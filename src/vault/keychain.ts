const SERVICE_NAME = "psst";
const ACCOUNT_NAME = "vault-key";

export interface KeychainResult {
  success: boolean;
  key?: string;
  error?: string;
}

const isBun = typeof globalThis.Bun !== "undefined";

/**
 * Run a command and return stdout.
 * Uses Bun.spawnSync when available, falls back to Node child_process.
 */
async function run(
  cmd: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  if (isBun) {
    const proc = Bun.spawnSync(cmd);
    return {
      exitCode: proc.exitCode,
      stdout: proc.stdout.toString().trim(),
      stderr: proc.stderr.toString().trim(),
    };
  }

  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf-8" });
  return {
    exitCode: result.status ?? 1,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  };
}

/**
 * Spawn a command with stdin input and return its exit code.
 */
async function spawnWithStdin(cmd: string[], input: string): Promise<number> {
  if (isBun) {
    const proc = Bun.spawn(cmd, { stdin: "pipe" });
    proc.stdin.write(input);
    proc.stdin.end();
    return await proc.exited;
  }

  const { spawn } = await import("node:child_process");
  return new Promise((resolve) => {
    const proc = spawn(cmd[0], cmd.slice(1), { stdio: ["pipe", "ignore", "ignore"] });
    proc.stdin!.write(input);
    proc.stdin!.end();
    proc.on("close", (code) => resolve(code ?? 1));
  });
}

/**
 * Store encryption key in OS keychain
 */
export async function storeKey(key: string): Promise<KeychainResult> {
  try {
    if (process.platform === "darwin") {
      // macOS: Use security command
      // -U flag updates if exists
      const result = await run([
        "security",
        "add-generic-password",
        "-s",
        SERVICE_NAME,
        "-a",
        ACCOUNT_NAME,
        "-w",
        key,
        "-U",
      ]);

      if (result.exitCode === 0) {
        return { success: true };
      }
      return { success: false, error: result.stderr || "Failed to store key" };
    }

    if (process.platform === "linux") {
      // Linux: Use secret-tool (libsecret) — needs stdin pipe for the key
      const exitCode = await spawnWithStdin(
        [
          "secret-tool",
          "store",
          "--label=psst vault key",
          "service",
          SERVICE_NAME,
          "account",
          ACCOUNT_NAME,
        ],
        key,
      );
      if (exitCode === 0) {
        return { success: true };
      }
      return { success: false, error: "secret-tool failed" };
    }

    if (process.platform === "win32") {
      // Windows: Use cmdkey
      const result = await run([
        "cmdkey",
        `/generic:${SERVICE_NAME}`,
        `/user:${ACCOUNT_NAME}`,
        `/pass:${key}`,
      ]);

      if (result.exitCode === 0) {
        return { success: true };
      }
      return { success: false, error: result.stderr || "Failed to store key" };
    }

    return {
      success: false,
      error: `Unsupported platform: ${process.platform}`,
    };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Retrieve encryption key from OS keychain
 */
export async function getKey(): Promise<KeychainResult> {
  try {
    if (process.platform === "darwin") {
      // macOS: Use security command
      const result = await run([
        "security",
        "find-generic-password",
        "-s",
        SERVICE_NAME,
        "-a",
        ACCOUNT_NAME,
        "-w",
      ]);

      if (result.exitCode === 0 && result.stdout) {
        return { success: true, key: result.stdout };
      }
      return { success: false, error: "Key not found in keychain" };
    }

    if (process.platform === "linux") {
      // Linux: Use secret-tool
      const result = await run([
        "secret-tool",
        "lookup",
        "service",
        SERVICE_NAME,
        "account",
        ACCOUNT_NAME,
      ]);

      if (result.exitCode === 0 && result.stdout) {
        return { success: true, key: result.stdout };
      }
      return { success: false, error: "Key not found" };
    }

    if (process.platform === "win32") {
      // Windows: Use PowerShell to retrieve from credential manager
      const result = await run([
        "powershell",
        "-Command",
        `(Get-StoredCredential -Target '${SERVICE_NAME}').Password`,
      ]);

      if (result.exitCode === 0 && result.stdout) {
        return { success: true, key: result.stdout };
      }
      return { success: false, error: "Key not found" };
    }

    return {
      success: false,
      error: `Unsupported platform: ${process.platform}`,
    };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Check if keychain is available on this system
 */
export async function isKeychainAvailable(): Promise<boolean> {
  try {
    if (process.platform === "darwin") {
      const result = await run(["which", "security"]);
      return result.exitCode === 0;
    }

    if (process.platform === "linux") {
      const result = await run(["which", "secret-tool"]);
      return result.exitCode === 0;
    }

    if (process.platform === "win32") {
      // cmdkey is built into Windows
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Generate a random encryption key
 */
export function generateKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64");
}
