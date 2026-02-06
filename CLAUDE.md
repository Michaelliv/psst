# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
- **Exit codes**: Semantic codes in `utils/exit-codes.ts` (0=success, 2=user error, 3=no vault, 4=locked, 5=auth failed).
- **Exec pattern**: `psst SECRET -- cmd` is detected by `--` in args and routed to `exec.ts`. Output masking replaces secret values with `[REDACTED]` in real-time.
- **Vault lifecycle**: `new Vault(path)` → `vault.unlock()` → operate → `vault.close()`. The `getUnlockedVault()` helper handles find + unlock + error messages.
- **Secret names**: Must match `^[A-Z][A-Z0-9_]*$` (validated in `set.ts`).
- **History archival**: `setSecret()` copies raw encrypted bytes to `secrets_history` before overwriting — no decrypt/re-encrypt overhead.
- **Environments**: Vaults live at `.psst/envs/<name>/vault.db`. Legacy path `.psst/vault.db` is supported as "default".

### Adding a new command

1. Create `src/commands/<name>.ts` exporting an async function
2. Import and add a `case` in `src/main.ts`'s switch statement
3. Add help text to the `HELP` constant in `main.ts`
4. Follow the existing pattern: validate input → `getUnlockedVault()` → operate → `vault.close()` → output

<mental>
Use `mental` to maintain the mental model as you work on the codebase.

<commands>
- `mental add domain <name>` - Add a domain (core business concept)
- `mental add capability <name>` - Add a capability (what the system does)
- `mental add aspect <name>` - Add an aspect (cross-cutting concern)
- `mental add decision <what> --why <reason>` - Record a decision
- `mental update <type> <name|id>` - Update an entity (--desc, --files, --relates-to, etc.)
- `mental supersede decision <id>` - Replace a decision with a new one (keeps history)
- `mental show` - Display the current model
- `mental view` - Open interactive visualization
</commands>

<when-to-use>
- After adding a new feature or module
- After making an architectural decision
- When introducing a new domain concept
- When adding cross-cutting concerns (auth, logging, caching)
- When the user asks to update the mental model
</when-to-use>

<guidelines>
- Domains are nouns (User, Order, Payment)
- Capabilities are verbs (Checkout, ProcessPayment, SendNotification)
- Aspects apply across capabilities (Auth, Validation, RateLimit)
- Decisions capture the "why" behind choices
- Link decisions to related entities with --relates-to
- Attach documentation with --docs (local paths or URLs)
</guidelines>
</mental>
