import { Vault } from "../vault/vault";

export async function getUnlockedVault(): Promise<Vault> {
  const vaultPath = Vault.findVaultPath();

  if (!vaultPath) {
    console.error("No vault found. Run 'psst init' first.");
    process.exit(1);
  }

  const vault = new Vault(vaultPath);
  const success = await vault.unlock();

  if (!success) {
    console.error("Failed to unlock vault.");
    console.error("Ensure keychain is available or set PSST_PASSWORD env var.");
    process.exit(1);
  }

  return vault;
}
