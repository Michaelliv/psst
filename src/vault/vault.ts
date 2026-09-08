/**
 * vault.ts — Vault façade over pluggable storage backends.
 *
 * The Vault class keeps its historical public API (setSecret, getSecret,
 * listSecrets, etc) and delegates to the configured backend:
 *
 *   sqlite — local encrypted SQLite (default; original behavior)
 *   aws    — AWS Secrets Manager (new)
 *
 * Selection order:
 *
 *   1. Explicit `options.backend` passed to the constructor.
 *   2. `config.json` inside the vault directory.
 *   3. Default: sqlite.
 *
 * Environment/CLI-level config is handled by callers (they pass
 * the resolved config into the constructor) so the Vault stays pure.
 */

import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AwsBackend, initializeAwsVault } from "./aws-backend.js";
import type {
  SecretHistoryRecord,
  SecretMetaRecord,
  VaultBackend,
} from "./backend.js";
import {
  type AwsBackendConfig,
  type BackendType,
  type KeyBackendType,
  loadConfig,
  saveConfig,
  type VaultConfig,
} from "./config.js";
import { initializeSqliteVault, SqliteBackend } from "./sqlite-backend.js";

const VAULT_DIR_NAME = ".psst";
const DB_NAME = "vault.db";
const CONFIG_FILE_NAME = "config.json";

// Re-export the backend record types under their historic names so
// existing callers (the CLI commands, SDK consumers) don't need to change.
//
// These are declared as `interface extends ...` (rather than `type =`) so
// downstream TypeScript consumers can augment them via declaration merging.

export interface Secret {
  name: string;
  value: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}
export interface SecretMeta extends SecretMetaRecord {}
export interface SecretHistoryEntry extends SecretHistoryRecord {}

export interface VaultOptions {
  /** Encryption key (base64 or password string). Only meaningful for the sqlite backend. */
  key?: string;
  /** Override the backend selection. Skips reading config.json. */
  backend?: BackendType;
  /** Where the vault encryption key is stored. Default: "keychain". */
  keyBackend?: KeyBackendType;
  /** AWS backend settings. Only used when backend === "aws". */
  aws?: AwsBackendConfig;
}

export class Vault {
  readonly vaultPath: string;
  private backend: VaultBackend;
  // Kept for backwards-compatible isUnlocked() — only meaningful for sqlite.
  private sqlite: SqliteBackend | null = null;

  constructor(vaultPath: string, options?: VaultOptions) {
    this.vaultPath = vaultPath;

    // Resolve the backend choice and config.
    let backendType: BackendType;
    let awsConfig: AwsBackendConfig | undefined;
    let keyBackend: KeyBackendType | undefined;

    if (options?.backend) {
      backendType = options.backend;
      awsConfig = options.aws;
      keyBackend = options.keyBackend;
    } else {
      const fileConfig = this.tryLoadConfig();
      backendType = fileConfig?.backend ?? "sqlite";
      awsConfig = fileConfig?.aws ?? options?.aws;
      keyBackend = fileConfig?.keyBackend ?? options?.keyBackend;
    }

    if (backendType === "aws") {
      this.backend = new AwsBackend(awsConfig);
    } else {
      const sqlite = new SqliteBackend(vaultPath, {
        key: options?.key,
        keyBackend,
        vaultPath,
      });
      this.sqlite = sqlite;
      this.backend = sqlite;
    }
  }

  private tryLoadConfig(): VaultConfig | null {
    const configPath = join(this.vaultPath, CONFIG_FILE_NAME);
    if (!existsSync(configPath)) return null;
    return loadConfig(this.vaultPath);
  }

  /** Backend type currently in use — useful for CLI messaging. */
  get backendType(): string {
    return this.backend.type;
  }

  /**
   * Unlock the vault. For sqlite: fetches the encryption key from keychain
   * or PSST_PASSWORD. For aws: no-op (auth is handled by AWS SDK).
   */
  async unlock(): Promise<boolean> {
    if (this.sqlite) return this.sqlite.unlock();
    return true;
  }

  /** True if the backend is ready to read/write. */
  isUnlocked(): boolean {
    if (this.sqlite) return this.sqlite.isUnlocked();
    return true;
  }

  setSecret(name: string, value: string, tags?: string[]): Promise<void> {
    return this.backend.setSecret(name, value, tags);
  }

  /** True if a secret with this logical name exists in the backend. */
  exists(name: string): Promise<boolean> {
    return this.backend.exists(name);
  }

  getSecret(name: string): Promise<string | null> {
    return this.backend.getSecret(name);
  }

  getSecrets(names: string[]): Promise<Map<string, string>> {
    return this.backend.getSecrets(names);
  }

  listSecrets(filterTags?: string[]): Promise<SecretMetaRecord[]> {
    return this.backend.listSecrets(filterTags);
  }

