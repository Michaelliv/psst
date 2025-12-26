import { existsSync, unlinkSync } from "fs";
import { join } from "path";
import { Vault } from "../vault/vault";
import { encryptFile } from "../vault/crypto";
import { deleteKey } from "../vault/keychain";

const DB_NAME = "vault.db";
const LOCKED_NAME = "vault.db.locked";

export async function lock(): Promise<void> {
  const vaultPath = Vault.findVaultPath();

  if (!vaultPath) {
    console.error("No vault found. Run 'psst init' first.");
    process.exit(1);
  }

  const dbPath = join(vaultPath, DB_NAME);
  const lockedPath = join(vaultPath, LOCKED_NAME);

  if (!existsSync(dbPath)) {
    if (existsSync(lockedPath)) {
      console.log("Vault is already locked.");
      return;
    }
    console.error("Vault database not found.");
    process.exit(1);
  }

  // Get password
  const password = await getPassword();
  if (!password) {
    console.error("Error: Password required to lock vault");
    process.exit(1);
  }

  // Read vault database
  const dbData = await Bun.file(dbPath).arrayBuffer();

  // Encrypt it
  const encrypted = await encryptFile(Buffer.from(dbData), password);

  // Write encrypted file
  await Bun.write(lockedPath, encrypted);

  // Delete unencrypted database
  unlinkSync(dbPath);

  // Remove key from keychain
  await deleteKey();

  console.log("Vault locked.");
}

async function getPassword(): Promise<string | null> {
  // Check env var first
  if (process.env.PSST_PASSWORD) {
    return process.env.PSST_PASSWORD;
  }

  // Interactive prompt
  if (!process.stdin.isTTY) {
    return null;
  }

  const { spawnSync } = await import("child_process");

  process.stdout.write("Enter lock password: ");
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
