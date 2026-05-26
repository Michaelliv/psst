#!/usr/bin/env node

import { spawn } from "node:child_process";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { expandEnvVars, maskSecrets } from "./commands/exec.js";
import { Vault } from "./vault/vault.js";

const MAX_OUTPUT_BYTES = 100_000;

// ── vault helpers ─────────────────────────────────────────────────────────────

function openVault(opts: {
  global?: boolean;
  env?: string;
}): Vault | null {
  const path = Vault.findVaultPath(opts);
  return path ? new Vault(path) : null;
}

async function unlockVault(opts: {
  global?: boolean;
  env?: string;
}): Promise<Vault> {
  const vault = openVault(opts);
  if (!vault) {
    const scope = opts.global ? "global" : "local";
    throw new Error(
      `No ${scope} psst vault found. Run: psst init${opts.global ? " --global" : ""}`,
    );
  }
  const ok = await vault.unlock();
  if (!ok) {
    throw new Error(
      "Failed to unlock vault — ensure keychain is accessible or set PSST_PASSWORD",
    );
  }
  return vault;
}

// ── subprocess helper ─────────────────────────────────────────────────────────

async function spawnCaptured(
  cmdArgs: string[],
  secrets: Map<string, string>,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const env: Record<string, string | undefined> = {
    ...process.env,
    ...Object.fromEntries(secrets),
  };
  delete env.PSST_PASSWORD;

  const secretValues = Array.from(secrets.values()).filter((v) => v.length > 0);
  const [cmd, ...rest] = cmdArgs;
  const expandedArgs = rest.map((a) => expandEnvVars(a, env));

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, expandedArgs, {
      env: env as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let stdout = "";
    let stderr = "";

    child.stdout!.on("data", (chunk: Buffer) => {
      stdout += maskSecrets(chunk.toString(), secretValues);
      if (stdout.length > MAX_OUTPUT_BYTES)
        stdout = `[...truncated...]\n${stdout.slice(-MAX_OUTPUT_BYTES)}`;
    });

    child.stderr!.on("data", (chunk: Buffer) => {
      stderr += maskSecrets(chunk.toString(), secretValues);
      if (stderr.length > MAX_OUTPUT_BYTES)
        stderr = `[...truncated...]\n${stderr.slice(-MAX_OUTPUT_BYTES)}`;
    });

    child.on("error", (err) => reject(new Error(`Failed to start command: ${err.message}`)));
    child.on("exit", (code) =>
      resolve({ stdout, stderr, exitCode: code ?? 0 }),
    );
  });
}

// ── MCP server ────────────────────────────────────────────────────────────────

