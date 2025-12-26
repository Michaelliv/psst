import { existsSync, unlinkSync } from "fs";
import { join } from "path";
import { Vault } from "../vault/vault";
import { decryptFile } from "../vault/crypto";
import { storeKey, generateKey } from "../vault/keychain";

const DB_NAME = "vault.db";
const LOCKED_NAME = "vault.db.locked";

export async function unlock(): Promise<void> {
  const vaultPath = Vault.findVaultPath();

  // For unlock, we need to check for locked vault even if no unlocked vault exists
  let checkPath = vaultPath;
  if (!checkPath) {
    // Try to find a locked vault
    const { homedir } = await import("os");
    const globalPath = join(homedir(), ".psst");
    const localPath = join(process.cwd(), ".psst");

    if (existsSync(join(localPath, LOCKED_NAME))) {
      checkPath = localPath;
    } else if (existsSync(join(globalPath, LOCKED_NAME))) {
      checkPath = globalPath;
    }
  }

  if (!checkPath) {
    console.error("No vault found. Run 'psst init' first.");
    process.exit(1);
  }

  const dbPath = join(checkPath, DB_NAME);
  const lockedPath = join(checkPath, LOCKED_NAME);

  if (existsSync(dbPath)) {
    console.log("Vault is already unlocked.");
    return;
  }

  if (!existsSync(lockedPath)) {
    console.error("No locked vault found.");
    process.exit(1);
  }

  // Get password
  const password = await getPassword();
  if (!password) {
    console.error("Error: Password required to unlock vault");
    process.exit(1);
  }

  // Read encrypted file
  const encryptedData = await Bun.file(lockedPath).arrayBuffer();

  // Decrypt it
  let decrypted: Buffer;
  try {
    decrypted = await decryptFile(Buffer.from(encryptedData), password);
  } catch (err) {
    console.error("Error: Invalid password or corrupted vault");
    process.exit(1);
  }

  // Write decrypted database
  await Bun.write(dbPath, decrypted);

  // Delete encrypted file
  unlinkSync(lockedPath);

  // Store a new key in keychain for future operations
  const key = generateKey();
  await storeKey(key);

  console.log("Vault unlocked.");
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

  process.stdout.write("Enter unlock password: ");
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
