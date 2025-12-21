#!/usr/bin/env bun

import { init } from "./commands/init";
import { set } from "./commands/set";
import { get } from "./commands/get";
import { list } from "./commands/list";
import { rm } from "./commands/rm";
import { exec } from "./commands/exec";

const HELP = `
psst - AI-native secrets manager

VAULT MANAGEMENT
  psst init                     Create vault (~/.psst or .psst/)
  psst lock                     Lock vault
  psst unlock                   Unlock vault

SECRET MANAGEMENT
  psst set <NAME>               Set secret (interactive prompt)
  psst set <NAME> --stdin       Set secret from stdin
  psst get <NAME>               Get secret value (human debugging)
  psst list                     List secret names
  psst list --json              List as JSON (names only, no values)
  psst rm <NAME>                Remove secret

AGENT EXECUTION
  psst <NAME> [NAME...] -- <cmd>   Inject secrets and run command

EXAMPLES
  psst set STRIPE_KEY
  psst list
  psst STRIPE_KEY -- curl -H "Authorization: Bearer $STRIPE_KEY" https://api.stripe.com
  psst AWS_KEY AWS_SECRET -- aws s3 ls
`;

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(HELP);
    process.exit(0);
  }

  const command = args[0];

  // Check if this is the exec pattern: psst SECRET [SECRET...] -- cmd
  const dashDashIndex = args.indexOf("--");
  if (dashDashIndex > 0) {
    const secretNames = args.slice(0, dashDashIndex);
    const cmdArgs = args.slice(dashDashIndex + 1);

    if (cmdArgs.length === 0) {
      console.error("Error: No command specified after --");
      process.exit(1);
    }

    await exec(secretNames, cmdArgs);
    return;
  }

  // Standard commands
  switch (command) {
    case "init":
      await init(args.slice(1));
      break;

    case "set":
      if (!args[1]) {
        console.error("Error: Secret name required");
        console.error("Usage: psst set <NAME>");
        process.exit(1);
      }
      await set(args[1], args.includes("--stdin"));
      break;

    case "get":
      if (!args[1]) {
        console.error("Error: Secret name required");
        console.error("Usage: psst get <NAME>");
        process.exit(1);
      }
      await get(args[1]);
      break;

    case "list":
      await list(args.includes("--json"));
      break;

    case "rm":
    case "remove":
    case "delete":
      if (!args[1]) {
        console.error("Error: Secret name required");
        console.error("Usage: psst rm <NAME>");
        process.exit(1);
      }
      await rm(args[1]);
      break;

    case "lock":
      console.log("TODO: lock");
      break;

    case "unlock":
      console.log("TODO: unlock");
      break;

    default:
      console.error(`Unknown command: ${command}`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
