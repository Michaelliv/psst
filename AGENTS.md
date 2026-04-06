# AGENTS.md

This file provides guidance to AI coding agents when working with code in this repository.

## Commands

```bash
bun test                          # Run all tests
bun test src/vault/vault.unit.test.ts   # Run a single test file
bun run dev                       # Run CLI locally (bun run src/main.ts)
bun run build                     # Build native binary for current platform
```

## Architecture

psst is an AI-native secrets manager CLI built with Bun + TypeScript. It encrypts secrets locally with AES-256-GCM and injects them into subprocess environments so agents never see secret values.

### Layers

1. **CLI entry** (`src/main.ts`) — Manual arg parsing (no framework), routes to command handlers. Global flags (`--json`, `--quiet`, `--global`, `--env`, `--tag`) are stripped before passing to commands.
2. **Commands** (`src/commands/`) — Each command is an exported async function taking `(args, options: OutputOptions)`. All use `getUnlockedVault()` from `common.ts` for vault access.
3. **Vault** (`src/vault/vault.ts`) — SQLite-backed storage via `bun:sqlite`. Two tables: `secrets` (current values) and `secrets_history` (version history, max 10 per secret). Schema migrations run in `initSchema()` on every open.
4. **Crypto** (`src/vault/crypto.ts`) — AES-256-GCM encryption with random 12-byte IVs. Keys come from OS keychain (`keychain.ts`) or `PSST_PASSWORD` env var fallback.

### Key patterns

- **Output triple**: Every command handles three output modes — `json` (structured), `quiet` (minimal/exit codes only), human (chalk-colored). Use the `output()` helper from `utils/output.ts` or the `if/else if/else` pattern.
- **Exit codes**: Semantic codes in `utils/exit-codes.ts` (0=success, 2=user error, 3=no vault, 5=auth failed).
- **Exec pattern**: `psst SECRET -- cmd` is detected by `--` in args and routed to `exec.ts`. Output masking replaces secret values with `[REDACTED]` in real-time.
- **Vault lifecycle**: `new Vault(path)` → `vault.unlock()` → operate → `vault.close()`. The `getUnlockedVault()` helper handles find + unlock + error messages.
- **Secret names**: Must match `^[A-Z][A-Z0-9_]*$` (validated in `set.ts`).
- **History archival**: `setSecret()` copies raw encrypted bytes to `secrets_history` before overwriting — no decrypt/re-encrypt overhead.
- **Environments**: Vaults live at `.psst/envs/<name>/vault.db`. Legacy path `.psst/vault.db` is supported as "default".


