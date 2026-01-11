import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { encrypt, decrypt, keyToBuffer } from "./crypto";
import { getKey, storeKey, generateKey, isKeychainAvailable } from "./keychain";

const VAULT_DIR_NAME = ".psst";
const DB_NAME = "vault.db";

export interface Secret {
  name: string;
  value: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface SecretMeta {
  name: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export class Vault {
  private db: Database;
  private key: Buffer | null = null;
  private vaultPath: string;

  constructor(vaultPath: string) {
    this.vaultPath = vaultPath;
    const dbPath = join(vaultPath, DB_NAME);
    this.db = new Database(dbPath);
    this.initSchema();
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
    const columns = this.db.query("PRAGMA table_info(secrets)").all() as { name: string }[];
    const hasTagsColumn = columns.some((col) => col.name === "tags");
    if (!hasTagsColumn) {
      this.db.run("ALTER TABLE secrets ADD COLUMN tags TEXT DEFAULT '[]'");
    }
  }

  /**
   * Unlock vault using keychain or fallback password
   */
  async unlock(): Promise<boolean> {
    // Try keychain first
    const keychainResult = await getKey();

    if (keychainResult.success && keychainResult.key) {
      this.key = keyToBuffer(keychainResult.key);
      return true;
    }

    // Fallback to PSST_PASSWORD env var
    if (process.env.PSST_PASSWORD) {
      this.key = keyToBuffer(process.env.PSST_PASSWORD);
      return true;
    }

    return false;
  }

  isUnlocked(): boolean {
    return this.key !== null;
  }

  async setSecret(name: string, value: string, tags?: string[]): Promise<void> {
    if (!this.key) throw new Error("Vault is locked");

    const { encrypted, iv } = await encrypt(value, this.key);
    const tagsJson = JSON.stringify(tags || []);

    this.db.run(
      `INSERT INTO secrets (name, encrypted_value, iv, tags, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(name) DO UPDATE SET
         encrypted_value = excluded.encrypted_value,
         iv = excluded.iv,
         tags = excluded.tags,
         updated_at = CURRENT_TIMESTAMP`,
      [name, encrypted, iv, tagsJson]
    );
  }

  async getSecret(name: string): Promise<string | null> {
    if (!this.key) throw new Error("Vault is locked");

    const row = this.db
      .query("SELECT encrypted_value, iv FROM secrets WHERE name = ?")
      .get(name) as { encrypted_value: Buffer; iv: Buffer } | null;

    if (!row) return null;

    return decrypt(row.encrypted_value, row.iv, this.key);
  }

  async getSecrets(names: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();

    for (const name of names) {
      const value = await this.getSecret(name);
      if (value !== null) {
        result.set(name, value);
      }
    }

    return result;
  }

  listSecrets(filterTags?: string[]): SecretMeta[] {
    const rows = this.db
      .query("SELECT name, tags, created_at, updated_at FROM secrets ORDER BY name")
      .all() as { name: string; tags: string; created_at: string; updated_at: string }[];

    const secrets = rows.map((row) => ({
      name: row.name,
      tags: JSON.parse(row.tags || "[]") as string[],
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));

    // Filter by tags if specified (OR logic - any matching tag)
    if (filterTags && filterTags.length > 0) {
      return secrets.filter((s) => s.tags.some((t) => filterTags.includes(t)));
    }

    return secrets;
  }

  getTags(name: string): string[] {
    const row = this.db
      .query("SELECT tags FROM secrets WHERE name = ?")
      .get(name) as { tags: string } | null;

    if (!row) return [];
    return JSON.parse(row.tags || "[]");
  }

  setTags(name: string, tags: string[]): boolean {
    const result = this.db.run(
      "UPDATE secrets SET tags = ?, updated_at = CURRENT_TIMESTAMP WHERE name = ?",
      [JSON.stringify(tags), name]
    );
    return result.changes > 0;
  }

  addTags(name: string, newTags: string[]): boolean {
    const existing = this.getTags(name);
    const merged = [...new Set([...existing, ...newTags])];
    return this.setTags(name, merged);
  }

  removeTags(name: string, tagsToRemove: string[]): boolean {
    const existing = this.getTags(name);
    const filtered = existing.filter((t) => !tagsToRemove.includes(t));
    return this.setTags(name, filtered);
  }

  removeSecret(name: string): boolean {
    const result = this.db.run("DELETE FROM secrets WHERE name = ?", [name]);
    return result.changes > 0;
  }

  close() {
    this.db.close();
  }

  /**
   * Initialize a new vault with keychain-stored key
   */
  static async initializeVault(vaultPath: string): Promise<{ success: boolean; error?: string }> {
    // Check if keychain is available
    const hasKeychain = await isKeychainAvailable();

    if (!hasKeychain && !process.env.PSST_PASSWORD) {
      return {
        success: false,
        error: "No keychain available. Set PSST_PASSWORD env var as fallback.",
      };
    }

    // Generate and store key
    const key = generateKey();
    const storeResult = await storeKey(key);

    if (!storeResult.success) {
      // Keychain failed, check for fallback
      if (!process.env.PSST_PASSWORD) {
        return {
          success: false,
          error: `Keychain error: ${storeResult.error}. Set PSST_PASSWORD as fallback.`,
        };
      }
      // Use PSST_PASSWORD as key (user is responsible for it)
      console.log("Note: Using PSST_PASSWORD (keychain not available)");
    }

    // Create vault directory and database
    if (!existsSync(vaultPath)) {
      mkdirSync(vaultPath, { recursive: true });
    }

    // Initialize database
    const vault = new Vault(vaultPath);
    vault.close();

    return { success: true };
  }

  static findVaultPath(options: { global?: boolean; env?: string } = {}): string | null {
    const { global = false, env } = options;

    // Determine base path based on scope (no fallback between local and global)
    const basePath = global
      ? join(homedir(), VAULT_DIR_NAME)
      : join(process.cwd(), VAULT_DIR_NAME);

    // If env specified, look for env-specific vault only
    if (env) {
      const envPath = join(basePath, "envs", env);
      if (existsSync(join(envPath, DB_NAME))) {
        return envPath;
      }
      return null;
    }

    // No env specified: check legacy path first, then default env
    // Legacy: .psst/vault.db (no envs folder)
    if (existsSync(join(basePath, DB_NAME))) {
      return basePath;
    }

    // Default env: .psst/envs/default/vault.db
    const defaultEnvPath = join(basePath, "envs", "default");
    if (existsSync(join(defaultEnvPath, DB_NAME))) {
      return defaultEnvPath;
    }

    return null;
  }

  static getVaultPath(global: boolean = false, env?: string): string {
    const basePath = global
      ? join(homedir(), VAULT_DIR_NAME)
      : join(process.cwd(), VAULT_DIR_NAME);

    if (env) {
      return join(basePath, "envs", env);
    }

    return basePath;
  }

  static listEnvironments(global: boolean = false): string[] {
    const basePath = global
      ? join(homedir(), VAULT_DIR_NAME)
      : join(process.cwd(), VAULT_DIR_NAME);

    const envs: string[] = [];

    // Check for legacy vault (counts as "default")
    if (existsSync(join(basePath, DB_NAME))) {
      envs.push("default (legacy)");
    }

    // Check for envs folder
    const envsPath = join(basePath, "envs");
    if (existsSync(envsPath)) {
      try {
        const entries = readdirSync(envsPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && existsSync(join(envsPath, entry.name, DB_NAME))) {
            envs.push(entry.name);
          }
        }
      } catch {
        // Ignore read errors
      }
    }

    return envs;
  }
}
