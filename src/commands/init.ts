import { existsSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { EXIT_ERROR, EXIT_USER_ERROR } from "../utils/exit-codes";
import type { OutputOptions } from "../utils/output";
import { Vault } from "../vault/vault";

export async function init(
  args: string[],
  options: OutputOptions = {},
): Promise<void> {
  // Handle deprecated --local flag
  const hasLocalFlag = args.includes("--local") || args.includes("-l");
  if (hasLocalFlag && !options.quiet && !options.json) {
    console.log(
      chalk.yellow("⚠"),
      chalk.dim("--local flag is deprecated (local is now the default)"),
    );
  }

  // --global flag means use global vault, otherwise default to local
  const isGlobal =
    options.global || args.includes("--global") || args.includes("-g");
  const scope = isGlobal ? "global" : "local";

  // Use environment from options, default to "default" for new vaults with --env flag
  const env = options.env || "default";
  const vaultPath = Vault.getVaultPath(isGlobal, env);

  // Check if already exists
  if (existsSync(join(vaultPath, "vault.db"))) {
    if (options.json) {
      console.log(
        JSON.stringify({
          success: false,
          error: "already_exists",
          path: vaultPath,
          env,
          scope,
        }),
      );
    } else if (!options.quiet) {
      console.log(
        chalk.yellow("⚠"),
        `${scope.charAt(0).toUpperCase() + scope.slice(1)} vault already exists for "${env}" at ${chalk.dim(vaultPath)}`,
      );
      const globalFlag = isGlobal ? " --global" : "";
      console.log(chalk.dim(`  Run: psst${globalFlag} list`));
    }
    process.exit(EXIT_USER_ERROR);
  }

  const result = await Vault.initializeVault(vaultPath);

  if (result.success) {
    if (options.json) {
      console.log(
        JSON.stringify({ success: true, path: vaultPath, env, scope }),
      );
      return;
    }

    if (!options.quiet) {
      console.log(
        chalk.green("✓"),
        `${scope.charAt(0).toUpperCase() + scope.slice(1)} vault created for "${env}"`,
      );
    }

    if (!options.quiet) {
      console.log(chalk.dim(`  ${vaultPath}`));
      console.log();
      console.log("Next steps:");
      const globalFlag = isGlobal ? " --global" : "";
      const envFlag = env !== "default" ? ` --env ${env}` : "";
      console.log(chalk.cyan(`  psst${globalFlag}${envFlag} set STRIPE_KEY`));
      console.log(chalk.cyan(`  psst${globalFlag}${envFlag} set DATABASE_URL`));
      console.log(chalk.cyan("  psst onboard"));
      console.log();
    }
  } else {
    if (options.json) {
      console.log(
        JSON.stringify({ success: false, error: result.error, env, scope }),
      );
    } else {
      if (!options.quiet) {
        console.error(chalk.red("✗"), "Failed to create vault");
        console.error(chalk.dim(`  ${result.error}`));
      }
    }
    process.exit(EXIT_ERROR);
  }
}
