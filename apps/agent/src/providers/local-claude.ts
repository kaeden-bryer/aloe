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
 *
 * Guard rails: the provider refuses to start unless ALOE_ALLOW_LOCAL_CLAUDE=1
 * is set, and it logs a warning when it does. It is never the default.
 */
import { z } from "zod";
import type { ClaimedTask } from "@aloe/core/contracts";
import { run, type RunOptions, type RunResult } from "../exec.ts";
import { applyPatch, diffWorktree, withWorktree } from "../git.ts";
import { buildCodePrompt, buildReviewPrompt, parseReviewReply, type ReviewReply } from "../prompt.ts";
import { tail } from "./docker.ts";
import type { AgentProvider, CodeResult, VerifyResult } from "./types.ts";

const EDIT_TOOLS = "Read,Edit,Write,Glob,Grep";
const READ_TOOLS = "Read,Glob,Grep";

/** Injectable so tests never spawn the real CLI. Same shape as exec.run. */
export type ProcessRunner = (cmd: string, args: string[], opts: RunOptions) => Promise<RunResult>;

export interface LocalClaudeOptions {
  aloeHome: string;
  log: (line: string) => void;
  /** Defaults to process.env. Used for the opt-in guard and the child's environment. */
  env?: NodeJS.ProcessEnv;
  runner?: ProcessRunner;
  /** The `claude` binary. */
  command?: string;
  /** Hard stop for one model run. */
  timeoutMs?: number;
  /** Stop the run after this many assistant turns (this CLI version has no --max-turns flag). */
  maxTurns?: number;
}

/** The final `result` event of `--output-format stream-json`. */
const CliResult = z.object({
  type: z.literal("result"),
  result: z.string().default(""),
  is_error: z.boolean().default(false),
  subtype: z.string().optional(),
  modelUsage: z.record(z.string(), z.unknown()).optional(),
});
export type CliResult = z.infer<typeof CliResult>;

export const OPT_IN_ENV = "ALOE_ALLOW_LOCAL_CLAUDE";

export class LocalClaudeProvider implements AgentProvider {
  readonly name = "local-claude";
  private readonly env: NodeJS.ProcessEnv;
  private readonly runner: ProcessRunner;

  constructor(private readonly opts: LocalClaudeOptions) {
    this.env = opts.env ?? process.env;
    this.runner = opts.runner ?? run;
    // Explicit opt-in: using a personal subscription login inside a
    // distributed agent isn't allowed, so this must never happen by accident.
    if (this.env[OPT_IN_ENV] !== "1") {
      throw new Error(
        `the local-claude provider is for the developer's own machine and account only (demo). ` +
          `Set ${OPT_IN_ENV}=1 to confirm; donors' agents must use claude-sdk with an API key.`,
      );
    }
    opts.log("WARNING: local-claude runs your own `claude` login with NO sandbox. Demo on your own machine only.");
  }

  runCodeTask(task: ClaimedTask, signal: AbortSignal): Promise<CodeResult> {
    return withWorktree(this.opts.aloeHome, task.repoUrl, task.id, signal, async (dir) => {
      const out = await this.claude(dir, buildCodePrompt(task.spec), EDIT_TOOLS, signal);
      return {
        // The patch comes from git, not from anything the model says.
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

      // A crashed or timed-out review must never turn into an approval: it becomes "unsure".
      let verdict: ReviewReply;
      try {
        const out = await this.claude(dir, buildReviewPrompt(task.spec, review.patch), READ_TOOLS, signal);
        verdict = parseReviewReply(out.result);
      } catch (err) {
        if (signal.aborted) throw err; // lease lost / Ctrl-C: not a verdict at all
        verdict = { verdict: "unsure", notes: `Review run failed: ${(err as Error).message}`.slice(0, 1000) };
      }

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

  private async claude(cwd: string, prompt: string, tools: string, signal: AbortSignal): Promise<CliResult> {
    const { timeoutMs = 10 * 60_000, maxTurns = 30 } = this.opts;

    // One controller covers all three reasons to kill the child: lease lost /
    // Ctrl-C (the outer signal), a timeout, and too many turns.
    const stop = new AbortController();
    const onOuter = () => stop.abort(signal.reason);
    if (signal.aborted) onOuter();
    else signal.addEventListener("abort", onOuter, { once: true });
    const timer = setTimeout(() => stop.abort(new Error(`claude timed out after ${timeoutMs}ms`)), timeoutMs);

    let turns = 0;
    const onLine = (line: string) => {
      // Each assistant message is one model turn.
      if (line.startsWith('{"type":"assistant"') && ++turns > maxTurns) {
        stop.abort(new Error(`claude used more than ${maxTurns} turns`));
      }
    };

    // Otherwise the CLI refuses to start when we were launched from inside a Claude Code session.
    const { CLAUDECODE: _nested, ...env } = this.env;
    try {
      const res = await this.runner(
        this.opts.command ?? "claude",
        [
          "-p",
          "--output-format", "stream-json",
          "--verbose", // stream-json in print mode requires it
          `--tools=${tools}`,
          `--allowedTools=${tools}`,
          // dontAsk: anything not pre-approved is denied, never prompted for.
          "--permission-mode", "dontAsk",
          // Don't load .claude/settings.json from the task repo (it could add hooks).
          "--setting-sources", "user",
          // No MCP servers (incl. claude.ai connectors) and no skills from the repo.
          "--strict-mcp-config",
          "--disable-slash-commands",
          "--no-session-persistence",
        ],
        // The prompt goes in on stdin: a review prompt holds the whole patch,
        // which can exceed the OS limit on one command-line argument.
        { cwd, input: prompt, signal: stop.signal, env, onLine },
      );
      return parseCliOutput(res);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", onOuter);
    }
  }
}

/** Find the final `result` event in stream-json output. Throws unless the run finished cleanly. */
export function parseCliOutput(res: RunResult): CliResult {
  let result: CliResult | undefined;
  for (const line of res.stdout.split("\n")) {
    if (!line.startsWith('{"type":"result"')) continue;
    try {
      const parsed = CliResult.safeParse(JSON.parse(line));
      if (parsed.success) result = parsed.data;
    } catch {
      // a truncated line: ignore it
    }
  }
  if (!result) throw new Error(`claude exited ${res.code} without a result: ${tail(res.stderr || res.stdout)}`);
  if (result.is_error || result.subtype !== "success") {
    throw new Error(`claude reported an error (${result.subtype ?? "unknown"}): ${result.result.slice(0, 300)}`);
  }
  if (res.code !== 0) throw new Error(`claude exited ${res.code}: ${tail(res.stderr || res.stdout)}`);
  return result;
}
