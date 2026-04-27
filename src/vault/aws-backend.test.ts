/**
 * Unit tests for AwsBackend. We stub @aws-sdk/client-secrets-manager so the
 * tests are deterministic and offline. The stub is installed at module
 * level (before AwsBackend is imported inside the tests) via an in-memory
 * fake client + command classes.
 */

import { beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ─── Minimal in-memory AWS Secrets Manager fake ─────────────────────────────
//
// Tracks secrets by name with a list of versions, each with its own
// { VersionId, CreatedDate, SecretString } and a set of stage labels.
// Emulates just the behaviors AwsBackend uses.

interface FakeVersion {
  VersionId: string;
  CreatedDate: Date;
  SecretString: string;
  VersionStages: string[];
}

interface FakeSecret {
  Name: string;
  Tags: Array<{ Key: string; Value: string }>;
  Versions: FakeVersion[];
  // scheduled-for-deletion simulation
  pendingDelete?: boolean;
}

class FakeAwsError extends Error {
  name: string;
  constructor(name: string, message: string) {
    super(message);
    this.name = name;
  }
}

class FakeStore {
  secrets = new Map<string, FakeSecret>();
  private idCounter = 1;

  nextVersionId(): string {
    return `vid-${this.idCounter++}`;
  }

  assertExists(name: string): FakeSecret {
    const s = this.secrets.get(name);
    if (!s)
      throw new FakeAwsError("ResourceNotFoundException", `no secret: ${name}`);
    if (s.pendingDelete)
      throw new FakeAwsError(
        "InvalidRequestException",
        "scheduled for deletion",
      );
    return s;
  }
}

const store = new FakeStore();

/**
 * Input payload passed to any AWS SDK command. The real SDK has ~15 command
 * classes with wildly different input shapes, so we type this loosely in the
 * fake and narrow per-case inside FakeClient.send().
 */
type FakeCommandInput = Record<string, unknown>;

function makeCommand(name: string) {
  return class {
    readonly __cmd = name;
    input: FakeCommandInput;
    constructor(input: FakeCommandInput) {
      this.input = input;
    }
  };
}

type FakeCommand = { __cmd: string; input: FakeCommandInput };

class FakeClient {
  // The return type mirrors the AWS SDK — each command has its own output
  // shape. We use `unknown` on the public signature and let TypeScript flow
  // analysis narrow via the switch.
  async send(cmd: FakeCommand): Promise<unknown> {
    const name = cmd.__cmd;
    // Per-command input casts are safe because makeCommand() sets __cmd to
    // match the command class the caller instantiated.
    // biome-ignore lint/suspicious/noExplicitAny: deliberate fake-mock
    const i = cmd.input as any;
    switch (name) {
      case "CreateSecret": {
        if (store.secrets.has(i.Name)) {
          const existing = store.secrets.get(i.Name)!;
          if (existing.pendingDelete) {
            throw new FakeAwsError(
              "InvalidRequestException",
              "scheduled for deletion",
            );
          }
          throw new FakeAwsError("ResourceExistsException", "already exists");
        }
        const version: FakeVersion = {
          VersionId: store.nextVersionId(),
          CreatedDate: new Date(),
          SecretString: i.SecretString,
          VersionStages: ["AWSCURRENT"],
        };
        store.secrets.set(i.Name, {
          Name: i.Name,
          Tags: i.Tags ?? [],
          Versions: [version],
        });
        return {};
      }
      case "PutSecretValue": {
        const s = store.assertExists(i.SecretId);
        // Demote any previous AWSCURRENT to AWSPREVIOUS
        for (const v of s.Versions) {
          v.VersionStages = v.VersionStages.filter((st) => st !== "AWSCURRENT");
        }
        s.Versions.push({
          VersionId: store.nextVersionId(),
          CreatedDate: new Date(),
          SecretString: i.SecretString,
          VersionStages: ["AWSCURRENT"],
        });
        return {};
      }
      case "GetSecretValue": {
        const s = store.assertExists(i.SecretId);
        if (i.VersionId) {
          const v = s.Versions.find((x) => x.VersionId === i.VersionId);
          if (!v)
            throw new FakeAwsError("ResourceNotFoundException", "no version");
          return {
            Name: s.Name,
            SecretString: v.SecretString,
            VersionId: v.VersionId,
          };
        }
        const current = s.Versions.find((v) =>
          v.VersionStages.includes("AWSCURRENT"),
        );
        if (!current)
          throw new FakeAwsError(
            "ResourceNotFoundException",
            "no current version",
          );
        return {
          Name: s.Name,
          SecretString: current.SecretString,
          VersionId: current.VersionId,
        };
      }
      case "BatchGetSecretValue": {
        const ids: string[] = i.SecretIdList;
        const results: Array<{
          Name: string;
          SecretString: string;
          VersionId: string;
        }> = [];
        for (const id of ids) {
          const s = store.secrets.get(id);
          if (!s || s.pendingDelete) continue;
          const current = s.Versions.find((v) =>
            v.VersionStages.includes("AWSCURRENT"),
          );
          if (current) {
            results.push({
              Name: s.Name,
              SecretString: current.SecretString,
              VersionId: current.VersionId,
            });
          }
        }
        return { SecretValues: results, Errors: [] };
      }
      case "DescribeSecret": {
        const s = store.assertExists(i.SecretId);
        return { Name: s.Name, Tags: s.Tags };
      }
      case "ListSecrets": {
        const all = [...store.secrets.values()].filter((s) => !s.pendingDelete);
        // Apply the Filters[] array (tag-key + name prefix) like AWS does.
        const filters: Array<{ Key: string; Values: string[] }> =
          i.Filters ?? [];
        const filtered = all.filter((s) => {
          for (const f of filters) {
            if (f.Key === "tag-key") {
              const keys = s.Tags.map((t) => t.Key);
              if (!f.Values.some((v) => keys.includes(v))) return false;
            }
            if (f.Key === "name") {
              if (!f.Values.some((v) => s.Name.startsWith(v))) return false;
            }
          }
          return true;
        });
        return {
          SecretList: filtered.map((s) => ({
            Name: s.Name,
            Tags: s.Tags,
            CreatedDate: s.Versions[0]?.CreatedDate,
            LastChangedDate: s.Versions.at(-1)?.CreatedDate,
          })),
        };
      }
      case "ListSecretVersionIds": {
        const s = store.assertExists(i.SecretId);
        return {
          Versions: s.Versions.map((v) => ({
            VersionId: v.VersionId,
            CreatedDate: v.CreatedDate,
            VersionStages: [...v.VersionStages],
          })),
        };
      }
      case "TagResource": {
        const s = store.assertExists(i.SecretId);
        for (const t of i.Tags as Array<{ Key: string; Value: string }>) {
          const existing = s.Tags.find((x) => x.Key === t.Key);
          if (existing) existing.Value = t.Value;
          else s.Tags.push({ ...t });
        }
        return {};
      }
      case "UntagResource": {
        const s = store.assertExists(i.SecretId);
        s.Tags = s.Tags.filter((t) => !(i.TagKeys as string[]).includes(t.Key));
        return {};
      }
      case "DeleteSecret": {
        const s = store.secrets.get(i.SecretId);
        if (!s)
          throw new FakeAwsError("ResourceNotFoundException", "not found");
        if (i.ForceDeleteWithoutRecovery) {
          store.secrets.delete(i.SecretId);
        } else {
          s.pendingDelete = true;
        }
        return {};
      }
      case "RestoreSecret": {
        const s = store.secrets.get(i.SecretId);
        if (!s)
          throw new FakeAwsError("ResourceNotFoundException", "not found");
        s.pendingDelete = false;
        return {};
      }
      default:
        throw new FakeAwsError("UnknownCommandException", `stub: ${name}`);
    }
  }
}

// Install the module stub *before* AwsBackend is imported.
mock.module("@aws-sdk/client-secrets-manager", () => ({
  SecretsManagerClient: FakeClient,
  CreateSecretCommand: makeCommand("CreateSecret"),
  PutSecretValueCommand: makeCommand("PutSecretValue"),
  GetSecretValueCommand: makeCommand("GetSecretValue"),
  BatchGetSecretValueCommand: makeCommand("BatchGetSecretValue"),
  DescribeSecretCommand: makeCommand("DescribeSecret"),
  ListSecretsCommand: makeCommand("ListSecrets"),
  ListSecretVersionIdsCommand: makeCommand("ListSecretVersionIds"),
  TagResourceCommand: makeCommand("TagResource"),
  UntagResourceCommand: makeCommand("UntagResource"),
  DeleteSecretCommand: makeCommand("DeleteSecret"),
  RestoreSecretCommand: makeCommand("RestoreSecret"),
}));

// ─── Actual tests ───────────────────────────────────────────────────────────

import { exec } from "../commands/exec.js";
import { run } from "../commands/run.js";
import { AwsBackend } from "./aws-backend.js";

describe("AwsBackend", () => {
  beforeEach(() => {
    store.secrets.clear();
  });

  describe("basic CRUD", () => {
    it("creates, reads, and deletes a secret", async () => {
      const b = new AwsBackend({ region: "us-east-1", prefix: "psst/" });
      await b.setSecret("API_KEY", "hello");
      expect(await b.getSecret("API_KEY")).toBe("hello");
      expect(await b.removeSecret("API_KEY")).toBe(true);
      expect(await b.getSecret("API_KEY")).toBeNull();
    });

    it("uses the configured prefix in AWS names", async () => {
      const b = new AwsBackend({ region: "us-east-1", prefix: "myprefix/" });
      await b.setSecret("API_KEY", "v");
      expect(store.secrets.has("myprefix/API_KEY")).toBe(true);
      expect(store.secrets.has("psst/API_KEY")).toBe(false);
    });

    it("defaults to psst/ when prefix omitted", async () => {
      const b = new AwsBackend({ region: "us-east-1" });
      await b.setSecret("X", "v");
      expect(store.secrets.has("psst/X")).toBe(true);
    });

    it("returns null for missing secret", async () => {
      const b = new AwsBackend({ region: "us-east-1" });
      expect(await b.getSecret("MISSING")).toBeNull();
    });

    it("removeSecret returns false on missing secret", async () => {
      const b = new AwsBackend({ region: "us-east-1" });
      expect(await b.removeSecret("MISSING")).toBe(false);
    });

    it("exists returns true for present secret, false for missing", async () => {
      const b = new AwsBackend({ region: "us-east-1" });
      await b.setSecret("A", "v");
      expect(await b.exists("A")).toBe(true);
      expect(await b.exists("NOPE")).toBe(false);
    });

    it("updates overwrite and preserve the secret name", async () => {
      const b = new AwsBackend({ region: "us-east-1" });
      await b.setSecret("A", "v1");
      await b.setSecret("A", "v2");
      expect(await b.getSecret("A")).toBe("v2");
    });
  });

  describe("tags", () => {
    it("stores and retrieves tags", async () => {
      const b = new AwsBackend({ region: "us-east-1" });
      await b.setSecret("A", "v", ["prod", "api"]);
      expect((await b.getTags("A")).sort()).toEqual(["api", "prod"]);
    });

    it("listSecrets returns tags from resource tags", async () => {
      const b = new AwsBackend({ region: "us-east-1" });
      await b.setSecret("A", "v", ["prod"]);
      const list = await b.listSecrets();
      expect(list.map((s) => s.name)).toEqual(["A"]);
      expect(list[0].tags).toEqual(["prod"]);
    });

    it("listSecrets with tag filter matches OR logic", async () => {
      const b = new AwsBackend({ region: "us-east-1" });
      await b.setSecret("A", "va", ["aws"]);
      await b.setSecret("B", "vb", ["stripe"]);
      await b.setSecret("C", "vc", ["other"]);
      const list = await b.listSecrets(["aws", "stripe"]);
      expect(list.map((s) => s.name).sort()).toEqual(["A", "B"]);
    });

    it("setTags replaces all tags and does NOT create a new history version", async () => {
      const b = new AwsBackend({ region: "us-east-1" });
      await b.setSecret("A", "v1", ["old"]);
      const versionsBefore = store.secrets.get("psst/A")!.Versions.length;
      await b.setTags("A", ["new1", "new2"]);
      const versionsAfter = store.secrets.get("psst/A")!.Versions.length;
      expect(versionsAfter).toBe(versionsBefore);
      expect((await b.getTags("A")).sort()).toEqual(["new1", "new2"]);
    });

    it("addTags merges", async () => {
      const b = new AwsBackend({ region: "us-east-1" });
      await b.setSecret("A", "v", ["keep"]);
      await b.addTags("A", ["extra"]);
      expect((await b.getTags("A")).sort()).toEqual(["extra", "keep"]);
    });

    it("removeTags filters", async () => {
      const b = new AwsBackend({ region: "us-east-1" });
      await b.setSecret("A", "v", ["keep", "gone"]);
      await b.removeTags("A", ["gone"]);
      expect(await b.getTags("A")).toEqual(["keep"]);
    });

    it("setTags returns false for missing secret (no Tag/Untag calls)", async () => {
      const b = new AwsBackend({ region: "us-east-1" });
      expect(await b.setTags("NOPE", ["x"])).toBe(false);
    });

    it("addTags returns false for missing secret", async () => {
      const b = new AwsBackend({ region: "us-east-1" });
      expect(await b.addTags("NOPE", ["x"])).toBe(false);
    });

    it("removeTags returns false for missing secret", async () => {
      const b = new AwsBackend({ region: "us-east-1" });
      expect(await b.removeTags("NOPE", ["x"])).toBe(false);
    });

    it("setTags with identical tag set makes no Tag/Untag calls", async () => {
      const b = new AwsBackend({ region: "us-east-1" });
      await b.setSecret("A", "v", ["prod", "api"]);
      const s = store.secrets.get("psst/A")!;
      const beforeTagCount = s.Tags.length;
      // Apply the same tag set. Shouldn't shuffle resource tags at all.
      await b.setTags("A", ["api", "prod"]);
      expect(s.Tags.length).toBe(beforeTagCount);
      expect((await b.getTags("A")).sort()).toEqual(["api", "prod"]);
    });

    it("ignores non-psst resource tags when listing", async () => {
      const b = new AwsBackend({ region: "us-east-1" });
      await b.setSecret("A", "v", ["aws"]);
      // Add an external tag directly to the fake store
      store.secrets
        .get("psst/A")!
        .Tags.push({ Key: "Environment", Value: "prod" });
      const list = await b.listSecrets();
      expect(list[0].tags).toEqual(["aws"]);
    });

    it("listSecrets excludes secrets without psst:managed tag", async () => {
      const b = new AwsBackend({ region: "us-east-1" });
      await b.setSecret("A", "v");
      // Foreign secret without psst:managed tag
      store.secrets.set("psst/FOREIGN", {
        Name: "psst/FOREIGN",
        Tags: [],
        Versions: [
          {
            VersionId: "vid-foreign",
            CreatedDate: new Date(),
            SecretString: "x",
            VersionStages: ["AWSCURRENT"],
          },
        ],
      });
      const list = await b.listSecrets();
      expect(list.map((s) => s.name)).toEqual(["A"]);
    });

    it("exists returns false for unmanaged secret at same prefix", async () => {
      const b = new AwsBackend({ region: "us-east-1" });
      store.secrets.set("psst/FOREIGN", {
        Name: "psst/FOREIGN",
        Tags: [],
        Versions: [
          {
            VersionId: "vid-f",
            CreatedDate: new Date(),
            SecretString: "x",
            VersionStages: ["AWSCURRENT"],
          },
        ],
      });
      expect(await b.exists("FOREIGN")).toBe(false);
    });

    it("setSecret refuses to overwrite unmanaged secret", async () => {
      const b = new AwsBackend({ region: "us-east-1" });
      store.secrets.set("psst/EXTERNAL", {
        Name: "psst/EXTERNAL",
        Tags: [{ Key: "team", Value: "infra" }],
        Versions: [
          {
            VersionId: "vid-e",
            CreatedDate: new Date(),
            SecretString: "do-not-touch",
            VersionStages: ["AWSCURRENT"],
          },
        ],
      });
      await expect(b.setSecret("EXTERNAL", "overwrite")).rejects.toThrow(
        /not managed by psst/,
      );
      // Original value preserved
      const raw = store.secrets.get("psst/EXTERNAL")!;
      const current = raw.Versions.find((v) =>
        v.VersionStages.includes("AWSCURRENT"),
      );
      expect(current!.SecretString).toBe("do-not-touch");
    });

    it("removeSecret refuses to delete unmanaged secret", async () => {
      const b = new AwsBackend({ region: "us-east-1" });
      store.secrets.set("psst/EXTERNAL", {
        Name: "psst/EXTERNAL",
        Tags: [],
        Versions: [
          {
            VersionId: "vid-e2",
            CreatedDate: new Date(),
            SecretString: "protected",
            VersionStages: ["AWSCURRENT"],
          },
        ],
      });
      expect(await b.removeSecret("EXTERNAL")).toBe(false);
      // Still exists in the store
      expect(store.secrets.has("psst/EXTERNAL")).toBe(true);
    });

    it("getSecret returns null for unmanaged secret", async () => {
      const b = new AwsBackend({ region: "us-east-1" });
      store.secrets.set("psst/FOREIGN", {
        Name: "psst/FOREIGN",
        Tags: [],
        Versions: [
          {
            VersionId: "vid-f2",
            CreatedDate: new Date(),
            SecretString: '{"value":"secret-data","tags":[]}',
            VersionStages: ["AWSCURRENT"],
          },
        ],
      });
      expect(await b.getSecret("FOREIGN")).toBeNull();
    });

    it("getSecrets excludes unmanaged secrets", async () => {
      const b = new AwsBackend({ region: "us-east-1" });
      await b.setSecret("MANAGED", "ok");
      store.secrets.set("psst/FOREIGN", {
        Name: "psst/FOREIGN",
        Tags: [],
        Versions: [
          {
            VersionId: "vid-f3",
            CreatedDate: new Date(),
            SecretString: '{"value":"nope","tags":[]}',
            VersionStages: ["AWSCURRENT"],
          },
        ],
      });
      const map = await b.getSecrets(["MANAGED", "FOREIGN"]);
      expect(map.has("MANAGED")).toBe(true);
      expect(map.has("FOREIGN")).toBe(false);
    });
  });

  describe("history and rollback", () => {
    it("tracks versions through updates", async () => {
      const b = new AwsBackend({ region: "us-east-1" });
      await b.setSecret("A", "v1");
      await b.setSecret("A", "v2");
      await b.setSecret("A", "v3");
      const h = await b.getHistory("A");
      // 2 non-current versions (v1 and v2); v3 is AWSCURRENT
      expect(h.length).toBe(2);
      expect(h[0].version).toBe(2); // newest-first ordering
      expect(h[1].version).toBe(1);
    });

    it("preserves historical tags in getHistory", async () => {
      const b = new AwsBackend({ region: "us-east-1" });
      await b.setSecret("A", "v1", ["prod"]);
      await b.setSecret("A", "v2", ["staging"]);
      const h = await b.getHistory("A");
      expect(h[0].tags).toEqual(["prod"]); // v1 had ["prod"] in its envelope
    });

    it("rollback restores value and historical tags", async () => {
      const b = new AwsBackend({ region: "us-east-1" });
      await b.setSecret("A", "v1", ["oldtag"]);
      await b.setSecret("A", "v2", ["newtag"]);
      const ok = await b.rollback("A", 1);
      expect(ok).toBe(true);
      expect(await b.getSecret("A")).toBe("v1");
      expect((await b.getTags("A")).sort()).toEqual(["oldtag"]);
    });

    it("rollback returns false for non-existent version", async () => {
      const b = new AwsBackend({ region: "us-east-1" });
      await b.setSecret("A", "v1");
      expect(await b.rollback("A", 99)).toBe(false);
    });

    it("rollback returns false for non-existent secret", async () => {
      const b = new AwsBackend({ region: "us-east-1" });
      expect(await b.rollback("MISSING", 1)).toBe(false);
    });

    it("getHistoryVersion returns the archived value", async () => {
      const b = new AwsBackend({ region: "us-east-1" });
      await b.setSecret("A", "old");
      await b.setSecret("A", "new");
      expect(await b.getHistoryVersion("A", 1)).toBe("old");
    });
  });

  describe("batch reads", () => {
    it("getSecrets returns a map of requested names", async () => {
      const b = new AwsBackend({ region: "us-east-1" });
      await b.setSecret("A", "va");
      await b.setSecret("B", "vb");
      await b.setSecret("C", "vc");
      const map = await b.getSecrets(["A", "C", "MISSING"]);
      expect(map.get("A")).toBe("va");
      expect(map.get("C")).toBe("vc");
      expect(map.has("MISSING")).toBe(false);
    });

    it("getSecrets chunks at 20 names per request", async () => {
      const b = new AwsBackend({ region: "us-east-1" });
      const names: string[] = [];
      for (let i = 0; i < 45; i++) {
        const n = `K_${i}`;
        names.push(n);
        await b.setSecret(n, `v${i}`);
      }
      const map = await b.getSecrets(names);
      expect(map.size).toBe(45);
      expect(map.get("K_0")).toBe("v0");
      expect(map.get("K_44")).toBe("v44");
    });

    it("getSecrets of empty list returns empty map without calling AWS", async () => {
      const b = new AwsBackend({ region: "us-east-1" });
      const m = await b.getSecrets([]);
      expect(m.size).toBe(0);
    });
  });

  describe("clearHistory", () => {
    it("is a no-op for AWS backend", async () => {
      const b = new AwsBackend({ region: "us-east-1" });
      await b.setSecret("A", "v1");
      await b.setSecret("A", "v2");
      await b.clearHistory("A");
      // Versions still present
      expect(store.secrets.get("psst/A")!.Versions.length).toBe(2);
    });
  });

  describe("removeSecret + immediate set", () => {
    it("re-creates after ForceDeleteWithoutRecovery", async () => {
      const b = new AwsBackend({ region: "us-east-1" });
      await b.setSecret("A", "v1");
      await b.removeSecret("A");
      await b.setSecret("A", "v2");
      expect(await b.getSecret("A")).toBe("v2");
    });
  });

  describe("envelope decode", () => {
    it("gracefully handles non-JSON SecretString", async () => {
      const b = new AwsBackend({ region: "us-east-1" });
      // Pre-insert a raw secret (as if created outside psst)
      store.secrets.set("psst/LEGACY", {
        Name: "psst/LEGACY",
        Tags: [{ Key: "psst:managed", Value: "true" }],
        Versions: [
          {
            VersionId: "vid-legacy",
            CreatedDate: new Date(),
            SecretString: "just-a-raw-string",
            VersionStages: ["AWSCURRENT"],
          },
        ],
      });
      expect(await b.getSecret("LEGACY")).toBe("just-a-raw-string");
    });
  });

  describe("command injection and masking", () => {
    async function withAwsVault(fn: () => Promise<void>): Promise<{
      stdout: string;
      stderr: string;
      exitCode: number | undefined;
    }> {
      const testDir = join(
        tmpdir(),
        `psst-aws-command-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
      mkdirSync(join(testDir, ".psst", "envs", "default"), { recursive: true });
      writeFileSync(
        join(testDir, ".psst", "envs", "default", "config.json"),
        JSON.stringify({ backend: "aws", aws: { region: "us-east-1" } }),
      );

      const originalCwd = process.cwd();
      const originalStdoutWrite = process.stdout.write;
      const originalStderrWrite = process.stderr.write;
      const originalExit = process.exit;
      let stdout = "";
      let stderr = "";
      let exitCode: number | undefined;

      process.chdir(testDir);
      process.stdout.write = ((chunk: unknown) => {
        stdout += String(chunk);
        return true;
      }) as typeof process.stdout.write;
      process.stderr.write = ((chunk: unknown) => {
        stderr += String(chunk);
        return true;
      }) as typeof process.stderr.write;
      process.exit = ((code?: string | number | null) => {
        exitCode = typeof code === "number" ? code : 0;
        return undefined as never;
      }) as typeof process.exit;

      try {
        await fn();
        for (let i = 0; i < 100 && exitCode === undefined; i++) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return { stdout, stderr, exitCode };
      } finally {
        process.exit = originalExit;
        process.stdout.write = originalStdoutWrite;
        process.stderr.write = originalStderrWrite;
        process.chdir(originalCwd);
        rmSync(testDir, { recursive: true, force: true });
      }
    }

    it("exec injects AWS secrets and masks stdout/stderr", async () => {
      const b = new AwsBackend({ region: "us-east-1" });
      await b.setSecret("API_KEY", "aws-secret-123");

      const result = await withAwsVault(() =>
        exec(
          ["API_KEY"],
          [
            "sh",
            "-c",
            "printf 'stdout=%s\\n' \"$API_KEY\"; printf 'stderr=%s\\n' \"$API_KEY\" >&2",
          ],
        ),
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("stdout=[REDACTED]");
      expect(result.stderr).toContain("stderr=[REDACTED]");
      expect(result.stdout).not.toContain("aws-secret-123");
      expect(result.stderr).not.toContain("aws-secret-123");
    });

    it("run injects all AWS secrets and masks stdout/stderr", async () => {
      const b = new AwsBackend({ region: "us-east-1" });
      await b.setSecret("API_KEY", "aws-secret-123");

      const result = await withAwsVault(() =>
        run([
          "sh",
          "-c",
          "printf 'stdout=%s\\n' \"$API_KEY\"; printf 'stderr=%s\\n' \"$API_KEY\" >&2",
        ]),
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("stdout=[REDACTED]");
      expect(result.stderr).toContain("stderr=[REDACTED]");
      expect(result.stdout).not.toContain("aws-secret-123");
      expect(result.stderr).not.toContain("aws-secret-123");
    });

    it("tag-filtered exec injects AWS secrets and masks output", async () => {
      const b = new AwsBackend({ region: "us-east-1" });
      await b.setSecret("API_KEY", "aws-secret-123", ["prod"]);
      await b.setSecret("OTHER_KEY", "other-secret-456", ["dev"]);

      const result = await withAwsVault(() =>
        exec(
          [],
          [
            "sh",
            "-c",
            'printf \'api=%s other=%s\\n\' "$API_KEY" "${OTHER_KEY:-missing}"',
          ],
          { tags: ["prod"] },
        ),
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("api=[REDACTED] other=missing");
      expect(result.stdout).not.toContain("aws-secret-123");
      expect(result.stdout).not.toContain("other-secret-456");
    });

    it("tag-filtered run injects AWS secrets and masks output", async () => {
      const b = new AwsBackend({ region: "us-east-1" });
      await b.setSecret("API_KEY", "aws-secret-123", ["prod"]);
      await b.setSecret("OTHER_KEY", "other-secret-456", ["dev"]);

      const result = await withAwsVault(() =>
        run(
          [
            "sh",
            "-c",
            'printf \'api=%s other=%s\\n\' "$API_KEY" "${OTHER_KEY:-missing}"',
          ],
          { tags: ["prod"] },
        ),
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("api=[REDACTED] other=missing");
      expect(result.stdout).not.toContain("aws-secret-123");
      expect(result.stdout).not.toContain("other-secret-456");
    });
  });
});
