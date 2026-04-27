import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { errorMessage } from "../utils/errors.js";
import { EXIT_ERROR, EXIT_USER_ERROR } from "../utils/exit-codes.js";
import type { OutputOptions } from "../utils/output.js";
import type { AwsBackendConfig, BackendType } from "../vault/config.js";
import { Vault } from "../vault/vault.js";

const AWS_PKGS = [
  "@aws-sdk/client-secrets-manager",
  "@aws-sdk/credential-providers",
] as const;

/**
 * Parse `--backend <name>` from the CLI args. Accepts "sqlite" (default)
 * or "aws". Returns undefined if absent. Throws on unknown value so the
 * user doesn't silently get a sqlite vault when they asked for "gcp".
 */
function parseBackendFlag(args: string[]): BackendType | undefined {
  const idx = args.indexOf("--backend");
  if (idx === -1) return undefined;
  const value = args[idx + 1];
  if (!value || value.startsWith("-")) {
    throw new Error("--backend requires a value (sqlite or aws)");
  }
  if (value === "sqlite" || value === "aws") return value;
  throw new Error(`Unknown --backend "${value}". Supported: sqlite, aws.`);
}

function parseStringFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  const value = args[idx + 1];
  if (!value || value.startsWith("-")) return undefined;
  return value;
}

/** Check if a module is resolvable without importing/executing it. */
function canResolve(specifier: string): boolean {
  try {
    const req = createRequire(import.meta.url);
    req.resolve(specifier);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if the AWS SDK is resolvable. If not, install it into psst-cli's
 * own node_modules so the user doesn't need a separate install step.
 *
 * Uses require.resolve for detection (no execution, no module-cache
 * pollution). Trusts execFileSync exit code for install success rather
 * than re-importing (avoids Node's failed-import cache).
 */
async function ensureAwsSdk(options: OutputOptions): Promise<void> {
  if (canResolve("@aws-sdk/client-secrets-manager")) return;

  // Resolve psst-cli's package root (src/commands/ -> src/ -> psst-cli/).
  const thisFile =
    typeof __dirname !== "undefined"
      ? __dirname
      : dirname(fileURLToPath(import.meta.url));
  const pkgRoot = join(thisFile, "..", "..");

  // Detect compiled binary or broken install: if there's no package.json
  // at the resolved root, we can't install into it.
  if (!existsSync(join(pkgRoot, "package.json"))) {
    if (options.json) {
      console.log(
        JSON.stringify({
          success: false,
          error: "aws_sdk_missing",
          message:
            "AWS SDK not found. Install it: npm install -g @aws-sdk/client-secrets-manager @aws-sdk/credential-providers",
        }),
      );
    } else if (!options.quiet) {
      console.error(chalk.red("\u2717"), "AWS SDK not found. Install it:");
      console.error(
        chalk.cyan(
          "  npm install -g @aws-sdk/client-secrets-manager @aws-sdk/credential-providers",
        ),
      );
    }
    process.exit(EXIT_ERROR);
  }

  if (!options.quiet && !options.json) {
    console.log(chalk.cyan("\u27f3"), "Installing AWS SDK (one-time setup)...");
  }

  try {
    // Detect package manager. Prefer bun (psst is built with it),
    // fall back to npm which is always present with Node.
    let bin: string;
    let args: string[];
    try {
      execFileSync("bun", ["--version"], { stdio: "ignore" });
      bin = "bun";
      args = ["add", "--cwd", pkgRoot, ...AWS_PKGS];
    } catch {
      bin = "npm";
      args = ["install", "--prefix", pkgRoot, "--save=false", ...AWS_PKGS];
    }

    // execFileSync throws on non-zero exit, so success means installed.
    // We don't re-import to verify — avoids Node's failed-import cache.
    execFileSync(bin, args, {
      stdio: options.quiet || options.json ? "ignore" : "inherit",
    });

    if (!options.quiet && !options.json) {
      console.log(chalk.green("\u2713"), "AWS SDK installed");
      console.log();
    }
  } catch (err) {
    const msg = errorMessage(err);
    if (options.json) {
      console.log(
        JSON.stringify({
          success: false,
          error: "aws_sdk_install_failed",
          message: msg,
        }),
      );
    } else if (!options.quiet) {
      console.error(
        chalk.red("\u2717"),
        "Failed to install AWS SDK automatically",
      );
      console.error(
        chalk.dim(
          "  Install manually: npm install -g @aws-sdk/client-secrets-manager @aws-sdk/credential-providers",
        ),
      );
    }
    process.exit(EXIT_ERROR);
  }
}

export async function init(
  args: string[],
  options: OutputOptions = {},
): Promise<void> {
  // Handle deprecated --local flag
  const hasLocalFlag = args.includes("--local") || args.includes("-l");
  if (hasLocalFlag && !options.quiet && !options.json) {
    console.log(
      chalk.yellow("\u26a0"),
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

  // Backend selection — default sqlite, opt into aws with --backend aws.
  // parseBackendFlag throws on an unknown value; surface that cleanly.
  let backend: BackendType;
  try {
    backend = parseBackendFlag(args) ?? "sqlite";
  } catch (err) {
    const msg = errorMessage(err);
    if (options.json) {
      console.log(
        JSON.stringify({
          success: false,
          error: "invalid_backend",
          message: msg,
        }),
      );
    } else if (!options.quiet) {
      console.error(chalk.red("\u2717"), msg);
    }
    process.exit(EXIT_USER_ERROR);
    // Unreachable: process.exit's return type is `never`, but TS control
    // flow analysis doesn't always propagate that through the try/catch.
    // Explicit return keeps `backend` definitely-assigned below.
    return;
  }

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

    // Auto-install AWS SDK if not present
    await ensureAwsSdk(options);
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
        chalk.yellow("\u26a0"),
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
        chalk.green("\u2713"),
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
        console.error(chalk.red("\u2717"), "Failed to create vault");
        console.error(chalk.dim(`  ${result.error}`));
      }
    }
    process.exit(EXIT_ERROR);
  }
}
