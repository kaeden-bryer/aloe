/**
 * Full demo reset for the GitHub side: put the fork back to a known state so
 * the 5-minute demo can run again and again.
 *
 *   1. close open PRs whose head is aloe/staging
 *   2. force-set aloe/demo-base and aloe/staging to one pinned commit
 *   3. clear the staging_publishes ledger and delete the server's git cache clone
 *
 * This is the only code in Aloe that force-pushes, so it is deliberately
 * paranoid. Hard rules (each has a test):
 *   - only runs when ALOE_PUBLISH_STAGING=1
 *   - only for the repo named by GITHUB_DEMO_REPO (owner/repo), never any other
 *   - only touches refs starting with `aloe/`, and never the repo's default branch
 * The token is handled like the publisher does: env-only for git, never in argv,
 * URLs or logs.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { schema, type AloeDb, type ResetDemoResponse } from "@aloe/core";
import { Octokit } from "@octokit/rest";
import { authEnv, cloneDirFor, runGit, scrub, type GitRunner } from "./git.ts";
import { parseGithubRepo, STAGING_BRANCH, type RepoRef } from "./publisher.ts";
import { ensurePublishTable, stagingPublishes } from "./schema.ts";

/** The commit docker/sandbox-ccf is built from (see docker/sandbox-ccf/build.sh). Reset points the demo branches here. */
export const DEFAULT_DEMO_BASE_COMMIT = "f584c549ee358d5980d36513267d007ecd3ee716";
export const DEMO_BASE_BRANCH = "aloe/demo-base";

type GithubResult = NonNullable<ResetDemoResponse["github"]>;

/** The two GitHub calls the reset needs. Injected in tests; Octokit in production. */
export interface PrCloser {
  listOpenPrs(a: { owner: string; repo: string; branch: string }): Promise<{ number: number }[]>;
  closePr(a: { owner: string; repo: string; number: number }): Promise<void>;
}

export function octokitPrCloser(token: string): PrCloser {
  const octokit = new Octokit({ auth: token });
  return {
    async listOpenPrs({ owner, repo, branch }) {
      const { data } = await octokit.pulls.list({ owner, repo, state: "open", head: `${owner}:${branch}`, per_page: 20 });
      return data.map((p) => ({ number: p.number }));
    },
    async closePr({ owner, repo, number }) {
      await octokit.pulls.update({ owner, repo, pull_number: number, state: "closed" });
    },
  };
}

export interface DemoResetConfig {
  db: AloeDb;
  /** ALOE_PUBLISH_STAGING === "1". Off means every reset is refused. */
  enabled: boolean;
  /** `owner/repo`, from GITHUB_DEMO_REPO. The only repo this module will ever touch. */
  demoRepo?: string;
  baseCommit?: string;
  /** Branch that gets force-set as the PR base. Must start with `aloe/`. */
  baseBranch?: string;
  token?: string;
  github?: PrCloser;
  cacheDir?: string;
  git?: GitRunner;
  resolveRepo?: (repoUrl: string) => RepoRef | null;
  log?: (msg: string) => void;
}

export interface DemoResetter {
  /** Reset the GitHub side. Never throws: refusals and failures come back as ok:false. */
  reset(): Promise<GithubResult>;
}

/** A ref we may force-push: `aloe/` prefix, plain characters, no `..` tricks. */
export function isSafeDemoRef(ref: string): boolean {
  return /^aloe\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(ref) && !ref.includes("..") && !ref.endsWith(".lock") && !ref.endsWith("/");
}

export function demoResetterFromEnv(db: AloeDb, env = process.env): DemoResetter {
  const token = env.GITHUB_TOKEN;
  return createDemoResetter({
    db,
    enabled: env.ALOE_PUBLISH_STAGING === "1" && !!token,
    demoRepo: env.GITHUB_DEMO_REPO || undefined,
    baseCommit: env.ALOE_DEMO_BASE_COMMIT || undefined,
    baseBranch: env.ALOE_STAGING_BASE || undefined,
    token,
    github: token ? octokitPrCloser(token) : undefined,
    cacheDir: env.ALOE_GIT_CACHE || undefined,
    log: (m) => console.error(`[demo-reset] ${m}`),
  });
}

