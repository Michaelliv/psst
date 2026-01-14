const SERVICE_NAME = "psst";
const ACCOUNT_NAME = "vault-key";

export interface KeychainResult {
  success: boolean;
  key?: string;
  error?: string;
}

/**
 * Run a command and return stdout
 */
async function run(cmd: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawnSync(cmd);

  return {
    exitCode: proc.exitCode,
    stdout: proc.stdout.toString().trim(),
    stderr: proc.stderr.toString().trim(),
  };
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
        "-s", SERVICE_NAME,
        "-a", ACCOUNT_NAME,
        "-w", key,
        "-U",
      ]);

      if (result.exitCode === 0) {
        return { success: true };
      }
      return { success: false, error: result.stderr || "Failed to store key" };
    }

    if (process.platform === "linux") {
      // Linux: Use secret-tool (libsecret)
      const proc = Bun.spawn(
        ["secret-tool", "store", "--label=psst vault key", "service", SERVICE_NAME, "account", ACCOUNT_NAME],
        { stdin: "pipe" }
      );
      proc.stdin.write(key);
      proc.stdin.end();

      const exitCode = await proc.exited;
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

    return { success: false, error: `Unsupported platform: ${process.platform}` };
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
        "-s", SERVICE_NAME,
        "-a", ACCOUNT_NAME,
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
        "service", SERVICE_NAME,
        "account", ACCOUNT_NAME,
      ]);

      if (result.exitCode === 0 && result.stdout) {
        return { success: true, key: result.stdout };
      }
      return { success: false, error: "Key not found" };
    }

    if (process.platform === "win32") {
      // Windows: Use PowerShell with .NET P/Invoke to read from Credential Manager
      // Note: 64-bit offsets - CredentialBlobSize at 32, CredentialBlob at 40
      const psScript = `
$sig = @'
[DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
public static extern bool CredRead(string target, int type, int flags, out IntPtr credential);
[DllImport("advapi32.dll")]
public static extern void CredFree(IntPtr credential);
'@
Add-Type -MemberDefinition $sig -Namespace Win32 -Name Cred
$ptr = [IntPtr]::Zero
if ([Win32.Cred]::CredRead('${SERVICE_NAME}', 1, 0, [ref]$ptr)) {
  $size = [Runtime.InteropServices.Marshal]::ReadInt32($ptr, 32)
  $blob = [Runtime.InteropServices.Marshal]::ReadIntPtr($ptr, 40)
  if ($size -gt 0 -and $blob -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::PtrToStringUni($blob, $size/2)
  }
  [Win32.Cred]::CredFree($ptr)
} else { exit 1 }
`;
      const result = await run([
        "powershell",
        "-Command",
        psScript,
      ]);

      if (result.exitCode === 0 && result.stdout) {
        return { success: true, key: result.stdout };
      }
      return { success: false, error: "Key not found in Credential Manager" };
    }

    return { success: false, error: `Unsupported platform: ${process.platform}` };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Delete key from OS keychain
 */
export async function deleteKey(): Promise<KeychainResult> {
  try {
    if (process.platform === "darwin") {
      const result = await run([
        "security",
        "delete-generic-password",
        "-s", SERVICE_NAME,
        "-a", ACCOUNT_NAME,
      ]);
      return { success: result.exitCode === 0 };
    }

    if (process.platform === "linux") {
      const result = await run([
        "secret-tool",
        "clear",
        "service", SERVICE_NAME,
        "account", ACCOUNT_NAME,
      ]);
      return { success: result.exitCode === 0 };
    }

    if (process.platform === "win32") {
      const result = await run(["cmdkey", `/delete:${SERVICE_NAME}`]);
      return { success: result.exitCode === 0 };
    }

    return { success: false, error: `Unsupported platform: ${process.platform}` };
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
