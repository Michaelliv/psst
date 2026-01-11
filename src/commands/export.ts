import chalk from "chalk";
import { getUnlockedVault } from "./common";
import type { OutputOptions } from "../utils/output";

interface ExportOptions extends OutputOptions {
  envFile?: string;
}

export async function exportSecrets(options: ExportOptions = {}): Promise<void> {
  const vault = await getUnlockedVault(options);
  const secrets = vault.listSecrets();

  if (secrets.length === 0) {
    if (options.json) {
      console.log(JSON.stringify({ success: true, exported: 0 }));
    } else if (!options.quiet) {
      console.log(chalk.dim("No secrets to export"));
    }
    vault.close();
    return;
  }

  const lines: string[] = [];

  for (const secret of secrets) {
    const value = await vault.getSecret(secret.name);
    if (value !== null) {
      const escapedValue = escapeEnvValue(value);
      lines.push(`${secret.name}=${escapedValue}`);
    }
  }

  vault.close();

  const content = lines.join("\n") + "\n";

  if (options.envFile) {
    await Bun.write(options.envFile, content);

    if (options.json) {
      console.log(JSON.stringify({ success: true, exported: secrets.length, file: options.envFile }));
    } else if (!options.quiet) {
      console.log(chalk.green("✓"), `Exported ${chalk.bold(secrets.length)} secret(s) to ${chalk.dim(options.envFile)}`);
    }
  } else {
    // Write to stdout - no decoration
    process.stdout.write(content);

    if (options.json) {
      // JSON mode with stdout export doesn't make sense, but handle it
      console.error(JSON.stringify({ success: true, exported: secrets.length }));
    }
  }
}

export function escapeEnvValue(value: string): string {
  if (
    value.includes(" ") ||
    value.includes('"') ||
    value.includes("'") ||
    value.includes("\n") ||
    value.includes("$") ||
    value.includes("`") ||
    value.includes("\\")
  ) {
    const escaped = value
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\$/g, "\\$")
      .replace(/`/g, "\\`");
    return `"${escaped}"`;
  }

  return value;
}
