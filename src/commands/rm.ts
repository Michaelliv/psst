import chalk from "chalk";
import { getUnlockedVault } from "./common";
import { EXIT_USER_ERROR } from "../utils/exit-codes";
import type { OutputOptions } from "../utils/output";

export async function rm(name: string, options: OutputOptions = {}): Promise<void> {
  const vault = await getUnlockedVault(options);
  const removed = vault.removeSecret(name);
  if (removed) {
    vault.clearHistory(name);
  }
  vault.close();

  if (!removed) {
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: "not_found", name }));
    } else if (!options.quiet) {
      console.error(chalk.red("✗"), `Secret ${chalk.bold(name)} not found`);
    }
    process.exit(EXIT_USER_ERROR);
  }

  if (options.json) {
    console.log(JSON.stringify({ success: true, name }));
  } else if (!options.quiet) {
    console.log(chalk.green("✓"), `Secret ${chalk.bold(name)} removed`);
  }
}
