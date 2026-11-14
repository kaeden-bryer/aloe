/**
 * Lease engine: hands out tasks so that no two donor agents do the same work.
 *
 * A lease is a lock with an expiry time. The holder renews it with heartbeats.
 * If a laptop sleeps mid-task, its lease simply expires and the task becomes
 * claimable again. No background sweeper is needed: the claim query treats
 * "expired lease" the same as "never leased" (lazy expiry).
 *
 * Fencing tokens: every claim increments `tasks.lease_token`. Heartbeats and
 * submissions must carry the token they were given. A client that wakes up
 * after its lease was re-issued holds a stale token and is rejected, so stale
 * work can never overwrite fresh work:
 *
 *   accept(s)  <=>  now < lease_expires_at  AND  s.token == task.lease_token
 *
 * Atomicity: SQLite allows one writer at a time, and each function below runs
 * its read-check-write inside a single transaction, so two agents can't claim
 * the same row. On Postgres you'd use `SELECT ... FOR UPDATE SKIP LOCKED`.
 *
 * Re-claiming an expired lease is a `leased -> leased` move. The state machine
 * has no self-loops, so that case skips `assertTransition` and is treated as a
 * fresh claim: new device, new token, new expiry.
 */
import { and, asc, desc, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { AloeDb } from "./db.ts";
import type { ClaimedTask, SubmitRequest, TaskKind, TaskSpec, VerifyResultRequest } from "./contracts.ts";
import { explainEscalation, route, type RouteInput, type RouteOutcome } from "./routing.ts";
import { assertTransition, IllegalTransitionError, type TaskState } from "./states.ts";
import { backings, decisions, donors, events, hiddenTests, projects, submissions, tasks, verifications } from "./schema.ts";
import { newId } from "./ids.ts";

export const DEFAULT_LEASE_MS = 5 * 60_000; // 5 minutes, renewed by heartbeats every ~60s

/**
 * Added to a code task's priority to get its verify task's priority. Keep
 * hand-set code priorities below this so verification always goes first.
 */
export const VERIFY_PRIORITY_BOOST = 1000;

/** The choices a maintainer gets on an escalated task. "approve" merges it. */
export const ESCALATION_OPTIONS = [
  { id: "approve", label: "Approve and merge" },
  { id: "requeue", label: "Send it back to the queue" },
  { id: "close", label: "Close without merging" },
];

export type LeaseFailure =
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "lease_lost" } // wrong token, wrong device, or expired
  | { ok: false; reason: "illegal_transition" };

export interface ClaimInput {
  deviceId: string;
  donorId: string;
  kinds: TaskKind[];
  now: number;
  leaseMs?: number;
}

type Tx = Parameters<Parameters<AloeDb["transaction"]>[0]>[0];
type TaskRow = typeof tasks.$inferSelect;

/**
 * Atomically lease the highest-priority claimable task, or return null.
 * Claimable = state 'queued', OR state 'leased' with lease_expires_at < now.
 * Never returns a verify task whose excluded_donor_id equals input.donorId.
 * Code tasks come only from projects the donor backs (none backed = verify only).
 * Increments lease_token and attempts; sets lease_device_id and lease_expires_at.
 * Writes a 'task.claimed' event.
 */
