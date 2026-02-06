# psst 🤫

[![Tests](https://img.shields.io/github/actions/workflow/status/Michaelliv/psst/ci.yml?label=Tests&color=brightgreen)](https://github.com/Michaelliv/psst/actions/workflows/ci.yml) [![codecov](https://codecov.io/gh/Michaelliv/psst/branch/main/graph/badge.svg?token=DTPTV090HF)](https://codecov.io/gh/Michaelliv/psst) [![License](https://img.shields.io/badge/License-MIT-yellow)](https://opensource.org/licenses/MIT)

**Because your agent doesn't need to know your secrets.**

---

## The Hall of Shame

I keep pasting API keys into Claude Code. Or just letting it `cat .env`. Every time I tell myself I'll stop doing that. I never do.

```bash
# "just read the .env"
cat .env

# "here, use this key"
sk-live-4wB7xK9mN2pL8qR3...
```

Your secrets are now:
- 📜 In the model's context window
- 📟 In your terminal history
- 📁 In that log file you forgot about
- 🎓 Training data (maybe?)
- 📸 Screenshot material for your coworker's Slack

**There's a better way.**

---

## What if agents could *use* secrets without *seeing* them?

```bash
# Agent writes this:
psst STRIPE_KEY -- curl -H "Authorization: Bearer $STRIPE_KEY" https://api.stripe.com

# What the agent sees:
# ✅ Command executed successfully

# What actually ran:
# curl -H "Authorization: Bearer sk_live_abc123..." https://api.stripe.com
```

The secret never touches the agent's context. It's injected into the subprocess environment at runtime.

**The agent orchestrates. psst handles the secrets.**

---

## For Humans

You set up psst once. Then your agent handles the rest.

### Installation

```bash
npm install -g @pssst/cli
```

### Setup (one-time)

```bash
# Create vault (stores encryption key in your OS keychain)
psst init

# Add your secrets
psst set STRIPE_KEY          # Interactive prompt, value hidden
psst set OPENAI_API_KEY
psst set DATABASE_URL

# Verify
psst list
```

That's it. Now onboard your agent:

```bash
psst onboard
```

This adds psst instructions to your `CLAUDE.md` or `AGENTS.md` file, teaching your agent:
- How to use `psst SECRET -- command`
- To ask you to add missing secrets
- To **shame you** if you try to paste secrets in plain text 🤫

### Managing Secrets

```bash
psst set <NAME>               # Add/update secret (interactive)
psst set <NAME> --stdin       # Pipe value in (for scripts)
psst get <NAME>               # View value (debugging only)
psst list                     # List all secret names
psst rm <NAME>                # Delete secret

# Import/export
psst import .env              # Import from .env file
psst import --stdin           # Import from stdin
psst import --from-env        # Import from environment variables
psst export                   # Export to stdout (.env format)
psst export --env-file .env   # Export to file

# Vault encryption (for backups/travel)
psst lock                     # Encrypt vault at rest with password
psst unlock                   # Decrypt vault
```

### Environments

Organize secrets by environment (dev/staging/prod):

```bash
psst init --env prod          # Create vault for "prod" environment
psst --env prod set API_KEY   # Set secret in prod
psst --env prod list          # List secrets in prod
psst --env prod API_KEY -- curl https://api.example.com

# List all environments
psst list envs
```

Environments are stored in `~/.psst/envs/<name>/vault.db`.

You can also use the `PSST_ENV` environment variable:
```bash
export PSST_ENV=prod
psst list                     # Uses prod environment
```

**Note:** Existing vaults at `~/.psst/vault.db` continue to work as the "default" environment.

### Global Flags

All commands support:
```bash
-g, --global                  # Use global vault (~/.psst/)
--env <name>                  # Use specific environment
--tag <name>                  # Filter by tag (repeatable)
--json                        # Structured JSON output
-q, --quiet                   # Suppress output, use exit codes
```

### Local vs Global Vaults

By default, psst creates a **local vault** in your project directory:

```bash
psst init                     # Creates .psst/ in current directory
psst init --env dev           # Creates .psst/envs/dev/ in current directory
```

For user-wide secrets, use the global vault:

```bash
psst init --global            # Creates ~/.psst/
psst --global set API_KEY     # Store in global vault
psst --global list            # List global secrets
```

### Secret Scanning

Prevent accidentally committing secrets to git:

```bash
# Scan files for leaked secrets
psst scan                     # Scan all tracked files
psst scan --staged            # Scan only git staged files
psst scan --path ./src        # Scan specific directory

# Install pre-commit hook (runs scan automatically)
psst install-hook
```

The scanner checks for **actual vault secret values** — no regex false positives. If a secret is found:

```
✗ Secrets found in files:

  config.js:12
    Contains: STRIPE_KEY

Found 1 secret(s) in 1 file(s)
  Tip: Use PSST_SKIP_SCAN=1 git commit to bypass
```

Bypass the hook when needed:
```bash
PSST_SKIP_SCAN=1 git commit -m "message"
# or
git commit --no-verify
```

### Secret History & Rollback

Accidentally overwritten a secret? psst keeps the last 10 versions automatically.

```bash
# View version history
psst history API_KEY

# History for API_KEY
#
# ● current (active)
# ● v2  01/15/2026 14:30
# ● v1  01/10/2026 09:15
#
# 2 previous version(s)
#   Rollback: psst rollback API_KEY --to <version>

# Restore a previous version
psst rollback API_KEY --to 1
# ✓ Rolled back API_KEY to v1
```

Rollback is reversible — the current value is archived before restoring, so you can always undo.

### Secret Tags

Organize secrets with tags for easier management:

```bash
# Add tags when setting secrets
psst set AWS_KEY --tag aws --tag prod
psst set STRIPE_KEY --tag payments --tag prod

# Manage tags on existing secrets
psst tag DB_URL prod                  # Add tag
psst untag DB_URL dev                 # Remove tag

# List secrets filtered by tag
psst list --tag aws                   # Only aws-tagged secrets
psst list --tag prod                  # Only prod-tagged secrets

# Run commands with tagged secrets only
psst --tag aws -- aws s3 ls           # Inject only aws-tagged secrets
psst --tag prod run ./deploy.sh       # Run with only prod secrets
```

Tags use OR logic when filtering — `psst list --tag aws --tag payments` returns secrets with either tag.

---

## For Agents

**You don't read secrets. You use them.**

### The Simple Way

```bash
psst run <command>
```

This injects **all** vault secrets into the command's environment. You never see the values.

```bash
# Run any command with all secrets available
psst run ./deploy.sh
psst run python my_script.py
psst run docker-compose up
```

### Specific Secrets

If you only need certain secrets:

```bash
psst <SECRET_NAME> [SECRET_NAME...] -- <command>
```

```bash
# Single secret
psst STRIPE_KEY -- curl -H "Authorization: Bearer $STRIPE_KEY" https://api.stripe.com

# Multiple secrets
psst AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY -- aws s3 ls
```

### What You Get Back

- Exit code of the command
- stdout/stderr of the command (with secrets automatically redacted)
- **Not** the secret value

Secrets are automatically replaced with `[REDACTED]` in command output. Use `--no-mask` if you need to see the actual output for debugging.

### Checking Available Secrets

```bash
psst list                     # See what's available
psst list --json              # Structured output
```

### If a Secret is Missing

psst will automatically check environment variables as a fallback. If neither the vault nor the environment has the secret, the command will fail.

Ask the human to add it:
> "I need `STRIPE_KEY` to call the Stripe API. Please run `psst set STRIPE_KEY` to add it."

---

## How It Works

```
┌───────────────────────────────────────────────────────┐
│  Agent Context                                        │
│                                                       │
│  "I need to deploy the app"                           │
│  > psst run ./deploy.sh                               │
│                                                       │
│  [Command executed, exit code 0]                      │
│                                                       │
│  (Agent never sees any secret values)                 │
└───────────────────────────────────────────────────────┘
                          │
                          ▼
┌───────────────────────────────────────────────────────┐
│  psst                                                 │
│                                                       │
│  1. Retrieve encryption key from OS Keychain          │
│  2. Decrypt STRIPE_KEY from local vault               │
│  3. Inject into subprocess environment                │
│  4. Execute: curl ... (with $STRIPE_KEY expanded)     │
│  5. Return exit code to agent                         │
└───────────────────────────────────────────────────────┘
```

**Security model:**
- Secrets encrypted at rest (AES-256-GCM)
- Encryption key stored in OS Keychain (macOS Keychain, libsecret, Windows Credential Manager)
- Secrets automatically redacted in command output (`[REDACTED]`)
- Optional vault lock with password for backups/travel
- Secrets never exposed to agent context
- Zero friction for legitimate use

---

## CI / Headless Environments

When keychain isn't available, use the `PSST_PASSWORD` environment variable:

```bash
export PSST_PASSWORD="your-master-password"
psst STRIPE_KEY -- ./deploy.sh
```

---

## FAQ

**Q: Why not just use environment variables?**

Because `export STRIPE_KEY=sk_live_...` puts the secret:
- In your shell history
- In your agent's context (if it ran the export)
- Visible to `env` and `printenv`

psst keeps secrets out of the agent's context entirely.

**Q: Why not use a .env file?**

.env files are fine for local dev, but:
- Agents can `cat .env` and see everything
- Easy to accidentally commit
- No encryption at rest

**Q: Is this like HashiCorp Vault?**

Vault is for teams and infrastructure. psst is for your laptop and your AI agent. Different tools, different problems.

**Q: What if the agent runs `psst get STRIPE_KEY`?**

It'll print the value. That's a feature for human debugging. If you're worried, don't give your agent shell access. But honestly, if an agent has shell access, it can already do much worse things.

**Q: How is the encryption key stored?**

In your OS keychain:
- **macOS**: Keychain.app (unlocked when you log in)
- **Linux**: libsecret / gnome-keyring
- **Windows**: Credential Manager

---

## Philosophy

- **Local-first**: Your secrets never leave your machine. No cloud, no sync, no account.
- **Agent-first**: Designed for AI agents to use, not just humans.
- **Zero friction**: No passwords to type (keychain handles it).
- **Single binary**: Works everywhere Bun runs.

---

## Development

```bash
# Install dependencies
bun install

# Run locally
bun run src/main.ts --help

# Build single binary
bun run build
```

---

## License

MIT

---

<p align="center">
  <b>psst</b> — <i>because your agent doesn't need to know your secrets</i>
</p>
