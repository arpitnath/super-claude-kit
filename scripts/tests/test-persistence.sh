#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/helpers/test-helpers.sh"
source "$SCRIPT_DIR/helpers/mock-data.sh"

start_test_suite "Cross-Session Persistence"

cleanup_test_logs
create_mock_logs

if assert_file_exists ".claude/hooks/persist-capsule.sh"; then
  pass "Test 1: persist-capsule.sh exists"
else
  fail "Test 1: persist-capsule.sh exists"
fi

if assert_file_exists ".claude/hooks/restore-capsule.sh"; then
  pass "Test 2: restore-capsule.sh exists"
else
  fail "Test 2: restore-capsule.sh exists"
fi

create_mock_persistence

if assert_file_exists ".claude/capsule_persist.json"; then
  pass "Test 3: Persistence file can be created"
else
  fail "Test 3: Persistence file creation"
fi

persist_content=$(cat .claude/capsule_persist.json 2>/dev/null || echo "")

if echo "$persist_content" | python3 -m json.tool >/dev/null 2>&1; then
  pass "Test 4: Persistence file is valid JSON"
else
  fail "Test 4: Persistence file is valid JSON"
fi

if echo "$persist_content" | grep -q "last_session"; then
  pass "Test 5: Contains session end timestamp"
else
  fail "Test 5: Contains session end timestamp"
fi

if echo "$persist_content" | grep -q "discoveries"; then
  pass "Test 6: Contains discoveries array"
else
  fail "Test 6: Contains discoveries array"
fi

create_mock_persistence

output=$(./.claude/hooks/session-start.sh 2>&1 || true)

if echo "$output" | grep -q "RESTORING"; then
  pass "Test 7: session-start detects previous session"
else
  fail "Test 7: session-start restoration" "No restoration message"
fi

if echo "$output" | grep -q "Auth uses JWT"; then
  pass "Test 8: Restores discoveries from previous session"
else
  fail "Test 8: Discovery restoration"
fi

rm -f .claude/session_start.txt 2>/dev/null || true
old_timestamp=$(($(date +%s) - 90000))
echo "{\"last_session\": {\"ended_at\": $old_timestamp, \"duration_seconds\": 100, \"branch\": \"main\", \"head\": \"abc123\"}, \"discoveries\": []}" > .claude/capsule_persist.json

output=$(./.claude/hooks/session-start.sh 2>&1 || true)

if ! echo "$output" | grep -q "RESTORING"; then
  pass "Test 9: Ignores sessions >24h old"
else
  fail "Test 9: Session expiration" "Should not restore old session"
fi

cleanup_test_logs
rm -f .claude/capsule_persist.json 2>/dev/null || true

end_test_suite