  getTags(name: string): Promise<string[]> {
    return this.backend.getTags(name);
  }

  setTags(name: string, tags: string[]): Promise<boolean> {
    return this.backend.setTags(name, tags);
  }

  addTags(name: string, newTags: string[]): Promise<boolean> {
    return this.backend.addTags(name, newTags);
  }

  removeTags(name: string, tagsToRemove: string[]): Promise<boolean> {
    return this.backend.removeTags(name, tagsToRemove);
  }

  getHistory(name: string): Promise<SecretHistoryRecord[]> {
    return this.backend.getHistory(name);
  }

  getHistoryVersion(name: string, version: number): Promise<string | null> {
    return this.backend.getHistoryVersion(name, version);
  }

  rollback(name: string, targetVersion: number): Promise<boolean> {
    return this.backend.rollback(name, targetVersion);
  }

  clearHistory(name: string): Promise<void> {
    return this.backend.clearHistory(name);
  }

  removeSecret(name: string): Promise<boolean> {
    return this.backend.removeSecret(name);
  }

  close(): void {
    this.backend.close();
  }

  /**
   * Initialize a new vault directory and storage backend.
   *
   * CLI usage: no options for sqlite (keychain path) — or
   *   { backend: "aws", aws: {...} } for the AWS backend.
   *
   * SDK usage with a custom key: pass `{ skipKeychain: true }`.
   */
  static async initializeVault(
    vaultPath: string,
    options?: {
      skipKeychain?: boolean;
      backend?: BackendType;
      keyBackend?: KeyBackendType;
      keystorePassword?: string;
      aws?: AwsBackendConfig;
    },
  ): Promise<{ success: boolean; error?: string }> {
    if (!existsSync(vaultPath)) {
      mkdirSync(vaultPath, { recursive: true });
    }

    const backend: BackendType = options?.backend ?? "sqlite";

    if (backend === "aws") {
      const check = initializeAwsVault(options?.aws);
      if (!check.success) return check;

      saveConfig(vaultPath, { backend: "aws", aws: options?.aws ?? {} });
      return { success: true };
    }

    // sqlite
    const result = await initializeSqliteVault(vaultPath, {
      skipKeychain: options?.skipKeychain,
      keyBackend: options?.keyBackend,
      keystorePassword: options?.keystorePassword,
    });
    if (result.success && options?.keyBackend === "sqlite") {
      saveConfig(vaultPath, { backend: "sqlite", keyBackend: "sqlite" });
    }
    return result;
  }

  /**
   * Discover a vault path on disk.
   *
   * A vault is considered present if either a `vault.db` (sqlite) or a
   * `config.json` (any backend, e.g. aws with no local db) exists.
   *
   * Asymmetry: legacy sqlite vaults were never written with a config.json,
   * so we accept `vault.db` alone as proof-of-vault. AWS vaults have no
   * local DB file so `config.json` is the only marker. This preserves
   * zero-config for new sqlite users and backwards compat for existing
   * vaults created before backends were pluggable.
   */
  static findVaultPath(
    options: { global?: boolean; env?: string } = {},
  ): string | null {
    const { global = false, env } = options;

    const basePath = global
      ? join(homedir(), VAULT_DIR_NAME)
      : join(process.cwd(), VAULT_DIR_NAME);

    const hasVault = (dir: string) =>
      existsSync(join(dir, DB_NAME)) || existsSync(join(dir, CONFIG_FILE_NAME));

    if (env) {
      const envPath = join(basePath, "envs", env);
      return hasVault(envPath) ? envPath : null;
    }

    // Legacy: .psst/vault.db or .psst/config.json (no envs folder)
    if (hasVault(basePath)) return basePath;

    // Default env
    const defaultEnvPath = join(basePath, "envs", "default");
    if (hasVault(defaultEnvPath)) return defaultEnvPath;

    return null;
  }

  static getVaultPath(global: boolean = false, env?: string): string {
    const basePath = global
      ? join(homedir(), VAULT_DIR_NAME)
      : join(process.cwd(), VAULT_DIR_NAME);

    if (env) return join(basePath, "envs", env);
    return basePath;
  }

  static listEnvironments(global: boolean = false): string[] {
    const basePath = global
      ? join(homedir(), VAULT_DIR_NAME)
      : join(process.cwd(), VAULT_DIR_NAME);

    const envs: string[] = [];

    if (
      existsSync(join(basePath, DB_NAME)) ||
      existsSync(join(basePath, CONFIG_FILE_NAME))
    ) {
      envs.push("default (legacy)");
    }

    const envsPath = join(basePath, "envs");
    if (existsSync(envsPath)) {
      try {
        const entries = readdirSync(envsPath, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const dir = join(envsPath, entry.name);
          if (
            existsSync(join(dir, DB_NAME)) ||
            existsSync(join(dir, CONFIG_FILE_NAME))
          ) {
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
