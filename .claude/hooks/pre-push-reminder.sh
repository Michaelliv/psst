#!/bin/bash
# PreToolUse hook: Remind to update mental model before git push

input=$(cat)
tool_name=$(echo "$input" | jq -r '.tool_name')
command=$(echo "$input" | jq -r '.tool_input.command // ""')

# Only check Bash commands
if [ "$tool_name" != "Bash" ]; then
  exit 0
fi

# Check if it's a git push
if echo "$command" | grep -qE '^\s*git\s+push'; then
  cat << 'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "additionalContext": "Pre-push model check:\n\n1. SEARCH the model: Use Grep on .mental/model.ndjson for key concepts you introduced\n2. CHECK for gaps:\n   - New domain concepts? (nouns - entities that exist)\n   - New capabilities? (verbs - what the system does)\n   - New aspects? (cross-cutting concerns)\n   - Architectural decisions? (why you chose A over B)\n   - Changed your mind on a previous decision? (use supersede)\n   - Removed/changed anything still documented?\n3. COMMANDS:\n   - mental add <type> --relates-to <existing> --docs <files>\n   - mental update <type> <name|id> to modify existing entities\n   - mental supersede decision <id> to replace a decision (keeps history)"
  }
}
EOF
fi

exit 0
