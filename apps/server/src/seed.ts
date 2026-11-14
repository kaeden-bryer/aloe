/**
 * Demo seed: projects, donors, a live-looking queue and ~6 days of history,
 * so the dashboard has a chart and an activity feed on first load.
 *
 * Run with `pnpm --filter @aloe/server seed` (wipes and reseeds the database
 * at DATABASE_PATH), or call `resetAndSeed()` from POST /api/demo/reset.
 */
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { count, eq } from "drizzle-orm";
import { ESCALATION_OPTIONS, newId, schema, type AloeDb, type TaskSpec, type TaskState } from "@aloe/core";
import { CCF_BRIEF, CCF_DESIGN, CCF_REPO_URL, CCF_SANDBOX_IMAGE, CCF_TASKS } from "./seed-ccf.ts";
import { DONORS, PROJECT_EXTRAS, PROJECTS, CAUSES, type SeedTaskSpec } from "./seed-data.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Seeded leases outlast a normal 5-minute lease so the demo looks alive for a while, then lazily expire. */
const SEED_LEASE_MS = 45 * MIN;

type Tx = Parameters<Parameters<AloeDb["transaction"]>[0]>[0];

export function resetAndSeed(db: AloeDb, now: number): void {
  db.transaction((tx) => {
    // Keep agents that were paired for real (not the seeded ones), so a reset in the
    // middle of a demo doesn't log out the agents running in other terminals.
    const paired = tx
      .select()
      .from(schema.devices)
      .all()
      .filter((d) => !d.id.startsWith("dev_seed_"));

    // Children first, so foreign keys never point at a deleted row.
    for (const table of [
      schema.hiddenTests,
      schema.events,
      schema.taskDrafts,
      schema.decisions,
      schema.verifications,
      schema.submissions,
      schema.tasks,
      schema.devices,
      schema.backings,
      schema.donors,
      schema.projects,
    ]) {
      tx.delete(table).run();
    }
    seedInto(tx, now);

    const donorIds = new Set(tx.select({ id: schema.donors.id }).from(schema.donors).all().map((d) => d.id));
    for (const d of paired) {
      if (donorIds.has(d.donorId)) tx.insert(schema.devices).values(d).run();
    }
  });
}

export function seedIfEmpty(db: AloeDb, now: number): boolean {
  const row = db.select({ n: count() }).from(schema.projects).get();
  if ((row?.n ?? 0) > 0) return false;
  resetAndSeed(db, now);
  return true;
}

