/**
 * The "real" provider: Claude Agent SDK inside the aloe-sandbox container.
 *
 * Code task:
 *   fresh git worktree -> container runs query() in /work -> host `git diff` -> patch
 * Verify task:
 *   fresh worktree + apply the patch under review -> model reviews (read-only
 *   mount) -> test command runs in the container -> verdict
 *
 * Auth: this provider uses an Anthropic API key (ANTHROPIC_API_KEY). Anthropic's
 * terms require API-key auth for third-party products built on Claude; a
 * distributed agent like Aloe must not borrow a donor's consumer subscription
 * login.
 */
import { z } from "zod";
import type { ClaimedTask } from "@aloe/core/contracts";
import type { RunResult } from "../exec.ts";
import { applyPatch, diffWorktree, guardGitPointer, withWorktree } from "../git.ts";
import { runHiddenTests } from "../hidden-tests.ts";
import { parseReviewReply } from "../prompt.ts";
import { runSandbox, tail, withTaskDir } from "./docker.ts";
import type { AgentProvider, CodeResult, VerifyResult } from "./types.ts";

export interface ClaudeSdkOptions {
  aloeHome: string;
  log: (line: string) => void;
  image?: string;
  maxTurns?: number;
  testTimeoutMs?: number;
}

/** The runner's last stdout line in code mode. */
const CodeFinal = z.object({ summary: z.string(), model: z.string().optional() });

export class ClaudeSdkProvider implements AgentProvider {
  readonly name = "claude-sdk";
  private readonly image: string;
  private readonly env: Record<string, string>;

  constructor(private readonly opts: ClaudeSdkOptions) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        "The claude-sdk provider needs ANTHROPIC_API_KEY (an API key from the Claude Console). " +
          "Use --provider fake to try the agent without one.",
      );
    }
    this.image = opts.image ?? process.env.ALOE_SANDBOX_IMAGE ?? "aloe-sandbox";
    this.env = { ALOE_MAX_TURNS: String(opts.maxTurns ?? 30) };
    if (process.env.ALOE_MODEL) this.env.ALOE_MODEL = process.env.ALOE_MODEL;
  }

  runCodeTask(task: ClaimedTask, signal: AbortSignal): Promise<CodeResult> {
    const { aloeHome, log } = this.opts;
    return withWorktree(aloeHome, task.repoUrl, task.id, signal, (worktree) =>
      withTaskDir(aloeHome, task, async (taskDir) => {
        const restoreGit = await guardGitPointer(worktree);
        let res: RunResult;
        try {
          res = await runSandbox({
            image: this.image,
            mode: "code",
            worktree,
            taskDir,
            signal,
            env: this.env,
            onLine: (line) => {
              if (!line.startsWith("{")) log(`  | ${line}`); // progress; the final JSON line is parsed below
            },
          });
        } finally {
          await restoreGit();
        }
        if (res.code !== 0) throw new Error(`sandbox exited ${res.code}: ${tail(res.stderr || res.stdout)}`);

        const final = CodeFinal.parse(JSON.parse(lastLine(res.stdout)));
        return {
          patch: await diffWorktree(worktree),
          summary: final.summary.slice(0, 5000),
          model: final.model ?? process.env.ALOE_MODEL ?? "unknown",
          harness: "claude-agent-sdk/aloe-sandbox",
        };
      }),
    );
  }

  runVerifyTask(task: ClaimedTask, signal: AbortSignal): Promise<VerifyResult> {
    const { aloeHome } = this.opts;
    const review = task.review;
    if (!review) throw new Error("verify task has no submission to review");

    return withWorktree(aloeHome, task.repoUrl, task.id, signal, async (worktree): Promise<VerifyResult> => {
      try {
        await applyPatch(worktree, review.patch);
      } catch (err) {
        return reject(`Patch does not apply cleanly: ${(err as Error).message}`);
      }

      return withTaskDir(aloeHome, task, async (taskDir) => {
        const restoreGit = await guardGitPointer(worktree);
        try {
          // Review first, on a read-only mount, so it sees exactly the patched
          // tree and nothing the test run might generate.
          const reviewRun = await runSandbox({
            image: this.image,
            mode: "review",
            worktree,
            worktreeReadOnly: true,
            taskDir,
            signal,
            env: this.env,
          });
          const verdict = reviewRun.code === 0 ? parseReviewReply(lastLine(reviewRun.stdout)) : null;

          // Tests: the host runs `sh -c <testCommand>` in the same image. This
          // is simpler than a runner "test" mode and needs no API key.
          let testsPassed = true;
          let testNote = "no test command in spec";
          if (task.spec.testCommand.trim()) {
            const testRun = await runSandbox({
              image: this.image,
              mode: "test",
              worktree,
              taskDir,
              signal,
              shellCommand: task.spec.testCommand,
              timeoutMs: this.opts.testTimeoutMs ?? 10 * 60_000,
            });
            testsPassed = testRun.code === 0;
            testNote = `\`${task.spec.testCommand}\` exited ${testRun.code}`;
          }

          // Hidden tests ride along on the verify lease. They run last because
          // writing them into the worktree changes it (the review already saw the clean tree).
          const hidden = await runHiddenTests({
            worktree,
            hidden: task.hiddenTests,
            image: this.image,
            taskDir,
            signal,
            timeoutMs: this.opts.testTimeoutMs,
          });

          return {
            testsPassed,
            hiddenTestsPassed: hidden.passed,
            reviewVerdict: verdict?.verdict ?? "unsure",
            notes: `${verdict?.notes ?? `review run failed: ${tail(reviewRun.stderr)}`}\nTests: ${testNote}\n${hidden.note}`.slice(0, 5000),
          };
        } finally {
          await restoreGit();
        }
      });
    });
  }
}

function reject(notes: string): VerifyResult {
  return { testsPassed: false, hiddenTestsPassed: false, reviewVerdict: "reject", notes: notes.slice(0, 5000) };
}

function lastLine(text: string): string {
  return text.trim().split("\n").at(-1) ?? "";
}
