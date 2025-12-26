import chalk from "chalk";
import ora from "ora";
import { existsSync, unlinkSync } from "fs";
import { join } from "path";
import { Vault } from "../vault/vault";
import { encryptFile } from "../vault/crypto";
import { deleteKey } from "../vault/keychain";
import { readPassword } from "../utils/input";
import { EXIT_USER_ERROR, EXIT_LOCKED, EXIT_NO_VAULT, EXIT_ERROR } from "../utils/exit-codes";
import type { OutputOptions } from "../utils/output";

const DB_NAME = "vault.db";
const LOCKED_NAME = "vault.db.locked";

export async function lock(options: OutputOptions = {}): Promise<void> {
  const vaultPath = Vault.findVaultPath();

  if (!vaultPath) {
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: "no_vault" }));
    } else if (!options.quiet) {
      console.error(chalk.red("✗"), "No vault found");
      console.log(chalk.dim("  Run: psst init"));
    }
    process.exit(EXIT_NO_VAULT);
  }

  const dbPath = join(vaultPath, DB_NAME);
  const lockedPath = join(vaultPath, LOCKED_NAME);

  if (!existsSync(dbPath)) {
    if (existsSync(lockedPath)) {
      if (options.json) {
        console.log(JSON.stringify({ success: false, error: "already_locked" }));
      } else if (!options.quiet) {
        console.log(chalk.yellow("⚠"), "Vault is already locked");
      }
      process.exit(EXIT_LOCKED);
    }
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: "no_vault" }));
    } else if (!options.quiet) {
      console.error(chalk.red("✗"), "Vault database not found");
    }
    process.exit(EXIT_NO_VAULT);
  }

  const password = await readPassword("Enter lock password: ", options);
  if (!password) {
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: "no_password" }));
    } else if (!options.quiet) {
      console.error(chalk.red("✗"), "Password required");
    }
    process.exit(EXIT_USER_ERROR);
  }

  const useSpinner = !options.json && !options.quiet;
  const spinner = useSpinner ? ora("Encrypting vault...").start() : null;

  try {
    const dbData = await Bun.file(dbPath).arrayBuffer();
    const encrypted = await encryptFile(Buffer.from(dbData), password);
    await Bun.write(lockedPath, encrypted);
    unlinkSync(dbPath);
    await deleteKey();

    if (options.json) {
      console.log(JSON.stringify({ success: true }));
    } else {
      spinner?.succeed("Vault locked");
    }
  } catch (err: any) {
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: err.message }));
    } else {
      spinner?.fail("Failed to lock vault");
      if (!options.quiet) {
        console.error(chalk.dim(`  ${err.message}`));
      }
    }
    process.exit(EXIT_ERROR);
  }
}
