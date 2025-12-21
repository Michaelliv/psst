import { createHash } from "crypto";

const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12; // 96 bits for GCM

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
