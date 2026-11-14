import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runHiddenTests } from "./hidden-tests.ts";
import { FakeProvider } from "./providers/fake.ts";
import type { SandboxOptions } from "./providers/docker.ts";
import { ManualClock, makeTask } from "./test-helpers.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "aloe-hidden-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const signal = new AbortController().signal;
const hidden = { command: "node hidden/check.mjs", files: [{ path: "hidden/check.mjs", content: "console.log(1)" }] };

/** A stand-in for the Docker sandbox: records what it was asked and returns a canned exit code. */
function fakeSandbox(code: number) {
  const calls: SandboxOptions[] = [];
  const sandbox = async (o: SandboxOptions) => {
    calls.push(o);
    return { code, stdout: "ran\n", stderr: code ? "boom" : "" };
  };
  return { calls, sandbox };
}

const base = () => ({ worktree: dir, image: "img", taskDir: dir, signal });

describe("runHiddenTests", () => {
  it("passes with a note when there are no hidden tests, without touching the sandbox", async () => {
    const s = fakeSandbox(1);
    const res = await runHiddenTests({ ...base(), hidden: undefined, sandbox: s.sandbox });
    expect(res).toMatchObject({ passed: true, note: "no hidden tests" });
    expect(s.calls).toHaveLength(0);
  });

  it("writes the files, runs the command in test mode and reports the exit code", async () => {
    const s = fakeSandbox(0);
    const res = await runHiddenTests({ ...base(), hidden, sandbox: s.sandbox });
    expect(res.passed).toBe(true);
    expect(await readFile(join(dir, "hidden/check.mjs"), "utf8")).toBe("console.log(1)");
    expect(s.calls[0]).toMatchObject({ mode: "test", shellCommand: "node hidden/check.mjs", worktree: dir });

    const failed = await runHiddenTests({ ...base(), hidden, sandbox: fakeSandbox(1).sandbox });
    expect(failed.passed).toBe(false);
    expect(failed.output).toContain("boom");
  });

  it("fails closed on hostile paths and never runs the command", async () => {
    const s = fakeSandbox(0);
    const evil = { command: "true", files: [{ path: "../escape.txt", content: "x" }] };
    await expect(runHiddenTests({ ...base(), hidden: evil, sandbox: s.sandbox })).rejects.toThrow(); // schema rejects it
    expect(s.calls).toHaveLength(0);
  });

  it("refuses to write through a symlink the patch planted", async () => {
    const outside = await mkdtemp(join(tmpdir(), "aloe-outside-"));
    try {
      await mkdir(join(dir, "x"), { recursive: true });
      await symlink(outside, join(dir, "hidden"));
      const s = fakeSandbox(0);
      const res = await runHiddenTests({ ...base(), hidden, sandbox: s.sandbox });
      expect(res.passed).toBe(false);
      expect(res.note).toContain("symlink");
      expect(s.calls).toHaveLength(0);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe("FakeProvider hidden tests", () => {
  const clock = new ManualClock();
  const run = (p: FakeProvider, task = makeTask("verify", 0, { hiddenTests: hidden })) =>
    clock.drive(p.runVerifyTask(task, signal));

  it("passes by default, fails when the test-only flag is set, and notes when absent", async () => {
    expect((await run(new FakeProvider({ clock, delayMs: 1 }))).hiddenTestsPassed).toBe(true);
    expect((await run(new FakeProvider({ clock, delayMs: 1, failHiddenTests: true }))).hiddenTestsPassed).toBe(false);
    const none = await run(new FakeProvider({ clock, delayMs: 1, failHiddenTests: true }), makeTask("verify", 0));
    expect(none).toMatchObject({ hiddenTestsPassed: true });
    expect(none.notes).toContain("no hidden tests");
  });
});
