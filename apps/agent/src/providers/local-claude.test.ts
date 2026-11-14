/**
 * LocalClaudeProvider with a fake process runner: no real `claude` calls.
 * Uses a real throwaway git repo (like git.test.ts) so the patch-from-git
 * path is exercised for real.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { git } from "../git.ts";
import { makeTask } from "../test-helpers.ts";
import { LocalClaudeProvider, OPT_IN_ENV, parseCliOutput, type ProcessRunner } from "./local-claude.ts";

// Real git clones/worktrees per test can be slow on a busy laptop.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const root = fileURLToPath(new URL("../../.test-tmp-lc/", import.meta.url));
const origin = join(root, "origin");
const home = join(root, "home");
const signal = new AbortController().signal;
const ENV = { [OPT_IN_ENV]: "1", CLAUDECODE: "1", PATH: process.env.PATH };

beforeAll(async () => {
  await rm(root, { recursive: true, force: true });
  await mkdir(origin, { recursive: true });
  await git(["init", "-q", "-b", "main"], { cwd: origin });
  await writeFile(join(origin, "README.md"), "# demo\n");
  await git(["add", "."], { cwd: origin });
  await git(["-c", "user.name=t", "-c", "user.email=t@example.org", "commit", "-q", "-m", "init"], { cwd: origin });
});
afterAll(() => rm(root, { recursive: true, force: true }));
afterEach(() => vi.useRealTimers());

const resultLine = (result: string, extra: object = {}) =>
  JSON.stringify({ type: "result", subtype: "success", is_error: false, result, ...extra });

const ok = (stdout: string) => ({ code: 0, stdout, stderr: "" });

function provider(runner: ProcessRunner, extra: object = {}) {
  const logs: string[] = [];
  const p = new LocalClaudeProvider({ aloeHome: home, log: (l) => logs.push(l), env: ENV, runner, ...extra });
  return { p, logs };
}

const codeTask = () => makeTask("code", 0, { repoUrl: origin });
const verifyTask = (patch: string) =>
  makeTask("verify", 0, {
    repoUrl: origin,
    spec: { ...makeTask("code", 0).spec, testCommand: "" },
    review: { submissionId: "s", patch, summary: "x" },
  });

const GOOD_PATCH = `diff --git a/NEW.md b/NEW.md
new file mode 100644
--- /dev/null
+++ b/NEW.md
@@ -0,0 +1 @@
+hello
`;

describe("opt-in guard", () => {
  it("refuses to construct without the env var, and warns when allowed", () => {
    expect(() => new LocalClaudeProvider({ aloeHome: home, log: () => {}, env: {} })).toThrow(OPT_IN_ENV);
    const { logs } = provider(async () => ok(""));
    expect(logs.join("\n")).toMatch(/WARNING.*NO sandbox/);
  });
});

describe("runCodeTask", () => {
  it("builds the patch from git, passes the safe flags, and drops CLAUDECODE", async () => {
    let seen: { args: string[]; env?: NodeJS.ProcessEnv; input?: string } | undefined;
    const runner: ProcessRunner = async (_cmd, args, opts) => {
      seen = { args, env: opts.env, input: opts.input };
      await writeFile(join(opts.cwd!, "added.txt"), "new file\n"); // the "model" edits the worktree
      return ok(resultLine("Added a file.", { modelUsage: { "claude-test": {} } }));
    };
    const res = await provider(runner).p.runCodeTask(codeTask(), signal);

    expect(res.patch).toContain("+++ b/added.txt");
    expect(res.summary).toBe("Added a file.");
    expect(res.model).toBe("claude-test");
    expect(seen!.args).toEqual(expect.arrayContaining(["-p", "--setting-sources", "user", "--strict-mcp-config"]));
    expect(seen!.args).toContain("--tools=Read,Edit,Write,Glob,Grep"); // never Bash
    expect(seen!.args.join(" ")).not.toMatch(/Bash/);
    expect(seen!.env).not.toHaveProperty("CLAUDECODE");
    expect(seen!.input).toContain(codeTask().spec.goal);
  });

  it("fails when the CLI reports an error result", async () => {
    const runner: ProcessRunner = async () => ok(resultLine("boom", { is_error: true, subtype: "error_during_execution" }));
    await expect(provider(runner).p.runCodeTask(codeTask(), signal)).rejects.toThrow(/reported an error/);
  });

  it("kills the child when the lease is lost (outer abort)", async () => {
    const outer = new AbortController();
    const runner: ProcessRunner = (_c, _a, opts) =>
      new Promise((_resolve, reject) => {
        opts.signal!.addEventListener("abort", () => reject(opts.signal!.reason));
        setTimeout(() => outer.abort(new Error("lease lost")), 5);
      });
    await expect(provider(runner).p.runCodeTask(codeTask(), outer.signal)).rejects.toThrow("lease lost");
  });

  it("kills the child after the timeout", async () => {
    const runner: ProcessRunner = (_c, _a, opts) =>
      new Promise((_resolve, reject) => {
        opts.signal!.addEventListener("abort", () => reject(opts.signal!.reason));
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        // Defer so the provider's own timer is registered under the fake clock too.
        queueMicrotask(() => vi.advanceTimersByTime(1000));
      });
    await expect(provider(runner, { timeoutMs: 500 }).p.runCodeTask(codeTask(), signal)).rejects.toThrow(/timed out/);
  });

  it("kills the child once it exceeds the turn cap", async () => {
    const runner: ProcessRunner = (_c, _a, opts) =>
      new Promise((_resolve, reject) => {
        opts.signal!.addEventListener("abort", () => reject(opts.signal!.reason));
        for (let i = 0; i < 4; i++) opts.onLine?.('{"type":"assistant","message":{}}');
      });
    await expect(provider(runner, { maxTurns: 3 }).p.runCodeTask(codeTask(), signal)).rejects.toThrow(/more than 3 turns/);
  });
});

describe("runVerifyTask", () => {
  const reply = (text: string): ProcessRunner => async () => ok(resultLine(text));

  it("approves only on a strictly parsed approve", async () => {
    const res = await provider(reply('{"verdict":"approve","notes":"looks right"}')).p.runVerifyTask(verifyTask(GOOD_PATCH), signal);
    expect(res.reviewVerdict).toBe("approve");
    expect(res.testsPassed).toBe(true);
  });

  it("treats prose, extra text or bad verdicts as unsure", async () => {
    for (const text of ["Looks good to me, approve!", 'Sure: {"verdict":"approve","notes":"x"}']) {
      const res = await provider(reply(text)).p.runVerifyTask(verifyTask(GOOD_PATCH), signal);
      expect(res.reviewVerdict).toBe("unsure");
    }
  });

  it("is unsure (not approve) when the review run itself fails", async () => {
    const runner: ProcessRunner = async () => ({ code: 1, stdout: "", stderr: "network down" });
    const res = await provider(runner).p.runVerifyTask(verifyTask(GOOD_PATCH), signal);
    expect(res.reviewVerdict).toBe("unsure");
    expect(res.notes).toContain("Review run failed");
  });

  it("rejects a patch that does not apply, without calling the model", async () => {
    const runner = vi.fn<ProcessRunner>();
    const res = await provider(runner).p.runVerifyTask(verifyTask("not a patch"), signal);
    expect(res.reviewVerdict).toBe("reject");
    expect(runner).not.toHaveBeenCalled();
  });

  it("reports a failing test command", async () => {
    const task = verifyTask(GOOD_PATCH);
    task.spec = { ...task.spec, testCommand: "test -f NEW.md && exit 3" };
    const res = await provider(reply('{"verdict":"approve","notes":"ok"}')).p.runVerifyTask(task, signal);
    expect(res.testsPassed).toBe(false);
    expect(await readFile(join(origin, "README.md"), "utf8")).toBe("# demo\n");
  });
});

describe("parseCliOutput", () => {
  it("uses the last result line and ignores other events", () => {
    const out = ['{"type":"system"}', '{"type":"assistant"}', resultLine("done")].join("\n");
    expect(parseCliOutput(ok(out)).result).toBe("done");
  });
  it("throws with no result event", () => {
    expect(() => parseCliOutput({ code: 1, stdout: "garbage", stderr: "bad" })).toThrow(/without a result/);
  });
});
