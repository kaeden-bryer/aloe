/**
 * The HTTP API from packages/core/API.md.
 *
 * `createApp(db)` takes its database (and optionally a clock) as arguments
 * instead of opening one itself, so tests can run the whole API against an
 * in-memory SQLite with `app.request()` and no network.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { Hono, type Context } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  assertTransition,
  Cause,
  CauseId,
  ClaimRequest,
  AuthMe,
  ClaimResponse,
  Dashboard,
  Decision,
  DemoLoginRequest,
  DemoUser,
  DonorSettings,
  HeartbeatRequest,
  HeartbeatResponse,
  HiddenTests,
  IllegalTransitionError,
  Me,
  PairRequest,
  PairResponse,
  ProjectDetail,
  ProjectSummary,
  ResolveDecisionRequest,
  StagingStatus,
  SubmitRequest,
  VerifyResultRequest,
  claimTask,
  heartbeat,
  newId,
  recordVerification,
  releaseTask,
  schema,
  submitWork,
  type AloeDb,
  type TaskState,
} from "@aloe/core";
import { bearerToken, hashToken, newDeviceToken, secretsMatch } from "./auth.ts";
import { buildDashboard } from "./dashboard.ts";
import { errorBody, HttpError, leaseFailure, readBody, send } from "./http.ts";
import { resetAndSeed } from "./seed.ts";
import { CAUSES } from "./seed-data.ts";
import { getMe, getProject, listDecisions, listProjects, toDecision } from "./views.ts";
import { SERVER_ROOT } from "./database.ts";
import { createSessionTools } from "./session.ts";
import { mountWeeklyEmail } from "./email/routes.ts";
import type { EmailSender } from "./email/send.ts";
import type { GitHubClient } from "./github.ts";
import { createMaintainerRoutes, type MaintainerDeps } from "./maintainer.ts";
import { publisherFromEnv, stagingStatus, type StagingPublisher } from "./publish/publisher.ts";

const { devices, donors, projects, backings, decisions, tasks, events, submissions } = schema;

const hiddenTestsTable = schema.hiddenTests;

type Device = typeof devices.$inferSelect;
type Env = { Variables: { device: Device } };

export interface AppOptions {
  /** Clock, injectable for tests. */
  now?: () => number;
  /** Shared secret agents use to pair. Defaults to env ALOE_DEMO_PAIRING_CODE, then "aloe-demo". */
  pairingCode?: string;
  /** Built web app to serve at `/`. Defaults to apps/web/dist; pass null to disable. */
  webDist?: string | null;
  /** Email provider for the weekly report. Omit to use RESEND_API_KEY; null = not configured. */
  emailSender?: EmailSender | null;
  /** Demo sign-in picker + demo reset. Default: env ALOE_DEMO_LOGIN=1. Off = those routes 404. */
  demoLogin?: boolean;
  /** TEST ONLY: act as this user id without a cookie. Never wired to a request header. */
  actAs?: (c: Context) => string | null | undefined;
  /** Maintainer area: GitHub client, injected in tests. */
  github?: GitHubClient;
  /** Maintainer area: steward functions, injectable in tests. */
  steward?: MaintainerDeps["steward"];
  /** Publishes merged work to the fork's aloe/staging branch. Default: from env (ALOE_PUBLISH_STAGING=1 + GITHUB_TOKEN), else off. */
  publisher?: StagingPublisher | null;
}

// How long an idle agent waits before asking again. Short for demos (set in .env),
// longer in production so thousands of idle agents don't poll the server constantly.
// Read per request, not at import time: index.ts loads .env after this module is imported.
const idleRetryMs = () => Number(process.env.ALOE_IDLE_RETRY_MS ?? 30_000);
const pausedRetryMs = () => Math.max(idleRetryMs(), 60_000);

