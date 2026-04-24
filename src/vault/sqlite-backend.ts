/**
 * sqlite-backend.ts — Local encrypted SQLite storage backend.
 *
 * Extracted from the original Vault implementation: keeps the exact schema,
 * migrations, encryption, and history-pruning behavior untouched. All that
 * changed is it now implements the VaultBackend interface and owns its own
 * encryption key / unlock lifecycle.
 */

import { type SqliteDatabase, openDatabase } from "./database.js";
import { join } from "node:path";
import { decrypt, encrypt, keyToBuffer } from "./crypto.js";
import { generateKey, getKey, isKeychainAvailable, storeKey } from "./keychain.js";
import type {
  SecretHistoryRecord,
  SecretMetaRecord,
  VaultBackend,
} from "./backend.js";

const DB_NAME = "vault.db";
const HISTORY_KEEP = 10;

export interface SqliteBackendOptions {
  /** Encryption key (base64 or password string). Skips keychain/env var lookup. */
  key?: string;
}

export class SqliteBackend implements VaultBackend {
  readonly type = "sqlite";

  private db: SqliteDatabase;
  private key: Buffer | null = null;

  constructor(vaultPath: string, options?: SqliteBackendOptions) {
    const dbPath = join(vaultPath, DB_NAME);
    this.db = openDatabase(dbPath);
    this.initSchema();

    if (options?.key) {
      this.key = keyToBuffer(options.key);
    }
  }

