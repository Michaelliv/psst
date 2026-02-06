import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import chalk from "chalk";
import type { OutputOptions } from "../utils/output";

const PSST_INSTRUCTIONS = `
<psst>
Use \`psst\` for secrets management. Secrets are stored in vaults (local or global) and injected into commands without exposing values.

<commands>
- \`psst <SECRET_NAME> -- <command>\` - Inject specific secret and run command
- \`psst --global <SECRET_NAME> -- <command>\` - Inject from global vault
- \`psst --global run '<full command>'\` - Inject all global secrets (wrap command in single quotes)
- \`psst list\` - List local vault secrets
- \`psst --global list\` - List global vault secrets
- \`psst set <NAME>\` - Add secret to local vault
- \`psst --global set <NAME>\` - Add secret to global vault
</commands>

<examples>
- \`psst STRIPE_KEY -- curl -H "Authorization: Bearer $STRIPE_KEY" https://api.stripe.com\`
- \`psst --global MOTHERDUCK_TOKEN -- duckdb < query.sql\`
- \`psst --global run 'duckdb -c "SELECT 42 as test"'\`
</examples>

<when-to-use>
- Running commands that need API keys, tokens, or credentials
- Querying databases that require auth tokens
- Any command that needs a secret value
</when-to-use>

<gotcha>
\`psst -- <command>\` splits args by shell rules. Semicolons, pipes, and multi-statement commands break.
Two workarounds:
- Pipe from a file: \`psst --global TOKEN -- duckdb < query.sql\`
- Use \`psst run\` with the full command as a single-quoted string: \`psst --global run 'duckdb -c "ATTACH ...; SELECT ..."'\`
  Inner single quotes escape as \`'"'"'\`
</gotcha>

<rules>
- NEVER try to read secrets with \`psst get\` or by other means
- NEVER ask the user to paste secrets into the chat
- ALWAYS use the \`psst SECRET -- command\` pattern
- If a secret is missing, ask the user: "Please run \`psst set SECRET_NAME\` to add it."
- Secret values are automatically redacted in output (replaced with \`[REDACTED]\`)
</rules>
</psst>
`.trim();

const MARKER = "<psst>";

export async function onboard(options: OutputOptions = {}): Promise<void> {
  const claudeDir = join(homedir(), ".claude");
  const targetFile = join(claudeDir, "CLAUDE.md");

  let existingContent = "";
  if (existsSync(targetFile)) {
    existingContent = readFileSync(targetFile, "utf-8");
  }

  // Check if already onboarded - this is idempotent, so it's success
  if (existingContent.includes(MARKER)) {
    if (options.json) {
      console.log(
        JSON.stringify({
          success: true,
          file: targetFile,
          message: "already_onboarded",
        }),
      );
    } else if (!options.quiet) {
      console.log(chalk.green("✓"), "Already onboarded");
      console.log(chalk.dim(`  ${targetFile}`));
    }
    return;
  }

  // Ensure ~/.claude/ exists
  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true });
  }

  if (existingContent) {
    const newContent = `${existingContent.trimEnd()}\n\n${PSST_INSTRUCTIONS}\n`;
    writeFileSync(targetFile, newContent);
  } else {
    writeFileSync(targetFile, `${PSST_INSTRUCTIONS}\n`);
  }

  if (options.json) {
    console.log(JSON.stringify({ success: true, file: targetFile }));
  } else if (!options.quiet) {
    console.log(
      chalk.green("✓"),
      `Added psst instructions to ${chalk.bold(targetFile)}`,
    );
    console.log();
    console.log(chalk.dim("Your agent now knows how to use psst!"));
    console.log();
  }
}
