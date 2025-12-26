import { createHash, pbkdf2Sync, randomBytes } from "crypto";

const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12; // 96 bits for GCM
const SALT_LENGTH = 16; // 128 bits
const PBKDF2_ITERATIONS = 100000;

/**
 * Convert a key string (base64 or password) to a 32-byte buffer
 */
export function keyToBuffer(key: string): Buffer {
  // If it looks like base64 and decodes to 32 bytes, use directly
  try {
    const decoded = Buffer.from(key, "base64");
    if (decoded.length === KEY_LENGTH) {
      return decoded;
    }
  } catch {}

  // Otherwise, derive key from the string using SHA-256
  return createHash("sha256").update(key).digest();
}

export async function encrypt(
  plaintext: string,
  key: Buffer
): Promise<{ encrypted: Buffer; iv: Buffer }> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    new TextEncoder().encode(plaintext)
  );

  return {
    encrypted: Buffer.from(encrypted),
    iv: Buffer.from(iv),
  };
}

export async function decrypt(
  encrypted: Buffer,
  iv: Buffer,
  key: Buffer
): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    encrypted
  );

  return new TextDecoder().decode(decrypted);
}

/**
 * Derive a key from password using PBKDF2
 */
export function deriveKey(password: string, salt: Buffer): Buffer {
  return pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, "sha256");
}

/**
 * Encrypt a file buffer with password
 * Returns: salt (16) + iv (12) + encrypted data
 */
export async function encryptFile(
  data: Buffer,
  password: string
): Promise<Buffer> {
  const salt = randomBytes(SALT_LENGTH);
  const key = deriveKey(password, salt);
  const iv = randomBytes(IV_LENGTH);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    data
  );

  // Concatenate: salt + iv + encrypted
  return Buffer.concat([salt, iv, Buffer.from(encrypted)]);
}

/**
 * Decrypt a file buffer with password
 * Expects: salt (16) + iv (12) + encrypted data
 */
export async function decryptFile(
  data: Buffer,
  password: string
): Promise<Buffer> {
  if (data.length < SALT_LENGTH + IV_LENGTH + 16) {
    throw new Error("Invalid encrypted data");
  }

  const salt = data.subarray(0, SALT_LENGTH);
  const iv = data.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const encrypted = data.subarray(SALT_LENGTH + IV_LENGTH);

  const key = deriveKey(password, salt);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    encrypted
  );

  return Buffer.from(decrypted);
}