export function claimTask(db: AloeDb, input: ClaimInput): ClaimedTask | null {
  const { now, donorId, deviceId } = input;
  const leaseExpiresAt = now + (input.leaseMs ?? DEFAULT_LEASE_MS);
  if (input.kinds.length === 0) return null;

  // "immediate" takes SQLite's write lock at BEGIN, so the SELECT below and the
  // UPDATE after it see the same world: no other claimer can slip in between.
  return db.transaction(
    (tx) => {
      // Code work goes only to projects this donor backs: donors choose where
      // their capacity goes. Verification is a shared good, so any donor's agent
      // may verify any project (except their own work, below).
      const backed = tx
        .select({ projectId: backings.projectId })
        .from(backings)
        .where(eq(backings.donorId, donorId))
        .all()
        .map((b) => b.projectId);
      const projectAllowed =
        backed.length > 0
          ? or(eq(tasks.kind, "verify"), inArray(tasks.projectId, backed))
          : eq(tasks.kind, "verify");

      const task = tx
        .select()
        .from(tasks)
        .where(
          and(
            inArray(tasks.kind, input.kinds),
            or(eq(tasks.state, "queued"), and(eq(tasks.state, "leased"), lt(tasks.leaseExpiresAt, now))),
            // A reviewer must be a different person from the author.
            or(isNull(tasks.excludedDonorId), ne(tasks.excludedDonorId, donorId)),
            projectAllowed,
          ),
        )
        .orderBy(desc(tasks.priority), asc(tasks.createdAt))
        .limit(1)
        .get();
      if (!task) return null;

      const reclaimed = task.state === "leased";
      if (!reclaimed) assertTransition(task.state, "leased");

      const leaseToken = task.leaseToken + 1;
      tx.update(tasks)
        .set({
          state: "leased",
          leaseDeviceId: deviceId,
          leaseToken,
          leaseExpiresAt,
          attempts: sql`${tasks.attempts} + 1`,
          updatedAt: now,
        })
        .where(eq(tasks.id, task.id))
        .run();

      logEvent(tx, now, "task.claimed", task, donorId, { kind: task.kind, leaseToken, reclaimed });

      const project = tx.select({ repoUrl: projects.repoUrl, sandboxImage: projects.sandboxImage }).from(projects).where(eq(projects.id, task.projectId)).get();

      let review: ClaimedTask["review"];
      let hidden: ClaimedTask["hiddenTests"];
      if (task.kind === "verify" && task.reviewsSubmissionId) {
        const sub = tx.select().from(submissions).where(eq(submissions.id, task.reviewsSubmissionId)).get();
        if (sub) {
          review = { submissionId: sub.id, patch: sub.patch, summary: sub.summary };
          // Hidden tests are attached ONLY here, on verify leases: the patch
          // author's agent (a code lease) must never see them, or it could
          // write code that special-cases the tests. A task-level row beats the project-level one.
          const rows = tx.select().from(hiddenTests).where(eq(hiddenTests.projectId, task.projectId)).all();
          const row = rows.find((r) => r.taskId === sub.taskId) ?? rows.find((r) => r.taskId === "");
          if (row) hidden = { command: row.command, files: row.files };
        }
      }

      return {
        id: task.id,
        kind: task.kind,
        projectId: task.projectId,
        repoUrl: project?.repoUrl ?? "",
        title: task.title,
        spec: task.spec,
        leaseToken,
        leaseExpiresAt,
        ...(project?.sandboxImage ? { sandboxImage: project.sandboxImage } : {}),
        ...(review ? { review } : {}),
        ...(hidden ? { hiddenTests: hidden } : {}),
      };
    },
    { behavior: "immediate" },
  );
}

export interface HeartbeatInput {
  taskId: string;
  deviceId: string;
  leaseToken: number;
  now: number;
  leaseMs?: number;
}

/** Extend a live lease. Fails with lease_lost if token/device mismatch or lease expired. */
export function heartbeat(
  db: AloeDb,
  input: HeartbeatInput,
): { ok: true; leaseExpiresAt: number } | LeaseFailure {
  return guarded(db, (tx) => {
    const task = findTask(tx, input.taskId);
    if (!task) return fail("not_found");
    if (!holdsLease(task, input)) return fail("lease_lost");

    const leaseExpiresAt = input.now + (input.leaseMs ?? DEFAULT_LEASE_MS);
    tx.update(tasks).set({ leaseExpiresAt, updatedAt: input.now }).where(eq(tasks.id, task.id)).run();
    return { ok: true as const, leaseExpiresAt };
  });
}

/** Give a task back voluntarily (e.g. the donor's window closed). leased -> queued. */
export function releaseTask(
  db: AloeDb,
  input: { taskId: string; deviceId: string; leaseToken: number; now: number },
): { ok: true } | LeaseFailure {
  return guarded(db, (tx) => {
    const task = findTask(tx, input.taskId);
    if (!task) return fail("not_found");
    if (!holdsLease(task, input)) return fail("lease_lost");

    moveTask(tx, task, "queued", input.now, { leaseDeviceId: null, leaseExpiresAt: null });
    logEvent(tx, input.now, "task.released", task, null, { deviceId: input.deviceId });
    return { ok: true as const };
  });
}

