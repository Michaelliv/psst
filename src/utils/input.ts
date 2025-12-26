import type { OutputOptions } from "./output";

/**
 * Read password from stdin with echo disabled
 */
export async function readPassword(
  prompt: string,
  options: OutputOptions = {}
): Promise<string | null> {
  // Check env var first
  if (process.env.PSST_PASSWORD) {
    return process.env.PSST_PASSWORD;
  }

  // Can't prompt in non-interactive modes
  if (!process.stdin.isTTY || options.quiet || options.json) {
    return null;
  }

  const { spawnSync } = await import("child_process");

  process.stdout.write(prompt);
  spawnSync("stty", ["-echo"], { stdio: "inherit" });

  let input = "";
  const reader = Bun.stdin.stream().getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = new TextDecoder().decode(value);
      if (chunk.includes("\n") || chunk.includes("\r")) {
        input += chunk.replace(/[\r\n]/g, "");
        break;
      }
      input += chunk;
    }
  } finally {
    reader.releaseLock();
    spawnSync("stty", ["echo"], { stdio: "inherit" });
    console.log();
  }

  return input || null;
}

/**
 * Read all content from stdin
 */
export async function readStdin(): Promise<string> {
  const reader = Bun.stdin.stream().getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * Read secret value interactively (with echo disabled) or from stdin
 */
export async function readSecretValue(prompt: string): Promise<string> {
  const { spawnSync } = await import("child_process");

  if (!process.stdin.isTTY) {
    return (await readStdin()).trim();
  }

  process.stdout.write(prompt);
  spawnSync("stty", ["-echo"], { stdio: "inherit" });

  let input = "";
  const reader = Bun.stdin.stream().getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = new TextDecoder().decode(value);
      if (chunk.includes("\n") || chunk.includes("\r")) {
        input += chunk.replace(/[\r\n]/g, "");
        break;
      }
      input += chunk;
    }
  } finally {
    reader.releaseLock();
    spawnSync("stty", ["echo"], { stdio: "inherit" });
    console.log();
  }

  return input;
}
