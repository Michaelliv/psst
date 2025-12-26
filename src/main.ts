#!/usr/bin/env bun

import { version } from "../package.json";
import { init } from "./commands/init";
import { set } from "./commands/set";
import { get } from "./commands/get";
import { list } from "./commands/list";
import { rm } from "./commands/rm";
import { exec } from "./commands/exec";
import { onboard } from "./commands/onboard";
import { importSecrets } from "./commands/import";
import { exportSecrets } from "./commands/export";
import { lock } from "./commands/lock";
import { unlock } from "./commands/unlock";

const HELP = `
psst - AI-native secrets manager

VAULT MANAGEMENT
  psst init                     Create vault (~/.psst or .psst/)
  psst onboard                  Add psst instructions to CLAUDE.md/AGENTS.md
  psst lock                     Lock vault (encrypt at rest)
  psst unlock                   Unlock vault

SECRET MANAGEMENT
  psst set <NAME>               Set secret (interactive prompt)
  psst set <NAME> --stdin       Set secret from stdin
  psst get <NAME>               Get secret value (human debugging)
  psst list                     List secret names
  psst rm <NAME>                Remove secret

IMPORT/EXPORT
  psst import <file>            Import secrets from .env file
  psst import --stdin           Import secrets from stdin
  psst import --from-env        Import from environment variables
  psst export                   Export secrets to stdout (.env format)
  psst export --env-file <f>    Export secrets to file

AGENT EXECUTION
  psst <NAME> [NAME...] -- <cmd>   Inject secrets and run command
  psst --no-mask <NAME> -- <cmd>   Disable output masking (for debugging)

GLOBAL FLAGS
  --json                        Output as JSON
  -q, --quiet                   Suppress output, use exit codes

EXAMPLES
  psst set STRIPE_KEY
  psst list
  psst STRIPE_KEY -- curl -H "Authorization: Bearer $STRIPE_KEY" https://api.stripe.com
  psst AWS_KEY AWS_SECRET -- aws s3 ls
`;

async function main() {
  const args = process.argv.slice(2);

  // Parse global flags
  const json = args.includes("--json");
  const quiet = args.includes("--quiet") || args.includes("-q");
  const options = { json, quiet };

  // Remove global flags from args for command processing
  const cleanArgs = args.filter(a => a !== "--json" && a !== "--quiet" && a !== "-q");

  if (cleanArgs.length === 0 || cleanArgs[0] === "--help" || cleanArgs[0] === "-h") {
    if (!quiet) console.log(HELP);
    process.exit(0);
  }

  if (cleanArgs[0] === "--version" || cleanArgs[0] === "-v") {
    if (json) {
      console.log(JSON.stringify({ version }));
    } else if (!quiet) {
      console.log(`psst ${version}`);
    }
    process.exit(0);
  }

  const command = cleanArgs[0];

  // Check if this is the exec pattern: psst SECRET [SECRET...] -- cmd
  const dashDashIndex = cleanArgs.indexOf("--");
  if (dashDashIndex > 0) {
    const noMask = cleanArgs.includes("--no-mask");
    const secretNames = cleanArgs
      .slice(0, dashDashIndex)
      .filter((a) => a !== "--no-mask");
    const cmdArgs = cleanArgs.slice(dashDashIndex + 1);

    if (cmdArgs.length === 0) {
      console.error("Error: No command specified after --");
      process.exit(1);
    }

    await exec(secretNames, cmdArgs, { noMask });
    return;
  }

  // Standard commands
  switch (command) {
    case "init":
      await init(cleanArgs.slice(1), options);
      break;

    case "onboard":
      await onboard(options);
      break;

    case "set":
      if (!cleanArgs[1]) {
        if (json) {
          console.log(JSON.stringify({ success: false, error: "missing_name" }));
        } else if (!quiet) {
          console.error("Error: Secret name required");
          console.error("Usage: psst set <NAME>");
        }
        process.exit(1);
      }
      await set(cleanArgs[1], { ...options, stdin: cleanArgs.includes("--stdin") });
      break;

    case "get":
      if (!cleanArgs[1]) {
        if (json) {
          console.log(JSON.stringify({ success: false, error: "missing_name" }));
        } else if (!quiet) {
          console.error("Error: Secret name required");
          console.error("Usage: psst get <NAME>");
        }
        process.exit(1);
      }
      await get(cleanArgs[1], options);
      break;

    case "list":
      await list(options);
      break;

    case "rm":
    case "remove":
    case "delete":
      if (!cleanArgs[1]) {
        if (json) {
          console.log(JSON.stringify({ success: false, error: "missing_name" }));
        } else if (!quiet) {
          console.error("Error: Secret name required");
          console.error("Usage: psst rm <NAME>");
        }
        process.exit(1);
      }
      await rm(cleanArgs[1], options);
      break;

    case "import": {
      const fromStdin = cleanArgs.includes("--stdin");
      const fromEnv = cleanArgs.includes("--from-env");
      const patternIndex = cleanArgs.indexOf("--pattern");
      const pattern = patternIndex !== -1 ? cleanArgs[patternIndex + 1] : undefined;

      const fileArgs = cleanArgs.slice(1).filter(
        (a) => !a.startsWith("--") && a !== pattern
      );

      await importSecrets(fileArgs, { ...options, stdin: fromStdin, fromEnv, pattern });
      break;
    }

    case "export": {
      const envFileIndex = cleanArgs.indexOf("--env-file");
      const envFile = envFileIndex !== -1 ? cleanArgs[envFileIndex + 1] : undefined;

      await exportSecrets({ ...options, envFile });
      break;
    }

    case "lock":
      await lock(options);
      break;

    case "unlock":
      await unlock(options);
      break;

    default:
      if (json) {
        console.log(JSON.stringify({ success: false, error: "unknown_command", command }));
      } else {
        console.error(`Unknown command: ${command}`);
        console.log(HELP);
      }
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