/**
 * Accept a code submission. Checks the fencing token, stores the submission,
 * moves the task leased -> submitted -> verifying, and creates a verify task
 * (kind 'verify', excluded_donor_id = submitter's donor, priority above code
 * tasks so verification never starves). Writes 'task.submitted'.
 */
export function submitWork(
  db: AloeDb,
  input: { taskId: string; deviceId: string; donorId: string; now: number } & SubmitRequest,
): { ok: true; submissionId: string; verifyTaskId: string } | LeaseFailure {
  return guarded(db, (tx) => {
    const { now } = input;
    const task = findTask(tx, input.taskId);
    if (!task) return fail("not_found");
    if (!holdsLease(task, input)) return fail("lease_lost");
    if (task.kind !== "code") return fail("illegal_transition");

    const submissionId = newId("sub_");
    tx.insert(submissions)
      .values({
        id: submissionId,
        taskId: task.id,
        deviceId: input.deviceId,
        donorId: input.donorId,
        leaseToken: input.leaseToken,
        patch: input.patch,
        summary: input.summary,
        model: input.model,
        harness: input.harness,
        createdAt: now,
      })
      .run();

    // Two hops, both checked: the state machine has no leased -> verifying shortcut.
    const submitted = moveTask(tx, task, "submitted", now, { leaseDeviceId: null, leaseExpiresAt: null });
    moveTask(tx, submitted, "verifying", now);

    const verifyTaskId = newId("task_");
    tx.insert(tasks)
      .values({
        id: verifyTaskId,
        projectId: task.projectId,
        kind: "verify",
        title: `Verify: ${task.title}`,
        spec: verifySpec(task.spec),
        state: "queued",
        priority: task.priority + VERIFY_PRIORITY_BOOST,
        reviewsSubmissionId: submissionId,
        excludedDonorId: input.donorId,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    logEvent(tx, now, "task.submitted", task, input.donorId, { submissionId, verifyTaskId });
    return { ok: true as const, submissionId, verifyTaskId };
  });
}

/**
 * Accept a verifier's result. Checks the fencing token, stores the verification,
 * marks the verify task 'done', then applies `route()` to the reviewed code task:
 *   auto_merge / spot_check -> 'merged' (spot_check also writes an 'audit.sampled' event)
 *   maintainer             -> 'escalated' + a decisions row
 *   retry                  -> back to 'queued'
 * Increments the author donor's verified_count on merge. Writes events.
 */
export function recordVerification(
  db: AloeDb,
  input: { taskId: string; deviceId: string; donorId: string; now: number } & VerifyResultRequest,
): { ok: true; outcome: RouteOutcome; codeTaskId: string } | LeaseFailure {
  return guarded(db, (tx) => {
    const { now } = input;
    const verifyTask = findTask(tx, input.taskId);
    if (!verifyTask) return fail("not_found");
    if (!holdsLease(verifyTask, input)) return fail("lease_lost");
    if (verifyTask.kind !== "verify" || !verifyTask.reviewsSubmissionId) return fail("illegal_transition");

    const sub = tx.select().from(submissions).where(eq(submissions.id, verifyTask.reviewsSubmissionId)).get();
    if (!sub) return fail("not_found");
    const codeTask = findTask(tx, sub.taskId);
    if (!codeTask) return fail("not_found");
    const author = tx.select().from(donors).where(eq(donors.id, sub.donorId)).get();

    tx.insert(verifications)
      .values({
        id: newId("ver_"),
        submissionId: sub.id,
        deviceId: input.deviceId,
        donorId: input.donorId,
        testsPassed: input.testsPassed,
        hiddenTestsPassed: input.hiddenTestsPassed,
        reviewVerdict: input.reviewVerdict,
        notes: input.notes,
        createdAt: now,
      })
      .run();
    moveTask(tx, verifyTask, "done", now, { leaseDeviceId: null, leaseExpiresAt: null });

    const routeInput: RouteInput = {
      category: codeTask.spec.category,
      testsPassed: input.testsPassed,
      hiddenTestsPassed: input.hiddenTestsPassed,
      reviewVerdict: input.reviewVerdict,
      authorVerifiedCount: author?.verifiedCount ?? 0,
      attempts: codeTask.attempts,
    };
    const outcome = route(routeInput);
    logEvent(tx, now, "task.verified", verifyTask, input.donorId, {
      codeTaskId: codeTask.id,
      verdict: input.reviewVerdict,
      outcome,
    });

    switch (outcome) {
      case "auto_merge":
      case "spot_check":
        moveTask(tx, codeTask, "merged", now);
        tx.update(donors)
          .set({ verifiedCount: sql`${donors.verifiedCount} + 1` })
          .where(eq(donors.id, sub.donorId))
          .run();
        logEvent(tx, now, "task.merged", codeTask, sub.donorId, { outcome, submissionId: sub.id });
        if (outcome === "spot_check") logEvent(tx, now, "audit.sampled", codeTask, sub.donorId, { submissionId: sub.id });
        break;
      case "maintainer": {
        moveTask(tx, codeTask, "escalated", now);
        const decisionId = newId("dec_");
        tx.insert(decisions)
          .values({
            id: decisionId,
            projectId: codeTask.projectId,
            taskId: codeTask.id,
            question: `"${codeTask.title}". ${explainEscalation(routeInput)}`,
            options: ESCALATION_OPTIONS,
            status: "open",
            createdAt: now,
          })
          .run();
        logEvent(tx, now, "task.escalated", codeTask, sub.donorId, { decisionId });
        break;
      }
      case "retry":
        moveTask(tx, codeTask, "queued", now);
        logEvent(tx, now, "task.retry", codeTask, sub.donorId, { attempts: codeTask.attempts });
        break;
    }

    return { ok: true as const, outcome, codeTaskId: codeTask.id };
  });
}

// ---------- helpers ----------

function fail(reason: LeaseFailure["reason"]): LeaseFailure {
  return { ok: false, reason } as LeaseFailure;
}

/**
 * Run `fn` in one write transaction. If the state machine rejects a move,
 * the whole transaction rolls back (nothing half-written) and the caller gets
 * an `illegal_transition` failure instead of an exception.
 */
function guarded<T>(db: AloeDb, fn: (tx: Tx) => T): T | LeaseFailure {
  try {
    return db.transaction(fn, { behavior: "immediate" });
  } catch (err) {
    if (err instanceof IllegalTransitionError) return fail("illegal_transition");
    throw err;
  }
}

function findTask(tx: Tx, id: string): TaskRow | undefined {
  return tx.select().from(tasks).where(eq(tasks.id, id)).get();
}

/** The fencing check: right device, current token, lease not yet expired. */
function holdsLease(task: TaskRow, input: { deviceId: string; leaseToken: number; now: number }): boolean {
  return (
    task.state === "leased" &&
    task.leaseDeviceId === input.deviceId &&
    task.leaseToken === input.leaseToken &&
    task.leaseExpiresAt !== null &&
    input.now < task.leaseExpiresAt
  );
}

/** The single place task state changes. Returns the row as it now stands. */
function moveTask(
  tx: Tx,
  task: TaskRow,
  to: TaskState,
  now: number,
  extra: Partial<Pick<TaskRow, "leaseDeviceId" | "leaseExpiresAt">> = {},
): TaskRow {
  assertTransition(task.state, to);
  const patch = { state: to, updatedAt: now, ...extra };
  tx.update(tasks).set(patch).where(eq(tasks.id, task.id)).run();
  return { ...task, ...patch };
}

function logEvent(
  tx: Tx,
  ts: number,
  type: string,
  task: TaskRow,
  donorId: string | null,
  data: Record<string, unknown>,
): void {
  tx.insert(events).values({ id: newId("evt_"), ts, type, projectId: task.projectId, taskId: task.id, donorId, data }).run();
}

/** The verifier gets the same acceptance criteria, framed as a review job. */
function verifySpec(spec: TaskSpec): TaskSpec {
  return {
    ...spec,
    goal: `Review another donor's patch for: ${spec.goal}\nRun the tests and check every acceptance criterion.`.slice(0, 2000),
  };
}
