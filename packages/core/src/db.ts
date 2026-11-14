import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.ts";

export type AloeDb = BetterSQLite3Database<typeof schema>;

/**
 * Open (or create) the SQLite database. Pass ":memory:" in tests.
 *
 * WAL mode lets readers keep reading while one writer writes, which suits a
 * server where the dashboard polls while agents claim tasks.
 */
export function openDb(path: string): { db: AloeDb; sqlite: Database.Database } {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

export { schema };
