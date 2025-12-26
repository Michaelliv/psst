import { existsSync } from "fs";
import { getUnlockedVault } from "./common";

interface ImportOptions {
  stdin: boolean;
  fromEnv: boolean;
  pattern?: string;
}

export async function importSecrets(
  fileOrArgs: string[],
  options: ImportOptions
): Promise<void> {
  const vault = await getUnlockedVault();

  let entries: [string, string][] = [];

  if (options.fromEnv) {
    // Import from environment variables
    entries = importFromEnv(options.pattern);
  } else if (options.stdin) {
    // Import from stdin
    const content = await readStdin();
    entries = parseEnvContent(content);
  } else {
    // Import from file
    const filePath = fileOrArgs[0];
    if (!filePath) {
      console.error("Error: File path required");
      console.error("Usage: psst import <file>");
      process.exit(1);
    }

    if (!existsSync(filePath)) {
      console.error(`Error: File not found: ${filePath}`);
      process.exit(1);
    }

    const content = await Bun.file(filePath).text();
    entries = parseEnvContent(content);
  }

  if (entries.length === 0) {
    console.log("No secrets to import");
    vault.close();
    return;
  }

  let imported = 0;
  let skipped = 0;

  for (const [name, value] of entries) {
    // Validate secret name format
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
      console.log(`  Skipping '${name}' (invalid name format)`);
      skipped++;
      continue;
    }

    await vault.setSecret(name, value);
    imported++;
  }

  vault.close();

  console.log(`Imported ${imported} secret(s)`);
  if (skipped > 0) {
    console.log(`Skipped ${skipped} entry(ies) with invalid names`);
  }
}

function parseEnvContent(content: string): [string, string][] {
  const entries: [string, string][] = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) {
      continue;
    }

    const name = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Remove surrounding quotes if present
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

    // Skip if pattern provided and doesn't match
    if (regex && !regex.test(name)) {
      continue;
    }

    // Only include uppercase names (typical for secrets)
    if (/^[A-Z][A-Z0-9_]*$/.test(name)) {
      entries.push([name, value]);
    }
  }

  return entries;
}

async function readStdin(): Promise<string> {
  const reader = Bun.stdin.stream().getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  return new TextDecoder().decode(Buffer.concat(chunks));
}
