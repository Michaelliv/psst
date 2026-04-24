import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadConfig,
  resolveAwsPrefix,
  resolveAwsRegion,
  saveConfig,
} from "./config.js";

describe("vault config", () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `psst-config-${Date.now()}-${Math.random()}`);
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  });

  describe("loadConfig", () => {
    it("returns default (sqlite) when config.json is absent", () => {
      expect(loadConfig(dir)).toEqual({ backend: "sqlite" });
    });

    it("parses an explicit sqlite config", () => {
      writeFileSync(join(dir, "config.json"), JSON.stringify({ backend: "sqlite" }));
      expect(loadConfig(dir)).toEqual({ backend: "sqlite" });
    });

    it("parses an aws config with full options", () => {
      writeFileSync(
        join(dir, "config.json"),
        JSON.stringify({
          backend: "aws",
          aws: { region: "us-east-1", prefix: "myprefix/", profile: "dev" },
        }),
      );
      expect(loadConfig(dir)).toEqual({
        backend: "aws",
        aws: { region: "us-east-1", prefix: "myprefix/", profile: "dev" },
      });
    });

    it("parses an aws config with no explicit options", () => {
      writeFileSync(
        join(dir, "config.json"),
        JSON.stringify({ backend: "aws" }),
      );
      expect(loadConfig(dir)).toEqual({ backend: "aws", aws: {} });
    });

    it("rejects unknown backend", () => {
      writeFileSync(
        join(dir, "config.json"),
        JSON.stringify({ backend: "gcp" }),
      );
      expect(() => loadConfig(dir)).toThrow(/Unknown backend "gcp"/);
    });

    it("rejects non-object root", () => {
      writeFileSync(join(dir, "config.json"), JSON.stringify("hello"));
      expect(() => loadConfig(dir)).toThrow(/must be a JSON object/);
    });

    it("rejects malformed JSON", () => {
      writeFileSync(join(dir, "config.json"), "{not json");
      expect(() => loadConfig(dir)).toThrow(/Invalid JSON/);
    });

    it("rejects non-string aws fields", () => {
      writeFileSync(
        join(dir, "config.json"),
        JSON.stringify({ backend: "aws", aws: { region: 123 } }),
      );
      expect(() => loadConfig(dir)).toThrow(/aws\.region must be a string/);
    });
  });

  describe("saveConfig", () => {
    it("round-trips a sqlite config", () => {
      saveConfig(dir, { backend: "sqlite" });
      expect(loadConfig(dir)).toEqual({ backend: "sqlite" });
    });

    it("round-trips an aws config", () => {
      const cfg = {
        backend: "aws" as const,
        aws: { region: "eu-west-1", prefix: "x/" },
      };
      saveConfig(dir, cfg);
      expect(loadConfig(dir)).toEqual(cfg);
    });
  });

  describe("resolveAwsRegion", () => {
    const originalRegion = process.env.AWS_REGION;
    const originalDefault = process.env.AWS_DEFAULT_REGION;

    afterEach(() => {
      if (originalRegion === undefined) delete process.env.AWS_REGION;
      else process.env.AWS_REGION = originalRegion;
      if (originalDefault === undefined) delete process.env.AWS_DEFAULT_REGION;
      else process.env.AWS_DEFAULT_REGION = originalDefault;
    });

    it("prefers config over env vars", () => {
      process.env.AWS_REGION = "us-west-2";
      process.env.AWS_DEFAULT_REGION = "eu-west-1";
      expect(resolveAwsRegion({ region: "us-east-1" })).toBe("us-east-1");
    });

    it("falls back to AWS_REGION when config missing", () => {
      delete process.env.AWS_DEFAULT_REGION;
      process.env.AWS_REGION = "us-west-2";
      expect(resolveAwsRegion(undefined)).toBe("us-west-2");
    });

    it("falls back to AWS_DEFAULT_REGION when AWS_REGION missing", () => {
      delete process.env.AWS_REGION;
      process.env.AWS_DEFAULT_REGION = "eu-west-1";
      expect(resolveAwsRegion(undefined)).toBe("eu-west-1");
    });

    it("returns undefined when nothing is set", () => {
      delete process.env.AWS_REGION;
      delete process.env.AWS_DEFAULT_REGION;
      expect(resolveAwsRegion(undefined)).toBeUndefined();
    });
  });

  describe("resolveAwsPrefix", () => {
    it("defaults to psst/", () => {
      expect(resolveAwsPrefix(undefined)).toBe("psst/");
      expect(resolveAwsPrefix({})).toBe("psst/");
    });

    it("preserves trailing slash if already present", () => {
      expect(resolveAwsPrefix({ prefix: "myprefix/" })).toBe("myprefix/");
    });

    it("adds trailing slash when missing", () => {
      expect(resolveAwsPrefix({ prefix: "myprefix" })).toBe("myprefix/");
    });

    it("respects explicit empty prefix", () => {
      expect(resolveAwsPrefix({ prefix: "" })).toBe("");
    });
  });
});
