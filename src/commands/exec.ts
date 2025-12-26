import { Vault } from "../vault/vault";
import { spawn } from "child_process";

export async function exec(secretNames: string[], cmdArgs: string[]): Promise<void> {
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

  const child = spawn(cmd, args, {
    env,
    stdio: "inherit",
    shell: true,
  });

  child.on("error", (err) => {
    console.error(`Failed to execute: ${err.message}`);
    process.exit(1);
  });

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}
