/**
 * Running work inside the `aloe-sandbox` Docker image (built from docker/sandbox).
 *
 * Why a container? The model runs Bash with whatever the repo contains. In a
 * container it only sees the task's worktree (/work) and the task files
 * (/task, read-only), not the donor's home directory, SSH keys or other repos.
 * Network stays open for code/review runs because the model API must be
 * reachable (see docker/sandbox/README.md). Test runs have no model, so they
 * get `--network none`: a patch's tests can't phone home.
 */
import { randomBytes } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_SANDBOX_IMAGE, isAllowedSandboxImage, type ClaimedTask } from "@aloe/core/contracts";
import { run, type RunResult } from "../exec.ts";

export interface SandboxOptions {
  image: string;
  mode: "code" | "review" | "test";
  /** Host path mounted at /work. */
  worktree: string;
  worktreeReadOnly?: boolean;
  /** Host path mounted read-only at /task (spec.json, patch.diff). */
  taskDir: string;
  signal: AbortSignal;
  /** For mode 'test': run this shell command instead of the runner. */
  shellCommand?: string;
  timeoutMs?: number;
  /** Extra env vars for the container, e.g. ALOE_MAX_TURNS. */
  env?: Record<string, string>;
  onLine?: (line: string) => void;
}

/** Test runs always get a time limit: a patch can contain an infinite loop. */
export const DEFAULT_TEST_TIMEOUT_MS = 10 * 60_000;

/**
 * The image a task runs in: the project's `sandboxImage` if the server sent one
 * (and it passes the allowlist), else the donor's default. A name that fails the
 * allowlist throws, so the task fails and is released instead of running.
 */
export function resolveSandboxImage(task: Pick<ClaimedTask, "sandboxImage">, fallback = DEFAULT_SANDBOX_IMAGE): string {
  if (task.sandboxImage === undefined) return fallback;
  if (!isAllowedSandboxImage(task.sandboxImage)) {
    throw new Error(`refusing sandbox image ${JSON.stringify(task.sandboxImage.slice(0, 60))}: not an aloe-sandbox image`);
  }
  return task.sandboxImage;
}

/** The `docker run` argv, separated from runSandbox so tests can check the flags without Docker. */
export function dockerRunArgs(opts: SandboxOptions, name: string): string[] {
  const args = [
    "run", "--rm", "--name", name,
    // Resource limits, so a runaway test suite can't take the donor's machine down.
    "--memory", "4g", "--cpus", "2", "--pids-limit", "512",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "-e", `MODE=${opts.mode}`,
    "-v", `${opts.worktree}:/work${opts.worktreeReadOnly ? ":ro" : ""}`,
    "-v", `${opts.taskDir}:/task:ro`,
  ];
  // Run as the donor's uid so files the model writes in /work are owned by
  // them, not by a container user. HOME=/tmp because that uid has no home.
  if (process.getuid && process.getgid) {
    args.push("--user", `${process.getuid()}:${process.getgid()}`, "-e", "HOME=/tmp");
  }
  if (opts.mode === "test") {
    // No model call here, so no reason for the repo's code to reach the internet.
    args.push("--network", "none");
  } else {
    // `-e NAME` with no value copies it from our environment, so the key
    // never appears in the process list (`ps`) the way `-e NAME=value` would.
    args.push("-e", "ANTHROPIC_API_KEY");
  }
  for (const [k, v] of Object.entries(opts.env ?? {})) args.push("-e", `${k}=${v}`);
  if (opts.shellCommand !== undefined) {
    args.push("--entrypoint", "sh", opts.image, "-c", opts.shellCommand);
  } else {
    args.push(opts.image);
  }
  return args;
}

export async function runSandbox(opts: SandboxOptions): Promise<RunResult> {
  const name = `aloe-${opts.mode}-${randomBytes(4).toString("hex")}`;
  const args = dockerRunArgs(opts, name);
  const timeoutMs = opts.timeoutMs ?? (opts.mode === "test" ? DEFAULT_TEST_TIMEOUT_MS : undefined);

  // Killing the `docker run` client does not reliably stop the container, so
  // on abort (or timeout) we ask the daemon to kill it by name.
  let timedOut = false;
  const kill = () => void run("docker", ["kill", name]).catch(() => {});
  const killOnTimeout = () => {
    timedOut = true;
    kill();
  };
  opts.signal.addEventListener("abort", kill, { once: true });
  const timer = timeoutMs ? setTimeout(killOnTimeout, timeoutMs) : undefined;
  try {
    const res = await run("docker", args, { onLine: opts.onLine });
    opts.signal.throwIfAborted();
    // Exit 137 alone doesn't say why; the note ends up in the verifier's report.
    return timedOut ? { ...res, stderr: `${res.stderr}\n[aloe] container killed: ran longer than ${Math.round(timeoutMs! / 1000)}s` } : res;
  } finally {
    clearTimeout(timer);
    opts.signal.removeEventListener("abort", kill);
  }
}

/** Write the files the container reads from /task, run `fn`, then delete them. */
export async function withTaskDir<T>(
  aloeHome: string,
  task: ClaimedTask,
  fn: (dir: string) => Promise<T>,
): Promise<T> {
  await mkdir(join(aloeHome, "tmp"), { recursive: true });
  const dir = await mkdtemp(join(aloeHome, "tmp", "task-"));
  try {
    await chmod(dir, 0o755);
    // Only the approved TaskSpec goes in, never raw issue text.
    await writeFile(join(dir, "spec.json"), JSON.stringify(task.spec, null, 2), { mode: 0o644 });
    if (task.review) await writeFile(join(dir, "patch.diff"), task.review.patch, { mode: 0o644 });
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function tail(text: string, lines = 5): string {
  return text.trim().split("\n").slice(-lines).join("\n");
}
