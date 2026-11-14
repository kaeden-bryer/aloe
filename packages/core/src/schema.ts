/**
 * Database schema (Drizzle, SQLite).
 *
 * Timestamps are integer milliseconds since the epoch. Integers compare and
 * index cleanly, which matters for the lease query
 * (`lease_expires_at < now`).
 *
 * To move to Postgres later, swap `sqlite-core` for `pg-core` and change the
 * claim query to use `FOR UPDATE SKIP LOCKED` (see lease.ts).
 */
import { sqliteTable, text, integer, primaryKey, index } from "drizzle-orm/sqlite-core";
import type { TaskState } from "./states.ts";
import type { CauseId, TaskCategory, TaskKind, TaskSpec, ReviewVerdict, Schedule } from "./contracts.ts";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  emoji: text("emoji").notNull(),
  owner: text("owner").notNull(),
  cause: text("cause").$type<CauseId>().notNull(),
  alsoCauses: text("also_causes", { mode: "json" }).$type<CauseId[]>().notNull().default([]),
  tagline: text("tagline").notNull(),
  about: text("about").notNull(),
  type: text("type").notNull(),
  region: text("region").notNull(),
  url: text("url").notNull(),
  repoUrl: text("repo_url").notNull(),
  /** Docker image for this project's tasks (see SANDBOX_IMAGE_PATTERN). NULL = the agent's default. */
  sandboxImage: text("sandbox_image"),
  /** Project brief the steward wrote from the maintainer interview. Shared memory for agents. */
  brief: text("brief").notNull().default(""),
  createdAt: integer("created_at").notNull(),
});

export const donors = sqliteTable("donors", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  causes: text("causes", { mode: "json" }).$type<CauseId[]>().notNull().default([]),
  pct: integer("pct").notNull().default(50),
  schedule: text("schedule").$type<Schedule>().notNull().default("overnight"),
  paused: integer("paused", { mode: "boolean" }).notNull().default(false),
  weeklyEmail: integer("weekly_email", { mode: "boolean" }).notNull().default(true),
  decisionAlerts: integer("decision_alerts", { mode: "boolean" }).notNull().default(true),
  /** Verified results so far. Adaptive replication: trusted donors get spot checks. */
  verifiedCount: integer("verified_count").notNull().default(0),
  createdAt: integer("created_at").notNull(),
});

export const backings = sqliteTable(
  "backings",
  {
    donorId: text("donor_id").notNull().references(() => donors.id),
    projectId: text("project_id").notNull().references(() => projects.id),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.donorId, t.projectId] })],
);

/** A paired agent install on a donor's machine. */
export const devices = sqliteTable("devices", {
  id: text("id").primaryKey(),
  donorId: text("donor_id").notNull().references(() => donors.id),
  name: text("name").notNull(),
  /** SHA-256 of the bearer token. We never store the token itself. */
  tokenHash: text("token_hash").notNull().unique(),
  lastSeenAt: integer("last_seen_at"),
  createdAt: integer("created_at").notNull(),
});

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id),
    kind: text("kind").$type<TaskKind>().notNull(),
    title: text("title").notNull(),
    spec: text("spec", { mode: "json" }).$type<TaskSpec>().notNull(),
    state: text("state").$type<TaskState>().notNull().default("queued"),
    priority: integer("priority").notNull().default(0),
    /** Verify tasks point at the submission they review. */
    reviewsSubmissionId: text("reviews_submission_id"),
    /** Donor who must NOT claim this task (the author of the work under review). */
    excludedDonorId: text("excluded_donor_id"),
    leaseDeviceId: text("lease_device_id"),
    /** Fencing token. Incremented on every claim; stale holders are rejected. */
    leaseToken: integer("lease_token").notNull().default(0),
    leaseExpiresAt: integer("lease_expires_at"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("tasks_claim_idx").on(t.state, t.kind, t.priority)],
);

