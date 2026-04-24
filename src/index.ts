// psst SDK — programmatic access to encrypted vaults

export { Vault } from "./vault/vault.js";
export type {
  VaultOptions,
  Secret,
  SecretMeta,
  SecretHistoryEntry,
} from "./vault/vault.js";
export { encrypt, decrypt, keyToBuffer } from "./vault/crypto.js";
export {
  getKey,
  storeKey,
  generateKey,
  isKeychainAvailable,
} from "./vault/keychain.js";
export type { KeychainResult } from "./vault/keychain.js";

// Backend types — useful for SDK consumers who want to introspect the
// active backend or construct a Vault programmatically with AWS settings.
export type { VaultBackend, SecretRecord, SecretMetaRecord, SecretHistoryRecord } from "./vault/backend.js";
export type { BackendType, VaultConfig, AwsBackendConfig } from "./vault/config.js";
export { loadConfig as loadVaultConfig, saveConfig as saveVaultConfig } from "./vault/config.js";
