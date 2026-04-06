// psst SDK — programmatic access to encrypted vaults

export { Vault } from "./vault/vault";
export type { VaultOptions, Secret, SecretMeta, SecretHistoryEntry } from "./vault/vault";
export { encrypt, decrypt, keyToBuffer } from "./vault/crypto";
export {
  getKey,
  storeKey,
  generateKey,
  isKeychainAvailable,
} from "./vault/keychain";
export type { KeychainResult } from "./vault/keychain";
