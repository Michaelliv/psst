/**
 * passwd.ts — Change the sqlite keystore password without losing secrets.
 *
 * Requires PSST_PASSWORD (current) and PSST_NEW_PASSWORD (new) env vars.
 * No interactive prompts — designed for agent/CI use.
 */

import chalk from "chalk";
import { EXIT_AUTH_FAILED, EXIT_ERROR, EXIT_NO_VAULT, EXIT_USER_ERROR } from "../utils/exit-codes.js";
import type { OutputOptions } from "../utils/output.js";
import { getKeyFromSqlite, storeKeyInSqlite } from "../vault/sqlite-keystore.js";
import { Vault } from "../vault/vault.js";

export async function passwd(options: OutputOptions = {}): Promise<void> {
  const vaultPath = Vault.findVaultPath({ global: options.global, env: options.env });

  if (!vaultPath) {
    const scope = options.global ? "global" : "local";
    const envMsg = options.env ? ` for environment "${options.env}"` : "";
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: "no_vault" }));
    } else if (!options.quiet) {
      console.error(chalk.red("\u2717"), `No ${scope} vault found${envMsg}`);
    }
    process.exit(EXIT_NO_VAULT);
  }

  const currentPassword = process.env.PSST_PASSWORD;
  const newPassword = process.env.PSST_NEW_PASSWORD;

  if (!currentPassword) {
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: "missing_current_password" }));
    } else if (!options.quiet) {
      console.error(chalk.red("\u2717"), "PSST_PASSWORD env var required (current password)");
    }
    process.exit(EXIT_USER_ERROR);
  }

  if (!newPassword) {
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: "missing_new_password" }));
    } else if (!options.quiet) {
      console.error(chalk.red("\u2717"), "PSST_NEW_PASSWORD env var required (new password)");
    }
    process.exit(EXIT_USER_ERROR);
  }

  // Unlock keystore with current password
  const keyResult = await getKeyFromSqlite(vaultPath, currentPassword);
  if (!keyResult.success || !keyResult.key) {
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: "auth_failed" }));
    } else if (!options.quiet) {
      console.error(chalk.red("\u2717"), "Wrong password — could not unlock keystore");
    }
    process.exit(EXIT_AUTH_FAILED);
  }

  // Re-encrypt with new password
  const storeResult = await storeKeyInSqlite(vaultPath, keyResult.key, newPassword);
  if (!storeResult.success) {
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: "store_failed", message: storeResult.error }));
    } else if (!options.quiet) {
      console.error(chalk.red("\u2717"), `Failed to re-encrypt keystore: ${storeResult.error}`);
    }
    process.exit(EXIT_ERROR);
  }

  if (options.json) {
    console.log(JSON.stringify({ success: true }));
  } else if (!options.quiet) {
    console.log(chalk.green("\u2713"), "Password changed successfully");
  }
}