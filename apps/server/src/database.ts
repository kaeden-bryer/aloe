import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate, openDb, type AloeDb } from "@aloe/core";

export const SERVER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_ROOT = resolve(SERVER_ROOT, "../..");

/**
 * Load the repo-root .env if there is one. Node 22 can parse .env files
 * itself, so no dotenv dependency. Variables already set in the shell win.
 */
export function loadRootEnv(): void {
  const path = resolve(REPO_ROOT, ".env");
  if (existsSync(path)) process.loadEnvFile(path);
}

/** Open the real database (DATABASE_PATH, relative to apps/server) and make sure its tables exist. */
export function openDatabase(): { db: AloeDb; path: string } {
  loadRootEnv();
  const configured = process.env.DATABASE_PATH || "./aloe.db";
  const path = isAbsolute(configured) ? configured : resolve(SERVER_ROOT, configured);
  const { db, sqlite } = openDb(path);
  migrate(sqlite);
  return { db, path };
}
