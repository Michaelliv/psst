import chalk from "chalk";
import { EXIT_USER_ERROR } from "../utils/exit-codes";
import type { OutputOptions } from "../utils/output";
import { getUnlockedVault } from "./common";

export async function get(
  name: string,
  options: OutputOptions = {},
): Promise<void> {
  const vault = await getUnlockedVault(options);
  const value = await vault.getSecret(name);
  vault.close();

  if (value === null) {
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: "not_found", name }));
    } else if (!options.quiet) {
      console.error(chalk.red("✗"), `Secret ${chalk.bold(name)} not found`);
    }
    process.exit(EXIT_USER_ERROR);
  }

  if (options.json) {
    console.log(JSON.stringify({ success: true, name, value }));
  } else {
    // Both quiet and human output just print the value
    console.log(value);
  }
}
