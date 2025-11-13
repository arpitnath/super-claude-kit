#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/helpers/test-helpers.sh"

start_test_suite "Hook Execution"

HOOKS=(
  "session-start.sh"
  "pre-task-analysis.sh"
  "init-capsule-session.sh"
  "update-capsule.sh"
  "persist-capsule.sh"
  "log-file-access.sh"
  "log-discovery.sh"
  "log-task.sh"
  "log-subagent.sh"
)

hook_count=0
for hook in "${HOOKS[@]}"; do
  if assert_file_exists ".claude/hooks/$hook"; then
    hook_count=$((hook_count + 1))
  fi
done

if [ "$hook_count" -eq "${#HOOKS[@]}" ]; then
  pass "Test 1: All ${#HOOKS[@]} core hooks exist"
else
  fail "Test 1: All core hooks exist" "Found $hook_count/${#HOOKS[@]}"
fi

exec_count=0
for hook in "${HOOKS[@]}"; do
  if [ -x ".claude/hooks/$hook" ]; then
    exec_count=$((exec_count + 1))
  fi
done

if [ "$exec_count" -eq "${#HOOKS[@]}" ]; then
  pass "Test 2: All hooks are executable"
else
  fail "Test 2: All hooks are executable" "Only $exec_count/${#HOOKS[@]} executable"
fi

shebang_count=0
for hook in "${HOOKS[@]}"; do
  if head -n1 ".claude/hooks/$hook" 2>/dev/null | grep -q "^#!/bin/bash"; then
    shebang_count=$((shebang_count + 1))
  fi
done

if [ "$shebang_count" -eq "${#HOOKS[@]}" ]; then
  pass "Test 3: All hooks have correct shebang"
else
  fail "Test 3: All hooks have correct shebang" "Only $shebang_count/${#HOOKS[@]} correct"
fi

if assert_file_exists ".claude/settings.local.json"; then
  pass "Test 4: settings.local.json exists"
else
  fail "Test 4: settings.local.json exists"
fi

if grep -qi "sessionstart" .claude/settings.local.json 2>/dev/null; then
  pass "Test 5: SessionStart hook configured"
else
  fail "Test 5: SessionStart hook configured"
fi

if grep -qi "userpromptsubmit" .claude/settings.local.json 2>/dev/null; then
  pass "Test 6: UserPromptSubmit hook configured"
else
  fail "Test 6: UserPromptSubmit hook configured"
fi

if grep -q "session-start.sh" .claude/settings.local.json 2>/dev/null; then
  pass "Test 7: sessionStart points to correct file"
else
  fail "Test 7: sessionStart points to correct file"
fi

if grep -q "pre-task-analysis.sh" .claude/settings.local.json 2>/dev/null; then
  pass "Test 8: userPromptSubmit points to correct file"
else
  fail "Test 8: userPromptSubmit points to correct file"
fi

output=$(./.claude/hooks/init-capsule-session.sh 2>&1 || true)
if [ -n "$output" ]; then
  pass "Test 9: init-capsule-session.sh executes"
else
  fail "Test 9: init-capsule-session.sh executes" "No output"
fi

output=$(./.claude/hooks/update-capsule.sh 2>&1 || true)
if [ -n "$output" ] || [ -f ".claude/capsule.toon" ]; then
  pass "Test 10: update-capsule.sh executes"
else
  fail "Test 10: update-capsule.sh executes"
fi

./.claude/hooks/log-file-access.sh "test.txt" "read" 2>/dev/null
if [ -f ".claude/session_files.log" ]; then
  pass "Test 11: log-file-access.sh creates log"
else
  fail "Test 11: log-file-access.sh creates log"
fi

./.claude/hooks/log-discovery.sh "test" "content" 2>/dev/null
if [ -f ".claude/session_discoveries.log" ]; then
  pass "Test 12: log-discovery.sh creates log"
else
  fail "Test 12: log-discovery.sh creates log"
fi

./.claude/hooks/log-task.sh "in_progress" "task" 2>/dev/null
if [ -f ".claude/current_tasks.log" ]; then
  pass "Test 13: log-task.sh creates log"
else
  fail "Test 13: log-task.sh creates log"
fi

./.claude/hooks/log-subagent.sh "Explore" "summary" 2>/dev/null
if [ -f ".claude/subagent_results.log" ]; then
  pass "Test 14: log-subagent.sh creates log"
else
  fail "Test 14: log-subagent.sh creates log"
fi

if [ -f ".claude/capsule.toon" ]; then
  size=$(wc -c < .claude/capsule.toon)
  if [ "$size" -gt 50 ]; then
    pass "Test 15: Capsule has content ($size bytes)"
  else
    fail "Test 15: Capsule has content" "Only $size bytes"
  fi
else
  fail "Test 15: Capsule file exists"
fi

cleanup_test_logs
rm -f .claude/capsule.toon 2>/dev/null || true

end_test_suite