function seedInto(tx: Tx, now: number): void {
  const causeEmoji = new Map(CAUSES.map((c) => [c.id, c.emoji]));
  const deviceOf = new Map<string, string>();
  const verified = new Map<string, number>();

  // ---- projects ----
  for (const p of PROJECTS) {
    const x = PROJECT_EXTRAS[p.id]!;
    tx.insert(schema.projects)
      .values({
        id: p.id,
        name: p.name,
        emoji: causeEmoji.get(p.cause) ?? "🌱",
        owner: p.owner,
        cause: p.cause,
        alsoCauses: p.also,
        tagline: p.tagline,
        about: p.about,
        type: p.type,
        region: p.region,
        url: p.url,
        repoUrl: x.repoUrl,
        brief: x.brief,
        createdAt: now - 30 * DAY,
      })
      .run();
  }

  // ---- hidden tests: one tiny demo suite so the fake verify flow exercises the path ----
  tx.insert(schema.hiddenTests)
    .values({
      projectId: "eae",
      taskId: "",
      command: "node aloe-hidden/check.mjs",
      files: [
        {
          path: "aloe-hidden/check.mjs",
          content: "// Hidden: the patch author never sees this file.\nimport assert from 'node:assert';\nassert.strictEqual(1 + 1, 2);\nconsole.log('hidden ok');\n",
        },
      ],
      updatedAt: now,
    })
    .run();

  // ---- donors, their backings and one device each ----
  for (const d of DONORS) {
    tx.insert(schema.donors)
      .values({ id: d.id, name: d.name, email: d.email, causes: d.causes, createdAt: now - 28 * DAY })
      .run();
    for (const projectId of d.backs) {
      tx.insert(schema.backings).values({ donorId: d.id, projectId, createdAt: now - 27 * DAY }).run();
    }
    const deviceId = `dev_seed_${d.id}`;
    // Seeded devices get a random token nobody knows: they exist for history, not for pairing.
    tx.insert(schema.devices)
      .values({
        id: deviceId,
        donorId: d.id,
        name: d.deviceName,
        tokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
        lastSeenAt: now - 3 * MIN,
        createdAt: now - 27 * DAY,
      })
      .run();
    deviceOf.set(d.id, deviceId);
    verified.set(d.id, d.priorVerified);
  }

  const dev = (donorId: string) => deviceOf.get(donorId)!;

  const event = (ts: number, type: string, projectId: string, taskId: string, donorId: string | null, data: Record<string, unknown> = {}) =>
    tx.insert(schema.events).values({ id: newId("evt_"), ts, type, projectId, taskId, donorId, data }).run();

  const insertTask = (v: {
    projectId: string;
    kind: "code" | "verify";
    title: string;
    spec: TaskSpec;
    state: TaskState;
    priority?: number;
    createdAt: number;
    updatedAt?: number;
    leaseDeviceId?: string | null;
    leaseToken?: number;
    leaseExpiresAt?: number | null;
    attempts?: number;
    reviewsSubmissionId?: string;
    excludedDonorId?: string;
  }) => {
    const id = newId("task_");
    tx.insert(schema.tasks)
      .values({ id, updatedAt: v.updatedAt ?? v.createdAt, ...v })
      .run();
    return id;
  };

  const specFor = (projectId: string, title: string, s: SeedTaskSpec): TaskSpec => ({
    goal: title,
    acceptanceCriteria: [...s.criteria, "All existing tests still pass"],
    filesInScope: s.files,
    category: s.category,
    testCommand: PROJECT_EXTRAS[projectId]!.testCommand,
  });

  /** A code task an author finished: claim, submission, and the verify task that reviewed it. */
  const finishedWork = (o: {
    projectId: string;
    title: string;
    spec: TaskSpec;
    author: string;
    verifier: string | null;
    doneAt: number;
    codeState: TaskState;
    verifyLeasedUntil?: number;
  }) => {
    const claimedAt = o.doneAt - 70 * MIN;
    const submittedAt = o.doneAt - 25 * MIN;
    const codeTaskId = insertTask({
      projectId: o.projectId,
      kind: "code",
      title: o.title,
      spec: o.spec,
      state: o.codeState,
      createdAt: claimedAt - 2 * DAY,
      updatedAt: o.doneAt,
      leaseToken: 1,
      attempts: 1,
    });
    event(claimedAt, "task.claimed", o.projectId, codeTaskId, o.author, { kind: "code", leaseToken: 1 });

    const submissionId = newId("sub_");
    tx.insert(schema.submissions)
      .values({
        id: submissionId,
        taskId: codeTaskId,
        deviceId: dev(o.author),
        donorId: o.author,
        leaseToken: 1,
        patch: `diff --git a/${o.spec.filesInScope[0] ?? "README.md"} b/${o.spec.filesInScope[0] ?? "README.md"}\n# (seeded demo patch)\n`,
        summary: `${o.title}. All acceptance criteria met; test suite passes.`,
        model: "claude-sonnet-5-5",
        harness: "aloe-agent/0.1",
        createdAt: submittedAt,
      })
      .run();
    event(submittedAt, "task.submitted", o.projectId, codeTaskId, o.author, { submissionId });

    // A verifier that is still reviewing holds a lease; one that finished is 'done'.
    const reviewing = o.verifyLeasedUntil !== undefined;
    const verifyClaimedAt = submittedAt + 5 * MIN;
    const verifyTaskId = insertTask({
      projectId: o.projectId,
      kind: "verify",
      title: `Verify: ${o.title}`,
      spec: { ...o.spec, goal: `Review another donor's patch for: ${o.spec.goal}` },
      state: o.verifier === null ? "queued" : reviewing ? "leased" : "done",
      priority: 1000,
      createdAt: submittedAt,
      updatedAt: reviewing ? verifyClaimedAt : o.doneAt,
      reviewsSubmissionId: submissionId,
      excludedDonorId: o.author,
      leaseToken: o.verifier ? 1 : 0,
      attempts: o.verifier ? 1 : 0,
      leaseDeviceId: reviewing ? dev(o.verifier!) : null,
      leaseExpiresAt: reviewing ? o.verifyLeasedUntil : null,
    });
    if (o.verifier) {
      event(verifyClaimedAt, "task.claimed", o.projectId, verifyTaskId, o.verifier, { kind: "verify", leaseToken: 1 });
    }
    return { codeTaskId, submissionId, verifyTaskId, verifyClaimedAt };
  };

  const verify = (o: { projectId: string; codeTaskId: string; verifyTaskId: string; submissionId: string; verifier: string; ts: number; outcome: string }) => {
    tx.insert(schema.verifications)
      .values({
        id: newId("ver_"),
        submissionId: o.submissionId,
        deviceId: dev(o.verifier),
        donorId: o.verifier,
        testsPassed: true,
        hiddenTestsPassed: true,
        reviewVerdict: "approve",
        notes: "Tests pass and the change stays inside the files in scope.",
        createdAt: o.ts,
      })
      .run();
    event(o.ts, "task.verified", o.projectId, o.verifyTaskId, o.verifier, { codeTaskId: o.codeTaskId, verdict: "approve", outcome: o.outcome });
  };

  const startOfToday = new Date(now).setHours(0, 0, 0, 0);

  // ---- history: merged work spread over the last week ----
  for (const p of PROJECTS) {
    const x = PROJECT_EXTRAS[p.id]!;
    x.history.forEach((h, i) => {
      // Overnight runs (that's when donated quota is free), never in the future.
      const doneAt = Math.min(startOfToday - h.daysAgo * DAY + (2 + i * 0.8) * HOUR, now - (i + 1) * 20 * MIN);
      const spec = specFor(p.id, h.title, h);
      const outcome = h.category === "feature" ? "spot_check" : "auto_merge";
      const w = finishedWork({ projectId: p.id, title: h.title, spec, author: h.author, verifier: h.verifier, doneAt, codeState: "merged" });
      verify({ ...w, projectId: p.id, verifier: h.verifier, ts: doneAt - 2 * MIN, outcome });
      event(doneAt, "task.merged", p.id, w.codeTaskId, h.author, { outcome, submissionId: w.submissionId });
      verified.set(h.author, (verified.get(h.author) ?? 0) + 1);
    });
  }

  // ---- the design's in-flight work: review, progress, open, decision ----
  for (const p of PROJECTS) {
    const x = PROJECT_EXTRAS[p.id]!;
    for (const t of p.tasks) {
      const s = x.specs[t.title]!;
      const spec = specFor(p.id, t.title, s);

      switch (t.status) {
        case "merged":
          break; // already seeded as history
        case "open":
          insertTask({ projectId: p.id, kind: "code", title: t.title, spec, state: "queued", priority: s.priority ?? 1, createdAt: now - 3 * DAY });
          break;
        case "progress": {
          const claimedAt = now - 38 * MIN;
          const id = insertTask({
            projectId: p.id,
            kind: "code",
            title: t.title,
            spec,
            state: "leased",
            priority: 1,
            createdAt: now - 4 * DAY,
            updatedAt: claimedAt,
            leaseDeviceId: dev(x.people.progress),
            leaseToken: 1,
            leaseExpiresAt: now + SEED_LEASE_MS,
            attempts: 1,
          });
          event(claimedAt, "task.claimed", p.id, id, x.people.progress, { kind: "code", leaseToken: 1 });
          break;
        }
        case "review":
          finishedWork({
            projectId: p.id,
            title: t.title,
            spec,
            author: x.people.reviewAuthor,
            verifier: x.people.reviewer,
            doneAt: now - 20 * MIN,
            codeState: "verifying",
            verifyLeasedUntil: now + SEED_LEASE_MS,
          });
          break;
        case "decision": {
          const doneAt = now - 2 * DAY + 3 * HOUR;
          const w = finishedWork({
            projectId: p.id,
            title: t.title,
            spec,
            author: x.people.decisionAuthor,
            verifier: x.people.decisionVerifier,
            doneAt,
            codeState: "escalated",
          });
          verify({ ...w, projectId: p.id, verifier: x.people.decisionVerifier, ts: doneAt - 2 * MIN, outcome: "maintainer" });
          const decisionId = newId("dec_");
          tx.insert(schema.decisions)
            .values({
              id: decisionId,
              projectId: p.id,
              taskId: w.codeTaskId,
              // Same wording the design shows on the project page.
              question: `"${t.title}". ${p.decision}`,
              options: ESCALATION_OPTIONS,
              status: "open",
              createdAt: doneAt,
            })
            .run();
          event(doneAt, "task.escalated", p.id, w.codeTaskId, x.people.decisionAuthor, { decisionId });
          break;
        }
      }
    }

    for (const q of x.extraQueued) {
      insertTask({ projectId: p.id, kind: "code", title: q.title, spec: specFor(p.id, q.title, q), state: "queued", priority: q.priority ?? 1, createdAt: now - 2 * DAY });
    }
  }

  // ---- Cloud Carbon Footprint: a real fork with real tasks (no fake history) ----
  // Its own block instead of PROJECT_EXTRAS: the design projects all carry
  // fabricated history and in-flight work, which this honest project shouldn't.
  tx.insert(schema.projects)
    .values({
      id: CCF_DESIGN.id,
      name: CCF_DESIGN.name,
      emoji: causeEmoji.get(CCF_DESIGN.cause) ?? "🌱",
      owner: CCF_DESIGN.owner,
      cause: CCF_DESIGN.cause,
      alsoCauses: CCF_DESIGN.also,
      tagline: CCF_DESIGN.tagline,
      about: CCF_DESIGN.about,
      type: CCF_DESIGN.type,
      region: CCF_DESIGN.region,
      url: CCF_DESIGN.url,
      repoUrl: CCF_REPO_URL,
      sandboxImage: CCF_SANDBOX_IMAGE,
      brief: CCF_BRIEF,
      createdAt: now - 30 * DAY,
    })
    .run();
  for (const t of CCF_TASKS) {
    const id = insertTask({ projectId: CCF_DESIGN.id, kind: "code", title: t.title, spec: t.spec, state: "queued", priority: t.priority, createdAt: now - DAY });
    // Hidden tests are keyed by the *code* task id; only verify leases receive them.
    if (t.hiddenTests) {
      tx.insert(schema.hiddenTests)
        .values({ projectId: CCF_DESIGN.id, taskId: id, command: t.hiddenTests.command, files: t.hiddenTests.files, updatedAt: now })
        .run();
    }
  }

  for (const [donorId, n] of verified) {
    tx.update(schema.donors).set({ verifiedCount: n }).where(eq(schema.donors.id, donorId)).run();
  }
}

// `pnpm seed` runs this file directly; importing it (from the app) does not.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { openDatabase } = await import("./database.ts");
  const { db, path } = openDatabase();
  resetAndSeed(db, Date.now());
  console.log(`Seeded ${path}`);
}
