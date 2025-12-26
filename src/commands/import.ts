import chalk from "chalk";
import ora from "ora";
import { existsSync } from "fs";
import { getUnlockedVault } from "./common";
import { readStdin } from "../utils/input";
import { EXIT_USER_ERROR } from "../utils/exit-codes";
import type { OutputOptions } from "../utils/output";

interface ImportOptions extends OutputOptions {
  stdin?: boolean;
  fromEnv?: boolean;
  pattern?: string;
}

export async function importSecrets(
  fileOrArgs: string[],
  options: ImportOptions = {}
): Promise<void> {
  const vault = await getUnlockedVault(options);

  let entries: [string, string][] = [];

  if (options.fromEnv) {
    entries = importFromEnv(options.pattern);
  } else if (options.stdin) {
    const content = await readStdin();
    entries = parseEnvContent(content);
  } else {
    const filePath = fileOrArgs[0];
    if (!filePath) {
      if (options.json) {
        console.log(JSON.stringify({ success: false, error: "missing_file" }));
      } else if (!options.quiet) {
        console.error(chalk.red("✗"), "File path required");
        console.log(chalk.dim("  Usage: psst import <file>"));
      }
      vault.close();
      process.exit(EXIT_USER_ERROR);
    }

    if (!existsSync(filePath)) {
      if (options.json) {
        console.log(JSON.stringify({ success: false, error: "file_not_found", file: filePath }));
      } else if (!options.quiet) {
        console.error(chalk.red("✗"), `File not found: ${filePath}`);
      }
      vault.close();
      process.exit(EXIT_USER_ERROR);
    }

    const content = await Bun.file(filePath).text();
    entries = parseEnvContent(content);
  }

  if (entries.length === 0) {
    if (options.json) {
      console.log(JSON.stringify({ success: true, imported: 0, skipped: 0 }));
    } else if (!options.quiet) {
      console.log(chalk.dim("No secrets to import"));
    }
    vault.close();
    return;
  }

  const useSpinner = !options.json && !options.quiet && entries.length > 3;
  const spinner = useSpinner ? ora("Importing secrets...").start() : null;

  let imported = 0;
  let skipped = 0;

  for (const [name, value] of entries) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
      skipped++;
      continue;
    }
    await vault.setSecret(name, value);
    imported++;
  }

  vault.close();

  if (options.json) {
    console.log(JSON.stringify({ success: true, imported, skipped }));
    return;
  }

  spinner?.succeed(`Imported ${imported} secret(s)`);

  if (!options.quiet) {
    if (!useSpinner) {
      console.log(chalk.green("✓"), `Imported ${chalk.bold(imported)} secret(s)`);
    }
    if (skipped > 0) {
      console.log(chalk.dim(`  Skipped ${skipped} invalid entries`));
    }
  }
}

function parseEnvContent(content: string): [string, string][] {
  const entries: [string, string][] = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }

    const name = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (name && value) {
      entries.push([name, value]);
    }
  }

  return entries;
}

function importFromEnv(pattern?: string): [string, string][] {
  const entries: [string, string][] = [];
  const regex = pattern ? new RegExp(pattern) : null;

  for (const [name, value] of Object.entries(process.env)) {
    if (!value) continue;

    if (regex && !regex.test(name)) {
      continue;
    }

    if (/^[A-Z][A-Z0-9_]*$/.test(name)) {
      entries.push([name, value]);
    }
  }

  return entries;
}