export function createApp(db: AloeDb, opts: AppOptions = {}) {
  const now = opts.now ?? Date.now;
  const app = new Hono<Env>();
  const auth = createSessionTools({ db, now, actAs: opts.actAs });
  // Read per request (not at import) because index.ts loads .env after this module is imported.
  const demoLoginOn = () => opts.demoLogin ?? process.env.ALOE_DEMO_LOGIN === "1";
  const requireDemoLogin = () => {
    if (!demoLoginOn()) throw new HttpError(404, "not_found", "No such API route");
  };
  const publisher = opts.publisher === undefined ? publisherFromEnv(db, now) : opts.publisher;
  // On a real boot, retry anything a previous run left pending or failed.
  if (opts.publisher === undefined && publisher) void publisher.retryPending();
  /**
   * Called only AFTER the merge transaction has committed. Fire and forget:
   * a GitHub outage must never fail or slow the merge. Failures are recorded
   * in the staging_publishes table by the publisher itself.
   */
  const publishMerged = (taskId: string) => {
    publisher?.onMerged(taskId).catch((e) => console.error("[publish] could not queue", e));
  };

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json(errorBody(err.code, err.message), err.status);
    if (err instanceof IllegalTransitionError) return c.json(errorBody("illegal_transition", err.message), 409);
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  });

  app.get("/api/health", (c) => c.json({ ok: true }));

  // ================= Agent API =================

  app.post("/api/agent/pair", async (c) => {
    const body = await readBody(c, PairRequest);
    const expected = opts.pairingCode ?? process.env.ALOE_DEMO_PAIRING_CODE ?? "aloe-demo";
    if (!secretsMatch(body.pairingCode, expected)) throw new HttpError(401, "unauthorized", "Wrong pairing code");
    const donor = db.select().from(donors).where(eq(donors.id, body.donorId)).get();
    if (!donor) throw new HttpError(404, "not_found", "Unknown donor");

    const token = newDeviceToken();
    const deviceId = newId("dev_");
    const ts = now();
    db.insert(devices)
      .values({ id: deviceId, donorId: donor.id, name: body.deviceName, tokenHash: hashToken(token), lastSeenAt: ts, createdAt: ts })
      .run();
    db.insert(events)
      .values({ id: newId("evt_"), ts, type: "device.paired", donorId: donor.id, data: { deviceId, deviceName: body.deviceName } })
      .run();
    // The only time the plain token exists on the server: we return it and forget it.
    return send(c, PairResponse, { deviceId, token });
  });

  /** Every other agent route needs a paired device's bearer token. */
  const requireDevice = async (c: Context<Env>, next: () => Promise<void>) => {
    const token = bearerToken(c.req.header("authorization"));
    if (!token) throw new HttpError(401, "unauthorized", "Missing bearer token");
    const device = db.select().from(devices).where(eq(devices.tokenHash, hashToken(token))).get();
    if (!device) throw new HttpError(401, "unauthorized", "Unknown device token");
    const ts = now();
    db.update(devices).set({ lastSeenAt: ts }).where(eq(devices.id, device.id)).run();
    c.set("device", { ...device, lastSeenAt: ts });
    await next();
  };
  app.use("/api/agent/claim", requireDevice);
  app.use("/api/agent/tasks/*", requireDevice);

  app.post("/api/agent/claim", async (c) => {
    const { kinds } = await readBody(c, ClaimRequest);
    const device = c.get("device");
    const donor = db.select({ paused: donors.paused }).from(donors).where(eq(donors.id, device.donorId)).get();
    // Pausing in Settings has to stop the agent, wherever it runs.
    if (donor?.paused) return send(c, ClaimResponse, { task: null, retryAfterMs: pausedRetryMs() });

    const task = claimTask(db, { deviceId: device.id, donorId: device.donorId, kinds, now: now() });
    return send(c, ClaimResponse, task ? { task } : { task: null, retryAfterMs: idleRetryMs() });
  });

  app.post("/api/agent/tasks/:id/heartbeat", async (c) => {
    const { leaseToken } = await readBody(c, HeartbeatRequest);
    const res = heartbeat(db, { taskId: c.req.param("id"), deviceId: c.get("device").id, leaseToken, now: now() });
    if (!res.ok) throw leaseFailure(res);
    return send(c, HeartbeatResponse, { leaseExpiresAt: res.leaseExpiresAt });
  });

  app.post("/api/agent/tasks/:id/release", async (c) => {
    // Same body as a heartbeat: just the fencing token.
    const { leaseToken } = await readBody(c, HeartbeatRequest);
    const res = releaseTask(db, { taskId: c.req.param("id"), deviceId: c.get("device").id, leaseToken, now: now() });
    if (!res.ok) throw leaseFailure(res);
    return c.json({ ok: true });
  });

  app.post("/api/agent/tasks/:id/submit", async (c) => {
    const body = await readBody(c, SubmitRequest);
    const device = c.get("device");
    const res = submitWork(db, { ...body, taskId: c.req.param("id"), deviceId: device.id, donorId: device.donorId, now: now() });
    if (!res.ok) throw leaseFailure(res);
    return c.json({ submissionId: res.submissionId, verifyTaskId: res.verifyTaskId });
  });

  app.post("/api/agent/tasks/:id/verify", async (c) => {
    const body = await readBody(c, VerifyResultRequest);
    const device = c.get("device");
    const res = recordVerification(db, { ...body, taskId: c.req.param("id"), deviceId: device.id, donorId: device.donorId, now: now() });
    if (!res.ok) throw leaseFailure(res);
    if (res.outcome === "auto_merge" || res.outcome === "spot_check") publishMerged(res.codeTaskId);
    return c.json({ outcome: res.outcome });
  });

  // ================= Web API =================
  // Identity comes from the session cookie (session.ts). Public routes use `viewerId`
  // (maybe signed out); donor routes use `requireDonor` (401 without a session).

  const viewerId = (c: Context) => auth.currentUser(c)?.id ?? "";
  const requireDonor = (c: Context) => auth.requireUser(c).id;

  app.get("/api/auth/me", (c) => {
    const user = auth.currentUser(c);
    return send(c, AuthMe, { user, maintainerOf: user ? auth.maintainerOf(user.id) : [] });
  });

  // Demo-only sign-in: pick a persona, get a real session cookie. Off unless ALOE_DEMO_LOGIN=1.
  // GitHub sign-in will replace this step; the session and role checks stay.
  app.get("/api/auth/demo-users", (c) => {
    requireDemoLogin();
    const personas = db.select().from(donors).all().map((d) => ({ id: d.id, name: d.name, email: d.email, maintainerOf: auth.maintainerOf(d.id) }));
    // Personas = the two seeded donors, plus anyone who maintains a project.
    const shown = personas
      .filter((p) => p.maintainerOf.length > 0 || p.id === "demo-donor" || p.id === "demo-donor-2")
      .map((p) => ({ ...p, role: p.maintainerOf.length > 0 ? ("maintainer" as const) : ("donor" as const) }));
    return send(c, z.array(DemoUser), shown);
  });

  app.post("/api/auth/demo-login", async (c) => {
    requireDemoLogin();
    const { userId } = await readBody(c, DemoLoginRequest);
    const user = auth.userById(userId);
    if (!user) throw new HttpError(404, "not_found", "Unknown user");
    auth.startSession(c, user.id);
    return send(c, AuthMe, { user, maintainerOf: auth.maintainerOf(user.id) });
  });

  app.post("/api/auth/logout", (c) => {
    auth.endSession(c);
    return c.json({ ok: true });
  });

  const requireProject = (id: string) => {
    if (!db.select({ id: projects.id }).from(projects).where(eq(projects.id, id)).get()) {
      throw new HttpError(404, "not_found", "Project not found");
    }
  };

  app.get("/api/causes", (c) => send(c, z.array(Cause), CAUSES));

  app.get("/api/projects", (c) => {
    const raw = c.req.query("cause");
    const cause = raw === undefined || raw === "" ? undefined : CauseId.safeParse(raw);
    if (cause && !cause.success) throw new HttpError(400, "bad_request", `Unknown cause '${raw}'`);
    return send(c, z.array(ProjectSummary), listProjects(db, viewerId(c), now(), cause?.data));
  });

  app.get("/api/projects/:id", (c) => {
    const detail = getProject(db, c.req.param("id"), viewerId(c), now());
    if (!detail) throw new HttpError(404, "not_found", "Project not found");
    return send(c, ProjectDetail, detail);
  });

  app.get("/api/projects/:id/staging", (c) => {
    requireProject(c.req.param("id"));
    return send(c, StagingStatus, stagingStatus(db, c.req.param("id"), publisher !== null));
  });

  app.post("/api/projects/:id/back", (c) => {
    const donorId = requireDonor(c);
    const projectId = c.req.param("id");
    requireProject(projectId);
    db.insert(backings).values({ donorId, projectId, createdAt: now() }).onConflictDoNothing().run();
    return c.json({ ok: true });
  });

  app.delete("/api/projects/:id/back", (c) => {
    const donorId = requireDonor(c);
    const projectId = c.req.param("id");
    requireProject(projectId);
    db.delete(backings).where(and(eq(backings.donorId, donorId), eq(backings.projectId, projectId))).run();
    return c.json({ ok: true });
  });

  app.get("/api/me", (c) => send(c, Me, getMe(db, requireDonor(c))!));

  app.put("/api/me/settings", async (c) => {
    const donorId = requireDonor(c);
    const s = await readBody(c, DonorSettings);
    db.update(donors)
      .set({ causes: s.causes, pct: s.pct, schedule: s.schedule, paused: s.paused, weeklyEmail: s.weeklyEmail, decisionAlerts: s.decisionAlerts })
      .where(eq(donors.id, donorId))
      .run();
    return send(c, Me, getMe(db, donorId)!);
  });

  app.get("/api/me/dashboard", (c) => send(c, Dashboard, buildDashboard(db, requireDonor(c), now())));
  mountWeeklyEmail(app, { db, now, requireDonor, emailSender: opts.emailSender });

  app.get("/api/decisions", (c) => {
    requireDonor(c);
    const status = c.req.query("status");
    if (status !== undefined && status !== "open" && status !== "resolved") {
      throw new HttpError(400, "bad_request", "status must be 'open' or 'resolved'");
    }
    return send(c, z.array(Decision), listDecisions(db, { status }));
  });

  // There is deliberately NO donor-reachable "resolve" route: the one way to answer an
  // escalation is POST /api/maintain/projects/:id/decisions/:decisionId/resolve, which
  // checks the caller maintains that project.

  /** After a maintainer resolves a decision: approving an escalated task is the other way work reaches "merged". */
  const afterResolve = (decisionId: string) => {
    const taskId = db.select({ t: decisions.taskId }).from(decisions).where(eq(decisions.id, decisionId)).get()?.t;
    if (taskId && db.select({ s: tasks.state }).from(tasks).where(eq(tasks.id, taskId)).get()?.s === "merged") publishMerged(taskId);
  };

  app.route(
    "/api/maintain",
    createMaintainerRoutes(db, { now, requireMaintainerOf: auth.requireMaintainerOf, afterResolve, github: opts.github, steward: opts.steward, resolveDecision }),
  );

  app.post("/api/demo/reset", (c) => {
    // Wiping the database is a demo convenience: only with demo login on, and only for someone signed in.
    requireDemoLogin();
    auth.requireUser(c);
    resetAndSeed(db, now());
    return c.json({ ok: true });
  });

  // ================= Maintainer API: hidden tests =================
  // Auth: a signed-in maintainer of THIS project (session cookie + project_maintainers row).
  // Donors must never read hidden tests; the web app never calls these routes, and hidden
  // tests appear in no web/public response.

  /** "" = project-wide; otherwise a code task of this project that gets its own override. */
  const hiddenScope = (c: Context, projectId: string) => {
    auth.requireMaintainerOf(c, projectId);
    requireProject(projectId);
    const taskId = c.req.query("taskId") ?? "";
    if (taskId) {
      const t = db.select({ projectId: tasks.projectId }).from(tasks).where(eq(tasks.id, taskId)).get();
      if (!t || t.projectId !== projectId) throw new HttpError(404, "not_found", "Task not found in this project");
    }
    return taskId;
  };

  app.put("/api/projects/:id/hidden-tests", async (c) => {
    const projectId = c.req.param("id");
    const taskId = hiddenScope(c, projectId);
    const body = await readBody(c, HiddenTests);
    db.insert(hiddenTestsTable)
      .values({ projectId, taskId, command: body.command, files: body.files, updatedAt: now() })
      .onConflictDoUpdate({
        target: [hiddenTestsTable.projectId, hiddenTestsTable.taskId],
        set: { command: body.command, files: body.files, updatedAt: now() },
      })
      .run();
    return send(c, HiddenTests, body);
  });

  app.get("/api/projects/:id/hidden-tests", (c) => {
    const projectId = c.req.param("id");
    const taskId = hiddenScope(c, projectId);
    const row = db
      .select()
      .from(hiddenTestsTable)
      .where(and(eq(hiddenTestsTable.projectId, projectId), eq(hiddenTestsTable.taskId, taskId)))
      .get();
    if (!row) throw new HttpError(404, "not_found", "No hidden tests set");
    return send(c, HiddenTests, { command: row.command, files: row.files });
  });

  app.delete("/api/projects/:id/hidden-tests", (c) => {
    const projectId = c.req.param("id");
    const taskId = hiddenScope(c, projectId);
    db.delete(hiddenTestsTable).where(and(eq(hiddenTestsTable.projectId, projectId), eq(hiddenTestsTable.taskId, taskId))).run();
    return c.json({ ok: true });
  });

  app.all("/api/*", (c) => c.json(errorBody("not_found", "No such API route"), 404));

  // ================= Web app =================

  const webDist = opts.webDist === undefined ? resolve(SERVER_ROOT, "../web/dist") : opts.webDist;
  if (webDist && existsSync(join(webDist, "index.html"))) {
    app.use("/*", serveStatic({ root: relative(process.cwd(), webDist) }));
    // SPA fallback: client-side routes like /projects/eae load index.html and the router takes over.
    app.get("*", (c) => c.html(readFileSync(join(webDist, "index.html"), "utf8")));
  }

  return app;
}

