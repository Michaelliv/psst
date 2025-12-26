import chalk from "chalk";
import ora from "ora";
import { existsSync } from "fs";
import { join } from "path";
import { Vault } from "../vault/vault";
import { EXIT_USER_ERROR, EXIT_ERROR } from "../utils/exit-codes";
import type { OutputOptions } from "../utils/output";

export async function init(args: string[], options: OutputOptions = {}): Promise<void> {
  const isLocal = args.includes("--local") || args.includes("-l");
  const vaultPath = Vault.getVaultPath(!isLocal);

  // Check if already exists
  if (existsSync(join(vaultPath, "vault.db"))) {
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: "already_exists", path: vaultPath }));
    } else if (!options.quiet) {
      console.log(chalk.yellow("⚠"), `Vault already exists at ${chalk.dim(vaultPath)}`);
      console.log(chalk.dim("  Run: psst list"));
    }
    process.exit(EXIT_USER_ERROR);
  }

  const useSpinner = !options.json && !options.quiet;
  const spinner = useSpinner ? ora("Creating vault...").start() : null;

  const result = await Vault.initializeVault(vaultPath);

  if (result.success) {
    if (options.json) {
      console.log(JSON.stringify({ success: true, path: vaultPath }));
      return;
    }

    spinner?.succeed("Vault created");

    if (!options.quiet) {
      console.log(chalk.dim(`  ${vaultPath}`));
      console.log();
      console.log("Next steps:");
      console.log(chalk.cyan("  psst set STRIPE_KEY"));
      console.log(chalk.cyan("  psst set DATABASE_URL"));
      console.log(chalk.cyan("  psst onboard"));
      console.log();
    }
  } else {
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: result.error }));
    } else {
      spinner?.fail("Failed to create vault");
      if (!options.quiet) {
        console.error(chalk.dim(`  ${result.error}`));
      }
    }
    process.exit(EXIT_ERROR);
  }
}
