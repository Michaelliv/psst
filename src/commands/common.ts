import chalk from "chalk";
import { Vault } from "../vault/vault";
import { EXIT_NO_VAULT, EXIT_AUTH_FAILED } from "../utils/exit-codes";
import type { OutputOptions } from "../utils/output";

export async function getUnlockedVault(options: OutputOptions = {}): Promise<Vault> {
  const vaultPath = Vault.findVaultPath(options.env);

  if (!vaultPath) {
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: "no_vault", env: options.env || "default" }));
    } else if (!options.quiet) {
      const envMsg = options.env ? ` for environment "${options.env}"` : "";
      console.error(chalk.red("✗"), `No vault found${envMsg}`);
      console.log(chalk.dim(`  Run: psst init${options.env ? ` --env ${options.env}` : ""}`));
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
