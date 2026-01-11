#!/usr/bin/env bun

import { version } from "../package.json";
import { init } from "./commands/init";
import { set } from "./commands/set";
import { get } from "./commands/get";
import { list } from "./commands/list";
import { rm } from "./commands/rm";
import { exec } from "./commands/exec";
import { run } from "./commands/run";
import { onboard } from "./commands/onboard";
import { importSecrets } from "./commands/import";
import { exportSecrets } from "./commands/export";
import { lock } from "./commands/lock";
import { unlock } from "./commands/unlock";
import { listEnvs } from "./commands/list-envs";

const HELP = `
psst - AI-native secrets manager

VAULT MANAGEMENT
  psst init                     Create local vault (.psst/)
  psst init --global            Create global vault (~/.psst/)
  psst init --env <name>        Create vault for specific environment
  psst onboard                  Add psst instructions to CLAUDE.md/AGENTS.md
  psst lock                     Lock vault (encrypt at rest)
  psst unlock                   Unlock vault
  psst list envs                List available environments

SECRET MANAGEMENT
  psst set <NAME> [VALUE]       Set secret (prompt if no value)
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
  psst run <command>              Run command with ALL secrets injected
  psst <NAME> [NAME...] -- <cmd>  Inject specific secrets and run command

OPTIONS
  --no-mask                       Disable output masking (for debugging)

GLOBAL FLAGS
  -g, --global                  Use global vault (~/.psst/) instead of local
  --env <name>                  Use specific environment (default: "default")
  --json                        Output as JSON
  -q, --quiet                   Suppress output, use exit codes

ENVIRONMENT VARIABLES
  PSST_GLOBAL                   Alternative to --global flag (set to "1" or "true")
  PSST_ENV                      Alternative to --env flag

EXAMPLES
  psst init                                               # Create local vault
  psst init --global                                      # Create global vault
  psst set STRIPE_KEY
  psst list
  psst run ./deploy.sh                                    # All secrets injected
  psst STRIPE_KEY -- curl -H "Authorization: $STRIPE_KEY" https://api.stripe.com
  psst --env prod run ./deploy.sh                         # Use prod environment
  psst --global list                                      # List from global vault
`;

async function main() {
  const args = process.argv.slice(2);

  // Parse global flags
  const json = args.includes("--json");
  const quiet = args.includes("--quiet") || args.includes("-q");

  // Parse --global flag or fallback to PSST_GLOBAL
  let global = args.includes("--global") || args.includes("-g");
  if (!global && process.env.PSST_GLOBAL) {
    global = process.env.PSST_GLOBAL === "1" || process.env.PSST_GLOBAL.toLowerCase() === "true";
  }

  // Parse --env flag or fallback to PSST_ENV
  let env: string | undefined;
  const envIndex = args.indexOf("--env");
  if (envIndex !== -1 && args[envIndex + 1] && !args[envIndex + 1].startsWith("-")) {
    env = args[envIndex + 1];
  } else if (process.env.PSST_ENV) {
    env = process.env.PSST_ENV;
  }

  const options = { json, quiet, env, global };

  // Remove global flags from args for command processing
  const cleanArgs = args.filter((a, i) => {
    if (a === "--json" || a === "--quiet" || a === "-q") return false;
    if (a === "--global" || a === "-g") return false;
    if (a === "--env") return false;
    if (i > 0 && args[i - 1] === "--env") return false;
    return true;
  });

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

    await exec(secretNames, cmdArgs, { noMask, env, global });
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

    case "set": {
      if (!cleanArgs[1]) {
        if (json) {
          console.log(JSON.stringify({ success: false, error: "missing_name" }));
        } else if (!quiet) {
          console.error("Error: Secret name required");
          console.error("Usage: psst set <NAME> [VALUE]");
        }
        process.exit(1);
      }
      const setStdin = cleanArgs.includes("--stdin");
      // Value is cleanArgs[2] if it exists and isn't a flag
      const setValue = cleanArgs[2] && !cleanArgs[2].startsWith("-") ? cleanArgs[2] : undefined;
      await set(cleanArgs[1], { ...options, stdin: setStdin, value: setValue });
      break;
    }

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
      if (cleanArgs[1] === "envs") {
        await listEnvs(options);
      } else {
        await list(options);
      }
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

    case "run": {
      const runNoMask = cleanArgs.includes("--no-mask");
      const runCmdArgs = cleanArgs.slice(1).filter((a) => a !== "--no-mask");

      if (runCmdArgs.length === 0) {
        if (json) {
          console.log(JSON.stringify({ success: false, error: "missing_command" }));
        } else if (!quiet) {
          console.error("Error: Command required");
          console.error("Usage: psst run <command>");
        }
        process.exit(1);
      }

      await run(runCmdArgs, { noMask: runNoMask, env, global });
      break;
    }

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
