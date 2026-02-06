import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import ora from "ora";
import {
  EXIT_ERROR,
  EXIT_LOCKED,
  EXIT_NO_VAULT,
  EXIT_USER_ERROR,
} from "../utils/exit-codes";
import { readPassword } from "../utils/input";
import type { OutputOptions } from "../utils/output";
import { encryptFile } from "../vault/crypto";
import { deleteKey, getKey } from "../vault/keychain";
import { Vault } from "../vault/vault";

const DB_NAME = "vault.db";
const LOCKED_NAME = "vault.db.locked";

export async function lock(options: OutputOptions = {}): Promise<void> {
  const vaultPath = Vault.findVaultPath({
    global: options.global,
    env: options.env,
  });

  if (!vaultPath) {
    const scope = options.global ? "global" : "local";
    if (options.json) {
      console.log(
        JSON.stringify({
          success: false,
          error: "no_vault",
          scope,
          env: options.env || "default",
        }),
      );
    } else if (!options.quiet) {
      const envMsg = options.env ? ` for environment "${options.env}"` : "";
      console.error(chalk.red("✗"), `No ${scope} vault found${envMsg}`);
      const globalFlag = options.global ? " --global" : "";
      const envFlag = options.env ? ` --env ${options.env}` : "";
      console.log(chalk.dim(`  Run: psst init${globalFlag}${envFlag}`));
    }
    process.exit(EXIT_NO_VAULT);
  }

  const dbPath = join(vaultPath, DB_NAME);
  const lockedPath = join(vaultPath, LOCKED_NAME);

  if (!existsSync(dbPath)) {
    if (existsSync(lockedPath)) {
      if (options.json) {
        console.log(
          JSON.stringify({ success: false, error: "already_locked" }),
        );
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
    // Get the current keychain key to preserve it
    const keyResult = await getKey();
    const vaultKey = keyResult.key || process.env.PSST_PASSWORD || "";

    if (!vaultKey) {
      if (options.json) {
        console.log(JSON.stringify({ success: false, error: "no_key" }));
      } else {
        spinner?.fail("No vault key found");
        if (!options.quiet) {
          console.error(
            chalk.dim("  Ensure keychain is available or set PSST_PASSWORD"),
          );
        }
      }
      process.exit(EXIT_ERROR);
    }

    // Format: [key_length (4 bytes)] [key] [vault.db]
    const keyBuffer = Buffer.from(vaultKey, "utf-8");
    const keyLengthBuffer = Buffer.alloc(4);
    keyLengthBuffer.writeUInt32LE(keyBuffer.length, 0);

    const dbData = await Bun.file(dbPath).arrayBuffer();
    const combined = Buffer.concat([
      keyLengthBuffer,
      keyBuffer,
      Buffer.from(dbData),
    ]);

    const encrypted = await encryptFile(combined, password);
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
