# Changelog

## 0.1.3 (2025-12-26)

### Features
- Add `--version` / `-v` flag (#1)
- Add import/export from .env files (#2)
  - `psst import <file>` / `--stdin` / `--from-env`
  - `psst export` / `--env-file <file>`
- Fallback to environment variables when secret not in vault (#3)
- Mask/redact secrets in command output (#4)
  - Secrets are replaced with `[REDACTED]` in stdout/stderr
  - Use `--no-mask` to disable for debugging
- Implement lock/unlock for vault encryption at rest (#5)
  - `psst lock` - encrypts vault with password (AES-256-GCM + PBKDF2)
  - `psst unlock` - decrypts vault

### DX Improvements
- Colored output with status indicators (✓/✗/⚠)
- Spinners for async operations (lock, unlock, import)
- `--json` flag on all commands for structured output
- `-q` / `--quiet` flag to suppress output
- Semantic exit codes (0=success, 2=user error, 3=no vault, etc.)
- Helpful hints on errors ("Run: psst init")
- Next steps shown after `psst init`

## 0.1.2
- Initial public release
