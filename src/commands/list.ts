import chalk from "chalk";
import { getUnlockedVault } from "./common";
import type { OutputOptions } from "../utils/output";

export async function list(options: OutputOptions = {}): Promise<void> {
  const vault = await getUnlockedVault(options);
  const secrets = vault.listSecrets();
  vault.close();

  // JSON output
  if (options.json) {
    console.log(JSON.stringify({
      success: true,
      secrets: secrets.map((s) => ({
        name: s.name,
        created_at: s.created_at,
        updated_at: s.updated_at,
      })),
    }, null, 2));
    return;
  }

  // Quiet output - just names
  if (options.quiet) {
    for (const secret of secrets) {
      console.log(secret.name);
    }
    return;
  }

  // Human output
  if (secrets.length === 0) {
    console.log(chalk.dim("\nNo secrets stored.\n"));
    console.log("Add a secret with", chalk.cyan("psst set <NAME>"), "\n");
    return;
  }

  console.log(chalk.bold("\nSecrets\n"));
  for (const secret of secrets) {
    console.log(chalk.green("●"), secret.name);
  }
  console.log(chalk.dim(`\n${secrets.length} secret(s)\n`));
}
