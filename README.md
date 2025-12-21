# psst 🤫

**Stop whispering your secrets to AI agents.**

---

## The Hall of Shame

We've all done it:

```bash
# "Just this once..."
curl -H "Authorization: Bearer sk-live-YOLO420..." https://api.stripe.com

# "The agent needs it..."
OPENAI_API_KEY=sk-... claude "please help me debug"

# "I'll delete it from the chat after..."
Hey Claude, my database password is hunter2, can you...
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
psst list --json              # JSON output (names only)
psst rm <NAME>                # Delete secret
```

### Project-Local Vaults

```bash
psst init --local             # Creates .psst/ in current directory
```

Local vaults take precedence over the global `~/.psst/` vault.

---

## For Agents

**You don't read secrets. You use them.**

### The Pattern

```bash
psst <SECRET_NAME> -- <command>
```

This injects `SECRET_NAME` into the command's environment. You never see the value.

### Examples

```bash
# Single secret
psst STRIPE_KEY -- curl -H "Authorization: Bearer $STRIPE_KEY" https://api.stripe.com

# Multiple secrets
psst AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY -- aws s3 ls

# Any command that reads from environment
psst DATABASE_URL -- prisma migrate deploy
psst OPENAI_API_KEY -- python my_script.py
psst DOCKER_TOKEN -- docker login -u me --password $DOCKER_TOKEN
```

### What You Get Back

- Exit code of the command
- stdout/stderr of the command
- **Not** the secret value

### Checking Available Secrets

```bash
psst list                     # See what's available
psst list --json              # Structured output
```

### If a Secret is Missing

Ask the human to add it:
> "I need `STRIPE_KEY` to call the Stripe API. Please run `psst set STRIPE_KEY` to add it."

---

## How It Works

```
┌───────────────────────────────────────────────────────┐
│  Agent Context                                        │
│                                                       │
│  "I need to call Stripe API"                          │
│  > psst STRIPE_KEY -- curl https://api.stripe.com     │
│                                                       │
│  [Command executed, exit code 0]                      │
│                                                       │
│  (Agent never sees sk_live_...)                       │
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
- Secrets never written to stdout, logs, or agent context
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
