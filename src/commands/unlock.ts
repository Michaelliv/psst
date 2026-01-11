import chalk from "chalk";
import ora from "ora";
import { existsSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { Vault } from "../vault/vault";
import { decryptFile } from "../vault/crypto";
import { storeKey } from "../vault/keychain";
import { readPassword } from "../utils/input";
import { EXIT_USER_ERROR, EXIT_AUTH_FAILED, EXIT_NO_VAULT, EXIT_ERROR } from "../utils/exit-codes";
import type { OutputOptions } from "../utils/output";

const DB_NAME = "vault.db";
const LOCKED_NAME = "vault.db.locked";

export async function unlock(options: OutputOptions = {}): Promise<void> {
  const scope = options.global ? "global" : "local";

  // Look for vault (unlocked or locked) in specified scope only - no fallback
  let checkPath = Vault.findVaultPath({ global: options.global, env: options.env });

  // If no unlocked vault found, look for locked vault in same scope
  if (!checkPath) {
    const basePath = options.global
      ? join(homedir(), ".psst")
      : join(process.cwd(), ".psst");

    if (options.env) {
      // Check env-specific path for locked vault
      const envPath = join(basePath, "envs", options.env);
      if (existsSync(join(envPath, LOCKED_NAME))) {
        checkPath = envPath;
      }
    } else {
      // Check legacy path first, then default env
      if (existsSync(join(basePath, LOCKED_NAME))) {
        checkPath = basePath;
      } else {
        const defaultEnvPath = join(basePath, "envs", "default");
        if (existsSync(join(defaultEnvPath, LOCKED_NAME))) {
          checkPath = defaultEnvPath;
        }
      }
    }
  }

  if (!checkPath) {
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: "no_vault", scope, env: options.env || "default" }));
    } else if (!options.quiet) {
      const envMsg = options.env ? ` for environment "${options.env}"` : "";
      console.error(chalk.red("✗"), `No ${scope} vault found${envMsg}`);
      const globalFlag = options.global ? " --global" : "";
      const envFlag = options.env ? ` --env ${options.env}` : "";
      console.log(chalk.dim(`  Run: psst init${globalFlag}${envFlag}`));
    }
    process.exit(EXIT_NO_VAULT);
  }

  const dbPath = join(checkPath, DB_NAME);
  const lockedPath = join(checkPath, LOCKED_NAME);

  if (existsSync(dbPath)) {
    if (options.json) {
      console.log(JSON.stringify({ success: true, message: "already_unlocked" }));
    } else if (!options.quiet) {
      console.log(chalk.green("✓"), "Vault is already unlocked");
    }
    return;
  }

  if (!existsSync(lockedPath)) {
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: "not_locked" }));
    } else if (!options.quiet) {
      console.error(chalk.red("✗"), "No locked vault found");
    }
    process.exit(EXIT_NO_VAULT);
  }

  const password = await readPassword("Enter unlock password: ", options);
  if (!password) {
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: "no_password" }));
    } else if (!options.quiet) {
      console.error(chalk.red("✗"), "Password required");
    }
    process.exit(EXIT_USER_ERROR);
  }

  const useSpinner = !options.json && !options.quiet;
  const spinner = useSpinner ? ora("Decrypting vault...").start() : null;

  try {
    const encryptedData = await Bun.file(lockedPath).arrayBuffer();

    let decrypted: Buffer;
    try {
      decrypted = await decryptFile(Buffer.from(encryptedData), password);
    } catch {
      if (options.json) {
        console.log(JSON.stringify({ success: false, error: "invalid_password" }));
      } else {
        spinner?.fail("Invalid password");
      }
      process.exit(EXIT_AUTH_FAILED);
    }

    // Extract key from decrypted data
    // Format: [key_length (4 bytes)] [key] [vault.db]
    const keyLength = decrypted.readUInt32LE(0);
    const vaultKey = decrypted.subarray(4, 4 + keyLength).toString("utf-8");
    const dbData = decrypted.subarray(4 + keyLength);

    await Bun.write(dbPath, dbData);
    unlinkSync(lockedPath);

    // Restore the original key to keychain
    await storeKey(vaultKey);

    if (options.json) {
      console.log(JSON.stringify({ success: true }));
    } else {
      spinner?.succeed("Vault unlocked");
    }
  } catch (err: any) {
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: err.message }));
    } else {
      spinner?.fail("Failed to unlock vault");
      if (!options.quiet) {
        console.error(chalk.dim(`  ${err.message}`));
      }
    }
    process.exit(EXIT_ERROR);
  }
}
