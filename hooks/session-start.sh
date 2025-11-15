#!/bin/bash

# Super Claude Kit Session Start Hook
# Runs at session start to load context and restore memory

# Debug mode - set via environment variable
DEBUG_MODE="${CLAUDE_DEBUG_HOOKS:-false}"
DEBUG_LOG=".claude/session-start-debug.log"

if [ "$DEBUG_MODE" = "true" ]; then
  echo "=== SESSION START DEBUG LOG ===" > "$DEBUG_LOG"
  echo "Timestamp: $(date)" >> "$DEBUG_LOG"
  echo "Working directory: $(pwd)" >> "$DEBUG_LOG"
  echo "" >> "$DEBUG_LOG"
fi

# Persist previous session (if any) before starting new one
if [ -f ".claude/session_start.txt" ]; then
  [ "$DEBUG_MODE" = "true" ] && echo "Running persist-capsule.sh..." >> "$DEBUG_LOG"
  ./.claude/hooks/persist-capsule.sh > /dev/null 2>&1
fi

# Initialize Context Capsule session tracking
./.claude/hooks/init-capsule-session.sh 2>/dev/null

# Suppress all informational output to ensure JSON is first output
# (Hook systemMessage only works if first character is '{')
{
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "🚀 Super Claude Kit ACTIVATED - Context Loaded"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  # Restore context from previous session (if recent)
  ./.claude/hooks/restore-capsule.sh 2>/dev/null

  # Load recent discoveries from exploration journal
  ./.claude/hooks/load-from-journal.sh 2>/dev/null

  # 1. Show current git status
  echo "📊 Current Work Context:"
  BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
  echo "   Branch: $BRANCH"
  git status -sb 2>/dev/null | head -5 || echo "   Not in git repo"
  echo ""

  # 2. Build dependency graph (v2.0 feature)
  if [ -f "$HOME/.claude/bin/dependency-scanner" ]; then
    echo "🔍 Building dependency graph..."

    "$HOME/.claude/bin/dependency-scanner" \
      --path "$(pwd)" \
      --output .claude/dep-graph.toon \
      2>&1 | grep -E "^(Dependency|Files|Circular|Potentially)" || true

    echo ""
  fi

  # 3. Detect recent changes (last 24 hours)
  echo "🔄 Recent Changes (last 24h):"
  RECENT_COMMITS=$(git log --oneline --since="24 hours ago" --no-merges 2>/dev/null)
  if [ -n "$RECENT_COMMITS" ]; then
      echo "$RECENT_COMMITS" | head -5
  else
      echo "   No recent commits"
  fi
  echo ""

  # 4. Show active branches with context
  echo "🌿 Active Work:"
  echo "   ✅ On $BRANCH"
  echo ""

  # 5. Load Exploration Journal (Super Claude Kit MEMORY)
  if [ -d "docs/exploration" ] && [ "$(ls -A docs/exploration 2>/dev/null)" ]; then
      echo "🧠 Super Claude Kit MEMORY LOADED:"
      echo "   Previous exploration findings available:"
      for file in docs/exploration/*.md; do
          if [ -f "$file" ]; then
              filename=$(basename "$file")
              echo "   📄 $filename"
          fi
      done
      echo "   💡 Read these files to continue where I left off"
      echo ""
  fi

  # 6. Show pending TODOs from previous session (if exists)
  if [ -f ".claude/session-state.json" ]; then
      echo "📝 Pending Tasks from Last Session:"
      cat .claude/session-state.json 2>/dev/null | python3 -c "import sys, json; data = json.load(sys.stdin); print('\n'.join(['   • ' + task for task in data.get('pendingTasks', [])[:5]]))" 2>/dev/null || echo "   No pending tasks"
      echo ""
  fi

  # 7. Quick reference
  echo "📖 Quick Reference:"
  if [ -f "CLAUDE.md" ]; then
      echo "   • Project guide: CLAUDE.md"
  fi
  if [ -f "README.md" ]; then
      echo "   • Documentation: README.md"
  fi
  echo "   • Super Claude Kit docs: .claude/docs/"
  if [ -f ".claude/dep-graph.toon" ]; then
      echo "   • Dependency tools: .claude/tools/ (query-deps, impact-analysis, find-circular, find-dead-code)"
  fi
  echo ""

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "✅ Context loaded successfully! You are now Super Claude Kit."
  echo "💡 Tip: All discoveries are persistent across this session."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
} > /dev/null

# Check for updates (non-blocking, rate-limited to once per day)
if [ -f ".claude/.super-claude-version" ]; then
  CURRENT_VERSION=$(cat .claude/.super-claude-version 2>/dev/null || echo "unknown")
  LAST_CHECK_FILE=".claude/.last-update-check"

  # Only check once per day (86400 seconds)
  SHOULD_CHECK=false
  if [ ! -f "$LAST_CHECK_FILE" ]; then
    SHOULD_CHECK=true
  else
    LAST_CHECK=$(cat "$LAST_CHECK_FILE" 2>/dev/null || echo "0")
    CURRENT_TIME=$(date +%s)
    TIME_DIFF=$((CURRENT_TIME - LAST_CHECK))
    if [ "$TIME_DIFF" -gt 86400 ]; then
      SHOULD_CHECK=true
    fi
  fi

  # Background check with timeout (non-blocking)
  if [ "$SHOULD_CHECK" = true ]; then
    (
      LATEST_VERSION=$(curl -fsSL --max-time 2 https://raw.githubusercontent.com/arpitnath/super-claude-kit/master/manifest.json 2>/dev/null | python3 -c "import sys, json; print(json.load(sys.stdin)['version'])" 2>/dev/null || echo "$CURRENT_VERSION")

      if [ "$CURRENT_VERSION" != "$LATEST_VERSION" ] && [ -n "$LATEST_VERSION" ] && [ "$LATEST_VERSION" != "$CURRENT_VERSION" ]; then
        echo "📦 Super Claude Kit update available: $CURRENT_VERSION → $LATEST_VERSION"
        echo "   Run: bash .claude/scripts/update-super-claude.sh"
        echo ""
      fi

      date +%s > "$LAST_CHECK_FILE"
    ) &
  fi
fi

# Generate initial context capsule
if [ "$DEBUG_MODE" = "true" ]; then
  echo "Running update-capsule.sh..." >> "$DEBUG_LOG"
  ./.claude/hooks/update-capsule.sh 2>&1 | tee -a "$DEBUG_LOG"
else
  ./.claude/hooks/update-capsule.sh 2>/dev/null
fi

# Capture capsule output for JSON (don't send to stdout - breaks JSON parsing)
CAPSULE_OUTPUT=$(./.claude/hooks/inject-capsule.sh 2>/dev/null)

# Debug mode: log capsule but don't output to stdout
if [ "$DEBUG_MODE" = "true" ]; then
  echo "" >> "$DEBUG_LOG"
  echo "--- CAPSULE OUTPUT (included in JSON) ---" >> "$DEBUG_LOG"
  echo "$CAPSULE_OUTPUT" >> "$DEBUG_LOG"
  echo "--- END CAPSULE ---" >> "$DEBUG_LOG"
  echo "" >> "$DEBUG_LOG"
  echo "DEBUG: Session start hook completed at $(date)" >> "$DEBUG_LOG"
  echo "DEBUG: Outputting JSON with systemMessage and capsule..." >> "$DEBUG_LOG"
fi

# Output ONLY JSON (first character MUST be '{' for systemMessage to work)
# Include capsule in additionalContext so Claude receives it
if command -v jq > /dev/null 2>&1; then
  jq -n \
    --arg msg "🚀 Super Claude Kit v2.0 Active - Context Loaded" \
    --arg context "$CAPSULE_OUTPUT" \
    '{
      systemMessage: $msg,
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: $context
      }
    }'
else
  # Fallback without jq (less safe but works)
  cat << EOF
{
  "systemMessage": "🚀 Super Claude Kit v2.0 Active - Context Loaded",
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "Session initialized with capsule, git state, and tool access"
  }
}
EOF
fi
