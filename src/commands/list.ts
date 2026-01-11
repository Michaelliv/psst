import chalk from "chalk";
import { getUnlockedVault } from "./common";
import type { OutputOptions } from "../utils/output";

export async function list(options: OutputOptions = {}): Promise<void> {
  const vault = await getUnlockedVault(options);
  const secrets = vault.listSecrets(options.tags);
  vault.close();

  // JSON output
  if (options.json) {
    console.log(JSON.stringify({
      success: true,
      filter: options.tags || null,
      secrets: secrets.map((s) => ({
        name: s.name,
        tags: s.tags,
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
  const filterMsg = options.tags?.length ? ` (filtered by: ${options.tags.join(", ")})` : "";

  if (secrets.length === 0) {
    console.log(chalk.dim(`\nNo secrets found${filterMsg}.\n`));
    console.log("Add a secret with", chalk.cyan("psst set <NAME>"), "\n");
    return;
  }

  console.log(chalk.bold(`\nSecrets${filterMsg}\n`));
  for (const secret of secrets) {
    const tagStr = secret.tags.length > 0 ? chalk.dim(` [${secret.tags.join(", ")}]`) : "";
    console.log(chalk.green("●"), secret.name + tagStr);
  }
  console.log(chalk.dim(`\n${secrets.length} secret(s)\n`));
}
