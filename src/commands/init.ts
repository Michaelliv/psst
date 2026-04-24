import { existsSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { EXIT_ERROR, EXIT_USER_ERROR } from "../utils/exit-codes.js";
import type { OutputOptions } from "../utils/output.js";
import { Vault } from "../vault/vault.js";
import type { AwsBackendConfig, BackendType } from "../vault/config.js";

/**
 * Parse `--backend <name>` from the CLI args. Accepts "sqlite" (default)
 * or "aws". Returns undefined if absent.
 */
function parseBackendFlag(args: string[]): BackendType | undefined {
  const idx = args.indexOf("--backend");
  if (idx === -1) return undefined;
  const value = args[idx + 1];
  if (!value || value.startsWith("-")) return undefined;
  if (value === "sqlite" || value === "aws") return value;
  return undefined;
}

function parseStringFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  const value = args[idx + 1];
  if (!value || value.startsWith("-")) return undefined;
  return value;
}

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

  // Backend selection — default sqlite, opt into aws with --backend aws
  const backend: BackendType = parseBackendFlag(args) ?? "sqlite";

  let awsConfig: AwsBackendConfig | undefined;
  if (backend === "aws") {
    awsConfig = {
      region: parseStringFlag(args, "--aws-region"),
      prefix: parseStringFlag(args, "--aws-prefix"),
      profile: parseStringFlag(args, "--aws-profile"),
    };
    // Strip undefined properties so the persisted config.json is clean
    for (const k of Object.keys(awsConfig) as (keyof AwsBackendConfig)[]) {
      if (awsConfig[k] === undefined) delete awsConfig[k];
    }
  }

  // Check if already exists — look for either vault.db (sqlite) or
  // config.json (aws or future backends).
  const alreadyExists =
    existsSync(join(vaultPath, "vault.db")) ||
    existsSync(join(vaultPath, "config.json"));

  if (alreadyExists) {
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

  const result = await Vault.initializeVault(vaultPath, {
    backend,
    aws: awsConfig,
  });

  if (result.success) {
    if (options.json) {
      console.log(
        JSON.stringify({
          success: true,
          path: vaultPath,
          env,
          scope,
          backend,
          ...(awsConfig ? { aws: awsConfig } : {}),
        }),
      );
      return;
    }

    if (!options.quiet) {
      console.log(
        chalk.green("✓"),
        `${scope.charAt(0).toUpperCase() + scope.slice(1)} vault created for "${env}" (backend: ${backend})`,
      );
      console.log(chalk.dim(`  ${vaultPath}`));

      if (backend === "aws" && awsConfig) {
        const details: string[] = [];
        if (awsConfig.region) details.push(`region=${awsConfig.region}`);
        if (awsConfig.prefix) details.push(`prefix=${awsConfig.prefix}`);
        if (awsConfig.profile) details.push(`profile=${awsConfig.profile}`);
        if (details.length > 0) {
          console.log(chalk.dim(`  AWS: ${details.join(", ")}`));
        }
      }

      console.log();
      console.log("Next steps:");
      const globalFlag = isGlobal ? " --global" : "";
      const envFlag = env !== "default" ? ` --env ${env}` : "";
      console.log(chalk.cyan(`  psst${globalFlag}${envFlag} set STRIPE_KEY`));
      console.log(chalk.cyan(`  psst${globalFlag}${envFlag} set DATABASE_URL`));
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
