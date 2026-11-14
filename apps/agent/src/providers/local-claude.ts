/**
 * ============================================================================
 *  DEMO ONLY. NOT FOR DISTRIBUTION.
 *
 *  This provider runs the developer's own installed `claude` CLI, logged in
 *  with their own account, directly on their own machine, with no Docker
 *  sandbox. It exists so the person building Aloe can demo real model output
 *  at the hackathon without setting up Docker.
 *
 *  A distributed Aloe agent running on donors' machines must use API keys
 *  (the claude-sdk provider) unless Anthropic approves a subscription option.
 *  Do not ship this provider to donors.
 * ============================================================================
 *
 * Because nothing is sandboxed here, the model only gets file tools (no Bash)
 * and the repo's own .claude settings are not loaded. The verify step does
 * run the spec's test command on the host, which is acceptable only because
 * this is your own demo repo on your own machine.
 */
import { z } from "zod";
import type { ClaimedTask } from "@aloe/core/contracts";
import { run } from "../exec.ts";
import { applyPatch, diffWorktree, withWorktree } from "../git.ts";
import { buildCodePrompt, buildReviewPrompt, parseReviewReply } from "../prompt.ts";
import { tail } from "./docker.ts";
import type { AgentProvider, CodeResult, VerifyResult } from "./types.ts";

const EDIT_TOOLS = "Read,Edit,Write,Glob,Grep";
const READ_TOOLS = "Read,Glob,Grep";

/** The parts of `claude -p --output-format json` we use. */
const CliResult = z.object({
  result: z.string().default(""),
  is_error: z.boolean().default(false),
  modelUsage: z.record(z.string(), z.unknown()).optional(),
});

export class LocalClaudeProvider implements AgentProvider {
  readonly name = "local-claude";

  constructor(private readonly opts: { aloeHome: string; log: (line: string) => void }) {}

  runCodeTask(task: ClaimedTask, signal: AbortSignal): Promise<CodeResult> {
    return withWorktree(this.opts.aloeHome, task.repoUrl, task.id, signal, async (dir) => {
      const out = await this.claude(dir, buildCodePrompt(task.spec), EDIT_TOOLS, signal);
      return {
        patch: await diffWorktree(dir),
        summary: out.result.slice(0, 5000),
        model: Object.keys(out.modelUsage ?? {})[0] ?? "claude-cli",
        harness: "claude-cli/local (demo)",
      };
    });
  }

  runVerifyTask(task: ClaimedTask, signal: AbortSignal): Promise<VerifyResult> {
    const review = task.review;
    if (!review) throw new Error("verify task has no submission to review");

    return withWorktree(this.opts.aloeHome, task.repoUrl, task.id, signal, async (dir): Promise<VerifyResult> => {
      try {
        await applyPatch(dir, review.patch);
      } catch (err) {
        const notes = `Patch does not apply cleanly: ${(err as Error).message}`;
        return { testsPassed: false, hiddenTestsPassed: false, reviewVerdict: "reject", notes };
      }

      const out = await this.claude(dir, buildReviewPrompt(task.spec, review.patch), READ_TOOLS, signal);
      const verdict = parseReviewReply(out.result);

      let testsPassed = true;
      let testNote = "no test command in spec";
      if (task.spec.testCommand.trim()) {
        const res = await run("sh", ["-c", task.spec.testCommand], { cwd: dir, signal });
        testsPassed = res.code === 0;
        testNote = `\`${task.spec.testCommand}\` exited ${res.code}`;
      }
      return {
        testsPassed,
        hiddenTestsPassed: testsPassed, // TODO: hidden tests fetched from the server
        reviewVerdict: verdict.verdict,
        notes: `${verdict.notes}\nTests: ${testNote}`.slice(0, 5000),
      };
    });
  }

  private async claude(cwd: string, prompt: string, tools: string, signal: AbortSignal) {
    // The prompt goes in on stdin rather than as `-p "<prompt>"`: a review
    // prompt includes the whole patch, which can exceed the OS limit on the
    // length of a single command-line argument.
    const res = await run(
      "claude",
      [
        "-p",
        "--output-format", "json",
        `--tools=${tools}`,
        `--allowedTools=${tools}`,
        // dontAsk: anything not pre-approved is denied, never prompted for.
        "--permission-mode", "dontAsk",
        // Don't load .claude/settings.json from the task repo (it could add hooks).
        "--setting-sources", "user",
      ],
      { cwd, input: prompt, signal },
    );
    if (res.code !== 0) throw new Error(`claude exited ${res.code}: ${tail(res.stderr || res.stdout)}`);
    const out = CliResult.parse(JSON.parse(res.stdout));
    if (out.is_error) throw new Error(`claude reported an error: ${out.result.slice(0, 300)}`);
    return out;
  }
}
