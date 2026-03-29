#!/bin/bash

# Pre-Tool-Use Hook (Read tool only)
# 1. Blocks large files (>50KB) and forces progressive-reader
# 2. Warns when file was recently read (encourages capsule cache)
# 3. Suggests context-librarian when prior context exists
# Runs BEFORE each Read tool call (registered with "if": "Read(*)")
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

FILE_PATH=$(echo "$TOOL_INPUT" | python3 -c "import sys, json; print(json.load(sys.stdin).get('file_path', ''))" 2>/dev/null || echo "")

# Find project root via git
PROJECT_ROOT="$PWD"
while [ "$PROJECT_ROOT" != "/" ] && [ ! -d "$PROJECT_ROOT/.git" ]; do
  PROJECT_ROOT=$(dirname "$PROJECT_ROOT")
done
[ "$PROJECT_ROOT" = "/" ] && PROJECT_ROOT="$PWD"

# Check file size and block Read for large files (force progressive-reader)
if [ -n "$FILE_PATH" ]; then
  RESOLVED_PATH=""

  # Try multiple path resolutions
  if [ -f "$FILE_PATH" ]; then
    RESOLVED_PATH="$FILE_PATH"
  elif [ -f "$PROJECT_ROOT/$FILE_PATH" ]; then
    RESOLVED_PATH="$PROJECT_ROOT/$FILE_PATH"
  elif [ -f "$(pwd)/$FILE_PATH" ]; then
    RESOLVED_PATH="$(pwd)/$FILE_PATH"
  fi

  if [ -n "$RESOLVED_PATH" ]; then
    # Skip size check for images and binary files (Claude handles these natively)
    FILE_EXT="${RESOLVED_PATH##*.}"
    FILE_EXT_LOWER=$(echo "$FILE_EXT" | tr '[:upper:]' '[:lower:]')

    case "$FILE_EXT_LOWER" in
      jpg|jpeg|png|gif|webp|svg|bmp|ico|pdf|ipynb)
        # Allow images, PDFs, notebooks regardless of size
        exit 0
        ;;
    esac

    FILE_SIZE=$(stat -f%z "$RESOLVED_PATH" 2>/dev/null || stat -c%s "$RESOLVED_PATH" 2>/dev/null || echo "0")
    FILE_SIZE_KB=$((FILE_SIZE / 1024))

    if [ "$FILE_SIZE" -gt 51200 ]; then  # 50KB threshold
      echo "{\"decision\": \"block\", \"reason\": \"File ${FILE_SIZE_KB}KB exceeds 50KB. Use progressive-reader instead: \$HOME/.claude/bin/progressive-reader --path $FILE_PATH --list\"}"
      exit 0
    fi

    # Context-librarian suggestion if file is in capsule
    if [ -f "$HOME/.claude/cck/state/capsule.toon" ] && grep -q "$FILE_PATH" "$HOME/.claude/cck/state/capsule.toon" 2>/dev/null; then
      FILE_AGE=$(grep "$FILE_PATH" "$HOME/.claude/cck/state/capsule.toon" | tail -1 | grep -oE '[0-9]+' | head -1 || echo "0")
      FILE_AGE_MIN=$((FILE_AGE / 60))

      if [ "$FILE_AGE_MIN" -lt 30 ]; then
        FILE_BASENAME=$(basename "$FILE_PATH" .ts .js .go .py .tsx .jsx)
        cat << EOF >&2
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 CONTEXT AVAILABLE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

File: $FILE_PATH
Status: Already read ${FILE_AGE_MIN}m ago (in capsule)

Suggestion: Query context-librarian first (faster, 90% attention):
  Bash("$HOME/.claude/cck/tools/context-query/context-query.sh search $FILE_BASENAME")

This retrieves focused context and avoids re-reading ~12,000 tokens.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EOF
      fi
    fi
  fi
fi

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Tracking files
CCK_STATE_DIR="$HOME/.claude/cck/state"
mkdir -p "$CCK_STATE_DIR"
RECENT_READS_LOG="$CCK_STATE_DIR/recent_reads.log"
WARNINGS_SHOWN="$CCK_STATE_DIR/read_warnings_shown.log"

# Create logs if they don't exist
touch "$RECENT_READS_LOG"
touch "$WARNINGS_SHOWN"

# Check if we already warned about this file this session
if grep -q "^${FILE_PATH}$" "$WARNINGS_SHOWN" 2>/dev/null; then
  exit 0
fi

# Check if file was recently accessed
CURRENT_TIME=$(date +%s)
THRESHOLD=300  # 5 minutes in seconds

if grep -q "^${FILE_PATH}," "$RECENT_READS_LOG" 2>/dev/null; then
  # Get last read time
  LAST_READ=$(grep "^${FILE_PATH}," "$RECENT_READS_LOG" | tail -1 | cut -d',' -f2)
  TIME_SINCE=$((CURRENT_TIME - LAST_READ))

  if [ $TIME_SINCE -lt $THRESHOLD ]; then
    # Convert to human readable
    if [ $TIME_SINCE -lt 60 ]; then
      TIME_STR="${TIME_SINCE}s"
    else
      TIME_STR="$((TIME_SINCE / 60))m"
    fi

    # Show warning as JSON (to stderr so it doesn't interfere with JSON blocking output)
    echo "{\"type\":\"read-warning\",\"file\":\"$FILE_PATH\",\"lastRead\":\"${TIME_STR} ago\",\"message\":\"File recently read - check capsule first\"}" >&2

    # Mark as warned
    echo "$FILE_PATH" >> "$WARNINGS_SHOWN"
  fi
fi

# Record this read attempt
echo "$FILE_PATH,$CURRENT_TIME" >> "$RECENT_READS_LOG"

# Auto-log file access to capsule
if [ -x "$HOME/.claude/cck/hooks/log-file-access.sh" ]; then
  # Auto-log this read operation (suppress output to avoid noise)
  "$HOME/.claude/cck/hooks/log-file-access.sh" "$FILE_PATH" "read" > /dev/null 2>&1 || true
fi

exit 0
