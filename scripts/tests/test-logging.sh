#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/helpers/test-helpers.sh"

start_test_suite "Logging"

cleanup_test_logs

if assert_file_exists ".claude/hooks/log-file-access.sh"; then
  pass "Test 1: log-file-access.sh exists"
else
  fail "Test 1: log-file-access.sh exists"
fi

if assert_file_exists ".claude/hooks/log-discovery.sh"; then
  pass "Test 2: log-discovery.sh exists"
else
  fail "Test 2: log-discovery.sh exists"
fi

if assert_file_exists ".claude/hooks/log-task.sh"; then
  pass "Test 3: log-task.sh exists"
else
  fail "Test 3: log-task.sh exists"
fi

if assert_file_exists ".claude/hooks/log-subagent.sh"; then
  pass "Test 4: log-subagent.sh exists"
else
  fail "Test 4: log-subagent.sh exists"
fi

./.claude/hooks/log-file-access.sh "test.txt" "read" 2>/dev/null
if assert_file_exists ".claude/session_files.log"; then
  pass "Test 5: File logging creates log file"
else
  fail "Test 5: File logging creates log file"
fi

if grep -q "test.txt" .claude/session_files.log 2>/dev/null; then
  pass "Test 6: File log contains filename"
else
  fail "Test 6: File log contains filename"
fi

if grep -q "read" .claude/session_files.log 2>/dev/null; then
  pass "Test 7: File log contains action"
else
  fail "Test 7: File log contains action"
fi

./.claude/hooks/log-discovery.sh "pattern" "Test pattern" 2>/dev/null
if assert_file_exists ".claude/session_discoveries.log"; then
  pass "Test 8: Discovery logging creates log file"
else
  fail "Test 8: Discovery logging creates log file"
fi

if grep -q "Test pattern" .claude/session_discoveries.log 2>/dev/null; then
  pass "Test 9: Discovery log contains content"
else
  fail "Test 9: Discovery log contains content"
fi

./.claude/hooks/log-task.sh "in_progress" "Test task" 2>/dev/null
if assert_file_exists ".claude/current_tasks.log"; then
  pass "Test 10: Task logging creates log file"
else
  fail "Test 10: Task logging creates log file"
fi

if grep -q "Test task" .claude/current_tasks.log 2>/dev/null; then
  pass "Test 11: Task log contains content"
else
  fail "Test 11: Task log contains content"
fi

./.claude/hooks/log-subagent.sh "Explore" "Test summary" 2>/dev/null
if assert_file_exists ".claude/subagent_results.log"; then
  pass "Test 12: Sub-agent logging creates log file"
else
  fail "Test 12: Sub-agent logging creates log file"
fi

if grep -q "Test summary" .claude/subagent_results.log 2>/dev/null; then
  pass "Test 13: Sub-agent log contains summary"
else
  fail "Test 13: Sub-agent log contains summary"
fi

log_count=$(find .claude -name "*.log" 2>/dev/null | wc -l | tr -d ' ')
if [ "$log_count" -ge 4 ]; then
  pass "Test 14: All log files created ($log_count files)"
else
  fail "Test 14: All log files created" "Only found $log_count files"
fi

cleanup_test_logs

end_test_suite
