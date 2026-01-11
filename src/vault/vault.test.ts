import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("Environment support integration tests", () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    // Create isolated test directory
    testDir = join(tmpdir(), `psst-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });

    // Save and change cwd
    originalCwd = process.cwd();
    process.chdir(testDir);
  });

  afterEach(() => {
    // Restore cwd
    process.chdir(originalCwd);

    // Cleanup test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  const runPsst = async (args: string[], env: Record<string, string> = {}) => {
    const proc = Bun.spawn(["bun", "run", join(originalCwd, "src/main.ts"), ...args], {
      cwd: testDir,
      env: { ...process.env, PSST_PASSWORD: "testpass123", ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    return { stdout, stderr, exitCode };
  };

  describe("init with --env", () => {
    it("creates local vault with default env", async () => {
      const result = await runPsst(["init", "--local"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(".psst/envs/default");
      expect(existsSync(join(testDir, ".psst", "envs", "default", "vault.db"))).toBe(true);
    });

    it("creates local vault with custom env", async () => {
      const result = await runPsst(["init", "--local", "--env", "prod"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(".psst/envs/prod");
      expect(existsSync(join(testDir, ".psst", "envs", "prod", "vault.db"))).toBe(true);
    });

    it("creates multiple environments", async () => {
      await runPsst(["init", "--local", "--env", "dev"]);
      await runPsst(["init", "--local", "--env", "staging"]);
      await runPsst(["init", "--local", "--env", "prod"]);

      expect(existsSync(join(testDir, ".psst", "envs", "dev", "vault.db"))).toBe(true);
      expect(existsSync(join(testDir, ".psst", "envs", "staging", "vault.db"))).toBe(true);
      expect(existsSync(join(testDir, ".psst", "envs", "prod", "vault.db"))).toBe(true);
    });
  });

  describe("list envs", () => {
    it("shows no local environments when none exist", async () => {
      const result = await runPsst(["list", "envs", "--json"]);
      expect(result.exitCode).toBe(0);
      const json = JSON.parse(result.stdout);
      expect(json.local).toEqual([]);
    });

    it("lists created local environments", async () => {
      await runPsst(["init", "--local", "--env", "dev"]);
      await runPsst(["init", "--local", "--env", "prod"]);

      const result = await runPsst(["list", "envs", "--json"]);
      expect(result.exitCode).toBe(0);

      const json = JSON.parse(result.stdout);
      expect(json.local).toContain("dev");
      expect(json.local).toContain("prod");
    });

    it("returns JSON format with success flag", async () => {
      await runPsst(["init", "--local", "--env", "staging"]);

      const result = await runPsst(["list", "envs", "--json"]);
      expect(result.exitCode).toBe(0);

      const json = JSON.parse(result.stdout);
      expect(json.success).toBe(true);
      expect(json.local).toContain("staging");
    });
  });

  describe("secrets isolation between environments", () => {
    it("secrets are isolated per environment", async () => {
      // Create two environments
      await runPsst(["init", "--local", "--env", "dev"]);
      await runPsst(["init", "--local", "--env", "prod"]);

      // Set secret in dev
      const setDev = Bun.spawn(
        ["bun", "run", join(originalCwd, "src/main.ts"), "--env", "dev", "set", "API_KEY", "--stdin"],
        {
          cwd: testDir,
          env: { ...process.env, PSST_PASSWORD: "testpass123" },
          stdin: new TextEncoder().encode("dev-key-123"),
          stdout: "pipe",
          stderr: "pipe",
        }
      );
      await setDev.exited;

      // Set different secret in prod
      const setProd = Bun.spawn(
        ["bun", "run", join(originalCwd, "src/main.ts"), "--env", "prod", "set", "API_KEY", "--stdin"],
        {
          cwd: testDir,
          env: { ...process.env, PSST_PASSWORD: "testpass123" },
          stdin: new TextEncoder().encode("prod-key-456"),
          stdout: "pipe",
          stderr: "pipe",
        }
      );
      await setProd.exited;

      // List secrets in each env
      const listDev = await runPsst(["--env", "dev", "list", "--json"]);
      const listProd = await runPsst(["--env", "prod", "list", "--json"]);

      const devSecrets = JSON.parse(listDev.stdout);
      const prodSecrets = JSON.parse(listProd.stdout);

      expect(devSecrets.secrets).toHaveLength(1);
      expect(prodSecrets.secrets).toHaveLength(1);

      // Get secrets to verify they're different
      const getDev = await runPsst(["--env", "dev", "get", "API_KEY"]);
      const getProd = await runPsst(["--env", "prod", "get", "API_KEY"]);

      expect(getDev.stdout).toContain("dev-key-123");
      expect(getProd.stdout).toContain("prod-key-456");
    });
  });

  describe("PSST_ENV environment variable", () => {
    it("uses PSST_ENV when --env not specified", async () => {
      await runPsst(["init", "--local", "--env", "staging"]);

      // Set secret using PSST_ENV
      const setResult = Bun.spawn(
        ["bun", "run", join(originalCwd, "src/main.ts"), "set", "TOKEN", "--stdin"],
        {
          cwd: testDir,
          env: { ...process.env, PSST_PASSWORD: "testpass123", PSST_ENV: "staging" },
          stdin: new TextEncoder().encode("staging-token"),
          stdout: "pipe",
          stderr: "pipe",
        }
      );
      await setResult.exited;

      // List using PSST_ENV
      const listResult = await runPsst(["list", "--json"], { PSST_ENV: "staging" });
      const json = JSON.parse(listResult.stdout);
      expect(json.secrets).toHaveLength(1);
      expect(json.secrets[0].name).toBe("TOKEN");
    });

    it("--env flag overrides PSST_ENV", async () => {
      await runPsst(["init", "--local", "--env", "dev"]);
      await runPsst(["init", "--local", "--env", "prod"]);

      // Set secret in dev
      const setDev = Bun.spawn(
        ["bun", "run", join(originalCwd, "src/main.ts"), "--env", "dev", "set", "KEY", "--stdin"],
        {
          cwd: testDir,
          env: { ...process.env, PSST_PASSWORD: "testpass123" },
          stdin: new TextEncoder().encode("dev-value"),
          stdout: "pipe",
          stderr: "pipe",
        }
      );
      await setDev.exited;

      // Use --env dev but PSST_ENV=prod - should use dev
      const result = await runPsst(["--env", "dev", "list", "--json"], { PSST_ENV: "prod" });
      const json = JSON.parse(result.stdout);
      expect(json.secrets).toHaveLength(1);
    });
  });

  describe("exec with --env", () => {
    it("injects secrets from specified environment", async () => {
      await runPsst(["init", "--local", "--env", "prod"]);

      // Set secret
      const setProc = Bun.spawn(
        ["bun", "run", join(originalCwd, "src/main.ts"), "--env", "prod", "set", "MY_SECRET", "--stdin"],
        {
          cwd: testDir,
          env: { ...process.env, PSST_PASSWORD: "testpass123" },
          stdin: new TextEncoder().encode("secret-value-789"),
          stdout: "pipe",
          stderr: "pipe",
        }
      );
      await setProc.exited;

      // Exec with secret (with --no-mask to see actual value)
      const result = await runPsst(["--env", "prod", "--no-mask", "MY_SECRET", "--", "echo", "$MY_SECRET"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("secret-value-789");
    });
  });

  describe("lock/unlock preserves secrets", () => {
    // Note: In non-TTY/headless mode, PSST_PASSWORD serves as both:
    // 1. The vault encryption key (for secrets)
    // 2. The lock/unlock password (for vault file encryption)
    // This is by design for CI/headless environments.

    it("secrets survive lock/unlock cycle", async () => {
      // Create vault and set secret (all using same PSST_PASSWORD)
      await runPsst(["init", "--local"]);

      const setProc = Bun.spawn(
        ["bun", "run", join(originalCwd, "src/main.ts"), "set", "PRESERVED_SECRET", "--stdin"],
        {
          cwd: testDir,
          env: { ...process.env, PSST_PASSWORD: "testpass123" },
          stdin: new TextEncoder().encode("my-secret-value-abc"),
          stdout: "pipe",
          stderr: "pipe",
        }
      );
      await setProc.exited;

      // Verify secret before lock
      const getBefore = await runPsst(["get", "PRESERVED_SECRET"]);
      expect(getBefore.stdout).toContain("my-secret-value-abc");

      // Lock vault (same PSST_PASSWORD used for vault key AND lock password)
      const lockResult = await runPsst(["lock"]);
      expect(lockResult.exitCode).toBe(0);

      // Verify vault is locked (vault.db gone, vault.db.locked exists)
      expect(existsSync(join(testDir, ".psst", "envs", "default", "vault.db"))).toBe(false);
      expect(existsSync(join(testDir, ".psst", "envs", "default", "vault.db.locked"))).toBe(true);

      // Unlock vault (same PSST_PASSWORD)
      const unlockResult = await runPsst(["unlock"]);
      expect(unlockResult.exitCode).toBe(0);

      // Verify vault is unlocked
      expect(existsSync(join(testDir, ".psst", "envs", "default", "vault.db"))).toBe(true);
      expect(existsSync(join(testDir, ".psst", "envs", "default", "vault.db.locked"))).toBe(false);

      // Verify secret is still accessible after unlock
      const getAfter = await runPsst(["get", "PRESERVED_SECRET"]);
      expect(getAfter.exitCode).toBe(0);
      expect(getAfter.stdout).toContain("my-secret-value-abc");
    });

    it("fails with wrong unlock password", async () => {
      await runPsst(["init", "--local"]);

      const setProc = Bun.spawn(
        ["bun", "run", join(originalCwd, "src/main.ts"), "set", "TEST_KEY", "--stdin"],
        {
          cwd: testDir,
          env: { ...process.env, PSST_PASSWORD: "testpass123" },
          stdin: new TextEncoder().encode("test-value"),
          stdout: "pipe",
          stderr: "pipe",
        }
      );
      await setProc.exited;

      // Lock vault
      await runPsst(["lock"]);

      // Try to unlock with wrong password
      const unlockProc = Bun.spawn(["bun", "run", join(originalCwd, "src/main.ts"), "unlock"], {
        cwd: testDir,
        env: { ...process.env, PSST_PASSWORD: "wrongpassword" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const unlockExitCode = await unlockProc.exited;
      expect(unlockExitCode).not.toBe(0);

      // Vault should still be locked
      expect(existsSync(join(testDir, ".psst", "envs", "default", "vault.db.locked"))).toBe(true);
    });
  });
});
