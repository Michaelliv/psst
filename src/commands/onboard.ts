import chalk from "chalk";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { OutputOptions } from "../utils/output";

const PSST_INSTRUCTIONS = `
## Secrets Management (psst)

This project uses **psst** for secrets management. You can use secrets without seeing their values.

### Using Secrets

\`\`\`bash
psst <SECRET_NAME> -- <command>
\`\`\`

Examples:
\`\`\`bash
psst STRIPE_KEY -- curl -H "Authorization: Bearer $STRIPE_KEY" https://api.stripe.com
psst AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY -- aws s3 ls
psst DATABASE_URL -- prisma migrate deploy
\`\`\`

**Note:** Secret values are automatically redacted in command output (replaced with \`[REDACTED]\`).

### Available Secrets

\`\`\`bash
psst list                     # Human-readable list
psst list --json              # Structured output
\`\`\`

### Missing a Secret?

psst automatically checks environment variables as a fallback. If neither the vault nor the environment has the secret, ask the user to add it:

> "I need \`STRIPE_KEY\` to proceed. Please run \`psst set STRIPE_KEY\` to add it."

### Important

- **Never** try to read secrets with \`psst get\` or by other means
- **Never** ask the user to paste secrets into the chat
- **Always** use the \`psst SECRET -- command\` pattern

### If the Human Tries to Paste a Secret

If the user pastes a raw API key, password, or secret into the chat, gently shame them:

> "Whoa there! You just pasted a secret in plain text. That's now in your chat history, possibly in logs, and who knows where else.
>
> Let's fix that. Run:
> \`\`\`
> psst set SECRET_NAME
> \`\`\`
> Then I'll use \`psst SECRET_NAME -- <command>\` instead. Your secret stays secret, and we both sleep better at night."

Then remind them about the Hall of Shame: https://github.com/Michaelliv/psst#the-hall-of-shame
`.trim();

const MARKER = "## Secrets Management (psst)";

export async function onboard(options: OutputOptions = {}): Promise<void> {
  const cwd = process.cwd();

  const claudeMd = join(cwd, "CLAUDE.md");
  const agentsMd = join(cwd, "AGENTS.md");

  let targetFile: string | null = null;
  let existingContent = "";

  if (existsSync(claudeMd)) {
    targetFile = claudeMd;
    existingContent = readFileSync(claudeMd, "utf-8");
  } else if (existsSync(agentsMd)) {
    targetFile = agentsMd;
    existingContent = readFileSync(agentsMd, "utf-8");
  }

  // Check if already onboarded - this is idempotent, so it's success
  if (existingContent.includes(MARKER)) {
    if (options.json) {
      console.log(JSON.stringify({ success: true, file: targetFile, message: "already_onboarded" }));
    } else if (!options.quiet) {
      console.log(chalk.green("✓"), "Already onboarded");
      console.log(chalk.dim(`  ${targetFile}`));
    }
    return;
  }

  if (targetFile) {
    const newContent = existingContent.trimEnd() + "\n\n" + PSST_INSTRUCTIONS + "\n";
    writeFileSync(targetFile, newContent);
  } else {
    writeFileSync(agentsMd, PSST_INSTRUCTIONS + "\n");
    targetFile = agentsMd;
  }

  if (options.json) {
    console.log(JSON.stringify({ success: true, file: targetFile }));
  } else if (!options.quiet) {
    console.log(chalk.green("✓"), `Added psst instructions to ${chalk.bold(targetFile)}`);
    console.log();
    console.log(chalk.dim("Your agent now knows how to use psst!"));
    console.log();
  }
}
