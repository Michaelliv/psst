import chalk from "chalk";
import { EXIT_AUTH_FAILED, EXIT_NO_VAULT } from "../utils/exit-codes";
import type { OutputOptions } from "../utils/output";
import { Vault } from "../vault/vault";

export async function getUnlockedVault(
  options: OutputOptions = {},
): Promise<Vault> {
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

  const vault = new Vault(vaultPath);
  const success = await vault.unlock();

  if (!success) {
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: "unlock_failed" }));
    } else if (!options.quiet) {
      console.error(chalk.red("✗"), "Failed to unlock vault");
      console.log(
        chalk.dim("  Ensure keychain is available or set PSST_PASSWORD"),
      );
    }
    process.exit(EXIT_AUTH_FAILED);
  }

  return vault;
}
