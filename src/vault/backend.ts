/**
 * backend.ts — Pluggable storage backend interface for psst vaults.
 *
 * Every backend must implement VaultBackend. The Vault class delegates
 * all storage operations to the active backend.
 */

export interface SecretRecord {
  name: string;
  value: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface SecretMetaRecord {
  name: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface SecretHistoryRecord {
  version: number;
  tags: string[];
  archived_at: string;
}

/**
 * Pluggable storage backend for secrets.
 *
 * Implementations:
 *   - SqliteBackend  — local encrypted SQLite (original psst behavior)
 *   - AwsBackend     — AWS Secrets Manager
 */
export interface VaultBackend {
  readonly type: string;

  /** Return true if a secret with this logical name exists. */
  exists(name: string): Promise<boolean>;

  /** Set or update a secret. Implementations should archive previous versions. */
  setSecret(name: string, value: string, tags?: string[]): Promise<void>;

  /** Get a secret value by name. Returns null if not found. */
  getSecret(name: string): Promise<string | null>;

  /** Get multiple secrets by name. */
  getSecrets(names: string[]): Promise<Map<string, string>>;

  /** List secret metadata, optionally filtered by tags (OR logic). */
  listSecrets(filterTags?: string[]): Promise<SecretMetaRecord[]>;

  /** Remove a secret and its history. Returns true if it existed. */
  removeSecret(name: string): Promise<boolean>;

  /** Get tags for a secret. */
  getTags(name: string): Promise<string[]>;

  /** Replace all tags on a secret. */
  setTags(name: string, tags: string[]): Promise<boolean>;

  /** Add tags to a secret (merge with existing). */
  addTags(name: string, newTags: string[]): Promise<boolean>;

  /** Remove specific tags from a secret. */
  removeTags(name: string, tagsToRemove: string[]): Promise<boolean>;

  /** Get version history for a secret. */
  getHistory(name: string): Promise<SecretHistoryRecord[]>;

  /** Get a specific historical version's value. */
  getHistoryVersion(name: string, version: number): Promise<string | null>;

  /** Rollback a secret to a previous version. Returns true on success. */
  rollback(name: string, targetVersion: number): Promise<boolean>;

  /** Clear all history for a secret. */
  clearHistory(name: string): Promise<void>;

  /** Clean up resources (close DB connections, etc). */
  close(): void;
}
