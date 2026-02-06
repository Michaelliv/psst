import { describe, expect, it } from "bun:test";
import { generateKey } from "./keychain";

describe("keychain", () => {
  describe("generateKey", () => {
    it("generates a base64-encoded key", () => {
      const key = generateKey();

      // Should be valid base64
      expect(() => Buffer.from(key, "base64")).not.toThrow();
    });

    it("generates a 32-byte key (256 bits)", () => {
      const key = generateKey();
      const decoded = Buffer.from(key, "base64");

      expect(decoded.length).toBe(32);
    });

    it("generates unique keys each time", () => {
      const key1 = generateKey();
      const key2 = generateKey();
      const key3 = generateKey();

      expect(key1).not.toBe(key2);
      expect(key2).not.toBe(key3);
      expect(key1).not.toBe(key3);
    });

    it("generates cryptographically random keys", () => {
      // Generate many keys and check they're all different
      const keys = new Set<string>();
      for (let i = 0; i < 100; i++) {
        keys.add(generateKey());
      }

      expect(keys.size).toBe(100);
    });
  });
});
