import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { parseEnvContent, importFromEnv } from "./import";

describe("import", () => {
  describe("parseEnvContent", () => {
    it("parses simple KEY=value pairs", () => {
      const content = "API_KEY=abc123\nSECRET=xyz789";
      const result = parseEnvContent(content);
      expect(result).toEqual([
        ["API_KEY", "abc123"],
        ["SECRET", "xyz789"],
      ]);
    });

    it("handles double-quoted values", () => {
      const content = 'MY_VAR="hello world"';
      const result = parseEnvContent(content);
      expect(result).toEqual([["MY_VAR", "hello world"]]);
    });

    it("handles single-quoted values", () => {
      const content = "MY_VAR='hello world'";
      const result = parseEnvContent(content);
      expect(result).toEqual([["MY_VAR", "hello world"]]);
    });

    it("skips comment lines", () => {
      const content = "# This is a comment\nAPI_KEY=value\n# Another comment";
      const result = parseEnvContent(content);
      expect(result).toEqual([["API_KEY", "value"]]);
    });

    it("skips empty lines", () => {
      const content = "KEY1=value1\n\n\nKEY2=value2\n";
      const result = parseEnvContent(content);
      expect(result).toEqual([
        ["KEY1", "value1"],
        ["KEY2", "value2"],
      ]);
    });

    it("handles values with equals sign", () => {
      const content = "CONNECTION_STRING=host=localhost;port=5432";
      const result = parseEnvContent(content);
      expect(result).toEqual([["CONNECTION_STRING", "host=localhost;port=5432"]]);
    });

    it("handles whitespace around key and value", () => {
      const content = "  API_KEY  =  abc123  ";
      const result = parseEnvContent(content);
      expect(result).toEqual([["API_KEY", "abc123"]]);
    });

    it("skips lines without equals sign", () => {
      const content = "VALID_KEY=value\ninvalid line\nANOTHER_KEY=value2";
      const result = parseEnvContent(content);
      expect(result).toEqual([
        ["VALID_KEY", "value"],
        ["ANOTHER_KEY", "value2"],
      ]);
    });

    it("skips entries with empty value", () => {
      const content = "EMPTY_KEY=\nVALID_KEY=value";
      const result = parseEnvContent(content);
      expect(result).toEqual([["VALID_KEY", "value"]]);
    });

    it("skips entries with empty key", () => {
      const content = "=value\nVALID_KEY=value";
      const result = parseEnvContent(content);
      expect(result).toEqual([["VALID_KEY", "value"]]);
    });

    it("handles special characters in values", () => {
      const content = "SPECIAL=!@#$%^&*()_+-=[]{}|;':\",./<>?";
      const result = parseEnvContent(content);
      expect(result).toEqual([["SPECIAL", "!@#$%^&*()_+-=[]{}|;':\",./<>?"]]);
    });

    it("handles URL values", () => {
      const content = "DATABASE_URL=postgres://user:pass@localhost:5432/db";
      const result = parseEnvContent(content);
      expect(result).toEqual([["DATABASE_URL", "postgres://user:pass@localhost:5432/db"]]);
    });

    it("handles multiline with Windows line endings", () => {
      const content = "KEY1=value1\r\nKEY2=value2\r\n";
      const result = parseEnvContent(content);
      // \r will remain in value but trim() handles leading/trailing
      expect(result.length).toBe(2);
      expect(result[0][0]).toBe("KEY1");
      expect(result[1][0]).toBe("KEY2");
    });

    it("handles lowercase keys (valid parse, validation happens elsewhere)", () => {
      const content = "lowercase_key=value";
      const result = parseEnvContent(content);
      expect(result).toEqual([["lowercase_key", "value"]]);
    });

    it("returns empty array for empty content", () => {
      const result = parseEnvContent("");
      expect(result).toEqual([]);
    });

    it("returns empty array for only comments", () => {
      const content = "# comment 1\n# comment 2\n# comment 3";
      const result = parseEnvContent(content);
      expect(result).toEqual([]);
    });

    it("handles export prefix (keeps it as part of key)", () => {
      // Note: Standard .env files don't use export, but some do
      const content = "export API_KEY=value";
      const result = parseEnvContent(content);
      // "export API_KEY" becomes the key
      expect(result).toEqual([["export API_KEY", "value"]]);
    });

    it("handles JSON values", () => {
      const content = 'CONFIG={"key": "value", "num": 123}';
      const result = parseEnvContent(content);
      expect(result).toEqual([["CONFIG", '{"key": "value", "num": 123}']]);
    });

    it("handles base64 values", () => {
      const content = "ENCODED=SGVsbG8gV29ybGQh";
      const result = parseEnvContent(content);
      expect(result).toEqual([["ENCODED", "SGVsbG8gV29ybGQh"]]);
    });

    it("handles very long values", () => {
      const longValue = "x".repeat(10000);
      const content = `LONG_KEY=${longValue}`;
      const result = parseEnvContent(content);
      expect(result).toEqual([["LONG_KEY", longValue]]);
    });
  });

  describe("importFromEnv", () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      // Set up test environment variables
      process.env.TEST_VAR_ONE = "value1";
      process.env.TEST_VAR_TWO = "value2";
      process.env.ANOTHER_TEST = "value3";
      process.env.lowercase_var = "should_be_skipped";
    });

    afterEach(() => {
      // Restore original env
      delete process.env.TEST_VAR_ONE;
      delete process.env.TEST_VAR_TWO;
      delete process.env.ANOTHER_TEST;
      delete process.env.lowercase_var;
    });

    it("imports uppercase env vars without pattern", () => {
      const result = importFromEnv();

      // Should include our test vars
      const names = result.map(([name]) => name);
      expect(names).toContain("TEST_VAR_ONE");
      expect(names).toContain("TEST_VAR_TWO");
      expect(names).toContain("ANOTHER_TEST");
    });

    it("excludes lowercase env vars", () => {
      const result = importFromEnv();
      const names = result.map(([name]) => name);
      expect(names).not.toContain("lowercase_var");
    });

    it("filters by pattern", () => {
      const result = importFromEnv("^TEST_VAR");
      const names = result.map(([name]) => name);

      expect(names).toContain("TEST_VAR_ONE");
      expect(names).toContain("TEST_VAR_TWO");
      expect(names).not.toContain("ANOTHER_TEST");
    });

    it("returns correct values", () => {
      const result = importFromEnv("^TEST_VAR_ONE$");

      expect(result.length).toBe(1);
      expect(result[0]).toEqual(["TEST_VAR_ONE", "value1"]);
    });

    it("handles pattern that matches nothing", () => {
      const result = importFromEnv("^NONEXISTENT_PREFIX");
      const hasNonexistent = result.some(([name]) => name.startsWith("NONEXISTENT"));
      expect(hasNonexistent).toBe(false);
    });

    it("skips env vars with empty values", () => {
      process.env.EMPTY_VAR = "";
      const result = importFromEnv("^EMPTY_VAR$");
      delete process.env.EMPTY_VAR;

      expect(result.length).toBe(0);
    });
  });
});
