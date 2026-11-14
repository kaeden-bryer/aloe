/**
 * Publish ledger: one row per merged task that should land on aloe/staging.
 *
 * It lives here (not in core's schema.ts) because publishing is a server-only
 * concern, and the table is created with `ensurePublishTable` so core's
 * migrate stays untouched. No foreign keys on purpose: a ledger row should
 * survive a demo reseed without blocking it.
 */
import { isNotNull, sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { AloeDb, PublishStatus } from "@aloe/core";

export const stagingPublishes = sqliteTable("staging_publishes", {
  taskId: text("task_id").primaryKey(),
  projectId: text("project_id").notNull(),
  submissionId: text("submission_id").notNull(),
  status: text("status").$type<PublishStatus>().notNull().default("pending"),
  error: text("error"),
  commitSha: text("commit_sha"),
  prUrl: text("pr_url"),
  attempts: integer("attempts").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  /** When the PR holding this change was merged on GitHub (ms). Null = not released. */
  releasedAt: integer("released_at"),
});

export function ensurePublishTable(db: AloeDb): void {
  db.run(sql`CREATE TABLE IF NOT EXISTS staging_publishes (
    task_id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL,
    submission_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT,
    commit_sha TEXT,
    pr_url TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    released_at INTEGER
  )`);
  // Tables made before releases existed lack the column; SQLite has no ADD COLUMN IF NOT EXISTS.
  const cols = db.all<{ name: string }>(sql`PRAGMA table_info(staging_publishes)`);
  if (!cols.some((c) => c.name === "released_at")) db.run(sql`ALTER TABLE staging_publishes ADD COLUMN released_at INTEGER`);
  db.run(sql`CREATE INDEX IF NOT EXISTS staging_publishes_project_idx ON staging_publishes (project_id, status)`);
}

/**
 * Task ids whose work was in a merged PR. Publishing may never have been enabled
 * (no table), so a failed read just means "nothing released".
 */
export function releasedTaskIds(db: AloeDb): Set<string> {
  try {
    const rows = db.select({ taskId: stagingPublishes.taskId }).from(stagingPublishes).where(isNotNull(stagingPublishes.releasedAt)).all();
    return new Set(rows.map((r) => r.taskId));
  } catch {
    return new Set();
  }
}
