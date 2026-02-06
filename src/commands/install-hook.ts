import { chmodSync, existsSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { EXIT_ERROR, EXIT_USER_ERROR } from "../utils/exit-codes";
import type { OutputOptions } from "../utils/output";

const HOOK_CONTENT = `#!/bin/sh
# psst pre-commit hook - scans staged files for secrets
# Installed by: psst install-hook
# Bypass with: PSST_SKIP_SCAN=1 git commit -m "message"
#          or: git commit --no-verify

if [ "$PSST_SKIP_SCAN" = "1" ]; then
  exit 0
fi

psst scan --staged --quiet
exit $?
`;

export async function installHook(
  args: string[],
  options: OutputOptions = {},
): Promise<void> {
  const force = args.includes("--force") || args.includes("-f");

  // Find .git directory
  const gitDir = findGitDir();

  if (!gitDir) {
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: "not_git_repo" }));
    } else if (!options.quiet) {
      console.error(chalk.red("✗"), "Not a git repository");
      console.log(chalk.dim("  Run this command from within a git repository"));
    }
    process.exit(EXIT_USER_ERROR);
  }

  const hooksDir = join(gitDir, "hooks");
  const hookPath = join(hooksDir, "pre-commit");

  // Check if hook already exists
  if (existsSync(hookPath) && !force) {
    // Check if it's our hook
    const existingContent = await Bun.file(hookPath).text();
    if (existingContent.includes("psst scan")) {
      if (options.json) {
        console.log(
          JSON.stringify({
            success: true,
            message: "already_installed",
            path: hookPath,
          }),
        );
      } else if (!options.quiet) {
        console.log(chalk.green("✓"), "Pre-commit hook already installed");
        console.log(chalk.dim(`  ${hookPath}`));
      }
      return;
    }

    // Different hook exists
    if (options.json) {
      console.log(
        JSON.stringify({
          success: false,
          error: "hook_exists",
          path: hookPath,
        }),
      );
    } else if (!options.quiet) {
      console.error(chalk.red("✗"), "Pre-commit hook already exists");
      console.log(chalk.dim(`  ${hookPath}`));
      console.log(chalk.dim("  Use --force to overwrite"));
    }
    process.exit(EXIT_USER_ERROR);
  }

  // Write hook
  try {
    await Bun.write(hookPath, HOOK_CONTENT);
    chmodSync(hookPath, 0o755);

    if (options.json) {
      console.log(JSON.stringify({ success: true, path: hookPath }));
    } else if (!options.quiet) {
      console.log(chalk.green("✓"), "Pre-commit hook installed");
      console.log(chalk.dim(`  ${hookPath}`));
      console.log();
      console.log(
        "Staged files will be scanned for secrets before each commit.",
      );
      console.log(
        chalk.dim("  Bypass with:"),
        chalk.cyan("PSST_SKIP_SCAN=1 git commit"),
      );
      console.log(chalk.dim("  Or use:"), chalk.cyan("git commit --no-verify"));
      console.log();
    }
  } catch (err: any) {
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: err.message }));
    } else if (!options.quiet) {
      console.error(chalk.red("✗"), "Failed to install hook");
      console.log(chalk.dim(`  ${err.message}`));
    }
    process.exit(EXIT_ERROR);
  }
}

function findGitDir(): string | null {
  let dir = process.cwd();

  while (dir !== "/") {
    const gitPath = join(dir, ".git");
    if (existsSync(gitPath)) {
      return gitPath;
    }
    dir = join(dir, "..");
  }

  return null;
}
