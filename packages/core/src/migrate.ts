import type Database from "better-sqlite3";

/**
 * Create every table and index from schema.ts if it doesn't exist yet.
 *
 * Hand-written SQL keeps the hackathon setup to zero extra tools. It must stay
 * in step with schema.ts (migrate.test.ts checks the column names). The
 * upgrade path is drizzle-kit: `drizzle-kit generate` produces versioned
 * migration files from schema.ts, and `migrate()` from drizzle-orm applies them.
 */
export function migrate(sqlite: Database.Database): void {
  sqlite.exec(SQL);
}

const SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL,
  owner TEXT NOT NULL,
  cause TEXT NOT NULL,
  also_causes TEXT NOT NULL DEFAULT '[]',
  tagline TEXT NOT NULL,
  about TEXT NOT NULL,
  type TEXT NOT NULL,
  region TEXT NOT NULL,
  url TEXT NOT NULL,
  repo_url TEXT NOT NULL,
  brief TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS donors (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  causes TEXT NOT NULL DEFAULT '[]',
  pct INTEGER NOT NULL DEFAULT 50,
  schedule TEXT NOT NULL DEFAULT 'overnight',
  paused INTEGER NOT NULL DEFAULT 0,
  weekly_email INTEGER NOT NULL DEFAULT 1,
  decision_alerts INTEGER NOT NULL DEFAULT 1,
  verified_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS backings (
  donor_id TEXT NOT NULL REFERENCES donors(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (donor_id, project_id)
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY NOT NULL,
  donor_id TEXT NOT NULL REFERENCES donors(id),
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  last_seen_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  spec TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued',
  priority INTEGER NOT NULL DEFAULT 0,
  reviews_submission_id TEXT,
  excluded_donor_id TEXT,
  lease_device_id TEXT,
  lease_token INTEGER NOT NULL DEFAULT 0,
  lease_expires_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tasks_claim_idx ON tasks (state, kind, priority);

CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY NOT NULL,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  device_id TEXT NOT NULL REFERENCES devices(id),
  donor_id TEXT NOT NULL REFERENCES donors(id),
  lease_token INTEGER NOT NULL,
  patch TEXT NOT NULL,
  summary TEXT NOT NULL,
  model TEXT NOT NULL,
  harness TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS verifications (
  id TEXT PRIMARY KEY NOT NULL,
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  device_id TEXT NOT NULL REFERENCES devices(id),
  donor_id TEXT NOT NULL REFERENCES donors(id),
  tests_passed INTEGER NOT NULL,
  hidden_tests_passed INTEGER NOT NULL,
  review_verdict TEXT NOT NULL,
  notes TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  task_id TEXT REFERENCES tasks(id),
  question TEXT NOT NULL,
  options TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  resolution TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY NOT NULL,
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,
  project_id TEXT,
  task_id TEXT,
  donor_id TEXT,
  data TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS events_donor_ts_idx ON events (donor_id, ts);

CREATE TABLE IF NOT EXISTS hidden_tests (
  project_id TEXT NOT NULL REFERENCES projects(id),
  task_id TEXT NOT NULL DEFAULT '',
  command TEXT NOT NULL,
  files TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, task_id)
);
`;
