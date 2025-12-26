import chalk from "chalk";
import { Vault } from "../vault/vault";
import { EXIT_NO_VAULT, EXIT_AUTH_FAILED } from "../utils/exit-codes";
import type { OutputOptions } from "../utils/output";

export async function getUnlockedVault(options: OutputOptions = {}): Promise<Vault> {
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

  const vault = new Vault(vaultPath);
  const success = await vault.unlock();

  if (!success) {
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: "unlock_failed" }));
    } else if (!options.quiet) {
      console.error(chalk.red("✗"), "Failed to unlock vault");
      console.log(chalk.dim("  Ensure keychain is available or set PSST_PASSWORD"));
    }
    process.exit(EXIT_AUTH_FAILED);
  }

  return vault;
}
