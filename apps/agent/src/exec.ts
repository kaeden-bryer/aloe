/** Run a child process and collect its output. Used for git, docker and claude. */
import { spawn } from "node:child_process";

export interface RunOptions {
  cwd?: string;
  /** Written to stdin, then stdin is closed. */
  input?: string;
  env?: NodeJS.ProcessEnv;
  /** Kills the child (SIGTERM) and rejects when aborted. */
  signal?: AbortSignal;
  /** Called with each complete stdout line as it arrives (for progress logs). */
  onLine?: (line: string) => void;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Resolves with the exit code, even when it's non-zero. Rejects only on spawn failure or abort. */
export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    // Passing args as an array (no shell) means task data can never be
    // interpreted as shell syntax on the host.
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      signal: opts.signal,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let partial = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
      if (!opts.onLine) return;
      partial += chunk;
      const lines = partial.split("\n");
      partial = lines.pop() ?? "";
      for (const line of lines) opts.onLine(line);
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("error", (err) => reject(opts.signal?.aborted ? opts.signal.reason : err));
    child.on("close", (code) => {
      if (opts.signal?.aborted) return reject(opts.signal.reason);
      if (partial && opts.onLine) opts.onLine(partial);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.stdin.on("error", () => {}); // child may exit before reading stdin
    child.stdin.end(opts.input ?? "");
  });
}

/** Like `run`, but throws if the command exits non-zero. Returns stdout. */
export async function runOk(cmd: string, args: string[], opts: RunOptions = {}): Promise<string> {
  const res = await run(cmd, args, opts);
  if (res.code !== 0) {
    const detail = (res.stderr || res.stdout).trim().split("\n").slice(-5).join("\n");
    throw new Error(`${cmd} ${args[0] ?? ""} exited ${res.code}: ${detail}`);
  }
  return res.stdout;
}
