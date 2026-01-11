import chalk from "chalk";
import { Vault } from "../vault/vault";
import { spawn } from "child_process";
import { EXIT_NO_VAULT, EXIT_AUTH_FAILED, EXIT_USER_ERROR } from "../utils/exit-codes";

interface ExecOptions {
  noMask?: boolean;
  env?: string;
  global?: boolean;
}

export async function exec(
  secretNames: string[],
  cmdArgs: string[],
  options: ExecOptions = {}
): Promise<void> {
  const vaultPath = Vault.findVaultPath({ global: options.global, env: options.env });

  if (!vaultPath) {
    const scope = options.global ? "global" : "local";
    const envMsg = options.env ? ` for environment "${options.env}"` : "";
    console.error(chalk.red("✗"), `No ${scope} vault found${envMsg}`);
    const globalFlag = options.global ? " --global" : "";
    const envFlag = options.env ? ` --env ${options.env}` : "";
    console.log(chalk.dim(`  Run: psst init${globalFlag}${envFlag}`));
    process.exit(EXIT_NO_VAULT);
  }

  const vault = new Vault(vaultPath);
  const success = await vault.unlock();

  if (!success) {
    console.error(chalk.red("✗"), "Failed to unlock vault");
    console.log(chalk.dim("  Ensure keychain is available or set PSST_PASSWORD"));
    process.exit(EXIT_AUTH_FAILED);
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
    console.error(chalk.red("✗"), `Missing secrets: ${chalk.bold(missing.join(", "))}`);
    console.log(chalk.dim("  Add with: psst set <NAME>"));
    process.exit(EXIT_USER_ERROR);
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
    console.error(chalk.red("✗"), `Failed to execute: ${err.message}`);
    process.exit(EXIT_USER_ERROR);
  });

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}

export function maskSecrets(text: string, secrets: string[]): string {
  let masked = text;
  for (const secret of secrets) {
    // Use split/join for global replace (avoids regex escaping issues)
    masked = masked.split(secret).join("[REDACTED]");
  }
  return masked;
}
