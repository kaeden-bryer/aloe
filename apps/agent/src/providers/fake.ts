/**
 * The fake provider: no model, no Docker, no network. It waits a bit (so the
 * dashboard has something to show) and returns a deterministic patch. This is
 * what the end-to-end demo and the tests run.
 */
import type { ClaimedTask } from "@aloe/core/contracts";
import { systemClock, type Clock } from "../clock.ts";
import { NO_HIDDEN_TESTS_NOTE } from "../hidden-tests.ts";
import type { AgentProvider, CodeResult, VerifyResult } from "./types.ts";

export interface FakeProviderOptions {
  delayMs?: number;
  clock?: Clock;
  /** Test-only: make the fake hidden-test run fail. Env ALOE_FAKE_HIDDEN_FAIL=1 sets it for demos. */
  failHiddenTests?: boolean;
}

export class FakeProvider implements AgentProvider {
  readonly name = "fake";
  private readonly delayMs: number;
  private readonly clock: Clock;
  private readonly failHiddenTests: boolean;

  constructor(opts: FakeProviderOptions = {}) {
    this.failHiddenTests = opts.failHiddenTests ?? process.env.ALOE_FAKE_HIDDEN_FAIL === "1";
    this.delayMs = opts.delayMs ?? 3000;
    this.clock = opts.clock ?? systemClock;
  }

  async runCodeTask(task: ClaimedTask, signal: AbortSignal): Promise<CodeResult> {
    await this.work(signal);
    return {
      patch: fakePatch(task),
      summary: `Fake provider: added aloe-notes/${safeName(task.id)}.md for "${oneLine(task.title)}".`,
      model: "none",
      harness: "aloe-fake/1",
    };
  }

  async runVerifyTask(task: ClaimedTask, signal: AbortSignal): Promise<VerifyResult> {
    await this.work(signal);
    // No Docker here, so "running" hidden tests is deterministic: they pass
    // unless the test-only flag says otherwise. Without any, the note says so.
    const hiddenTestsPassed = !this.failHiddenTests;
    const hiddenNote = task.hiddenTests
      ? `Hidden tests (${task.hiddenTests.files.length} files): fake run ${hiddenTestsPassed ? "passed" : "failed"}`
      : NO_HIDDEN_TESTS_NOTE;
    return {
      testsPassed: true,
      hiddenTestsPassed: task.hiddenTests ? hiddenTestsPassed : true,
      reviewVerdict: "approve",
      notes: `Fake provider: approved without looking.\n${hiddenNote}`,
    };
  }

  private async work(signal: AbortSignal): Promise<void> {
    await this.clock.sleep(this.delayMs, signal);
    // The clock's sleep returns early on abort; turn that into a rejection
    // so the loop knows the result never came.
    signal.throwIfAborted();
  }
}

/** A unified diff that creates one small file. `git apply` accepts it on any repo. */
export function fakePatch(task: ClaimedTask): string {
  const file = `aloe-notes/${safeName(task.id)}.md`;
  const body = [
    `# ${oneLine(task.title)}`,
    "",
    `Task ${task.id} was handled by the Aloe fake provider.`,
    `Goal: ${oneLine(task.spec.goal)}`,
  ];
  return [
    `diff --git a/${file} b/${file}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${file}`,
    `@@ -0,0 +1,${body.length} @@`,
    ...body.map((line) => `+${line}`),
    "",
  ].join("\n");
}

const safeName = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "_");
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 200);