  private initSchema() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS secrets (
        name TEXT PRIMARY KEY,
        encrypted_value BLOB NOT NULL,
        iv BLOB NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Migration: add tags column if it doesn't exist
    const columns = this.db.query("PRAGMA table_info(secrets)").all() as {
      name: string;
    }[];
    const hasTagsColumn = columns.some((col) => col.name === "tags");
    if (!hasTagsColumn) {
      this.db.run("ALTER TABLE secrets ADD COLUMN tags TEXT DEFAULT '[]'");
    }

    // Migration: add secrets_history table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS secrets_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        version INTEGER NOT NULL,
        encrypted_value BLOB NOT NULL,
        iv BLOB NOT NULL,
        tags TEXT DEFAULT '[]',
        archived_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(name, version)
      )
    `);
    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_secrets_history_name ON secrets_history(name)`,
    );
  }

  /**
   * Unlock via keychain or PSST_PASSWORD fallback.
   * No-op if a key was provided via constructor options.
   */
  async unlock(): Promise<boolean> {
    if (this.key) return true;

    const keychainResult = await getKey();
    if (keychainResult.success && keychainResult.key) {
      this.key = keyToBuffer(keychainResult.key);
      return true;
    }

    if (process.env.PSST_PASSWORD) {
      this.key = keyToBuffer(process.env.PSST_PASSWORD);
      return true;
    }

    return false;
  }

  isUnlocked(): boolean {
    return this.key !== null;
  }

  private requireKey(): Buffer {
    if (!this.key) throw new Error("Vault is locked");
    return this.key;
  }

  async exists(name: string): Promise<boolean> {
    const row = this.db
      .query("SELECT 1 AS ok FROM secrets WHERE name = ?")
      .get(name) as { ok: number } | null;
    return row !== null;
  }

  async setSecret(name: string, value: string, tags?: string[]): Promise<void> {
    const key = this.requireKey();

    // Archive existing secret to history before overwriting
    const existing = this.db
      .query("SELECT encrypted_value, iv, tags FROM secrets WHERE name = ?")
      .get(name) as {
      encrypted_value: Buffer;
      iv: Buffer;
      tags: string;
    } | null;

    if (existing) {
      const maxVersion = this.db
        .query("SELECT MAX(version) as max_v FROM secrets_history WHERE name = ?")
        .get(name) as { max_v: number | null } | null;
      const nextVersion = (maxVersion?.max_v ?? 0) + 1;

      this.db.run(
        `INSERT INTO secrets_history (name, version, encrypted_value, iv, tags)
         VALUES (?, ?, ?, ?, ?)`,
        [
          name,
          nextVersion,
          existing.encrypted_value,
          existing.iv,
          existing.tags || "[]",
        ],
      );

      this.pruneHistory(name);
    }

    const { encrypted, iv } = await encrypt(value, key);
    const tagsJson = JSON.stringify(tags || []);

    this.db.run(
      `INSERT INTO secrets (name, encrypted_value, iv, tags, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(name) DO UPDATE SET
         encrypted_value = excluded.encrypted_value,
         iv = excluded.iv,
         tags = excluded.tags,
         updated_at = CURRENT_TIMESTAMP`,
      [name, encrypted, iv, tagsJson],
    );
  }

  async getSecret(name: string): Promise<string | null> {
    const key = this.requireKey();

    const row = this.db
      .query("SELECT encrypted_value, iv FROM secrets WHERE name = ?")
      .get(name) as { encrypted_value: Buffer; iv: Buffer } | null;

    if (!row) return null;
    return decrypt(row.encrypted_value, row.iv, key);
  }

  async getSecrets(names: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    for (const name of names) {
      const value = await this.getSecret(name);
      if (value !== null) result.set(name, value);
    }
    return result;
  }

  async listSecrets(filterTags?: string[]): Promise<SecretMetaRecord[]> {
    const rows = this.db
      .query(
        "SELECT name, tags, created_at, updated_at FROM secrets ORDER BY name",
      )
      .all() as {
      name: string;
      tags: string;
      created_at: string;
      updated_at: string;
    }[];

    const secrets = rows.map((row) => ({
      name: row.name,
      tags: JSON.parse(row.tags || "[]") as string[],
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));

    if (filterTags && filterTags.length > 0) {
      return secrets.filter((s) => s.tags.some((t) => filterTags.includes(t)));
    }
    return secrets;
  }

  async getTags(name: string): Promise<string[]> {
    const row = this.db
      .query("SELECT tags FROM secrets WHERE name = ?")
      .get(name) as { tags: string } | null;

    if (!row) return [];
    return JSON.parse(row.tags || "[]");
  }

  async setTags(name: string, tags: string[]): Promise<boolean> {
    const result = this.db.run(
      "UPDATE secrets SET tags = ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?",
      [JSON.stringify(tags), name],
    );
    return result.changes > 0;
  }

  async addTags(name: string, newTags: string[]): Promise<boolean> {
    const existing = await this.getTags(name);
    const merged = [...new Set([...existing, ...newTags])];
    return this.setTags(name, merged);
  }

  async removeTags(name: string, tagsToRemove: string[]): Promise<boolean> {
    const existing = await this.getTags(name);
    const filtered = existing.filter((t) => !tagsToRemove.includes(t));
    return this.setTags(name, filtered);
  }

  async getHistory(name: string): Promise<SecretHistoryRecord[]> {
    const rows = this.db
      .query(
        "SELECT version, tags, archived_at FROM secrets_history WHERE name = ? ORDER BY version DESC",
      )
      .all(name) as { version: number; tags: string; archived_at: string }[];

    return rows.map((row) => ({
      version: row.version,
      tags: JSON.parse(row.tags || "[]") as string[],
      archived_at: row.archived_at,
    }));
  }

  async getHistoryVersion(name: string, version: number): Promise<string | null> {
    const key = this.requireKey();

    const row = this.db
      .query(
        "SELECT encrypted_value, iv FROM secrets_history WHERE name = ? AND version = ?",
      )
      .get(name, version) as { encrypted_value: Buffer; iv: Buffer } | null;

    if (!row) return null;
    return decrypt(row.encrypted_value, row.iv, key);
  }

  async rollback(name: string, targetVersion: number): Promise<boolean> {
    this.requireKey();

    const historyRow = this.db
      .query(
        "SELECT encrypted_value, iv, tags FROM secrets_history WHERE name = ? AND version = ?",
      )
      .get(name, targetVersion) as {
      encrypted_value: Buffer;
      iv: Buffer;
      tags: string;
    } | null;

    if (!historyRow) return false;

    const currentRow = this.db
      .query("SELECT encrypted_value, iv, tags FROM secrets WHERE name = ?")
      .get(name) as {
      encrypted_value: Buffer;
      iv: Buffer;
      tags: string;
    } | null;

    if (!currentRow) return false;

    // Archive current value first (making rollback reversible)
    const maxVersion = this.db
      .query("SELECT MAX(version) as max_v FROM secrets_history WHERE name = ?")
      .get(name) as { max_v: number | null } | null;
    const nextVersion = (maxVersion?.max_v ?? 0) + 1;

    this.db.run(
      `INSERT INTO secrets_history (name, version, encrypted_value, iv, tags)
       VALUES (?, ?, ?, ?, ?)`,
      [
        name,
        nextVersion,
        currentRow.encrypted_value,
        currentRow.iv,
        currentRow.tags || "[]",
      ],
    );

    // Restore the target version
    this.db.run(
      `UPDATE secrets SET encrypted_value = ?, iv = ?, tags = ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?`,
      [
        historyRow.encrypted_value,
        historyRow.iv,
        historyRow.tags || "[]",
        name,
      ],
    );

    this.pruneHistory(name);
    return true;
  }

  async clearHistory(name: string): Promise<void> {
    this.db.run("DELETE FROM secrets_history WHERE name = ?", [name]);
  }

  async removeSecret(name: string): Promise<boolean> {
    const result = this.db.run("DELETE FROM secrets WHERE name = ?", [name]);
    return result.changes > 0;
  }

  private pruneHistory(name: string, keep: number = HISTORY_KEEP): void {
    this.db.run(
      `DELETE FROM secrets_history WHERE name = ? AND id NOT IN (
        SELECT id FROM secrets_history WHERE name = ? ORDER BY version DESC LIMIT ?
      )`,
      [name, name, keep],
    );
  }

  close(): void {
    this.db.close();
  }
}

/**
 * Initialize a sqlite vault: create directory (caller does that), set up
 * the keychain key if needed, and create the database file.
 *
 * `skipKeychain` is used in SDK mode — caller provides the key via options.
 */
export async function initializeSqliteVault(
  vaultPath: string,
  options?: { skipKeychain?: boolean },
): Promise<{ success: boolean; error?: string }> {
  if (options?.skipKeychain) {
    const backend = new SqliteBackend(vaultPath);
    backend.close();
    return { success: true };
  }

  const hasKeychain = await isKeychainAvailable();

  if (!hasKeychain && !process.env.PSST_PASSWORD) {
    return {
      success: false,
      error: "No keychain available. Set PSST_PASSWORD env var as fallback.",
    };
  }

  const existingKey = await getKey();

  if (!existingKey.success || !existingKey.key) {
    const key = generateKey();
    const storeResult = await storeKey(key);

    if (!storeResult.success) {
      if (!process.env.PSST_PASSWORD) {
        return {
          success: false,
          error: `Keychain error: ${storeResult.error}. Set PSST_PASSWORD as fallback.`,
        };
      }
      console.log("Note: Using PSST_PASSWORD (keychain not available)");
    }
  }

  const backend = new SqliteBackend(vaultPath);
  backend.close();
  return { success: true };
}
