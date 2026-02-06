import chalk from "chalk";
import { getUnlockedVault } from "./common";
import { EXIT_USER_ERROR } from "../utils/exit-codes";
import type { OutputOptions } from "../utils/output";

export async function rollback(
  name: string,
  targetVersion: number,
  options: OutputOptions = {}
): Promise<void> {
  if (!Number.isInteger(targetVersion) || targetVersion < 1) {
    if (options.json) {
      console.log(
        JSON.stringify({ success: false, error: "invalid_version", message: "--to must be a positive integer" })
      );
    } else if (!options.quiet) {
      console.error(chalk.red("✗"), "--to must be a positive integer");
    }
    process.exit(EXIT_USER_ERROR);
  }

  const vault = await getUnlockedVault(options);
  const success = await vault.rollback(name, targetVersion);
  vault.close();

  if (!success) {
    if (options.json) {
      console.log(
        JSON.stringify({ success: false, error: "rollback_failed", name, version: targetVersion })
      );
    } else if (!options.quiet) {
      console.error(
        chalk.red("✗"),
        `Cannot rollback ${chalk.bold(name)} to v${targetVersion} (secret or version not found)`
      );
    }
    process.exit(EXIT_USER_ERROR);
  }

  if (options.json) {
    console.log(JSON.stringify({ success: true, name, restored_version: targetVersion }));
  } else if (!options.quiet) {
    console.log(
      chalk.green("✓"),
      `Rolled back ${chalk.bold(name)} to v${targetVersion}`
    );
  }
}
