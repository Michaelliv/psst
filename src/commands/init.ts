import chalk from "chalk";
import ora from "ora";
import { existsSync } from "fs";
import { join } from "path";
import { Vault } from "../vault/vault";
import { EXIT_USER_ERROR, EXIT_ERROR } from "../utils/exit-codes";
import type { OutputOptions } from "../utils/output";

export async function init(args: string[], options: OutputOptions = {}): Promise<void> {
  const isLocal = args.includes("--local") || args.includes("-l");

  // Use environment from options, default to "default" for new vaults with --env flag
  const env = options.env || "default";
  const vaultPath = Vault.getVaultPath(!isLocal, env);

  // Check if already exists
  if (existsSync(join(vaultPath, "vault.db"))) {
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: "already_exists", path: vaultPath, env }));
    } else if (!options.quiet) {
      console.log(chalk.yellow("⚠"), `Vault already exists for "${env}" at ${chalk.dim(vaultPath)}`);
      console.log(chalk.dim("  Run: psst list"));
    }
    process.exit(EXIT_USER_ERROR);
  }

  const useSpinner = !options.json && !options.quiet;
  const spinner = useSpinner ? ora(`Creating vault for "${env}"...`).start() : null;

  const result = await Vault.initializeVault(vaultPath);

  if (result.success) {
    if (options.json) {
      console.log(JSON.stringify({ success: true, path: vaultPath, env }));
      return;
    }

    spinner?.succeed(`Vault created for "${env}"`);

    if (!options.quiet) {
      console.log(chalk.dim(`  ${vaultPath}`));
      console.log();
      console.log("Next steps:");
      const envFlag = env !== "default" ? ` --env ${env}` : "";
      console.log(chalk.cyan(`  psst${envFlag} set STRIPE_KEY`));
      console.log(chalk.cyan(`  psst${envFlag} set DATABASE_URL`));
      console.log(chalk.cyan("  psst onboard"));
      console.log();
    }
  } else {
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: result.error, env }));
    } else {
      spinner?.fail("Failed to create vault");
      if (!options.quiet) {
        console.error(chalk.dim(`  ${result.error}`));
      }
    }
    process.exit(EXIT_ERROR);
  }
}
