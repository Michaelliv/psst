import chalk from "chalk";
import { existsSync, mkdirSync, chmodSync } from "fs";
import { join } from "path";
import { EXIT_ERROR, EXIT_USER_ERROR } from "../utils/exit-codes";
import type { OutputOptions } from "../utils/output";

// Hook scripts bundled with psst - NO PYTHON DEPENDENCY
const PRE_TOOL_USE_HOOK = `#!/bin/bash
# psst PreToolUse hook: Block commands that reveal secrets
# Installed by: psst install-hooks
# Bypass: Remove this file or the hook config from .claude/settings.json

INPUT=$(cat)

# Extract command from JSON using pure bash
# Match: "command": "..." and extract the value
COMMAND=$(echo "$INPUT" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/"command"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')

# Handle escaped characters in JSON
COMMAND=$(echo "$COMMAND" | sed 's/\\\\"/"/g' | sed 's/\\\\\\\\/\\\\/g')

if [ -z "$COMMAND" ]; then
    exit 0
fi

# Block patterns that reveal secrets
if echo "$COMMAND" | grep -qE 'psst[[:space:]]+get[[:space:]]'; then
    echo "BLOCKED: 'psst get' reveals secrets. Use 'psst run <cmd>' or 'psst <SECRET> -- <cmd>' instead." >&2
    exit 2
fi

if echo "$COMMAND" | grep -qE 'psst[[:space:]]+export'; then
    echo "BLOCKED: 'psst export' reveals secrets. Use 'psst run <cmd>' or 'psst <SECRET> -- <cmd>' instead." >&2
    exit 2
fi

if echo "$COMMAND" | grep -qE '\\-\\-no-mask'; then
    echo "BLOCKED: '--no-mask' flag would reveal secrets in output." >&2
    exit 2
fi

if echo "$COMMAND" | grep -qE 'cat.*vault\\.db|sqlite.*vault\\.db'; then
    echo "BLOCKED: Direct vault file access not allowed." >&2
    exit 2
fi

exit 0
`;

const POST_TOOL_USE_HOOK = `#!/bin/bash
# psst PostToolUse hook: Scan files for leaked secrets (plaintext + encoded)
# Installed by: psst install-hooks
# NO PYTHON DEPENDENCY - uses pure bash + psst

INPUT=$(cat)

# Extract command from JSON using pure bash
COMMAND=$(echo "$INPUT" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/"command"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')

if [ -z "$COMMAND" ]; then
    exit 0
fi

# Check if command involved file writes
if ! echo "$COMMAND" | grep -qE '>[[:space:]]|>>[[:space:]]|tee[[:space:]]'; then
    exit 0
fi

# Extract potential file paths from the command (after > or >>)
FILES=$(echo "$COMMAND" | grep -oE '(>|>>)[[:space:]]*[^;&|]+' | sed 's/^>>[[:space:]]*//' | sed 's/^>[[:space:]]*//' | tr -d '"' | tr -d "'" | head -5)

if [ -z "$FILES" ]; then
    exit 0
fi

# Get secret names from psst (extract from JSON without python)
SECRET_NAMES=$(psst list --json 2>/dev/null | grep -o '"name"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/"name"[[:space:]]*:[[:space:]]*"//' | sed 's/"$//')

if [ -z "$SECRET_NAMES" ]; then
    exit 0
fi

# Cross-platform base64 decode
decode_base64() {
    local file="$1"
    base64 -d < "$file" 2>/dev/null || base64 -D < "$file" 2>/dev/null || base64 --decode < "$file" 2>/dev/null
}

# Check content for a specific secret value
contains_secret() {
    local content="$1"
    local value="$2"
    echo "$content" | grep -qF "$value"
}

# Check each file
REDACTED_FILES=""
for file in $FILES; do
    # Expand path (handle $VAR, ~, etc)
    file=$(eval echo "$file" 2>/dev/null || echo "$file")

    if [ ! -f "$file" ]; then
        continue
    fi

    FOUND_SECRETS=""
    FILE_CONTENT=$(cat "$file" 2>/dev/null)

    # Check each secret
    for name in $SECRET_NAMES; do
        # Get the secret value
        value=$(psst get "$name" 2>/dev/null)

        if [ -z "$value" ]; then
            continue
        fi

        # 1. Check plaintext
        if contains_secret "$FILE_CONTENT" "$value"; then
            FOUND_SECRETS="$FOUND_SECRETS $name"
            continue
        fi

        # 2. Check base64 decoded content
        DECODED=$(decode_base64 "$file" 2>/dev/null)
        if [ -n "$DECODED" ] && contains_secret "$DECODED" "$value"; then
            FOUND_SECRETS="$FOUND_SECRETS $name"
            continue
        fi

        # 3. Check hex decoded content (xxd format)
        DECODED=$(xxd -r < "$file" 2>/dev/null)
        if [ -n "$DECODED" ] && contains_secret "$DECODED" "$value"; then
            FOUND_SECRETS="$FOUND_SECRETS $name"
            continue
        fi

        # 4. Check hex decoded content (plain hex)
        DECODED=$(xxd -r -p < "$file" 2>/dev/null)
        if [ -n "$DECODED" ] && contains_secret "$DECODED" "$value"; then
            FOUND_SECRETS="$FOUND_SECRETS $name"
            continue
        fi
    done

    # If secrets found, redact the entire file
    if [ -n "$FOUND_SECRETS" ]; then
        echo "[REDACTED: secrets detected -$FOUND_SECRETS ]" > "$file"
        REDACTED_FILES="$REDACTED_FILES $file"
    fi
done

if [ -n "$REDACTED_FILES" ]; then
    echo "SECURITY: Secrets detected and redacted in:$REDACTED_FILES" >&2
    exit 2
fi

exit 0
`;

