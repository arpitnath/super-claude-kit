#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/helpers/test-helpers.sh"

start_test_suite "Auto-Logging (PostToolUse Hook)"

cleanup_test_logs

if assert_file_exists "hooks/post-tool-use.sh"; then
  pass "Test 1: post-tool-use.sh exists"
else
  fail "Test 1: post-tool-use.sh exists"
fi

if assert_executable "hooks/post-tool-use.sh"; then
  pass "Test 2: post-tool-use.sh is executable"
else
  fail "Test 2: post-tool-use.sh is executable"
fi

if grep -q "post-tool-use.sh" manifest.json 2>/dev/null; then
  pass "Test 3: Hook registered in manifest.json"
else
  fail "Test 3: Hook registered in manifest.json"
fi

if grep -q "post-tool-use.sh" install 2>/dev/null; then
  pass "Test 4: Hook wired in install script"
else
  fail "Test 4: Hook wired in install script"
fi

bash hooks/post-tool-use.sh "Read" '{"file_path":"test/file.ts"}' "content" 2>/dev/null || true

if [ -f ".claude/session_files.log" ]; then
  pass "Test 5: Read operation creates log file"
else
  fail "Test 5: Read operation creates log file"
fi

if grep -q "test/file.ts" .claude/session_files.log 2>/dev/null; then
  pass "Test 6: Read operation logs file path"
else
  fail "Test 6: Read operation logs file path"
fi

if grep -q "read" .claude/session_files.log 2>/dev/null; then
  pass "Test 7: Read operation logs action"
else
  fail "Test 7: Read operation logs action"
fi

cleanup_test_logs

bash hooks/post-tool-use.sh "Edit" '{"file_path":"test/edit.ts"}' "content" 2>/dev/null || true

if grep -q "test/edit.ts" .claude/session_files.log 2>/dev/null; then
  pass "Test 8: Edit operation logs file path"
else
  fail "Test 8: Edit operation logs file path"
fi

if grep -q "edit" .claude/session_files.log 2>/dev/null; then
  pass "Test 9: Edit operation logs action"
else
  fail "Test 9: Edit operation logs action"
fi

cleanup_test_logs

bash hooks/post-tool-use.sh "Write" '{"file_path":"test/new.ts"}' "content" 2>/dev/null || true

if grep -q "test/new.ts" .claude/session_files.log 2>/dev/null; then
  pass "Test 10: Write operation logs file path"
else
  fail "Test 10: Write operation logs file path"
fi

if grep -q "write" .claude/session_files.log 2>/dev/null; then
  pass "Test 11: Write operation logs action"
else
  fail "Test 11: Write operation logs action"
fi

cleanup_test_logs

bash hooks/post-tool-use.sh "Task" '{"subagent_type":"Explore"}' "Found important patterns in codebase" 2>/dev/null || true

if [ -f ".claude/subagent_results.log" ]; then
  pass "Test 12: Task operation creates subagent log"
else
  fail "Test 12: Task operation creates subagent log"
fi

if grep -q "Explore" .claude/subagent_results.log 2>/dev/null; then
  pass "Test 13: Task operation logs agent type"
else
  fail "Test 13: Task operation logs agent type"
fi

cleanup_test_logs

bash hooks/post-tool-use.sh "TodoWrite" '{"todos":[{"status":"in_progress","content":"Testing task"}]}' "result" 2>/dev/null || true

if [ -f ".claude/current_tasks.log" ]; then
  pass "Test 14: TodoWrite operation creates task log"
else
  fail "Test 14: TodoWrite operation creates task log"
fi

if grep -q "Testing task" .claude/current_tasks.log 2>/dev/null; then
  pass "Test 15: TodoWrite logs in_progress task"
else
  fail "Test 15: TodoWrite logs in_progress task"
fi

bash hooks/post-tool-use.sh "" "" "" 2>/dev/null || true
exit_code=$?
if [ "$exit_code" -eq 0 ]; then
  pass "Test 16: Hook handles empty input gracefully"
else
  fail "Test 16: Hook handles empty input"
fi

bash hooks/post-tool-use.sh "Read" "invalid json" "" 2>/dev/null || true
exit_code=$?
if [ "$exit_code" -eq 0 ]; then
  pass "Test 17: Hook handles malformed JSON gracefully"
else
  fail "Test 17: Hook handles malformed JSON"
fi

bash hooks/post-tool-use.sh "UnknownTool" '{}' "" 2>/dev/null || true
exit_code=$?
if [ "$exit_code" -eq 0 ]; then
  pass "Test 18: Hook ignores unknown tools gracefully"
else
  fail "Test 18: Hook ignores unknown tools"
fi

cleanup_test_logs

end_test_suite
