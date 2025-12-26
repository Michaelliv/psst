// Semantic exit codes for CLI
export const EXIT_SUCCESS = 0;
export const EXIT_ERROR = 1;
export const EXIT_USER_ERROR = 2;  // Invalid input, missing args
export const EXIT_NO_VAULT = 3;    // Vault not found
export const EXIT_LOCKED = 4;      // Vault is locked
export const EXIT_AUTH_FAILED = 5; // Wrong password
