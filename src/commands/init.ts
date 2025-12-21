import { existsSync } from "fs";
import { join } from "path";
import { Vault } from "../vault/vault";

export async function init(args: string[]): Promise<void> {
  const isLocal = args.includes("--local") || args.includes("-l");
  const vaultPath = Vault.getVaultPath(!isLocal);

  if (existsSync(join(vaultPath, "vault.db"))) {
    console.log(`Vault already exists at ${vaultPath}`);
    return;
  }

  const result = await Vault.initializeVault(vaultPath);

  if (result.success) {
    console.log(`Vault created at ${vaultPath}`);
    console.log("Encryption key stored in system keychain");
  } else {
    console.error(`Failed to create vault: ${result.error}`);
    process.exit(1);
  }
}
