import { describe, expect, it } from "bun:test";
import {
  decrypt,
  decryptFile,
  deriveKey,
  encrypt,
  encryptFile,
  keyToBuffer,
} from "./crypto";

describe("crypto", () => {
  describe("keyToBuffer", () => {
    it("converts base64 key to 32-byte buffer", () => {
      // Generate a valid 32-byte base64 key
      const key = Buffer.from(new Uint8Array(32).fill(1)).toString("base64");
      const result = keyToBuffer(key);
      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBe(32);
    });

    it("derives key from password string using SHA-256", () => {
      const password = "my-secret-password";
      const result = keyToBuffer(password);
      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBe(32);
    });

    it("produces consistent output for same input", () => {
      const password = "test-password";
      const result1 = keyToBuffer(password);
      const result2 = keyToBuffer(password);
      expect(result1.equals(result2)).toBe(true);
    });

    it("produces different output for different inputs", () => {
      const result1 = keyToBuffer("password1");
      const result2 = keyToBuffer("password2");
      expect(result1.equals(result2)).toBe(false);
    });
  });

  describe("encrypt/decrypt", () => {
    it("encrypts and decrypts plaintext correctly", async () => {
      const key = keyToBuffer("test-key");
      const plaintext = "Hello, World!";

      const { encrypted, iv } = await encrypt(plaintext, key);
      const decrypted = await decrypt(encrypted, iv, key);

      expect(decrypted).toBe(plaintext);
    });

    it("produces different ciphertext for same plaintext (random IV)", async () => {
      const key = keyToBuffer("test-key");
      const plaintext = "Same message";

      const result1 = await encrypt(plaintext, key);
      const result2 = await encrypt(plaintext, key);

      // IVs should be different
      expect(result1.iv.equals(result2.iv)).toBe(false);
      // Ciphertext should be different
      expect(result1.encrypted.equals(result2.encrypted)).toBe(false);
    });

    it("fails to decrypt with wrong key", async () => {
      const key1 = keyToBuffer("correct-key");
      const key2 = keyToBuffer("wrong-key");
      const plaintext = "Secret message";

      const { encrypted, iv } = await encrypt(plaintext, key1);

      await expect(decrypt(encrypted, iv, key2)).rejects.toThrow();
    });

    it("handles empty string", async () => {
      const key = keyToBuffer("test-key");
      const plaintext = "";

      const { encrypted, iv } = await encrypt(plaintext, key);
      const decrypted = await decrypt(encrypted, iv, key);

      expect(decrypted).toBe("");
    });

    it("handles unicode characters", async () => {
      const key = keyToBuffer("test-key");
      const plaintext = "Hello 世界! 🔐";

      const { encrypted, iv } = await encrypt(plaintext, key);
      const decrypted = await decrypt(encrypted, iv, key);

      expect(decrypted).toBe(plaintext);
    });

    it("handles long plaintext", async () => {
      const key = keyToBuffer("test-key");
      const plaintext = "A".repeat(10000);

      const { encrypted, iv } = await encrypt(plaintext, key);
      const decrypted = await decrypt(encrypted, iv, key);

      expect(decrypted).toBe(plaintext);
    });
  });

  describe("deriveKey", () => {
    it("derives 32-byte key from password and salt", () => {
      const password = "my-password";
      const salt = Buffer.from("random-salt-1234");

      const key = deriveKey(password, salt);

      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);
    });

    it("produces consistent key for same password and salt", () => {
      const password = "my-password";
      const salt = Buffer.from("same-salt-here!!");

      const key1 = deriveKey(password, salt);
      const key2 = deriveKey(password, salt);

      expect(key1.equals(key2)).toBe(true);
    });

    it("produces different key for different salt", () => {
      const password = "my-password";
      const salt1 = Buffer.from("salt-one-here!!!");
      const salt2 = Buffer.from("salt-two-here!!!");

      const key1 = deriveKey(password, salt1);
      const key2 = deriveKey(password, salt2);

      expect(key1.equals(key2)).toBe(false);
    });

    it("produces different key for different password", () => {
      const salt = Buffer.from("same-salt-here!!");

      const key1 = deriveKey("password1", salt);
      const key2 = deriveKey("password2", salt);

      expect(key1.equals(key2)).toBe(false);
    });
  });

  describe("encryptFile/decryptFile", () => {
    it("encrypts and decrypts file data correctly", async () => {
      const password = "file-password";
      const data = Buffer.from("File contents here");

      const encrypted = await encryptFile(data, password);
      const decrypted = await decryptFile(encrypted, password);

      expect(decrypted.equals(data)).toBe(true);
    });

    it("produces output with salt + iv + ciphertext", async () => {
      const password = "test";
      const data = Buffer.from("test data");

      const encrypted = await encryptFile(data, password);

      // salt (16) + iv (12) + ciphertext (at least 16 for auth tag)
      expect(encrypted.length).toBeGreaterThanOrEqual(16 + 12 + 16);
    });

    it("fails to decrypt with wrong password", async () => {
      const data = Buffer.from("Secret file");

      const encrypted = await encryptFile(data, "correct-password");

      await expect(decryptFile(encrypted, "wrong-password")).rejects.toThrow();
    });

    it("fails on truncated data", async () => {
      const shortData = Buffer.from("too short");

      await expect(decryptFile(shortData, "password")).rejects.toThrow(
        "Invalid encrypted data",
      );
    });

    it("handles binary data", async () => {
      const password = "binary-test";
      const data = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);

      const encrypted = await encryptFile(data, password);
      const decrypted = await decryptFile(encrypted, password);

      expect(decrypted.equals(data)).toBe(true);
    });

    it("handles large files", async () => {
      const password = "large-file";
      const data = Buffer.alloc(1024 * 1024, 0xab); // 1MB

      const encrypted = await encryptFile(data, password);
      const decrypted = await decryptFile(encrypted, password);

      expect(decrypted.equals(data)).toBe(true);
    });
  });
});
