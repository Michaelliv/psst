import { describe, expect, it } from "bun:test";
import { decrypt, encrypt, keyToBuffer } from "./crypto";

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
});
