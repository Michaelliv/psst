import chalk from "chalk";
import ora from "ora";
import { existsSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { Vault } from "../vault/vault";
import { decryptFile } from "../vault/crypto";
import { storeKey, generateKey } from "../vault/keychain";
import { readPassword } from "../utils/input";
import { EXIT_USER_ERROR, EXIT_AUTH_FAILED, EXIT_NO_VAULT, EXIT_ERROR } from "../utils/exit-codes";
import type { OutputOptions } from "../utils/output";

const DB_NAME = "vault.db";
const LOCKED_NAME = "vault.db.locked";

export async function unlock(options: OutputOptions = {}): Promise<void> {
  let checkPath = Vault.findVaultPath(options.env);

  // Look for locked vault even if no unlocked vault exists
  if (!checkPath) {
    if (options.env) {
      // Check env-specific paths for locked vault
      const globalEnvPath = join(homedir(), ".psst", "envs", options.env);
      const localEnvPath = join(process.cwd(), ".psst", "envs", options.env);

      if (existsSync(join(localEnvPath, LOCKED_NAME))) {
        checkPath = localEnvPath;
      } else if (existsSync(join(globalEnvPath, LOCKED_NAME))) {
        checkPath = globalEnvPath;
      }
    } else {
      // Check legacy paths for locked vault
      const globalPath = join(homedir(), ".psst");
      const localPath = join(process.cwd(), ".psst");

      if (existsSync(join(localPath, LOCKED_NAME))) {
        checkPath = localPath;
      } else if (existsSync(join(globalPath, LOCKED_NAME))) {
        checkPath = globalPath;
      }

      // Also check default env paths
      if (!checkPath) {
        const globalDefaultEnv = join(homedir(), ".psst", "envs", "default");
        const localDefaultEnv = join(process.cwd(), ".psst", "envs", "default");

        if (existsSync(join(localDefaultEnv, LOCKED_NAME))) {
          checkPath = localDefaultEnv;
        } else if (existsSync(join(globalDefaultEnv, LOCKED_NAME))) {
          checkPath = globalDefaultEnv;
        }
      }
    }
  }

  if (!checkPath) {
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: "no_vault", env: options.env || "default" }));
    } else if (!options.quiet) {
      const envMsg = options.env ? ` for environment "${options.env}"` : "";
      console.error(chalk.red("✗"), `No vault found${envMsg}`);
      console.log(chalk.dim(`  Run: psst init${options.env ? ` --env ${options.env}` : ""}`));
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

    await Bun.write(dbPath, decrypted);
    unlinkSync(lockedPath);

    const key = generateKey();
    await storeKey(key);

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
