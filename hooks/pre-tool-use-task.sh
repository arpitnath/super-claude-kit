#!/bin/bash

# Pre-Tool-Use Hook (Task tool only)
# 1. Enforces CCK dependency tools over Task-based scanning
# 2. Suggests Glob for file search queries
# 3. Suggests context-librarian when past agent findings exist
# Runs BEFORE each Task tool call (registered with "if": "Task(*)")
# Claude Code passes arguments via stdin as JSON, NOT positional args

set -euo pipefail

# Defensive check: Ensure CWD exists (can be invalid if directory was deleted)
if ! cd "$(pwd 2>/dev/null)" 2>/dev/null; then
  cd "$HOME" 2>/dev/null || exit 0
fi

# CCK opt-out check
[ -f "$PWD/.cck-disable" ] && exit 0

# Read JSON from stdin (Claude Code's hook protocol)
INPUT_JSON=$(cat)

# Extract fields from JSON using python3
TOOL_INPUT=$(echo "$INPUT_JSON" | python3 -c "import sys, json; import json as j; print(j.dumps(json.load(sys.stdin).get('tool_input', {})))" 2>/dev/null || echo "{}")

# Extract prompt from Task tool input
TASK_PROMPT=$(echo "$TOOL_INPUT" | python3 -c "import sys, json; print(json.load(sys.stdin).get('prompt', ''))" 2>/dev/null || echo "")

if [ -n "$TASK_PROMPT" ]; then
  # Convert to lowercase for pattern matching
  PROMPT_LOWER=$(echo "$TASK_PROMPT" | tr '[:upper:]' '[:lower:]')

  # Detect dependency-related queries
  if echo "$PROMPT_LOWER" | grep -qE '(depend|import|require|module.*load|circular.*depend|who.*use|what.*import|find.*import)'; then
    # Output JSON enforcement message (to stderr for informational display)
    cat << 'EOF' >&2
{"type":"tool-enforcement","category":"dependency-analysis","warning":"Query appears to be about code dependencies","dontUse":{"tool":"Task","reason":"inefficient","issues":["Slower: Scans files one-by-one","Limited: Cannot detect circular dependencies","Expensive: High token usage"]},"useInstead":[{"name":"query-deps","useCase":"what imports X, who uses X","command":"bash $HOME/.claude/cck/tools/query-deps/query-deps.sh <file-path>"},{"name":"impact-analysis","useCase":"what would break if I change X","command":"bash $HOME/.claude/cck/tools/impact-analysis/impact-analysis.sh <file-path>"},{"name":"find-circular","useCase":"circular dependencies","command":"bash $HOME/.claude/cck/tools/find-circular/find-circular.sh"}],"benefit":"These tools are instant and read pre-built dependency graph"}
EOF
  fi

  # Detect file search queries
  if echo "$PROMPT_LOWER" | grep -qE '(where.*file|find.*file|locate.*file|search.*file)' && ! echo "$PROMPT_LOWER" | grep -qE '(depend|import|require)'; then
    # Output JSON suggestion message (to stderr for informational display)
    cat << 'EOF' >&2
{"type":"tool-suggestion","category":"file-search","useInstead":{"tool":"Glob","reason":"faster-and-direct","pattern":"**/*<filename>*","description":"For finding files by name pattern"}}
EOF
  fi

  # Context-librarian suggestion for Task spawning (check for past agent findings)
  SUBAGENT_TYPE=$(echo "$TOOL_INPUT" | python3 -c "import sys, json; print(json.load(sys.stdin).get('subagent_type', ''))" 2>/dev/null || echo "")

  # Skip if already invoking context-librarian
  if [ "$SUBAGENT_TYPE" != "context-librarian" ] && [ -f "$HOME/.claude/cck/state/session_subagents.log" ]; then
    # Extract keywords from task prompt
    KEYWORDS=$(echo "$TASK_PROMPT" | grep -oiE "(auth|database|schema|error|bug|architecture|api|routing|payment)" | head -1)

    if [ -n "$KEYWORDS" ] && grep -qi "$KEYWORDS" "$HOME/.claude/cck/state/session_subagents.log" 2>/dev/null; then
      cat << EOF >&2
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 PAST AGENT FINDINGS AVAILABLE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Agent: $SUBAGENT_TYPE
Topic: $KEYWORDS

Past findings exist in subagent logs.

Suggestion: Query context-librarian first:
  Bash("$HOME/.claude/cck/tools/context-query/context-query.sh search $KEYWORDS")

This checks if similar work was already done (saves 30-60s).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EOF
    fi
  fi
fi

exit 0
