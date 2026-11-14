/**
 * Maintainer API (/api/maintain/*): onboarding interview, GitHub issue import
 * into a draft queue, and the decision inbox.
 *
 * Auth: a signed-in session whose user maintains the project in the URL
 * (`requireMaintainerOf`, session.ts). Donors and other projects' maintainers get 403.
 *
 * Safety rule: GitHub issue text is untrusted. It goes only to the steward,
 * which rewrites it into a TaskSpec; the spec lands in `task_drafts`, which
 * the agent claim query never reads. A maintainer must approve a draft before
 * it becomes a real queued task.
 */
import { Hono, type Context } from "hono";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  ApproveDraftResponse,
  Decision,
  DraftTask,
  ImportIssuesRequest,
  ImportIssuesResponse,
  MAX_IMPORT_ISSUES,
  MaintainerBrief,
  OnboardRequest,
  ResolveDecisionRequest,
  UpdateDraftRequest,
  newId,
  schema,
  type AloeDb,
  type TaskSpec,
} from "@aloe/core";
import { octokitClient, parseRepoUrl, type GitHubClient } from "./github.ts";
import { errorBody, HttpError, readBody, send } from "./http.ts";
import { interviewToBrief, issuesToTaskSpecs } from "./steward/index.ts";
import { listDecisions } from "./views.ts";

const { projects, tasks, taskDrafts, events, decisions } = schema;

export interface MaintainerDeps {
  now: () => number;
  /** 401 if signed out, 403 unless the caller maintains `projectId`; returns the caller's user id (session.ts). */
  requireMaintainerOf: (c: Context, projectId: string) => string;
  /** Called after a decision is resolved (app.ts publishes newly merged work). */
  afterResolve?: (decisionId: string) => void;
  /** Injected in tests; defaults to a real Octokit client created per request (so env is read late). */
  github?: GitHubClient;
  steward?: {
    interviewToBrief: typeof interviewToBrief;
    issuesToTaskSpecs: typeof issuesToTaskSpecs;
  };
  /** The shared "maintainer answers an escalation" logic from app.ts. */
  resolveDecision: (db: AloeDb, decisionId: string, body: z.infer<typeof ResolveDecisionRequest>, resolvedBy: string, ts: number) => Decision;
}

type DraftRow = typeof taskDrafts.$inferSelect;
const toDraft = (r: DraftRow): DraftTask => ({
  id: r.id,
  projectId: r.projectId,
  sourceIssue: r.sourceIssue,
  spec: r.spec,
  createdAt: r.createdAt,
});

