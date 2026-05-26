import { createInterface } from "node:readline";
import type { OutputOptions } from "./output.js";

/**
 * Read password from stdin with echo disabled
 */
export async function readPassword(
  prompt: string,
  options: OutputOptions = {},
): Promise<string | null> {
  // Check env var first
  if (process.env.PSST_PASSWORD) {
    return process.env.PSST_PASSWORD;
  }

  // Can't prompt in non-interactive modes
  if (!process.stdin.isTTY || options.quiet || options.json) {
    return null;
  }

  const { spawnSync } = await import("node:child_process");

  process.stdout.write(prompt);
  spawnSync("stty", ["-echo"], { stdio: "inherit" });

  let input = "";
  try {
    const rl = createInterface({ input: process.stdin, terminal: false });
    input = await new Promise<string>((resolve) => {
      rl.once("line", (line) => {
        rl.close();
        resolve(line);
      });
    });
  } finally {
    spawnSync("stty", ["echo"], { stdio: "inherit" });
    console.log();
  }

  return input || null;
}

/**
 * Read all content from stdin
 */
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

/**
 * Read secret value interactively (with echo disabled) or from stdin
 */
export async function readSecretValue(prompt: string): Promise<string> {
  const { spawnSync } = await import("node:child_process");

  if (!process.stdin.isTTY) {
    return (await readStdin()).trim();
  }

  process.stdout.write(prompt);
  spawnSync("stty", ["-echo"], { stdio: "inherit" });

  let input = "";
  try {
    const rl = createInterface({ input: process.stdin, terminal: false });
    input = await new Promise<string>((resolve) => {
      rl.once("line", (line) => {
        rl.close();
        resolve(line);
      });
    });
  } finally {
    spawnSync("stty", ["echo"], { stdio: "inherit" });
    console.log();
  }

  return input;
}
