/**
 * Git helpers shared by the claude-sdk and local-claude providers.
 *
 * Layout under ALOE_HOME:
 *   repos/<hash>.git      one shallow bare clone per repo, reused across tasks
 *   work/<task>-<rand>/   a throwaway worktree per task
 *
 * Worktrees are cheap (they share the clone's object store) and give every
 * task a clean checkout, so one task's leftovers can't leak into the next.
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runOk } from "./exec.ts";

// Host-side git must never run code from the repo it's handling. Hooks and
// fsmonitor are the two ways a repo's config could make `git` execute things.
const SAFE = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false"];

export function git(args: string[], opts: { cwd?: string; input?: string; signal?: AbortSignal } = {}) {
  return runOk("git", [...SAFE, ...args], opts);
}

export function repoCacheDir(aloeHome: string, repoUrl: string): string {
  const hash = createHash("sha256").update(repoUrl).digest("hex").slice(0, 16);
  return join(aloeHome, "repos", `${hash}.git`);
}

/** Clone once, then `git fetch` on later tasks. Returns the commit to work on. */
export async function ensureRepo(cacheDir: string, repoUrl: string, signal?: AbortSignal): Promise<string> {
  if (!existsSync(cacheDir)) {
    await mkdir(join(cacheDir, ".."), { recursive: true });
    // `--` stops a hostile URL like "--upload-pack=..." being read as an option.
    await git(["clone", "--bare", "--depth", "1", "--", repoUrl, cacheDir], { signal });
    return (await git(["--git-dir", cacheDir, "rev-parse", "HEAD"])).trim();
  }
  await git(["--git-dir", cacheDir, "fetch", "--depth", "1", "origin", "HEAD"], { signal });
  return (await git(["--git-dir", cacheDir, "rev-parse", "FETCH_HEAD"])).trim();
}

/** Run `fn` in a fresh worktree of `repoUrl`; the worktree is removed afterwards, whatever happens. */
export async function withWorktree<T>(
  aloeHome: string,
  repoUrl: string,
  taskId: string,
  signal: AbortSignal,
  fn: (dir: string) => Promise<T>,
): Promise<T> {
  const cacheDir = repoCacheDir(aloeHome, repoUrl);
  const commit = await ensureRepo(cacheDir, repoUrl, signal);
  const dir = join(aloeHome, "work", `${taskId.replace(/[^\w.-]/g, "_")}-${randomBytes(3).toString("hex")}`);
  await mkdir(join(aloeHome, "work"), { recursive: true });
  await git(["--git-dir", cacheDir, "worktree", "add", "--detach", dir, commit]);
  try {
    return await fn(dir);
  } finally {
    await git(["--git-dir", cacheDir, "worktree", "remove", "--force", dir]).catch(() => {});
    await rm(dir, { recursive: true, force: true });
    await git(["--git-dir", cacheDir, "worktree", "prune"]).catch(() => {});
  }
}

/** Everything changed in the worktree (including new files) as one unified diff. */
export async function diffWorktree(dir: string): Promise<string> {
  await git(["add", "--all"], { cwd: dir });
  return git(["diff", "--cached", "--binary"], { cwd: dir });
}

export async function applyPatch(dir: string, patch: string): Promise<void> {
  await git(["apply", "--whitespace=nowarn", "-"], { cwd: dir, input: patch });
}

/**
 * A worktree's `.git` is a one-line file pointing at the clone. Code running
 * in the sandbox can write anywhere in the worktree, so it could replace that
 * file with a `.git/` directory holding a hostile config (e.g. an fsmonitor
 * command) that the host's next `git` call would execute. We snapshot the
 * pointer before the sandbox runs and put it back afterwards.
 */
export async function guardGitPointer(dir: string): Promise<() => Promise<void>> {
  const path = join(dir, ".git");
  const pointer = await readFile(path, "utf8");
  return async () => {
    await rm(path, { recursive: true, force: true });
    await writeFile(path, pointer);
  };
}