const SETTINGS_CONFIG = {
  hooks: {
    PreToolUse: [
      {
        matcher: "Bash",
        hooks: [
          {
            type: "command",
            command: '"$CLAUDE_PROJECT_DIR/.claude/hooks/psst-block.sh"',
          },
        ],
      },
    ],
    PostToolUse: [
      {
        matcher: "Bash",
        hooks: [
          {
            type: "command",
            command: '"$CLAUDE_PROJECT_DIR/.claude/hooks/psst-scan.sh"',
          },
        ],
      },
    ],
  },
};

export async function installHooks(
  args: string[],
  options: OutputOptions = {}
): Promise<void> {
  const isGlobal = args.includes("--global") || args.includes("-g");
  const force = args.includes("--force") || args.includes("-f");

  // Determine target directory
  const baseDir = isGlobal
    ? join(process.env.HOME || "~", ".claude")
    : join(process.cwd(), ".claude");

  const hooksDir = join(baseDir, "hooks");
  const settingsPath = join(baseDir, "settings.json");

  // Check if .claude directory exists
  if (!existsSync(baseDir)) {
    mkdirSync(baseDir, { recursive: true });
  }

  // Check if hooks already exist
  const preHookPath = join(hooksDir, "psst-block.sh");
  const postHookPath = join(hooksDir, "psst-scan.sh");

  if ((existsSync(preHookPath) || existsSync(postHookPath)) && !force) {
    if (options.json) {
      console.log(
        JSON.stringify({
          success: false,
          error: "hooks_exist",
          path: hooksDir,
        })
      );
    } else if (!options.quiet) {
      console.error(chalk.red("✗"), "Hooks already installed");
      console.log(chalk.dim(`  ${hooksDir}`));
      console.log(chalk.dim("  Use --force to overwrite"));
    }
    process.exit(EXIT_USER_ERROR);
  }

  try {
    // Create hooks directory
    if (!existsSync(hooksDir)) {
      mkdirSync(hooksDir, { recursive: true });
    }

    // Write hook scripts
    await Bun.write(preHookPath, PRE_TOOL_USE_HOOK);
    chmodSync(preHookPath, 0o755);

    await Bun.write(postHookPath, POST_TOOL_USE_HOOK);
    chmodSync(postHookPath, 0o755);

    // Update or create settings.json
    let existingSettings: any = {};
    if (existsSync(settingsPath)) {
      try {
        existingSettings = JSON.parse(await Bun.file(settingsPath).text());
      } catch {
        // Invalid JSON, start fresh
      }
    }

    // Merge hook config (don't overwrite other settings)
    const newSettings = {
      ...existingSettings,
      hooks: mergeHooks(existingSettings.hooks || {}, SETTINGS_CONFIG.hooks),
    };

    await Bun.write(settingsPath, JSON.stringify(newSettings, null, 2) + "\n");

    if (options.json) {
      console.log(
        JSON.stringify({
          success: true,
          hooks: [preHookPath, postHookPath],
          settings: settingsPath,
        })
      );
    } else if (!options.quiet) {
      console.log(chalk.green("✓"), "Claude Code hooks installed");
      console.log();
      console.log(chalk.dim("Hooks:"));
      console.log(chalk.dim(`  ${preHookPath}`));
      console.log(chalk.dim(`  ${postHookPath}`));
      console.log();
      console.log(chalk.dim("Settings:"));
      console.log(chalk.dim(`  ${settingsPath}`));
      console.log();
      console.log("Protection enabled:");
      console.log(chalk.dim("  • Blocks"), chalk.cyan("psst get"), chalk.dim("and"), chalk.cyan("psst export"));
      console.log(chalk.dim("  • Blocks"), chalk.cyan("--no-mask"), chalk.dim("flag"));
      console.log(chalk.dim("  • Redacts secrets written to files (plaintext + encoded)"));
      console.log();
      console.log(chalk.dim("To remove:"), chalk.cyan("rm -rf " + hooksDir));
    }
  } catch (err: any) {
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: err.message }));
    } else if (!options.quiet) {
      console.error(chalk.red("✗"), "Failed to install hooks");
      console.log(chalk.dim(`  ${err.message}`));
    }
    process.exit(EXIT_ERROR);
  }
}

// Merge hooks without duplicating
function mergeHooks(existing: any, incoming: any): any {
  const result = { ...existing };

  for (const [event, matchers] of Object.entries(incoming) as [string, any][]) {
    if (!result[event]) {
      result[event] = matchers;
    } else {
      // Check if psst hooks already exist
      for (const matcher of matchers) {
        const exists = result[event].some((m: any) =>
          m.hooks?.some((h: any) => h.command?.includes("psst-"))
        );
        if (!exists) {
          result[event].push(matcher);
        }
      }
    }
  }

  return result;
}