export const submissions = sqliteTable("submissions", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => tasks.id),
  deviceId: text("device_id").notNull().references(() => devices.id),
  donorId: text("donor_id").notNull().references(() => donors.id),
  leaseToken: integer("lease_token").notNull(),
  patch: text("patch").notNull(),
  summary: text("summary").notNull(),
  model: text("model").notNull(),
  harness: text("harness").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const verifications = sqliteTable("verifications", {
  id: text("id").primaryKey(),
  submissionId: text("submission_id").notNull().references(() => submissions.id),
  deviceId: text("device_id").notNull().references(() => devices.id),
  donorId: text("donor_id").notNull().references(() => donors.id),
  testsPassed: integer("tests_passed", { mode: "boolean" }).notNull(),
  hiddenTestsPassed: integer("hidden_tests_passed", { mode: "boolean" }).notNull(),
  reviewVerdict: text("review_verdict").$type<ReviewVerdict>().notNull(),
  notes: text("notes").notNull(),
  createdAt: integer("created_at").notNull(),
});

/** Escalations to a maintainer: the "one human decision" in the demo. */
export const decisions = sqliteTable("decisions", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  taskId: text("task_id").references(() => tasks.id),
  question: text("question").notNull(),
  options: text("options", { mode: "json" }).$type<{ id: string; label: string }[]>().notNull(),
  status: text("status").$type<"open" | "resolved">().notNull().default("open"),
  resolution: text("resolution"),
  createdAt: integer("created_at").notNull(),
  resolvedAt: integer("resolved_at"),
});

/** Append-only activity log. Feeds the dashboard activity list and the weekly report. */
export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    ts: integer("ts").notNull(),
    type: text("type").notNull(),
    projectId: text("project_id"),
    taskId: text("task_id"),
    donorId: text("donor_id"),
    data: text("data", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [index("events_donor_ts_idx").on(t.donorId, t.ts)],
);

// ---- Hidden tests (own section, added by the hidden-tests feature) ----
/**
 * Hidden tests a maintainer registers. One row per project (task_id = '') plus
 * optional per-task overrides (task_id = the code task's id). A task-level row
 * wins over the project-level one. Only claimTask for a verify lease reads this.
 */
export const hiddenTests = sqliteTable(
  "hidden_tests",
  {
    projectId: text("project_id").notNull().references(() => projects.id),
    /** '' means "the whole project". Not NULL because SQLite treats NULLs as distinct in a primary key. */
    taskId: text("task_id").notNull().default(""),
    command: text("command").notNull(),
    files: text("files", { mode: "json" }).$type<{ path: string; content: string }[]>().notNull().default([]),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.taskId] })],
);

/**
 * Steward-written tasks awaiting maintainer approval. A separate table from
 * `tasks` on purpose: the claim query only reads `tasks`, so a draft can never
 * be handed to an agent by accident. Approving inserts a real queued task.
 */
export const taskDrafts = sqliteTable(
  "task_drafts",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id),
    /** GitHub issue number it came from; used to avoid importing the same issue twice. */
    sourceIssue: integer("source_issue"),
    spec: text("spec", { mode: "json" }).$type<TaskSpec>().notNull(),
    status: text("status").$type<"pending" | "approved" | "rejected">().notNull().default("pending"),
    /** Set when approved: the real task this draft became. */
    taskId: text("task_id"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("task_drafts_project_idx").on(t.projectId, t.status)],
);

// ---- Sessions and maintainer roles ----
/**
 * Who maintains which project. A "maintainer" is not a separate kind of user:
 * it is a user (a row of `donors`) with at least one row here. Per project, so
 * being CCF's maintainer gives no power over any other project.
 */
export const projectMaintainers = sqliteTable(
  "project_maintainers",
  {
    userId: text("user_id").notNull().references(() => donors.id),
    projectId: text("project_id").notNull().references(() => projects.id),
  },
  (t) => [primaryKey({ columns: [t.userId, t.projectId] })],
);

/**
 * Browser sessions. Like device tokens we store only the SHA-256 of the random
 * cookie value, so a leaked database can't be replayed as a login.
 */
export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull().references(() => donors.id),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
});
