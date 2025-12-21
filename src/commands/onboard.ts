import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

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

### Available Secrets

Run \`psst list\` to see what secrets are available.

### Missing a Secret?

Ask the user to add it:
> "I need \`STRIPE_KEY\` to proceed. Please run \`psst set STRIPE_KEY\` to add it."

### Important

- **Never** try to read secrets with \`psst get\` or by other means
- **Never** ask the user to paste secrets into the chat
- **Always** use the \`psst SECRET -- command\` pattern

### If the Human Tries to Paste a Secret

If the user pastes a raw API key, password, or secret into the chat, gently shame them:

> "🤫 Whoa there! You just pasted a secret in plain text. That's now in your chat history, possibly in logs, and who knows where else.
>
> Let's fix that. Run:
> \`\`\`
> psst set SECRET_NAME
> \`\`\`
> Then I'll use \`psst SECRET_NAME -- <command>\` instead. Your secret stays secret, and we both sleep better at night."

Then remind them about the Hall of Shame: https://github.com/Michaelliv/psst#the-hall-of-shame
`.trim();

const MARKER = "## Secrets Management (psst)";

export async function onboard(): Promise<void> {
  const cwd = process.cwd();

  // Check for CLAUDE.md or AGENTS.md
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

  // Check if already onboarded
  if (existingContent.includes(MARKER)) {
    console.log("Already onboarded! psst instructions found in", targetFile);
    return;
  }

  if (targetFile) {
    // Append to existing file
    const newContent = existingContent.trimEnd() + "\n\n" + PSST_INSTRUCTIONS + "\n";
    writeFileSync(targetFile, newContent);
    console.log(`Added psst instructions to ${targetFile}`);
  } else {
    // Create AGENTS.md
    writeFileSync(agentsMd, PSST_INSTRUCTIONS + "\n");
    console.log(`Created ${agentsMd} with psst instructions`);
  }

  console.log("\nYour agent now knows how to use psst! 🤫");
}