export function createDemoResetter(cfg: DemoResetConfig): DemoResetter {
  const { db, token } = cfg;
  const git = cfg.git ?? runGit;
  const log = cfg.log ?? (() => {});
  const cacheDir = cfg.cacheDir ?? join(tmpdir(), "aloe-git-cache");
  const resolveRepo = cfg.resolveRepo ?? parseGithubRepo;
  const baseCommit = cfg.baseCommit ?? DEFAULT_DEMO_BASE_COMMIT;
  const baseBranch = cfg.baseBranch ?? DEMO_BASE_BRANCH;

  const refuse = (message: string): GithubResult => ({ ok: false, message, closedPrs: 0, resetBranches: [], commit: null });

  async function reset(): Promise<GithubResult> {
    try {
      return await doReset();
    } catch (e) {
      const msg = scrub(e instanceof Error ? e.message : String(e), token).slice(0, 300);
      log(`failed: ${msg}`);
      return { ...refuse(`GitHub reset failed: ${msg}`) };
    }
  }

  async function doReset(): Promise<GithubResult> {
    // ---- safety gates, cheapest first; nothing below runs unless all pass ----
    if (!cfg.enabled) return refuse("Refused: GitHub reset needs ALOE_PUBLISH_STAGING=1 and a GITHUB_TOKEN.");
    if (!cfg.demoRepo || !/^[\w.-]+\/[\w.-]+$/.test(cfg.demoRepo)) return refuse("Refused: GITHUB_DEMO_REPO (owner/repo) is not set.");
    if (!cfg.github) return refuse("Refused: no GitHub client configured.");
    if (!/^[0-9a-f]{40}$/.test(baseCommit)) return refuse("Refused: ALOE_DEMO_BASE_COMMIT must be a full 40-character commit sha.");
    const refs = [baseBranch, STAGING_BRANCH];
    const bad = refs.find((r) => !isSafeDemoRef(r));
    if (bad) return refuse(`Refused: ${bad} does not start with aloe/ (reset only touches aloe/* branches).`);

    // The project must point at the demo repo; compare what its repoUrl resolves to, not just text.
    const wanted = cfg.demoRepo.toLowerCase();
    const project = db
      .select({ id: schema.projects.id, repoUrl: schema.projects.repoUrl })
      .from(schema.projects)
      .all()
      .find((p) => {
        const r = resolveRepo(p.repoUrl);
        return r && `${r.owner}/${r.repo}`.toLowerCase() === wanted;
      });
    if (!project) return refuse(`Refused: no project's repo matches GITHUB_DEMO_REPO (${cfg.demoRepo}).`);
    const repo = resolveRepo(project.repoUrl)!;
    if (`${repo.owner}/${repo.repo}`.toLowerCase() !== wanted) return refuse("Refused: repo does not match GITHUB_DEMO_REPO.");

    // ---- 1. close PRs from aloe/staging (before moving the branch, so GitHub doesn't auto-"merge" them) ----
    const open = await cfg.github.listOpenPrs({ owner: repo.owner, repo: repo.repo, branch: STAGING_BRANCH });
    for (const pr of open) await cfg.github.closePr({ owner: repo.owner, repo: repo.repo, number: pr.number });

    // ---- 2. force-set the demo branches, from a throwaway repo so we never disturb the publisher's cache ----
    const work = await mkdtemp(join(tmpdir(), "aloe-demo-reset-"));
    try {
      const g = (args: string[], withAuth = false) => git(["-c", "core.hooksPath=/dev/null", ...args], { cwd: work, env: withAuth ? authEnv(token) : undefined });
      await g(["init", "--quiet"]);
      await g(["remote", "add", "origin", repo.cloneUrl]); // plain URL: the token goes in via env only
      // Never touch the default branch, whatever it is called.
      const head = await g(["ls-remote", "--symref", "origin", "HEAD"], true);
      const defaultBranch = /^ref: refs\/heads\/(\S+)\s+HEAD/m.exec(head)?.[1];
      if (!defaultBranch) return refuse("Refused: could not tell the repo's default branch.");
      if (refs.includes(defaultBranch)) return refuse(`Refused: ${defaultBranch} is the default branch.`);
      await g(["fetch", "--quiet", "--depth", "1", "origin", baseCommit], true);
      // `+` = force. Explicit full ref names so a typo can't create or move anything else.
      await g(["push", "--quiet", "origin", ...refs.map((r) => `+${baseCommit}:refs/heads/${r}`)], true);
    } finally {
      await rm(work, { recursive: true, force: true });
    }

    // ---- 3. forget the ledger and the cached clone, so the next publish starts clean ----
    clearLedger(db);
    await rm(cloneDirFor(cacheDir, repo.cloneUrl, repo.repo), { recursive: true, force: true });

    return {
      ok: true,
      message: `Reset ${repo.owner}/${repo.repo}: closed ${open.length} PR(s), ${refs.join(" and ")} now at ${baseCommit.slice(0, 7)}.`,
      closedPrs: open.length,
      resetBranches: refs,
      commit: baseCommit,
    };
  }

  return { reset };
}

/** Empty the publish ledger. Also called by the plain DB reset. */
export function clearLedger(db: AloeDb): void {
  ensurePublishTable(db);
  db.delete(stagingPublishes).run();
}
