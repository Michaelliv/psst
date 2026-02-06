import chalk from "chalk";
import { EXIT_USER_ERROR } from "../utils/exit-codes";
import type { OutputOptions } from "../utils/output";
import { getUnlockedVault } from "./common";

export async function history(
  name: string,
  options: OutputOptions = {},
): Promise<void> {
  const vault = await getUnlockedVault(options);

  // Check secret exists
  const secrets = vault.listSecrets();
  const exists = secrets.some((s) => s.name === name);

  if (!exists) {
    vault.close();
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: "not_found", name }));
    } else if (!options.quiet) {
      console.error(chalk.red("✗"), `Secret ${chalk.bold(name)} not found`);
    }
    process.exit(EXIT_USER_ERROR);
  }

  const entries = vault.getHistory(name);
  vault.close();

  if (options.json) {
    console.log(
      JSON.stringify({
        success: true,
        name,
        current: true,
        history: entries.map((e) => ({
          version: e.version,
          tags: e.tags,
          archived_at: e.archived_at,
        })),
      }),
    );
    return;
  }

  if (options.quiet) return;

  console.log();
  console.log(chalk.bold(`History for ${name}`));
  console.log();
  console.log(chalk.green("●"), "current", chalk.dim("(active)"));

  for (const entry of entries) {
    const date = new Date(`${entry.archived_at}Z`);
    const formatted =
      date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }) +
      " " +
      date.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    console.log(chalk.dim("●"), `v${entry.version}`, chalk.dim(formatted));
  }

  console.log();
  if (entries.length > 0) {
    console.log(chalk.dim(`${entries.length} previous version(s)`));
    console.log(chalk.dim(`  Rollback: psst rollback ${name} --to <version>`));
  } else {
    console.log(chalk.dim("No previous versions"));
  }
}
