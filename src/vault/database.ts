/**
 * Database compatibility layer.
 * Uses bun:sqlite when running in Bun, better-sqlite3 when running in Node.js.
 *
 * Both APIs are very similar (bun:sqlite was inspired by better-sqlite3),
 * but have key differences:
 *
 * bun:sqlite:
 *   - db.run(sql, params?) — execute DDL/DML, returns { changes }
 *   - db.query(sql) — returns a Statement with .get(), .all(), .run()
 *   - new Database(path)
 *
 * better-sqlite3:
 *   - db.exec(sql) — execute raw SQL (DDL)
 *   - db.prepare(sql) — returns a Statement with .get(), .all(), .run()
 *   - new Database(path)
 *
 * This module normalizes to the bun:sqlite-style API so vault.ts doesn't change.
 */

type SqlValue = string | number | Buffer | null;

export interface PreparedStatement {
  run(...params: SqlValue[]): { changes: number };
  get<T = Record<string, SqlValue>>(...params: SqlValue[]): T | null;
  all<T = Record<string, SqlValue>>(...params: SqlValue[]): T[];
}

export interface SqliteDatabase {
  /** Execute SQL directly (DDL/DML). Returns { changes }. */
  run(sql: string, params?: SqlValue[]): { changes: number };
  /** Create a prepared statement. */
  query(sql: string): PreparedStatement;
  /** Close the database. */
  close(): void;
}

import { createRequire } from "node:module";

// createRequire works in both Bun and Node, and compiles cleanly to ESM.
// `require` is not available in ESM module scope, so we synthesize one here.
const require = createRequire(import.meta.url);
const isBun = typeof globalThis.Bun !== "undefined";

export function openDatabase(path: string): SqliteDatabase {
  if (isBun) {
    // bun:sqlite already has the exact API shape we want
    const { Database } = require("bun:sqlite");
    return new Database(path) as SqliteDatabase;
  }

  // Node.js: wrap better-sqlite3 to match bun:sqlite API
  const BetterSqlite3 = require("better-sqlite3");
  const db = new BetterSqlite3(path);

  return {
    run(sql: string, params?: SqlValue[]): { changes: number } {
      if (params && params.length > 0) {
        const result = db.prepare(sql).run(...params);
        return { changes: result.changes };
      }
      db.exec(sql);
      return { changes: 0 };
    },
    query(sql: string): PreparedStatement {
      const stmt = db.prepare(sql);
      return {
        run(...params: SqlValue[]) {
          const result = stmt.run(...params);
          return { changes: result.changes };
        },
        get<T>(...params: SqlValue[]): T | null {
          return stmt.get(...params) ?? null;
        },
        all<T>(...params: SqlValue[]): T[] {
          return stmt.all(...params);
        },
      };
    },
    close() {
      db.close();
    },
  };
}
