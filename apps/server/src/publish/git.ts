/**
 * Thin wrapper around the `git` binary.
 *
 * Auth: the token is passed to git through GIT_CONFIG_* environment variables
 * as an http.extraHeader. It is never put in the remote URL (which git would
 * write into .git/config and print in errors) and never in argv (which any
 * user can read with `ps`). Env of a child process is only readable by its owner.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";

export interface GitRunOptions {
  cwd?: string;
  env?: Record<string, string>;
}
/** Injectable so tests can record every argument list. */
export type GitRunner = (args: string[], opts?: GitRunOptions) => Promise<string>;

export const runGit: GitRunner = (args, opts = {}) =>
  new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd: opts.cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...opts.env }, maxBuffer: 32 * 1024 * 1024, timeout: 120_000 },
      (err, stdout, stderr) => {
        if (err) reject(new Error(`git ${args.find((a) => !a.startsWith("-") && !a.includes("=")) ?? ""} failed: ${(stderr || err.message).trim()}`));
        else resolve(stdout.trim());
      },
    );
  });

/** Env vars that make git send `Authorization` to GitHub over https, and nowhere else. */
export function authEnv(token: string | undefined): Record<string, string> {
  if (!token) return {};
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return {
    GIT_CONFIG_COUNT: "1",
    // Scoped to github.com so a file:// or foreign remote never sees the token.
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraHeader",
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
  };
}

/** Remove the token (and its base64 form) from text before it is stored or logged. */
export function scrub(text: string, token: string | undefined): string {
  if (!token) return text;
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return text.split(token).join("***").split(basic).join("***");
}

/** Where the publisher keeps its clone of a repo. Shared so the demo reset can wipe exactly that directory. */
export function cloneDirFor(cacheDir: string, cloneUrl: string, repo: string): string {
  return join(cacheDir, `${createHash("sha1").update(cloneUrl).digest("hex").slice(0, 10)}-${repo}`);
}
