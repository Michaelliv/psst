import { getUnlockedVault } from "./common";

interface ExportOptions {
  envFile?: string;
}

export async function exportSecrets(options: ExportOptions): Promise<void> {
  const vault = await getUnlockedVault();

  const secrets = vault.listSecrets();

  if (secrets.length === 0) {
    console.error("No secrets to export");
    vault.close();
    return;
  }

  const lines: string[] = [];

  for (const secret of secrets) {
    const value = await vault.getSecret(secret.name);
    if (value !== null) {
      // Escape special characters and wrap in quotes if needed
      const escapedValue = escapeEnvValue(value);
      lines.push(`${secret.name}=${escapedValue}`);
    }
  }

  vault.close();

  const content = lines.join("\n") + "\n";

  if (options.envFile) {
    // Write to file
    await Bun.write(options.envFile, content);
    console.error(`Exported ${secrets.length} secret(s) to ${options.envFile}`);
  } else {
    // Write to stdout
    process.stdout.write(content);
  }
}

function escapeEnvValue(value: string): string {
  // If value contains special characters, wrap in double quotes and escape
  if (
    value.includes(" ") ||
    value.includes('"') ||
    value.includes("'") ||
    value.includes("\n") ||
    value.includes("$") ||
    value.includes("`") ||
    value.includes("\\")
  ) {
    // Escape backslashes, double quotes, and newlines
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
