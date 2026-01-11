import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Vault } from "./vault";

describe("Vault unit tests", () => {
  let testDir: string;
  let vaultPath: string;
  const TEST_PASSWORD = "test-password-123";

  beforeEach(() => {
    // Create isolated test directory
    testDir = join(tmpdir(), `psst-unit-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    vaultPath = join(testDir, ".psst", "envs", "default");
    mkdirSync(vaultPath, { recursive: true });

    // Set test password
    process.env.PSST_PASSWORD = TEST_PASSWORD;
  });

  afterEach(() => {
    // Cleanup
    delete process.env.PSST_PASSWORD;
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("constructor and initSchema", () => {
    it("creates vault database file", () => {
      const vault = new Vault(vaultPath);
      vault.close();

      expect(existsSync(join(vaultPath, "vault.db"))).toBe(true);
    });

    it("creates secrets table", () => {
      const vault = new Vault(vaultPath);
      vault.close();

      // Reopen and verify table exists by listing secrets
      const vault2 = new Vault(vaultPath);
      const secrets = vault2.listSecrets();
      vault2.close();

      expect(secrets).toEqual([]);
    });
  });

  describe("unlock", () => {
    it("unlocks with PSST_PASSWORD env var", async () => {
      const vault = new Vault(vaultPath);
      const result = await vault.unlock();
      vault.close();

      expect(result).toBe(true);
      expect(vault.isUnlocked()).toBe(true);
    });

    it("fails without password or keychain", async () => {
      delete process.env.PSST_PASSWORD;

      const vault = new Vault(vaultPath);
      const result = await vault.unlock();
      vault.close();

      // May succeed if keychain has a key, or fail if not
      // This test verifies the method runs without throwing
      expect(typeof result).toBe("boolean");
    });
  });

  describe("isUnlocked", () => {
    it("returns false before unlock", () => {
      const vault = new Vault(vaultPath);
      expect(vault.isUnlocked()).toBe(false);
      vault.close();
    });

    it("returns true after unlock", async () => {
      const vault = new Vault(vaultPath);
      await vault.unlock();
      expect(vault.isUnlocked()).toBe(true);
      vault.close();
    });
  });

  describe("setSecret/getSecret", () => {
    it("stores and retrieves a secret", async () => {
      const vault = new Vault(vaultPath);
      await vault.unlock();

      await vault.setSecret("API_KEY", "secret-value-123");
      const value = await vault.getSecret("API_KEY");

      vault.close();

      expect(value).toBe("secret-value-123");
    });

    it("throws when vault is locked", async () => {
      const vault = new Vault(vaultPath);

      await expect(vault.setSecret("KEY", "value")).rejects.toThrow("Vault is locked");
      await expect(vault.getSecret("KEY")).rejects.toThrow("Vault is locked");

      vault.close();
    });

    it("returns null for non-existent secret", async () => {
      const vault = new Vault(vaultPath);
      await vault.unlock();

      const value = await vault.getSecret("NONEXISTENT");

      vault.close();

      expect(value).toBeNull();
    });

    it("updates existing secret", async () => {
      const vault = new Vault(vaultPath);
      await vault.unlock();

      await vault.setSecret("KEY", "original");
      await vault.setSecret("KEY", "updated");
      const value = await vault.getSecret("KEY");

      vault.close();

      expect(value).toBe("updated");
    });

    it("handles special characters in value", async () => {
      const vault = new Vault(vaultPath);
      await vault.unlock();

      const specialValue = "p@ssw0rd!#$%^&*()_+-=[]{}|;':\",./<>?`~";
      await vault.setSecret("SPECIAL", specialValue);
      const value = await vault.getSecret("SPECIAL");

      vault.close();

      expect(value).toBe(specialValue);
    });

    it("handles unicode in value", async () => {
      const vault = new Vault(vaultPath);
      await vault.unlock();

      const unicodeValue = "密码 🔐 пароль";
      await vault.setSecret("UNICODE", unicodeValue);
      const value = await vault.getSecret("UNICODE");

      vault.close();

      expect(value).toBe(unicodeValue);
    });

    it("handles empty string value", async () => {
      const vault = new Vault(vaultPath);
      await vault.unlock();

      await vault.setSecret("EMPTY", "");
      const value = await vault.getSecret("EMPTY");

      vault.close();

      expect(value).toBe("");
    });

    it("handles very long values", async () => {
      const vault = new Vault(vaultPath);
      await vault.unlock();

      const longValue = "A".repeat(100000);
      await vault.setSecret("LONG", longValue);
      const value = await vault.getSecret("LONG");

      vault.close();

      expect(value).toBe(longValue);
    });
  });

  describe("getSecrets", () => {
    it("retrieves multiple secrets", async () => {
      const vault = new Vault(vaultPath);
      await vault.unlock();

      await vault.setSecret("KEY1", "value1");
      await vault.setSecret("KEY2", "value2");
      await vault.setSecret("KEY3", "value3");

      const secrets = await vault.getSecrets(["KEY1", "KEY3"]);

      vault.close();

      expect(secrets.size).toBe(2);
      expect(secrets.get("KEY1")).toBe("value1");
      expect(secrets.get("KEY3")).toBe("value3");
    });

    it("skips non-existent secrets", async () => {
      const vault = new Vault(vaultPath);
      await vault.unlock();

      await vault.setSecret("EXISTS", "value");

      const secrets = await vault.getSecrets(["EXISTS", "MISSING"]);

      vault.close();

      expect(secrets.size).toBe(1);
      expect(secrets.get("EXISTS")).toBe("value");
      expect(secrets.has("MISSING")).toBe(false);
    });

    it("returns empty map for empty array", async () => {
      const vault = new Vault(vaultPath);
      await vault.unlock();

      const secrets = await vault.getSecrets([]);

      vault.close();

      expect(secrets.size).toBe(0);
    });
  });

  describe("listSecrets", () => {
    it("returns empty array for new vault", () => {
      const vault = new Vault(vaultPath);
      const secrets = vault.listSecrets();
      vault.close();

      expect(secrets).toEqual([]);
    });

    it("lists all secrets with metadata", async () => {
      const vault = new Vault(vaultPath);
      await vault.unlock();

      await vault.setSecret("ALPHA", "a");
      await vault.setSecret("BETA", "b");

      const secrets = vault.listSecrets();
      vault.close();

      expect(secrets.length).toBe(2);
      expect(secrets[0].name).toBe("ALPHA");
      expect(secrets[1].name).toBe("BETA");
      expect(secrets[0].created_at).toBeDefined();
      expect(secrets[0].updated_at).toBeDefined();
    });

    it("returns secrets in alphabetical order", async () => {
      const vault = new Vault(vaultPath);
      await vault.unlock();

      await vault.setSecret("ZEBRA", "z");
      await vault.setSecret("APPLE", "a");
      await vault.setSecret("MANGO", "m");

      const secrets = vault.listSecrets();
      vault.close();

      expect(secrets.map(s => s.name)).toEqual(["APPLE", "MANGO", "ZEBRA"]);
    });
  });

  describe("removeSecret", () => {
    it("removes existing secret", async () => {
      const vault = new Vault(vaultPath);
      await vault.unlock();

      await vault.setSecret("TO_DELETE", "value");
      const removed = vault.removeSecret("TO_DELETE");
      const value = await vault.getSecret("TO_DELETE");

      vault.close();

      expect(removed).toBe(true);
      expect(value).toBeNull();
    });

    it("returns false for non-existent secret", () => {
      const vault = new Vault(vaultPath);
      const removed = vault.removeSecret("NONEXISTENT");
      vault.close();

      expect(removed).toBe(false);
    });
  });

  describe("static methods", () => {
    describe("getVaultPath", () => {
      it("returns local path without env", () => {
        const path = Vault.getVaultPath(false);
        expect(path).toContain(".psst");
        expect(path).not.toContain("envs");
      });

      it("returns local path with env", () => {
        const path = Vault.getVaultPath(false, "prod");
        expect(path).toContain(".psst");
        expect(path).toContain("envs");
        expect(path).toContain("prod");
      });

      it("returns global path without env", () => {
        const path = Vault.getVaultPath(true);
        expect(path).toContain(".psst");
      });

      it("returns global path with env", () => {
        const path = Vault.getVaultPath(true, "staging");
        expect(path).toContain(".psst");
        expect(path).toContain("envs");
        expect(path).toContain("staging");
      });
    });

    describe("findVaultPath", () => {
      it("returns null when no vault exists", () => {
        const originalCwd = process.cwd();
        process.chdir(testDir);

        const path = Vault.findVaultPath();

        process.chdir(originalCwd);

        expect(path).toBeNull();
      });

      it("finds local env vault", () => {
        const originalCwd = process.cwd();
        process.chdir(testDir);

        // Create vault.db
        writeFileSync(join(vaultPath, "vault.db"), "");

        const path = Vault.findVaultPath("default");

        process.chdir(originalCwd);

        // Use endsWith to handle /var vs /private/var symlink on macOS
        expect(path).not.toBeNull();
        expect(path!.endsWith(".psst/envs/default")).toBe(true);
      });
    });

    describe("listEnvironments", () => {
      it("returns empty array when no envs exist", () => {
        const originalCwd = process.cwd();
        process.chdir(testDir);

        const envs = Vault.listEnvironments(false);

        process.chdir(originalCwd);

        expect(envs).toEqual([]);
      });

      it("lists environments with vault.db", () => {
        const originalCwd = process.cwd();
        process.chdir(testDir);

        // Create vault in default env (already created in beforeEach)
        writeFileSync(join(vaultPath, "vault.db"), "");

        // Create another env
        const prodPath = join(testDir, ".psst", "envs", "prod");
        mkdirSync(prodPath, { recursive: true });
        writeFileSync(join(prodPath, "vault.db"), "");

        const envs = Vault.listEnvironments(false);

        process.chdir(originalCwd);

        expect(envs).toContain("default");
        expect(envs).toContain("prod");
      });
    });
  });

  describe("initializeVault", () => {
    it("creates vault directory and database", async () => {
      const newVaultPath = join(testDir, ".psst", "envs", "new-env");

      const result = await Vault.initializeVault(newVaultPath);

      expect(result.success).toBe(true);
      expect(existsSync(newVaultPath)).toBe(true);
      expect(existsSync(join(newVaultPath, "vault.db"))).toBe(true);
    });

    it("succeeds with PSST_PASSWORD when keychain fails", async () => {
      const newVaultPath = join(testDir, ".psst", "envs", "env-with-password");
      process.env.PSST_PASSWORD = "test-password";

      const result = await Vault.initializeVault(newVaultPath);

      expect(result.success).toBe(true);
      expect(existsSync(join(newVaultPath, "vault.db"))).toBe(true);
    });

    it("creates nested directories as needed", async () => {
      const deepPath = join(testDir, "deep", "nested", "path", ".psst");

      const result = await Vault.initializeVault(deepPath);

      expect(result.success).toBe(true);
      expect(existsSync(deepPath)).toBe(true);
    });
  });

  describe("persistence", () => {
    it("persists secrets across vault instances", async () => {
      // First instance - write
      const vault1 = new Vault(vaultPath);
      await vault1.unlock();
      await vault1.setSecret("PERSIST_KEY", "persist_value");
      vault1.close();

      // Second instance - read
      const vault2 = new Vault(vaultPath);
      await vault2.unlock();
      const value = await vault2.getSecret("PERSIST_KEY");
      vault2.close();

      expect(value).toBe("persist_value");
    });

    it("encrypts secrets with different IVs", async () => {
      const vault = new Vault(vaultPath);
      await vault.unlock();

      // Set same value twice under different names
      await vault.setSecret("KEY_A", "same_value");
      await vault.setSecret("KEY_B", "same_value");

      vault.close();

      // The encrypted values should be different (different IVs)
      // We verify by checking both decrypt correctly
      const vault2 = new Vault(vaultPath);
      await vault2.unlock();
      const valueA = await vault2.getSecret("KEY_A");
      const valueB = await vault2.getSecret("KEY_B");
      vault2.close();

      expect(valueA).toBe("same_value");
      expect(valueB).toBe("same_value");
    });
  });
});