const server = new Server(
  { name: "psst", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_secrets",
      description:
        "List secret names stored in the psst vault. Returns names and tags only — never values. Use this to discover which secrets are available before running commands.",
      inputSchema: {
        type: "object",
        properties: {
          global: {
            type: "boolean",
            description: "Use the global vault (~/.psst/) instead of the local project vault. Default: false.",
          },
          env: {
            type: "string",
            description: "Vault environment name (e.g. 'prod', 'staging'). Default: 'default'.",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Filter secrets by tag(s). Only secrets matching ALL tags are returned.",
          },
        },
      },
    },
    {
      name: "run_command",
      description:
        "Run a shell command with ALL secrets from the vault injected as environment variables. Secrets are never exposed in the output — they are masked with [REDACTED]. Use this when the command needs every secret (e.g. a deploy script).",
      inputSchema: {
        type: "object",
        properties: {
          command: {
            type: "array",
            items: { type: "string" },
            description: "Command and arguments as an array, e.g. [\"curl\", \"-H\", \"Authorization: Bearer $API_KEY\", \"https://api.example.com\"]",
          },
          global: {
            type: "boolean",
            description: "Use the global vault. Default: false.",
          },
          env: {
            type: "string",
            description: "Vault environment name. Default: 'default'.",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Only inject secrets matching these tags.",
          },
        },
        required: ["command"],
      },
    },
    {
      name: "exec_command",
      description:
        "Run a shell command with SPECIFIC named secrets injected as environment variables. Prefer this over run_command when you know exactly which secrets the command needs — it follows least-privilege. Secrets are masked in output.",
      inputSchema: {
        type: "object",
        properties: {
          secrets: {
            type: "array",
            items: { type: "string" },
            description: "Names of the secrets to inject (e.g. [\"STRIPE_KEY\", \"DATABASE_URL\"]).",
          },
          command: {
            type: "array",
            items: { type: "string" },
            description: "Command and arguments as an array.",
          },
          global: {
            type: "boolean",
            description: "Use the global vault. Default: false.",
          },
          env: {
            type: "string",
            description: "Vault environment name. Default: 'default'.",
          },
        },
        required: ["secrets", "command"],
      },
    },
    {
      name: "list_environments",
      description:
        "List available vault environments (e.g. 'default', 'prod', 'staging'). Environments are separate isolated vaults under the same .psst/ directory.",
      inputSchema: {
        type: "object",
        properties: {
          global: {
            type: "boolean",
            description: "List environments in the global vault. Default: false (lists local).",
          },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    // ── list_secrets ────────────────────────────────────────────────────────
    if (name === "list_secrets") {
      const vault = await unlockVault({
        global: args.global as boolean | undefined,
        env: args.env as string | undefined,
      });
      const secrets = await vault.listSecrets(args.tags as string[] | undefined);
      vault.close();

      const rows = secrets.map((s) => ({
        name: s.name,
        tags: s.tags,
        updated_at: s.updated_at,
      }));

      return {
        content: [
          {
            type: "text",
            text:
              rows.length === 0
                ? "No secrets found in vault."
                : JSON.stringify(rows, null, 2),
          },
        ],
      };
    }

    // ── run_command ──────────────────────────────────────────────────────────
    if (name === "run_command") {
      const cmdArgs = args.command as string[];
      if (!cmdArgs?.length) throw new Error("command must be a non-empty array");

      const vault = await unlockVault({
        global: args.global as boolean | undefined,
        env: args.env as string | undefined,
      });

      const metas = await vault.listSecrets(args.tags as string[] | undefined);
      const secrets = new Map<string, string>();
      for (const m of metas) {
        const v = await vault.getSecret(m.name);
        if (v !== null) secrets.set(m.name, v);
      }
      vault.close();

      const { stdout, stderr, exitCode } = await spawnCaptured(cmdArgs, secrets);

      return {
        content: [
          {
            type: "text",
            text: formatResult({ stdout, stderr, exitCode }),
          },
        ],
      };
    }

    // ── exec_command ─────────────────────────────────────────────────────────
    if (name === "exec_command") {
      const secretNames = args.secrets as string[];
      const cmdArgs = args.command as string[];
      if (!secretNames?.length) throw new Error("secrets must be a non-empty array");
      if (!cmdArgs?.length) throw new Error("command must be a non-empty array");

      const vault = await unlockVault({
        global: args.global as boolean | undefined,
        env: args.env as string | undefined,
      });

      const fetched = await vault.getSecrets(secretNames);
      vault.close();

      const secrets = new Map<string, string>();
      const missing: string[] = [];
      for (const name of secretNames) {
        const v = fetched.get(name);
        if (v !== undefined) {
          secrets.set(name, v);
        } else if (process.env[name]) {
          secrets.set(name, process.env[name]!);
        } else {
          missing.push(name);
        }
      }

      if (missing.length > 0) {
        throw new Error(`Missing secrets: ${missing.join(", ")}. Add them with: psst set <NAME>`);
      }

      const { stdout, stderr, exitCode } = await spawnCaptured(cmdArgs, secrets);

      return {
        content: [
          {
            type: "text",
            text: formatResult({ stdout, stderr, exitCode }),
          },
        ],
      };
    }

    // ── list_environments ────────────────────────────────────────────────────
    if (name === "list_environments") {
      const isGlobal = args.global as boolean | undefined;
      const envs = Vault.listEnvironments(isGlobal ?? false);

      return {
        content: [
          {
            type: "text",
            text:
              envs.length === 0
                ? `No environments found in the ${isGlobal ? "global" : "local"} vault.`
                : JSON.stringify(envs, null, 2),
          },
        ],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
});

function formatResult(result: {
  stdout: string;
  stderr: string;
  exitCode: number;
}): string {
  const parts: string[] = [];
  if (result.stdout) parts.push(`stdout:\n${result.stdout}`);
  if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
  parts.push(`exit code: ${result.exitCode}`);
  return parts.join("\n");
}

// ── start ─────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
