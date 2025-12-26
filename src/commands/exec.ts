import { Vault } from "../vault/vault";
import { spawn } from "child_process";

interface ExecOptions {
  noMask?: boolean;
}

export async function exec(
  secretNames: string[],
  cmdArgs: string[],
  options: ExecOptions = {}
): Promise<void> {
  const vaultPath = Vault.findVaultPath();

  if (!vaultPath) {
    console.error("No vault found. Run 'psst init' first.");
    process.exit(1);
  }

  const vault = new Vault(vaultPath);
  const success = await vault.unlock();

  if (!success) {
    console.error("Failed to unlock vault.");
    console.error("Ensure keychain is available or set PSST_PASSWORD env var.");
    process.exit(1);
  }

  // Get all requested secrets
  const secrets = await vault.getSecrets(secretNames);
  vault.close();

  // Check for missing secrets, fallback to env vars
  const missing: string[] = [];
  for (const name of secretNames) {
    if (!secrets.has(name)) {
      // Fallback to environment variable
      if (process.env[name]) {
        secrets.set(name, process.env[name]!);
      } else {
        missing.push(name);
      }
    }
  }

  if (missing.length > 0) {
    console.error(`Missing secrets: ${missing.join(", ")}`);
    process.exit(1);
  }

  // Build environment with secrets
  const env = {
    ...process.env,
    ...Object.fromEntries(secrets),
  };

  // Remove PSST_PASSWORD from child env for safety
  delete env.PSST_PASSWORD;

  // Execute command with secrets in environment
  const [cmd, ...args] = cmdArgs;
  const shouldMask = !options.noMask;

  // Get secret values for masking
  const secretValues = shouldMask
    ? Array.from(secrets.values()).filter((v) => v.length > 0)
    : [];

  const child = spawn(cmd, args, {
    env,
    stdio: shouldMask ? ["inherit", "pipe", "pipe"] : "inherit",
    shell: true,
  });

  if (shouldMask && child.stdout && child.stderr) {
    child.stdout.on("data", (data: Buffer) => {
      process.stdout.write(maskSecrets(data.toString(), secretValues));
    });

    child.stderr.on("data", (data: Buffer) => {
      process.stderr.write(maskSecrets(data.toString(), secretValues));
    });
  }

  child.on("error", (err) => {
    console.error(`Failed to execute: ${err.message}`);
    process.exit(1);
  });

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}

function maskSecrets(text: string, secrets: string[]): string {
  let masked = text;
  for (const secret of secrets) {
    // Use split/join for global replace (avoids regex escaping issues)
    masked = masked.split(secret).join("[REDACTED]");
  }
  return masked;
}
