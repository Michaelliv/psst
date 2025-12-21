import { getUnlockedVault } from "./common";

export async function get(name: string): Promise<void> {
  const vault = await getUnlockedVault();

  const value = await vault.getSecret(name);
  vault.close();

  if (value === null) {
    console.error(`Secret '${name}' not found`);
    process.exit(1);
  }

  // Print value (human debugging only - discouraged for agents)
  console.log(value);
}
