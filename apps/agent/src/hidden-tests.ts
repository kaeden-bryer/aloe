/**
 * Running a project's hidden tests against a patched verify worktree.
 *
 * "Hidden" means the patch's author never saw these files: the server only
 * attaches them to verify leases. Here the verifier writes them into the
 * worktree (after the patch is applied) and runs the maintainer's command in
 * the sandbox, in `test` mode (no API key, no model).
 *
 * The server is trusted more than a patch but still not blindly: the files are
 * re-validated here, and we refuse to write through symlinks, because the
 * *patch* is untrusted and could have planted `aloe-hidden -> /home/you`.
 */
import { lstat, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { HiddenTests } from "@aloe/core/contracts";
import type { RunResult } from "./exec.ts";
import { runSandbox, tail, type SandboxOptions } from "./providers/docker.ts";

export interface HiddenTestsOptions {
  /** Verify worktree, with the patch under review already applied. */
  worktree: string;
  /** From `task.hiddenTests`; undefined when the project has none. */
  hidden: HiddenTests | undefined;
  image: string;
  /** Host dir mounted at /task (see withTaskDir). */
  taskDir: string;
  signal: AbortSignal;
  timeoutMs?: number;
  /** Injected in tests so no Docker is needed. Defaults to the real sandbox. */
  sandbox?: (opts: SandboxOptions) => Promise<RunResult>;
}

export interface HiddenTestsResult {
  passed: boolean;
  /** Last lines of the test output (never the file contents). */
  output: string;
  /** One line for VerifyResult.notes. */
  note: string;
}

export const NO_HIDDEN_TESTS_NOTE = "no hidden tests";

export async function runHiddenTests(opts: HiddenTestsOptions): Promise<HiddenTestsResult> {
  // No hidden tests registered: nothing to fail, and the notes say so.
  if (!opts.hidden) return { passed: true, output: "", note: NO_HIDDEN_TESTS_NOTE };

  const hidden = HiddenTests.parse(opts.hidden);
  try {
    await writeHiddenFiles(opts.worktree, hidden);
  } catch (err) {
    // A file we can't write safely is a failed check, not a crash: never let it merge.
    const msg = (err as Error).message;
    return { passed: false, output: msg, note: `Hidden tests could not be set up: ${msg}`.slice(0, 500) };
  }
  if (!hidden.command.trim()) return { passed: false, output: "", note: "Hidden tests have no command to run" };

  const run = opts.sandbox ?? runSandbox;
  const res = await run({
    image: opts.image,
    mode: "test",
    worktree: opts.worktree,
    taskDir: opts.taskDir,
    signal: opts.signal,
    shellCommand: hidden.command,
    timeoutMs: opts.timeoutMs ?? 10 * 60_000,
  });
  const passed = res.code === 0;
  return {
    passed,
    output: tail(res.stdout + (res.stderr ? `\n${res.stderr}` : ""), 20),
    note: `Hidden tests (${hidden.files.length} file${hidden.files.length === 1 ? "" : "s"}): \`${hidden.command}\` exited ${res.code}`,
  };
}

/** Write each file under `worktree`, refusing anything that would land outside it or inside .git. */
export async function writeHiddenFiles(worktree: string, hidden: HiddenTests): Promise<void> {
  const root = resolve(worktree);
  for (const file of hidden.files) {
    const target = resolve(root, file.path);
    if (!target.startsWith(root + sep)) throw new Error(`hidden test path escapes the worktree: ${file.path}`);

    // Walk every directory from the root down and refuse symlinks (the patch may have created one).
    const parts = target.slice(root.length + 1).split(sep);
    let cur = root;
    for (const part of parts.slice(0, -1)) {
      cur = join(cur, part);
      const st = await lstat(cur).catch(() => null);
      if (st?.isSymbolicLink()) throw new Error(`hidden test path crosses a symlink: ${file.path}`);
      if (st && !st.isDirectory()) throw new Error(`hidden test path crosses a file: ${file.path}`);
    }
    await mkdir(dirname(target), { recursive: true });
    // Replace whatever the patch put there (including a symlink at the leaf) rather than writing through it.
    await rm(target, { force: true, recursive: true });
    await writeFile(target, file.content, { mode: 0o644 });
  }
}
