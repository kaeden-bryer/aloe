/**
 * Staging publisher: after a task merges in our database, replay its patch onto
 * the `aloe/staging` branch of the project's fork and keep one PR up to date.
 *
 * Design rules:
 *  - The merge is already committed before we are called. Nothing here can
 *    roll it back or block it; failures are recorded in `staging_publishes`
 *    and retried on the next merge (or by `retryPending`).
 *  - One publish at a time per repo (a promise chain), so two merges can't
 *    race on the same working copy.
 *  - Patch contents are untrusted data: applied with `git apply` only, with
 *    hooks disabled, and never copied into the PR body.
 */
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, asc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { schema, type AloeDb, type StagingStatus } from "@aloe/core";
import { authEnv, cloneDirFor, runGit, scrub, type GitRunner } from "./git.ts";
import { octokitClient, type GithubClient } from "./github.ts";
import { ensurePublishTable, stagingPublishes } from "./schema.ts";

const { tasks, submissions, verifications, devices, donors, projects, decisions } = schema;

export const STAGING_BRANCH = "aloe/staging";
type Row = typeof stagingPublishes.$inferSelect;

export interface RepoRef {
  owner: string;
  repo: string;
  /** What `git clone` is given. https for GitHub; tests use file://. */
  cloneUrl: string;
}

export interface PublisherConfig {
  db: AloeDb;
  now: () => number;
  github: GithubClient;
  /** Only sent to github.com over https (see git.ts). */
  token?: string;
  cacheDir?: string;
  authorName?: string;
  authorEmail?: string;
  git?: GitRunner;
  /** Branch that aloe/staging starts from and the PR targets. Unset = the repo's default branch. */
  stagingBase?: string;
  resolveRepo?: (repoUrl: string) => RepoRef | null;
  /** Called with errors we swallow, so they are visible in logs. */
  log?: (msg: string) => void;
}

/** https://github.com/owner/repo(.git) -> owner/repo. Anything else is not publishable. */
export function parseGithubRepo(repoUrl: string): RepoRef | null {
  const m = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(repoUrl.trim());
  return m ? { owner: m[1]!, repo: m[2]!, cloneUrl: `https://github.com/${m[1]}/${m[2]}.git` } : null;
}

export interface StagingPublisher {
  /** Record a merged task as pending, then publish everything pending for its project. */
  onMerged(taskId: string): Promise<void>;
  /** Publish pending/failed rows (and any missing PR) for every project. */
  retryPending(): Promise<void>;
  /** Resolves when all queued publishes have finished. For tests and shutdown. */
  idle(): Promise<void>;
}

/** Gate: ALOE_PUBLISH_STAGING=1 and a token. Returns null (feature off) otherwise. */
export function publisherFromEnv(db: AloeDb, now: () => number, env = process.env): StagingPublisher | null {
  const token = env.GITHUB_TOKEN;
  if (env.ALOE_PUBLISH_STAGING !== "1" || !token) return null;
  return createStagingPublisher({
    db,
    now,
    token,
    github: octokitClient(token),
    cacheDir: env.ALOE_GIT_CACHE || undefined,
    stagingBase: env.ALOE_STAGING_BASE || undefined,
    authorName: env.ALOE_GIT_AUTHOR_NAME || undefined,
    authorEmail: env.ALOE_GIT_AUTHOR_EMAIL || undefined,
    log: (m) => console.error(`[publish] ${m}`),
  });
}

