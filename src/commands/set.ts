import { getUnlockedVault } from "./common";

export async function set(name: string, fromStdin: boolean): Promise<void> {
  // Validate secret name
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
    console.error("Error: Secret name must be uppercase with underscores (e.g., STRIPE_KEY)");
    process.exit(1);
  }

  let value: string;

  if (fromStdin) {
    // Read stdin via stream
    const reader = Bun.stdin.stream().getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      chunks.push(chunk);
    }
    value = new TextDecoder().decode(Buffer.concat(chunks)).trim();
  } else {
    // Interactive prompt (hide input)
    process.stdout.write(`Enter value for ${name}: `);
    value = await readSecretValue();
  }

  if (!value) {
    console.error("Error: Empty value not allowed");
    process.exit(1);
  }

  const vault = await getUnlockedVault();
  await vault.setSecret(name, value);
  vault.close();

  console.log(`Secret '${name}' saved`);
}

async function readSecretValue(): Promise<string> {
  const { spawnSync } = await import("child_process");

  if (!process.stdin.isTTY) {
    // Not a terminal, read from pipe
    const reader = Bun.stdin.stream().getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      chunks.push(chunk);
    }
    return new TextDecoder().decode(Buffer.concat(chunks)).trim();
  }

  // Disable echo for password input
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
