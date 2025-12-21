import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { encrypt, decrypt, keyToBuffer } from "./crypto";
import { getKey, storeKey, generateKey, isKeychainAvailable } from "./keychain";

const VAULT_DIR_NAME = ".psst";
const DB_NAME = "vault.db";

export interface Secret {
  name: string;
  value: string;
  created_at: string;
  updated_at: string;
}

export interface SecretMeta {
  name: string;
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

  async setSecret(name: string, value: string): Promise<void> {
    if (!this.key) throw new Error("Vault is locked");

    const { encrypted, iv } = await encrypt(value, this.key);

    this.db.run(
      `INSERT INTO secrets (name, encrypted_value, iv, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(name) DO UPDATE SET
         encrypted_value = excluded.encrypted_value,
         iv = excluded.iv,
         updated_at = CURRENT_TIMESTAMP`,
      [name, encrypted, iv]
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

  listSecrets(): SecretMeta[] {
    const rows = this.db
      .query("SELECT name, created_at, updated_at FROM secrets ORDER BY name")
      .all() as SecretMeta[];

    return rows;
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

  static findVaultPath(): string | null {
    // Check local .psst/ first
    const localPath = join(process.cwd(), VAULT_DIR_NAME);
    if (existsSync(join(localPath, DB_NAME))) {
      return localPath;
    }

    // Check global ~/.psst/
    const globalPath = join(homedir(), VAULT_DIR_NAME);
    if (existsSync(join(globalPath, DB_NAME))) {
      return globalPath;
    }

    return null;
  }

  static getVaultPath(global: boolean = true): string {
    return global
      ? join(homedir(), VAULT_DIR_NAME)
      : join(process.cwd(), VAULT_DIR_NAME);
  }
}
