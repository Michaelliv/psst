import { execSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import chalk from "chalk";
import { EXIT_ERROR, EXIT_USER_ERROR } from "../utils/exit-codes";
import type { OutputOptions } from "../utils/output";
import { getUnlockedVault } from "./common";

interface ScanMatch {
  file: string;
  line: number;
  secretName: string;
}

interface ScanResult {
  matches: ScanMatch[];
  filesScanned: number;
  secretsChecked: number;
}

// Minimum secret length to avoid false positives
const MIN_SECRET_LENGTH = 4;

export async function scan(
  args: string[],
  options: OutputOptions = {},
): Promise<void> {
  const staged = args.includes("--staged");
  const pathIndex = args.indexOf("--path");
  const scanPath = pathIndex !== -1 ? args[pathIndex + 1] : undefined;

  // Get vault and secrets
  const vault = await getUnlockedVault(options);
  const secretMetas = vault.listSecrets();

  if (secretMetas.length === 0) {
    vault.close();
    if (options.json) {
      console.log(
        JSON.stringify({
          success: true,
          matches: [],
          filesScanned: 0,
          secretsChecked: 0,
        }),
      );
    } else if (!options.quiet) {
      console.log(chalk.yellow("⚠"), "No secrets in vault to scan for");
    }
    return;
  }

  // Get all secret values
  const secrets = new Map<string, string>();
  for (const meta of secretMetas) {
    const value = await vault.getSecret(meta.name);
    if (value !== null && value.length >= MIN_SECRET_LENGTH) {
      secrets.set(meta.name, value);
    }
  }
  vault.close();

  if (secrets.size === 0) {
    if (options.json) {
      console.log(
        JSON.stringify({
          success: true,
          matches: [],
          filesScanned: 0,
          secretsChecked: 0,
        }),
      );
    } else if (!options.quiet) {
      console.log(
        chalk.yellow("⚠"),
        "No secrets long enough to scan for (min 4 chars)",
      );
    }
    return;
  }

  // Get files to scan
  let files: string[];
  try {
    files = getFilesToScan(staged, scanPath);
  } catch (err: any) {
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: err.message }));
    } else if (!options.quiet) {
      console.error(chalk.red("✗"), err.message);
    }
    process.exit(EXIT_ERROR);
  }

  if (files.length === 0) {
    if (options.json) {
      console.log(
        JSON.stringify({
          success: true,
          matches: [],
          filesScanned: 0,
          secretsChecked: secrets.size,
        }),
      );
    } else if (!options.quiet) {
      console.log(chalk.green("✓"), "No files to scan");
    }
    return;
  }

  // Scan files
  const result = await scanFiles(files, secrets);

  // Output results
  if (options.json) {
    console.log(
      JSON.stringify({
        success: result.matches.length === 0,
        matches: result.matches,
        filesScanned: result.filesScanned,
        secretsChecked: result.secretsChecked,
      }),
    );
    if (result.matches.length > 0) {
      process.exit(EXIT_USER_ERROR);
    }
    return;
  }

  if (options.quiet) {
    if (result.matches.length > 0) {
      process.exit(EXIT_USER_ERROR);
    }
    return;
  }

  // Human output
  if (result.matches.length === 0) {
    console.log(
      chalk.green("✓"),
      `Scanned ${result.filesScanned} files - no secrets found`,
    );
    return;
  }

  console.log();
  console.log(chalk.red("✗"), chalk.bold("Secrets found in files:"));
  console.log();

  // Group by file
  const byFile = new Map<string, ScanMatch[]>();
  for (const match of result.matches) {
    const existing = byFile.get(match.file) || [];
    existing.push(match);
    byFile.set(match.file, existing);
  }

  for (const [file, matches] of byFile) {
    for (const match of matches) {
      console.log(`  ${chalk.cyan(file)}:${chalk.yellow(match.line)}`);
      console.log(chalk.dim(`    Contains: ${match.secretName}`));
    }
    console.log();
  }

  const uniqueSecrets = new Set(result.matches.map((m) => m.secretName));
  console.log(
    chalk.dim(
      `Found ${uniqueSecrets.size} secret(s) in ${byFile.size} file(s)`,
    ),
  );
  console.log(
    chalk.dim("  Tip: Use"),
    chalk.cyan("PSST_SKIP_SCAN=1 git commit"),
    chalk.dim("to bypass"),
  );
  console.log();

  process.exit(EXIT_USER_ERROR);
}

function getFilesToScan(staged: boolean, scanPath?: string): string[] {
  if (staged) {
    // Get staged files from git
    try {
      const output = execSync(
        "git diff --cached --name-only --diff-filter=ACMR",
        {
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      return output.trim().split("\n").filter(Boolean);
    } catch {
      throw new Error("Not a git repository or git not available");
    }
  }

  if (scanPath) {
    // Scan specific path
    if (!existsSync(scanPath)) {
      throw new Error(`Path not found: ${scanPath}`);
    }
    return getFilesRecursive(scanPath);
  }

  // Default: all tracked files (respects .gitignore)
  try {
    const output = execSync("git ls-files", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return output.trim().split("\n").filter(Boolean);
  } catch {
    // Not a git repo, scan all files in cwd
    return getFilesRecursive(".");
  }
}

function getFilesRecursive(dir: string): string[] {
  const files: string[] = [];
  const _entries = Bun.file(dir);

  // Use glob to get all files
  const glob = new Bun.Glob("**/*");
  for (const path of glob.scanSync({ cwd: dir, onlyFiles: true })) {
    // Skip common non-text files and directories
    if (shouldSkipFile(path)) continue;
    files.push(join(dir, path));
  }

  return files;
}

function shouldSkipFile(path: string): boolean {
  const skipPatterns = [
    /node_modules/,
    /\.git\//,
    /\.psst\//,
    /dist\//,
    /build\//,
    /\.png$/i,
    /\.jpg$/i,
    /\.jpeg$/i,
    /\.gif$/i,
    /\.ico$/i,
    /\.woff2?$/i,
    /\.ttf$/i,
    /\.eot$/i,
    /\.pdf$/i,
    /\.zip$/i,
    /\.tar$/i,
    /\.gz$/i,
    /\.db$/i,
    /\.sqlite$/i,
    /\.lock$/,
    /package-lock\.json$/,
    /yarn\.lock$/,
    /bun\.lockb$/,
  ];

  return skipPatterns.some((pattern) => pattern.test(path));
}

async function scanFiles(
  files: string[],
  secrets: Map<string, string>,
): Promise<ScanResult> {
  const matches: ScanMatch[] = [];
  let filesScanned = 0;

  for (const file of files) {
    try {
      // Skip if not a file or doesn't exist
      if (!existsSync(file)) continue;
      const stat = statSync(file);
      if (!stat.isFile()) continue;

      // Skip large files (> 1MB)
      if (stat.size > 1024 * 1024) continue;

      const content = await Bun.file(file).text();

      // Skip binary files (check for null bytes)
      if (content.includes("\0")) continue;

      filesScanned++;

      // Search for each secret
      const lines = content.split("\n");
      for (const [secretName, secretValue] of secrets) {
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(secretValue)) {
            matches.push({
              file: relative(process.cwd(), file) || file,
              line: i + 1,
              secretName,
            });
          }
        }
      }
    } catch {
      // Skip files we can't read
    }
  }

  return {
    matches,
    filesScanned,
    secretsChecked: secrets.size,
  };
}
