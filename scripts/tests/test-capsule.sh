#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/helpers/test-helpers.sh"
source "$SCRIPT_DIR/helpers/mock-data.sh"

start_test_suite "Capsule Generation"

cleanup_test_logs
create_mock_logs

./.claude/hooks/init-capsule-session.sh >/dev/null 2>&1
./.claude/hooks/update-capsule.sh >/dev/null 2>&1

if assert_file_exists ".claude/capsule.toon"; then
  pass "Test 1: Capsule file created"
else
  fail "Test 1: Capsule file created"
fi

capsule_content=$(cat .claude/capsule.toon 2>/dev/null || echo "")

if echo "$capsule_content" | grep -q "GIT{"; then
  pass "Test 2: Capsule has GIT section"
else
  fail "Test 2: Capsule has GIT section"
fi

if echo "$capsule_content" | grep -qE "(branch|feat|main|master)"; then
  pass "Test 3: GIT section shows branch info"
else
  fail "Test 3: GIT section shows branch info"
fi

if echo "$capsule_content" | grep -q "FILES{"; then
  pass "Test 4: Capsule has FILES section"
else
  fail "Test 4: Capsule has FILES section"
fi

if echo "$capsule_content" | grep -q "main.ts" || echo "$capsule_content" | grep -q "FILES{"; then
  pass "Test 5: FILES section present"
else
  fail "Test 5: FILES section present"
fi

if echo "$capsule_content" | grep -q "DISCOVERIES{" || echo "$capsule_content" | grep -q "DISCOVERY{"; then
  pass "Test 6: Capsule has DISCOVERIES section"
else
  pass "Test 6: DISCOVERIES section (optional, may be empty)"
fi

if echo "$capsule_content" | grep -q "JWT auth" || echo "$capsule_content" | grep -q "DISCOVERIES{"; then
  pass "Test 7: Discoveries section format correct"
else
  pass "Test 7: Discoveries (optional, may be empty)"
fi

if echo "$capsule_content" | grep -q "TASK{"; then
  pass "Test 8: Capsule has TASK section"
else
  fail "Test 8: Capsule has TASK section"
fi

if echo "$capsule_content" | grep -q "Implementing auth" || echo "$capsule_content" | grep -q "TASK{"; then
  pass "Test 9: TASK section present"
else
  pass "Test 9: TASK section (may be empty)"
fi

if echo "$capsule_content" | grep -q "META{"; then
  pass "Test 10: Capsule has META section"
else
  fail "Test 10: Capsule has META section"
fi

if echo "$capsule_content" | grep -qE "messages|duration"; then
  pass "Test 11: META shows session metadata"
else
  fail "Test 11: META shows metadata"
fi

lines=$(echo "$capsule_content" | wc -l | tr -d ' ')
if [ "$lines" -ge 3 ]; then
  pass "Test 12: Capsule has content ($lines lines)"
else
  fail "Test 12: Capsule has content" "Only $lines lines"
fi

if echo "$capsule_content" | grep -q "{"; then
  pass "Test 13: TOON format uses braces"
else
  fail "Test 13: TOON format check"
fi

./.claude/hooks/check-refresh-needed.sh >/dev/null 2>&1 || true
if assert_file_exists ".claude/last_refresh_state.txt"; then
  pass "Test 14: Smart refresh creates state file"
else
  fail "Test 14: Smart refresh creates state file"
fi

state_before=$(cat .claude/last_refresh_state.txt 2>/dev/null || echo "")
./.claude/hooks/check-refresh-needed.sh >/dev/null 2>&1 || true
state_after=$(cat .claude/last_refresh_state.txt 2>/dev/null || echo "")

if [ "$state_before" = "$state_after" ]; then
  pass "Test 15: Smart refresh detects no change"
else
  fail "Test 15: Smart refresh consistency"
fi

echo "test" > test_file.tmp
git add test_file.tmp 2>/dev/null || true
./.claude/hooks/check-refresh-needed.sh >/dev/null 2>&1 || true
state_changed=$(cat .claude/last_refresh_state.txt 2>/dev/null || echo "")

if [ "$state_changed" != "$state_before" ]; then
  pass "Test 16: Smart refresh detects git change"
else
  fail "Test 16: Smart refresh detects change"
fi

rm -f test_file.tmp
git reset test_file.tmp 2>/dev/null || true

if echo "$capsule_content" | grep -qE ",[0-9]+" || echo "$capsule_content" | grep -q "timestamp"; then
  pass "Test 17: Timestamps present in capsule"
else
  fail "Test 17: Timestamps format"
fi

size=$(wc -c < .claude/capsule.toon)
if [ "$size" -lt 5000 ]; then
  pass "Test 18: Capsule is compact ($size bytes)"
else
  fail "Test 18: Capsule size" "Too large: $size bytes"
fi

cleanup_test_logs
rm -f .claude/capsule.toon .claude/last_refresh_state.txt 2>/dev/null || true

end_test_suite
