#!/bin/bash

set -euo pipefail

TOOL_NAME="${1:-}"
TOOL_INPUT="${2:-}"
TOOL_OUTPUT="${3:-}"

if [ -z "$TOOL_NAME" ]; then
  exit 0
fi

case "$TOOL_NAME" in
  "Read")
    if FILE_PATH=$(echo "$TOOL_INPUT" | python3 -c "import sys, json; print(json.load(sys.stdin).get('file_path', ''))" 2>/dev/null); then
      if [ -n "$FILE_PATH" ]; then
        ./.claude/hooks/log-file-access.sh "$FILE_PATH" "read" 2>/dev/null || true
      fi
    fi
    ;;

  "Edit")
    if FILE_PATH=$(echo "$TOOL_INPUT" | python3 -c "import sys, json; print(json.load(sys.stdin).get('file_path', ''))" 2>/dev/null); then
      if [ -n "$FILE_PATH" ]; then
        ./.claude/hooks/log-file-access.sh "$FILE_PATH" "edit" 2>/dev/null || true
      fi
    fi
    ;;

  "Write")
    if FILE_PATH=$(echo "$TOOL_INPUT" | python3 -c "import sys, json; print(json.load(sys.stdin).get('file_path', ''))" 2>/dev/null); then
      if [ -n "$FILE_PATH" ]; then
        ./.claude/hooks/log-file-access.sh "$FILE_PATH" "write" 2>/dev/null || true
      fi
    fi
    ;;

  "Task")
    if AGENT_TYPE=$(echo "$TOOL_INPUT" | python3 -c "import sys, json; print(json.load(sys.stdin).get('subagent_type', ''))" 2>/dev/null); then
      if [ -n "$AGENT_TYPE" ] && [ -n "$TOOL_OUTPUT" ]; then
        SUMMARY=$(echo "$TOOL_OUTPUT" | head -c 200 | tr '\n' ' ')
        ./.claude/hooks/log-subagent.sh "$AGENT_TYPE" "$SUMMARY" 2>/dev/null || true
      fi
    fi
    ;;

  "TodoWrite")
    if [ -n "$TOOL_INPUT" ]; then
      if TODOS=$(echo "$TOOL_INPUT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    todos = data.get('todos', [])
    for todo in todos:
        if todo.get('status') == 'in_progress':
            print(todo.get('content', ''))
            break
except:
    pass
" 2>/dev/null); then
        if [ -n "$TODOS" ]; then
          ./.claude/hooks/log-task.sh "in_progress" "$TODOS" 2>/dev/null || true
        fi
      fi
    fi
    ;;
esac

exit 0