/**
 * A maintainer's answer to an escalation. One transaction, so the decision,
 * the task's new state and the events all change together or not at all.
 */
function resolveDecision(
  db: AloeDb,
  decisionId: string,
  body: z.infer<typeof ResolveDecisionRequest>,
  resolvedBy: string,
  ts: number,
): Decision {
  return db.transaction((tx) => {
    const d = tx.select().from(decisions).where(eq(decisions.id, decisionId)).get();
    if (!d) throw new HttpError(404, "not_found", "Decision not found");
    if (d.status !== "open") throw new HttpError(409, "conflict", "Decision is already resolved");
    const option = d.options.find((o) => o.id === body.optionId);
    if (!option) throw new HttpError(400, "bad_request", `Unknown option '${body.optionId}'`);

    const resolution = body.note ? `${option.label}: ${body.note}` : option.label;
    tx.update(decisions).set({ status: "resolved", resolution, resolvedAt: ts }).where(eq(decisions.id, d.id)).run();
    tx.insert(events)
      .values({ id: newId("evt_"), ts, type: "decision.resolved", projectId: d.projectId, taskId: d.taskId, data: { decisionId: d.id, optionId: option.id, resolvedBy } })
      .run();

    const task = d.taskId ? tx.select().from(tasks).where(eq(tasks.id, d.taskId)).get() : undefined;
    if (task?.state === "escalated") {
      const to: TaskState = option.id === "approve" ? "merged" : option.id === "close" ? "closed" : "queued";
      assertTransition(task.state, to);
      // Sent back to the queue = a fresh start, so earlier failures don't escalate it again at once.
      tx.update(tasks)
        .set({ state: to, updatedAt: ts, leaseDeviceId: null, leaseExpiresAt: null, ...(to === "queued" ? { attempts: 0 } : {}) })
        .where(eq(tasks.id, task.id))
        .run();

      const author = tx
        .select({ donorId: submissions.donorId, id: submissions.id })
        .from(submissions)
        .where(eq(submissions.taskId, task.id))
        .orderBy(submissions.createdAt)
        .all()
        .at(-1);
      tx.insert(events)
        .values({
          id: newId("evt_"),
          ts,
          type: to === "merged" ? "task.merged" : to === "closed" ? "task.closed" : "task.requeued",
          projectId: task.projectId,
          taskId: task.id,
          donorId: author?.donorId ?? null,
          data: { outcome: "maintainer", decisionId: d.id, submissionId: author?.id },
        })
        .run();
      if (to === "merged" && author) {
        const row = tx.select({ n: donors.verifiedCount }).from(donors).where(eq(donors.id, author.donorId)).get();
        tx.update(donors).set({ verifiedCount: (row?.n ?? 0) + 1 }).where(eq(donors.id, author.donorId)).run();
      }
    }

    const project = tx.select().from(projects).where(eq(projects.id, d.projectId)).get()!;
    const updated = tx.select().from(decisions).where(eq(decisions.id, d.id)).get()!;
    return toDecision(updated, project);
  });
}
