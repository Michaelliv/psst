import { getUnlockedVault } from "./common";

export async function list(asJson: boolean): Promise<void> {
  const vault = await getUnlockedVault();

  const secrets = vault.listSecrets();
  vault.close();

  if (secrets.length === 0) {
    if (asJson) {
      console.log("[]");
    } else {
      console.log("No secrets stored");
    }
    return;
  }

  if (asJson) {
    // JSON output: names and metadata only, never values
    console.log(
      JSON.stringify(
        secrets.map((s) => ({
          name: s.name,
          created_at: s.created_at,
          updated_at: s.updated_at,
        })),
        null,
        2
      )
    );
  } else {
    // Human-readable output
    console.log("Secrets:");
    for (const secret of secrets) {
      console.log(`  ${secret.name}`);
    }
    console.log(`\n${secrets.length} secret(s)`);
  }
}
