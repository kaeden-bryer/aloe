/**
 * Exercises the worktree helpers against a real (local, throwaway) git repo.
 * Everything lives under apps/agent/.test-tmp and is deleted afterwards.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig, saveConfig } from "./config.ts";
import { applyPatch, diffWorktree, git, guardGitPointer, withWorktree } from "./git.ts";
import { fakePatch } from "./providers/fake.ts";
import { makeTask } from "./test-helpers.ts";

const root = fileURLToPath(new URL("../.test-tmp/", import.meta.url));
const origin = join(root, "origin");
const home = join(root, "home");
const signal = new AbortController().signal;

beforeAll(async () => {
  await rm(root, { recursive: true, force: true });
  await mkdir(origin, { recursive: true });
  await git(["init", "-q", "-b", "main"], { cwd: origin });
  await writeFile(join(origin, "README.md"), "# demo\n");
  await git(["add", "."], { cwd: origin });
  await git(["-c", "user.name=t", "-c", "user.email=t@example.org", "commit", "-q", "-m", "init"], { cwd: origin });
});

afterAll(() => rm(root, { recursive: true, force: true }));

// Real git clones + worktrees: fast when idle, but can take 10s+ on a loaded machine.
describe("git worktrees", { timeout: 60_000 }, () => {
  it("applies the fake patch in a fresh worktree and diffs it back", async () => {
    const task = makeTask("code", 0);
    let worktree = "";
    const diff = await withWorktree(home, origin, task.id, signal, async (dir) => {
      worktree = dir;
      expect(existsSync(join(dir, "README.md"))).toBe(true);
      await applyPatch(dir, fakePatch(task));
      return diffWorktree(dir);
    });
    expect(diff).toContain("+++ b/aloe-notes/task-1.md");
    expect(diff).toContain("Task task-1 was handled");
    // The worktree is cleaned up afterwards.
    expect(existsSync(worktree)).toBe(false);
  });

  it("reuses the cached clone for the next task (fetch, not clone)", async () => {
    await withWorktree(home, origin, "again", signal, async (dir) => {
      expect(existsSync(join(dir, "README.md"))).toBe(true);
    });
    expect(await readdir(join(home, "repos"))).toHaveLength(1);
  });

  it("restores the .git pointer if the sandbox replaced it", async () => {
    await withWorktree(home, origin, "guard", signal, async (dir) => {
      const restore = await guardGitPointer(dir);
      await rm(join(dir, ".git"));
      await mkdir(join(dir, ".git"));
      await writeFile(join(dir, ".git", "config"), "[core]\n\tfsmonitor = touch /tmp/pwned\n");
      await restore();
      expect((await stat(join(dir, ".git"))).isFile()).toBe(true);
      expect(await diffWorktree(dir)).toBe("");
    });
  });
});

describe("config", () => {
  it("saves agent.json with mode 0600 and reads it back", async () => {
    const config = { serverUrl: "http://localhost:8787", deviceId: "d1", token: "tok", donorId: "donor-1" };
    const path = await saveConfig(config, home);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await loadConfig(home)).toEqual(config);
  });
});
