import chalk from "chalk";
import { EXIT_USER_ERROR } from "../utils/exit-codes.js";
import type { OutputOptions } from "../utils/output.js";
import { getUnlockedVault } from "./common.js";

export async function tag(
  args: string[],
  options: OutputOptions = {},
): Promise<void> {
  if (args.length < 2) {
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: "missing_args" }));
    } else if (!options.quiet) {
      console.error(chalk.red("✗"), "Missing arguments");
      console.log(
        chalk.dim("  Usage: psst tag <SECRET_NAME> <tag1> [tag2...]"),
      );
    }
    process.exit(EXIT_USER_ERROR);
  }

  const [name, ...tagsToAdd] = args;

  const vault = await getUnlockedVault(options);

  // Check if secret exists
  const existing = await vault.getTags(name);
  if (existing.length === 0) {
    // Could be no tags or secret doesn't exist - check by listing
    const secrets = await vault.listSecrets();
    const exists = secrets.some((s) => s.name === name);
    if (!exists) {
      vault.close();
      if (options.json) {
        console.log(
          JSON.stringify({ success: false, error: "not_found", name }),
        );
      } else if (!options.quiet) {
        console.error(chalk.red("✗"), `Secret "${name}" not found`);
      }
      process.exit(EXIT_USER_ERROR);
    }
  }

  const success = await vault.addTags(name, tagsToAdd);
  const newTags = await vault.getTags(name);
  vault.close();

  if (options.json) {
    console.log(JSON.stringify({ success, name, tags: newTags }));
  } else if (!options.quiet) {
    console.log(
      chalk.green("✓"),
      `Tags added to ${chalk.bold(name)}: ${tagsToAdd.join(", ")}`,
    );
    if (newTags.length > 0) {
      console.log(chalk.dim(`  All tags: ${newTags.join(", ")}`));
    }
  }
}

export async function untag(
  args: string[],
  options: OutputOptions = {},
): Promise<void> {
  if (args.length < 2) {
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: "missing_args" }));
    } else if (!options.quiet) {
      console.error(chalk.red("✗"), "Missing arguments");
      console.log(
        chalk.dim("  Usage: psst untag <SECRET_NAME> <tag1> [tag2...]"),
      );
    }
    process.exit(EXIT_USER_ERROR);
  }

  const [name, ...tagsToRemove] = args;

  const vault = await getUnlockedVault(options);

  // Check if secret exists
  const secrets = await vault.listSecrets();
  const exists = secrets.some((s) => s.name === name);
  if (!exists) {
    vault.close();
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: "not_found", name }));
    } else if (!options.quiet) {
      console.error(chalk.red("✗"), `Secret "${name}" not found`);
    }
    process.exit(EXIT_USER_ERROR);
  }

  const success = await vault.removeTags(name, tagsToRemove);
  const newTags = await vault.getTags(name);
  vault.close();

  if (options.json) {
    console.log(JSON.stringify({ success, name, tags: newTags }));
  } else if (!options.quiet) {
    console.log(
      chalk.green("✓"),
      `Tags removed from ${chalk.bold(name)}: ${tagsToRemove.join(", ")}`,
    );
    if (newTags.length > 0) {
      console.log(chalk.dim(`  Remaining tags: ${newTags.join(", ")}`));
    }
  }
}
