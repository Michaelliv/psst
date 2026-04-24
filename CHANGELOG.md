# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] — pluggable storage backends

### Added
- **AWS Secrets Manager backend.** New `psst init --backend aws [--aws-region ...] [--aws-prefix ...] [--aws-profile ...]` creates a vault whose secrets live in AWS Secrets Manager instead of a local SQLite database. All commands (`set`, `get`, `list`, `rm`, `tag`, `untag`, `history`, `rollback`, `run`, `exec`, `export`, `scan`) work transparently with either backend.
- **`VaultBackend` interface** (`src/vault/backend.ts`) and two implementations:
  - `SqliteBackend` — the original local encrypted SQLite storage (default).
  - `AwsBackend` — AWS Secrets Manager, server-side KMS encryption, native versioning, resource-tag-based filtering, zero-config on EC2 via IAM roles.
- **Per-vault `config.json`** selects the backend and holds backend-specific settings. Missing file → default SQLite (fully backwards compatible with existing vaults).
- Region resolution order: `config.aws.region` → `AWS_REGION` → `AWS_DEFAULT_REGION`.
- Secret name prefixing (default `psst/`) so AWS namespacing is configurable, with `psst:managed=true` resource tagging so psst never lists or modifies unrelated secrets in your AWS account.
- Batched reads (`BatchGetSecretValue`, 20 names per request) for `psst run` / `psst exec` with many secrets.
- Graceful recovery when `psst rm X && psst set X` hits AWS's ~15-second scheduled-deletion window: the backend attempts `RestoreSecret` and retries.

### Changed — **BREAKING** (SDK consumers)
Several `Vault` methods that were previously synchronous are now `async` to
accommodate network-backed backends. All CLI commands have been updated, but
**programmatic SDK consumers must add `await` at the call sites**:

| Method              | Before                 | After                          |
|---------------------|------------------------|--------------------------------|
| `listSecrets()`     | `SecretMeta[]`         | `Promise<SecretMeta[]>`        |
| `getTags()`         | `string[]`             | `Promise<string[]>`            |
| `setTags()`         | `boolean`              | `Promise<boolean>`             |
| `addTags()`         | `boolean`              | `Promise<boolean>`             |
| `removeTags()`      | `boolean`              | `Promise<boolean>`             |
| `getHistory()`      | `SecretHistoryEntry[]` | `Promise<SecretHistoryEntry[]>`|
| `clearHistory()`    | `void`                 | `Promise<void>`                |
| `removeSecret()`    | `boolean`              | `Promise<boolean>`             |

`setSecret`, `getSecret`, `getSecrets`, `getHistoryVersion`, and `rollback`
were already async and are unchanged.

### Added — SDK exports
- `VaultBackend`, `SecretRecord`, `SecretMetaRecord`, `SecretHistoryRecord`
- `BackendType`, `VaultConfig`, `AwsBackendConfig`
- `loadVaultConfig`, `saveVaultConfig`

### Fixed
- `psst history` now formats timestamps correctly for both SQLite's
  `YYYY-MM-DD HH:MM:SS` and AWS's ISO-8601 formats. Previously the SQLite
  path appended a `Z` unconditionally, producing "Invalid Date" on AWS.
- `psst tag` / `psst untag` no longer create spurious AWS history entries.
  Previous implementations rewrote the SecretString envelope on every tag
  change, which AWS logs as a new version.
- `psst rm X && psst set X` with the AWS backend no longer fails inside the
  ~15-second scheduled-for-deletion window.
- AWS backend rollback now restores the **historical version's tags**, matching
  SQLite semantics, instead of preserving current tags.
- AWS backend no longer mutates `process.env.AWS_PROFILE` (previously leaked
  into child processes spawned by `psst run` / `psst exec`). Users requesting
  `--aws-profile` must install `@aws-sdk/credential-providers` (clear error
  otherwise).
- `psst init --backend <unknown>` now errors out explicitly instead of
  silently defaulting to SQLite.
- `ListSecretVersionIds` is now paginated, so history and rollback work
  correctly for secrets with more than one page of versions.
- Internal type shapes preserved as `interface` (not `type` aliases) so
  declaration merging still works for SDK consumers augmenting the types.