export function createStagingPublisher(cfg: PublisherConfig): StagingPublisher {
  const { db, now, github, token } = cfg;
  const git = cfg.git ?? runGit;
  const cacheDir = cfg.cacheDir ?? join(tmpdir(), "aloe-git-cache");
  const authorName = cfg.authorName ?? "Aloe Steward";
  const authorEmail = cfg.authorEmail ?? "aloe@users.noreply.github.com";
  const resolveRepo = cfg.resolveRepo ?? parseGithubRepo;
  const log = cfg.log ?? (() => {});
  ensurePublishTable(db);

  // ---- per-repo serialization: each key owns a promise chain ----
  const chains = new Map<string, Promise<void>>();
  const inFlight = new Set<Promise<void>>();
  function serialize(key: string, job: () => Promise<void>): Promise<void> {
    const prev = chains.get(key) ?? Promise.resolve();
    const next = prev.then(job, job).catch((e) => log(`publish crashed: ${scrub(String(e), token)}`));
    chains.set(key, next);
    inFlight.add(next);
    void next.then(() => inFlight.delete(next));
    return next;
  }

  const repoKey = (projectId: string) => {
    const p = db.select({ repoUrl: projects.repoUrl }).from(projects).where(eq(projects.id, projectId)).get();
    return p?.repoUrl ?? projectId;
  };

  function setRow(taskId: string, patch: Partial<Row>) {
    db.update(stagingPublishes).set({ ...patch, updatedAt: now() }).where(eq(stagingPublishes.taskId, taskId)).run();
  }

  async function onMerged(taskId: string): Promise<void> {
    const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
    if (!task) return;
    // The submission that merged = the newest one for this task (same rule the resolve route uses).
    const sub = db.select({ id: submissions.id }).from(submissions).where(eq(submissions.taskId, taskId)).orderBy(submissions.createdAt).all().at(-1);
    if (!sub) return;
    db.insert(stagingPublishes)
      .values({ taskId, projectId: task.projectId, submissionId: sub.id, status: "pending", createdAt: now(), updatedAt: now() })
      .onConflictDoNothing()
      .run();
    return serialize(repoKey(task.projectId), () => publishProject(task.projectId));
  }

  async function retryPending(): Promise<void> {
    // Projects with unfinished rows, or published rows that never got a PR url.
    const rows = db
      .select({ projectId: stagingPublishes.projectId })
      .from(stagingPublishes)
      .where(or(ne(stagingPublishes.status, "published"), isNull(stagingPublishes.prUrl)))
      .all();
    const ids = [...new Set(rows.map((r) => r.projectId))];
    await Promise.all(ids.map((id) => serialize(repoKey(id), () => publishProject(id))));
  }

  // ---- the actual work ----

  async function publishProject(projectId: string): Promise<void> {
    const todo = db
      .select()
      .from(stagingPublishes)
      .where(and(eq(stagingPublishes.projectId, projectId), inArray(stagingPublishes.status, ["pending", "failed"])))
      .orderBy(asc(stagingPublishes.createdAt))
      .all();
    const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
    const failAll = (rows: Row[], err: unknown) => {
      const msg = scrub(err instanceof Error ? err.message : String(err), token).slice(0, 500);
      for (const r of rows) setRow(r.taskId, { status: "failed", error: msg, attempts: r.attempts + 1 });
    };
    const repo = project ? resolveRepo(project.repoUrl) : null;
    if (!repo) return failAll(todo, new Error("Project repoUrl is not a GitHub repository"));

    let dir = "";
    let base = "";
    const published: Row[] = [];
    if (todo.length > 0) {
      try {
        ({ dir, base } = await prepareBranch(repo));
      } catch (e) {
        return failAll(todo, e);
      }
      const applied: { row: Row; sha: string }[] = [];
      for (const row of todo) {
        try {
          applied.push({ row, sha: await applyOne(dir, row) });
        } catch (e) {
          // Put the working copy back so the next patch starts clean.
          await git(["reset", "--hard", "--quiet"], { cwd: dir }).catch(() => {});
          failAll([row], e);
        }
      }
      if (applied.length > 0) {
        try {
          await git(["push", "--quiet", "origin", `${STAGING_BRANCH}:${STAGING_BRANCH}`], { cwd: dir, env: authEnv(token) });
          for (const { row, sha } of applied) {
            setRow(row.taskId, { status: "published", error: null, commitSha: sha, attempts: row.attempts + 1 });
            published.push(row);
          }
        } catch (e) {
          failAll(applied.map((a) => a.row), e); // e.g. remote moved; next run re-fetches and re-applies
        }
      }
    }

    // PR: one per project. Runs even with nothing new if an earlier PR call failed.
    const live = db.select().from(stagingPublishes).where(and(eq(stagingPublishes.projectId, projectId), eq(stagingPublishes.status, "published"))).all();
    if (live.length === 0) return;
    if (!base) {
      try {
        ({ base } = await prepareBranch(repo));
      } catch (e) {
        log(`cannot resolve default branch: ${scrub(String(e), token)}`);
        return;
      }
    }
    try {
      const pr = await upsertPr(repo, base, live);
      for (const r of live) if (r.prUrl !== pr.url) setRow(r.taskId, { prUrl: pr.url });
    } catch (e) {
      log(`PR update failed: ${scrub(String(e), token)}`);
    }
  }

  /** Clone/fetch, then check out aloe/staging at the remote tip (or fork it off the default branch). */
  async function prepareBranch(repo: RepoRef): Promise<{ dir: string; base: string }> {
    const dir = cloneDirFor(cacheDir, repo.cloneUrl, repo.repo);
    const g = (args: string[], env?: Record<string, string>) => git(["-c", "core.hooksPath=/dev/null", ...args], { cwd: dir, env });
    if (!existsSync(join(dir, ".git"))) {
      await rm(dir, { recursive: true, force: true });
      await git(["clone", "--quiet", repo.cloneUrl, dir], { env: authEnv(token) });
    }
    await g(["reset", "--hard", "--quiet"]);
    await g(["clean", "-fdq"]);
    await g(["fetch", "--quiet", "--prune", "origin"], authEnv(token));
    await g(["remote", "set-head", "origin", "--auto"], authEnv(token)).catch(() => {});
    // A configured base (e.g. aloe/demo-base) wins over the default branch, so a live
    // merge of the PR can only ever land there and never on the fork's trunk.
    const base = cfg.stagingBase ?? (await g(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])).replace(/^origin\//, "");
    if (cfg.stagingBase) await g(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${base}`]).catch(() => {
      throw new Error(`Staging base branch ${base} does not exist on the remote`);
    });
    const remoteStaging = await g(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${STAGING_BRANCH}`]).then(() => true, () => false);
    // -B resets the local branch to the remote tip, discarding any leftovers from a failed run.
    await g(["checkout", "--quiet", "-B", STAGING_BRANCH, remoteStaging ? `origin/${STAGING_BRANCH}` : `origin/${base}`]);
    return { dir, base };
  }

  /** Apply one submission's patch and commit it. Returns the commit sha. */
  async function applyOne(dir: string, row: Row): Promise<string> {
    const info = describe(row);
    if (!info) throw new Error("Submission or task no longer exists");
    const g = (args: string[]) => git(["-c", "core.hooksPath=/dev/null", ...args], { cwd: dir });
    const tmp = await mkdtemp(join(tmpdir(), "aloe-patch-"));
    try {
      const file = join(tmp, "change.patch");
      await writeFile(file, info.patch.endsWith("\n") ? info.patch : `${info.patch}\n`);
      // --3way merges when the context drifted since the donor's checkout; it also stages the result.
      await g(["apply", "--3way", file]).catch((e: Error) => {
        throw new Error(`Patch does not apply: ${e.message}`);
      });
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
    const staged = await g(["diff", "--cached", "--quiet"]).then(() => false, () => true);
    if (staged) {
      const message = [
        oneLine(info.title, 100),
        "",
        `Aloe task ${row.taskId} (${info.category}).`,
        `Contributed by ${oneLine(info.donor, 60)} using ${oneLine(info.device, 60)} (model ${oneLine(info.model, 60)}).`,
        `Verification: ${info.verification}.`,
      ].join("\n");
      await g(["-c", `user.name=${authorName}`, "-c", `user.email=${authorEmail}`, "commit", "--quiet", "-m", message]);
    }
    // No staged changes = already on the branch; record HEAD instead of failing.
    return g(["rev-parse", "HEAD"]);
  }

  async function upsertPr(repo: RepoRef, base: string, live: Row[]) {
    const body = prBody(live);
    const found = await github.findOpenPr({ owner: repo.owner, repo: repo.repo, branch: STAGING_BRANCH });
    if (found) return github.updatePr({ owner: repo.owner, repo: repo.repo, number: found.number, body });
    return github.createPr({ owner: repo.owner, repo: repo.repo, branch: STAGING_BRANCH, base, title: "Aloe: staged changes from donor agents", body });
  }

  function prBody(live: Row[]): string {
    const lines = live
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((r) => describe(r))
      .filter((d): d is NonNullable<typeof d> => d !== null)
      .map((d) => `- **${md(d.title)}** (${d.category}): contributed by ${md(d.donor)} on ${md(d.device)} using \`${d.model.replace(/`/g, "")}\`. Verification: ${md(d.verification)}.`);
    return [
      "This pull request collects work done by Aloe donor agents. Each change was written by a donor's AI agent and reviewed by independent verifier agents before being merged into this staging branch.",
      "",
      "## Included changes",
      "",
      ...lines,
      "",
      "_Maintained automatically by the Aloe steward. Please review as you would any contribution._",
    ].join("\n");
  }

  /** Everything we show about a merged task. Only structured fields; free text from agents stays out. */
  function describe(row: Row) {
    const t = db.select().from(tasks).where(eq(tasks.id, row.taskId)).get();
    const s = db.select().from(submissions).where(eq(submissions.id, row.submissionId)).get();
    if (!t || !s) return null;
    const donor = db.select({ name: donors.name }).from(donors).where(eq(donors.id, s.donorId)).get();
    const device = db.select({ name: devices.name }).from(devices).where(eq(devices.id, s.deviceId)).get();
    const v = db.select().from(verifications).where(eq(verifications.submissionId, s.id)).orderBy(verifications.createdAt).all().at(-1);
    const d = db.select({ resolution: decisions.resolution }).from(decisions).where(and(eq(decisions.taskId, t.id), eq(decisions.status, "resolved"))).get();
    const parts: string[] = [];
    if (v) parts.push(`tests ${v.testsPassed ? "passed" : "failed"}`, `hidden tests ${v.hiddenTestsPassed ? "passed" : "failed"}`, `review verdict: ${v.reviewVerdict}`);
    if (d) parts.push("approved by a maintainer");
    return {
      title: t.title,
      category: t.spec.category,
      donor: donor?.name ?? "a donor",
      device: device?.name ?? "a device",
      model: s.model,
      patch: s.patch,
      verification: parts.length ? parts.join(", ") : "no verification recorded",
    };
  }

  return { onMerged, retryPending, idle: async () => void (await Promise.all([...inFlight])) };
}

/** Collapse whitespace so untrusted names can't inject extra commit-message lines. */
const oneLine = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);
/** Single-line, and no live @mentions or markdown links in a PR body. */
const md = (s: string) => oneLine(s, 120).replace(/@/g, "@​").replace(/[[\]<>`]/g, "");

/** Read model for GET /api/projects/:id/staging. */
export function stagingStatus(db: AloeDb, projectId: string, enabled: boolean): StagingStatus {
  ensurePublishTable(db);
  const rows = db
    .select({ r: stagingPublishes, title: tasks.title })
    .from(stagingPublishes)
    .innerJoin(tasks, eq(tasks.id, stagingPublishes.taskId))
    .where(eq(stagingPublishes.projectId, projectId))
    .orderBy(asc(stagingPublishes.createdAt))
    .all();
  return {
    enabled,
    branch: STAGING_BRANCH,
    prUrl: rows.map((x) => x.r.prUrl).filter(Boolean).at(-1) ?? null,
    items: rows.map(({ r, title }) => ({
      taskId: r.taskId,
      title,
      status: r.status,
      error: r.error,
      commitSha: r.commitSha,
      attempts: r.attempts,
      updatedAt: r.updatedAt,
    })),
  };
}
