import { describe, expect, it } from "vitest";
import { is } from "drizzle-orm";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { openDb } from "./db.ts";
import { migrate } from "./migrate.ts";
import * as schema from "./schema.ts";

const tables: SQLiteTable[] = Object.values(schema).filter((v: unknown) => is(v, SQLiteTable));

describe("migrate()", () => {
  it("creates every table in schema.ts with exactly the same columns", () => {
    const { sqlite } = openDb(":memory:");
    migrate(sqlite);
    expect(tables.length).toBeGreaterThanOrEqual(10);

    for (const table of tables) {
      const config = getTableConfig(table);
      const expected = config.columns.map((c) => c.name).sort();
      const actual = (sqlite.pragma(`table_info(${config.name})`) as { name: string }[]).map((c) => c.name).sort();
      expect(actual, config.name).toEqual(expected);
    }
  });

  it("is safe to run twice", () => {
    const { sqlite } = openDb(":memory:");
    migrate(sqlite);
    expect(() => migrate(sqlite)).not.toThrow();
  });
});
