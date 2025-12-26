import chalk from "chalk";
import { getUnlockedVault } from "./common";
import { EXIT_USER_ERROR } from "../utils/exit-codes";
import type { OutputOptions } from "../utils/output";

interface SetOptions extends OutputOptions {
  stdin?: boolean;
}

export async function set(name: string, options: SetOptions = {}): Promise<void> {
  // Validate secret name
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: "invalid_name", name }));
    } else if (!options.quiet) {
      console.error(chalk.red("✗"), "Invalid name format");
      console.log(chalk.dim("  Must be uppercase with underscores (e.g., STRIPE_KEY)"));
    }
    process.exit(EXIT_USER_ERROR);
  }

  let value: string;

  if (options.stdin) {
    const reader = Bun.stdin.stream().getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      chunks.push(chunk);
    }
    value = new TextDecoder().decode(Buffer.concat(chunks)).trim();
  } else {
    process.stdout.write(`Enter value for ${chalk.bold(name)}: `);
    value = await readSecretValue();
  }

  if (!value) {
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: "empty_value", name }));
    } else if (!options.quiet) {
      console.error(chalk.red("✗"), "Empty value not allowed");
    }
    process.exit(EXIT_USER_ERROR);
  }

  const vault = await getUnlockedVault();
  await vault.setSecret(name, value);
  vault.close();

  if (options.json) {
    console.log(JSON.stringify({ success: true, name }));
  } else if (!options.quiet) {
    console.log(chalk.green("✓"), `Secret ${chalk.bold(name)} saved`);
  }
}

async function readSecretValue(): Promise<string> {
  const { spawnSync } = await import("child_process");

  if (!process.stdin.isTTY) {
    const reader = Bun.stdin.stream().getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      chunks.push(chunk);
    }
    return new TextDecoder().decode(Buffer.concat(chunks)).trim();
  }

  spawnSync("stty", ["-echo"], { stdio: "inherit" });

  let input = "";
  const reader = Bun.stdin.stream().getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = new TextDecoder().decode(value);
      if (chunk.includes("\n") || chunk.includes("\r")) {
        input += chunk.replace(/[\r\n]/g, "");
        break;
      }
      input += chunk;
    }
  } finally {
    reader.releaseLock();
    spawnSync("stty", ["echo"], { stdio: "inherit" });
    console.log();
  }

  return input;
}
