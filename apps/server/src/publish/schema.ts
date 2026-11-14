/**
 * Publish ledger: one row per merged task that should land on aloe/staging.
 *
 * It lives here (not in core's schema.ts) because publishing is a server-only
 * concern, and the table is created with `ensurePublishTable` so core's
 * migrate stays untouched. No foreign keys on purpose: a ledger row should
 * survive a demo reseed without blocking it.
 */
import { sql } from "drizzle-orm";
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
    updated_at INTEGER NOT NULL
  )`);
  db.run(sql`CREATE INDEX IF NOT EXISTS staging_publishes_project_idx ON staging_publishes (project_id, status)`);
}
