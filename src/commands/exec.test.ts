import { describe, it, expect } from "bun:test";
import { maskSecrets } from "./exec";

describe("exec", () => {
  describe("maskSecrets", () => {
    it("masks a single secret", () => {
      const text = "The password is secret123 and more text";
      const result = maskSecrets(text, ["secret123"]);
      expect(result).toBe("The password is [REDACTED] and more text");
    });

    it("masks multiple different secrets", () => {
      const text = "API key: abc123, Token: xyz789";
      const result = maskSecrets(text, ["abc123", "xyz789"]);
      expect(result).toBe("API key: [REDACTED], Token: [REDACTED]");
    });

    it("masks multiple occurrences of same secret", () => {
      const text = "secret appears here: pass123, and again: pass123";
      const result = maskSecrets(text, ["pass123"]);
      expect(result).toBe("secret appears here: [REDACTED], and again: [REDACTED]");
    });

    it("handles empty secrets array", () => {
      const text = "Some text with no secrets";
      const result = maskSecrets(text, []);
      expect(result).toBe("Some text with no secrets");
    });

    it("handles empty text", () => {
      const result = maskSecrets("", ["secret"]);
      expect(result).toBe("");
    });

    it("handles special regex characters in secrets", () => {
      const text = "Password: p@ss.w*rd+test";
      const result = maskSecrets(text, ["p@ss.w*rd+test"]);
      expect(result).toBe("Password: [REDACTED]");
    });

    it("handles secrets with brackets", () => {
      const text = "Token: [abc](123)";
      const result = maskSecrets(text, ["[abc](123)"]);
      expect(result).toBe("Token: [REDACTED]");
    });

    it("handles multiline text", () => {
      const text = "Line 1: secret123\nLine 2: secret123\nLine 3: normal";
      const result = maskSecrets(text, ["secret123"]);
      expect(result).toBe("Line 1: [REDACTED]\nLine 2: [REDACTED]\nLine 3: normal");
    });

    it("handles overlapping secrets (masks first match)", () => {
      const text = "The value is abc123def";
      const result = maskSecrets(text, ["abc123", "123def"]);
      // abc123 is replaced first, leaving "def"
      // then 123def won't match anymore
      expect(result).toBe("The value is [REDACTED]def");
    });

    it("handles secret at start of text", () => {
      const text = "secret123 is at the start";
      const result = maskSecrets(text, ["secret123"]);
      expect(result).toBe("[REDACTED] is at the start");
    });

    it("handles secret at end of text", () => {
      const text = "At the end: secret123";
      const result = maskSecrets(text, ["secret123"]);
      expect(result).toBe("At the end: [REDACTED]");
    });

    it("handles JSON output with secrets", () => {
      const text = '{"api_key": "sk-12345", "token": "tk-67890"}';
      const result = maskSecrets(text, ["sk-12345", "tk-67890"]);
      expect(result).toBe('{"api_key": "[REDACTED]", "token": "[REDACTED]"}');
    });

    it("handles URL with secrets", () => {
      const text = "https://api.example.com?key=abc123&token=xyz789";
      const result = maskSecrets(text, ["abc123", "xyz789"]);
      expect(result).toBe("https://api.example.com?key=[REDACTED]&token=[REDACTED]");
    });

    it("preserves non-secret content exactly", () => {
      const text = "Hello\tWorld\nNew  line  with  spaces";
      const result = maskSecrets(text, ["notfound"]);
      expect(result).toBe("Hello\tWorld\nNew  line  with  spaces");
    });

    it("handles unicode secrets", () => {
      const text = "Password: 密码123";
      const result = maskSecrets(text, ["密码123"]);
      expect(result).toBe("Password: [REDACTED]");
    });

    it("handles empty string secrets (splits on every char)", () => {
      const text = "Some text";
      const result = maskSecrets(text, [""]);
      // Empty string split creates [REDACTED] between every character
      // This is a known edge case - callers should filter empty secrets
      expect(result).toContain("[REDACTED]");
    });
  });
});
