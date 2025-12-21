import { getUnlockedVault } from "./common";

export async function rm(name: string): Promise<void> {
  const vault = await getUnlockedVault();

  const removed = vault.removeSecret(name);
  vault.close();

  if (removed) {
    console.log(`Secret '${name}' removed`);
  } else {
    console.error(`Secret '${name}' not found`);
    process.exit(1);
  }
}
