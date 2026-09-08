/**
 * sqlite-keystore.ts — SQLite-based key storage as an alternative to the OS keychain.
 *
 * Stores the vault encryption key in `keystore.db` inside the vault directory.
 * The key is encrypted with AES-256-GCM using a key derived from a user password
 * via PBKDF2. Works on any platform without OS keychain support.
 *
 * SECURITY: Unlike the upstream fork, this implementation does NOT persist
 * the password to disk. The password must come from PSST_PASSWORD env var
 * or an interactive prompt. No credentials file is created.
 */

import { pbkdf2Sync, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { openDatabase } from "./database.js";
import type { KeychainResult } from "./keychain.js";

const KEYSTORE_DB_NAME = "keystore.db";
const KEY_ID = "vault-key";
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEYLEN = 32;
const PBKDF2_DIGEST = "sha256";
const IV_LENGTH = 12;

function deriveKey(password: string, salt: Buffer): Buffer {
  return pbkdf2Sync(
    password,
    salt,
    PBKDF2_ITERATIONS,
    PBKDF2_KEYLEN,
    PBKDF2_DIGEST,
  );
}

function openKeystore(vaultPath: string) {
  const dbPath = join(vaultPath, KEYSTORE_DB_NAME);
  const db = openDatabase(dbPath);
  db.run(`
    CREATE TABLE IF NOT EXISTS key_store (
      id TEXT PRIMARY KEY,
      salt BLOB NOT NULL,
      iv BLOB NOT NULL,
      encrypted_key BLOB NOT NULL
    )
  `);
  return db;
}

export function isKeystorePresent(vaultPath: string): boolean {
  return existsSync(join(vaultPath, KEYSTORE_DB_NAME));
}

export async function storeKeyInSqlite(
  vaultPath: string,
  key: string,
  password: string,
): Promise<KeychainResult> {
  try {
    const salt = Buffer.from(randomBytes(16));
    const iv = Buffer.from(randomBytes(IV_LENGTH));
    const derivedKey = deriveKey(password, salt);

    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      new Uint8Array(derivedKey),
      "AES-GCM",
      false,
      ["encrypt"],
    );

    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: new Uint8Array(iv) },
      cryptoKey,
      new TextEncoder().encode(key),
    );

    const db = openKeystore(vaultPath);
    db.run(
      `INSERT INTO key_store (id, salt, iv, encrypted_key)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         salt = excluded.salt,
         iv = excluded.iv,
         encrypted_key = excluded.encrypted_key`,
      [KEY_ID, salt, iv, Buffer.from(encrypted)],
    );
    db.close();

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

export async function getKeyFromSqlite(
  vaultPath: string,
  password: string,
): Promise<KeychainResult> {
  try {
    const db = openKeystore(vaultPath);
    const row = db
      .query("SELECT salt, iv, encrypted_key FROM key_store WHERE id = ?")
      .get(KEY_ID) as {
      salt: Buffer;
      iv: Buffer;
      encrypted_key: Buffer;
    } | null;
    db.close();

    if (!row) {
      return { success: false, error: "No key found in sqlite keystore" };
    }

    const derivedKey = deriveKey(password, row.salt);

    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      new Uint8Array(derivedKey),
      "AES-GCM",
      false,
      ["decrypt"],
    );

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(row.iv) },
      cryptoKey,
      new Uint8Array(row.encrypted_key),
    );

    return { success: true, key: new TextDecoder().decode(decrypted) };
  } catch {
    return { success: false, error: "Wrong password or corrupted keystore" };
  }
}