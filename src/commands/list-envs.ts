import chalk from "chalk";
import type { OutputOptions } from "../utils/output";
import { Vault } from "../vault/vault";

export async function listEnvs(options: OutputOptions = {}): Promise<void> {
  const globalEnvs = Vault.listEnvironments(true);
  const localEnvs = Vault.listEnvironments(false);

  if (options.json) {
    console.log(
      JSON.stringify({
        success: true,
        global: globalEnvs,
        local: localEnvs,
      }),
    );
    return;
  }

  if (options.quiet) {
    const allEnvs = [...new Set([...globalEnvs, ...localEnvs])];
    for (const env of allEnvs) {
      console.log(env);
    }
    return;
  }

  // Human output
  if (globalEnvs.length === 0 && localEnvs.length === 0) {
    console.log();
    console.log(chalk.dim("No environments found."));
    console.log();
    console.log(
      "Create one with",
      chalk.cyan("psst init"),
      "(local) or",
      chalk.cyan("psst init --global"),
      "(global)",
    );
    console.log();
    return;
  }

  if (globalEnvs.length > 0) {
    console.log();
    console.log(chalk.bold("Global Environments"));
    console.log();
    for (const env of globalEnvs) {
      console.log(chalk.green("●"), env);
    }
  }

  if (localEnvs.length > 0) {
    console.log();
    console.log(chalk.bold("Local Environments"));
    console.log();
    for (const env of localEnvs) {
      console.log(chalk.green("●"), env);
    }
  }

  console.log();
}
