import { describe, it, expect } from "bun:test";
import { escapeEnvValue } from "./export";

describe("export", () => {
  describe("escapeEnvValue", () => {
    it("returns simple values unchanged", () => {
      expect(escapeEnvValue("simplevalue")).toBe("simplevalue");
      expect(escapeEnvValue("abc123")).toBe("abc123");
      expect(escapeEnvValue("API_KEY_VALUE")).toBe("API_KEY_VALUE");
    });

    it("quotes values with spaces", () => {
      expect(escapeEnvValue("hello world")).toBe('"hello world"');
    });

    it("escapes and quotes values with double quotes", () => {
      expect(escapeEnvValue('say "hello"')).toBe('"say \\"hello\\""');
    });

    it("quotes values with single quotes", () => {
      expect(escapeEnvValue("it's fine")).toBe('"it\'s fine"');
    });

    it("escapes newlines", () => {
      expect(escapeEnvValue("line1\nline2")).toBe('"line1\\nline2"');
    });

    it("escapes dollar signs", () => {
      expect(escapeEnvValue("price is $100")).toBe('"price is \\$100"');
    });

    it("escapes backticks", () => {
      expect(escapeEnvValue("run `command`")).toBe('"run \\`command\\`"');
    });

    it("escapes backslashes", () => {
      expect(escapeEnvValue("path\\to\\file")).toBe('"path\\\\to\\\\file"');
    });

    it("handles multiple special characters", () => {
      const value = 'complex "value" with\nnewlines and $vars';
      const escaped = escapeEnvValue(value);
      expect(escaped).toContain('\\"');
      expect(escaped).toContain('\\n');
      expect(escaped).toContain('\\$');
      expect(escaped.startsWith('"')).toBe(true);
      expect(escaped.endsWith('"')).toBe(true);
    });

    it("handles empty string", () => {
      expect(escapeEnvValue("")).toBe("");
    });

    it("handles URL values", () => {
      expect(escapeEnvValue("https://example.com/path?key=value")).toBe("https://example.com/path?key=value");
    });

    it("handles base64 values", () => {
      expect(escapeEnvValue("SGVsbG8gV29ybGQh")).toBe("SGVsbG8gV29ybGQh");
    });

    it("quotes values with shell special chars", () => {
      // $ and ` need escaping for shell safety
      expect(escapeEnvValue("$(whoami)")).toContain("\\$");
      expect(escapeEnvValue("`whoami`")).toContain("\\`");
    });

    it("handles JSON values", () => {
      const json = '{"key": "value"}';
      const escaped = escapeEnvValue(json);
      expect(escaped).toContain('\\"');
      expect(escaped.startsWith('"')).toBe(true);
    });

    it("handles very long values", () => {
      const longValue = "x".repeat(10000);
      expect(escapeEnvValue(longValue)).toBe(longValue);
    });

    it("handles unicode characters", () => {
      expect(escapeEnvValue("密码")).toBe("密码");
      expect(escapeEnvValue("emoji 🔐")).toBe('"emoji 🔐"'); // has space
    });
  });
});
