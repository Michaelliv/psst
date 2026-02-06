import { spawn } from "node:child_process";
import chalk from "chalk";
import {
  EXIT_AUTH_FAILED,
  EXIT_NO_VAULT,
  EXIT_USER_ERROR,
} from "../utils/exit-codes";
import { Vault } from "../vault/vault";
import { maskSecrets } from "./exec";

interface RunOptions {
  noMask?: boolean;
  env?: string;
  global?: boolean;
  tags?: string[];
}

/**
 * Run a command with ALL secrets injected as environment variables
 */
export async function run(
  cmdArgs: string[],
  options: RunOptions = {},
): Promise<void> {
  const vaultPath = Vault.findVaultPath({
    global: options.global,
    env: options.env,
  });

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
    console.log(
      chalk.dim("  Ensure keychain is available or set PSST_PASSWORD"),
    );
    process.exit(EXIT_AUTH_FAILED);
  }

  // Get secrets (optionally filtered by tags)
  const secretMetas = vault.listSecrets(options.tags);
  const secrets = new Map<string, string>();

  for (const meta of secretMetas) {
    const value = await vault.getSecret(meta.name);
    if (value !== null) {
      secrets.set(meta.name, value);
    }
  }

  vault.close();

  if (secrets.size === 0) {
    const tagMsg = options.tags?.length
      ? ` with tags: ${options.tags.join(", ")}`
      : "";
    console.error(chalk.yellow("⚠"), `No secrets in vault${tagMsg}`);
    console.log(chalk.dim("  Add secrets with: psst set <NAME>"));
  }

  // Build environment with all secrets
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