export function createMaintainerRoutes(db: AloeDb, deps: MaintainerDeps) {
  const r = new Hono();
  const steward = deps.steward ?? { interviewToBrief, issuesToTaskSpecs };

  // One guard for every project route: you must maintain the project in the URL.
  // (Checked before the 404 for unknown projects, so outsiders learn nothing about what exists.)
  r.use("/projects/:id/*", async (c, next) => {
    deps.requireMaintainerOf(c, c.req.param("id")!);
    await next();
  });

  const getProject = (c: Context) => {
    const p = db.select().from(projects).where(eq(projects.id, c.req.param("id")!)).get();
    if (!p) throw new HttpError(404, "not_found", "Project not found");
    return p;
  };
  const getDraft = (c: Context, projectId: string) => {
    const d = db
      .select()
      .from(taskDrafts)
      .where(and(eq(taskDrafts.id, c.req.param("draftId")!), eq(taskDrafts.projectId, projectId)))
      .get();
    if (!d) throw new HttpError(404, "not_found", "Draft not found");
    if (d.status !== "pending") throw new HttpError(409, "conflict", `Draft was already ${d.status}`);
    return d;
  };

  // ---------- (a) Onboarding ----------

  r.get("/projects/:id/brief", (c) => {
    const p = getProject(c);
    return send(c, MaintainerBrief, { projectId: p.id, brief: p.brief });
  });

  r.post("/projects/:id/onboard", async (c) => {
    const p = getProject(c);
    const { answers } = await readBody(c, OnboardRequest);
    const brief = await steward.interviewToBrief(answers);
    db.update(projects).set({ brief }).where(eq(projects.id, p.id)).run();
    db.insert(events).values({ id: newId("evt_"), ts: deps.now(), type: "project.onboarded", projectId: p.id, data: {} }).run();
    return send(c, MaintainerBrief, { projectId: p.id, brief });
  });

  // ---------- (b) Import issues -> drafts -> approve ----------

  r.post("/projects/:id/import", async (c) => {
    const p = getProject(c);
    const body = await readBody(c, ImportIssuesRequest);
    const ref = parseRepoUrl(p.repoUrl);
    if (!ref) throw new HttpError(400, "bad_request", "This project's repo URL is not a github.com/owner/repo URL");

    const gh = deps.github ?? octokitClient();
    let source = ref;
    let issues;
    try {
      // Forks usually have issues switched off, so read the upstream's issues instead.
      source = (await gh.getParent(ref)) ?? ref;
      issues = await gh.listOpenIssues(source, { label: body.label, max: body.limit ?? MAX_IMPORT_ISSUES });
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 404) throw new HttpError(404, "not_found", `GitHub repo ${source.owner}/${source.repo} not found (or the token can't see it)`);
      throw new HttpError(400, "bad_request", `GitHub request failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Don't re-draft an issue that already has a draft (even a rejected one: the maintainer said no).
    const seen = new Set(
      db.select({ n: taskDrafts.sourceIssue }).from(taskDrafts).where(eq(taskDrafts.projectId, p.id)).all().map((d) => d.n),
    );
    const fresh = issues.filter((i) => !seen.has(i.number));

    const specs = fresh.length ? await steward.issuesToTaskSpecs(p.brief, fresh) : [];
    const ts = deps.now();
    const rows: DraftRow[] = specs.map((spec) => ({
      id: newId("drf_"),
      projectId: p.id,
      sourceIssue: spec.sourceIssue ?? null,
      spec,
      status: "pending",
      taskId: null,
      createdAt: ts,
    }));
    if (rows.length) db.insert(taskDrafts).values(rows).run();
    return send(c, ImportIssuesResponse, {
      drafts: rows.map(toDraft),
      skipped: issues.length - fresh.length,
      source: `${source.owner}/${source.repo}`,
    });
  });

  r.get("/projects/:id/drafts", (c) => {
    const p = getProject(c);
    const rows = db.select().from(taskDrafts).where(and(eq(taskDrafts.projectId, p.id), eq(taskDrafts.status, "pending"))).orderBy(taskDrafts.createdAt).all();
    return send(c, z.array(DraftTask), rows.map(toDraft));
  });

  r.put("/projects/:id/drafts/:draftId", async (c) => {
    const p = getProject(c);
    const d = getDraft(c, p.id);
    const { spec } = await readBody(c, UpdateDraftRequest); // TaskSpec validation happens here
    db.update(taskDrafts).set({ spec }).where(eq(taskDrafts.id, d.id)).run();
    return send(c, DraftTask, toDraft({ ...d, spec }));
  });

  r.post("/projects/:id/drafts/:draftId/approve", (c) => {
    const p = getProject(c);
    const ts = deps.now();
    const taskId = db.transaction((tx) => {
      const d = tx.select().from(taskDrafts).where(and(eq(taskDrafts.id, c.req.param("draftId")!), eq(taskDrafts.projectId, p.id))).get();
      if (!d) throw new HttpError(404, "not_found", "Draft not found");
      if (d.status !== "pending") throw new HttpError(409, "conflict", `Draft was already ${d.status}`);
      // A task is born 'queued' (no earlier state, so there is no transition to assert);
      // every later change to it goes through assertTransition in the lease engine.
      const id = newId("task_");
      tx.insert(tasks)
        .values({ id, projectId: p.id, kind: "code", title: titleOf(d.spec), spec: d.spec, state: "queued", priority: 0, createdAt: ts, updatedAt: ts })
        .run();
      tx.update(taskDrafts).set({ status: "approved", taskId: id }).where(eq(taskDrafts.id, d.id)).run();
      tx.insert(events).values({ id: newId("evt_"), ts, type: "task.approved", projectId: p.id, taskId: id, data: { draftId: d.id } }).run();
      return id;
    });
    return send(c, ApproveDraftResponse, { taskId });
  });

  r.post("/projects/:id/drafts/:draftId/reject", (c) => {
    const p = getProject(c);
    const d = getDraft(c, p.id);
    db.update(taskDrafts).set({ status: "rejected" }).where(eq(taskDrafts.id, d.id)).run();
    return c.json({ ok: true });
  });

  // ---------- (c) Decision inbox ----------

  r.get("/projects/:id/decisions", (c) => {
    const p = getProject(c);
    return send(c, z.array(Decision), listDecisions(db, { status: "open", projectIds: [p.id] }));
  });

  r.post("/projects/:id/decisions/:decisionId/resolve", async (c) => {
    const p = getProject(c);
    const body = await readBody(c, ResolveDecisionRequest);
    const decisionId = c.req.param("decisionId")!;
    // Scope check: a maintainer URL for project A must not resolve project B's decision.
    const d = db.select({ projectId: decisions.projectId }).from(decisions).where(eq(decisions.id, decisionId)).get();
    if (!d || d.projectId !== p.id) throw new HttpError(404, "not_found", "Decision not found");
    const resolved = deps.resolveDecision(db, decisionId, body, deps.requireMaintainerOf(c, p.id), deps.now());
    deps.afterResolve?.(decisionId);
    return send(c, Decision, resolved);
  });

  r.all("*", (c) => c.json(errorBody("not_found", "No such API route"), 404));
  return r;
}

/** Queue rows show a one-line title; the full goal stays in the spec. */
function titleOf(spec: TaskSpec): string {
  const line = spec.goal.split("\n")[0]!.trim();
  return line.length > 120 ? `${line.slice(0, 117)}...` : line;
}
