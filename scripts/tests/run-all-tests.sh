#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

TESTS=(
  "test-installation.sh"
  "test-version-tracking.sh"
  "test-production-safety.sh"
  "test-logging.sh"
  "test-hooks.sh"
  "test-capsule.sh"
  "test-persistence.sh"
  "test-auto-logging.sh"
  "test-tool-runner.sh"
  "test-dependency-scanner.sh"
  "test-tool-integration.sh"
)

TEST_NAMES=(
  "Installation"
  "Version Tracking"
  "Production Safety"
  "Logging"
  "Hook Execution"
  "Capsule Generation"
  "Cross-Session Persistence"
  "Auto-Logging (PostToolUse)"
  "Tool Runner (v2.0)"
  "Dependency Scanner (v2.0)"
  "Tool Integration (v2.0)"
)

VERBOSE=false
FAIL_FAST=false
SPECIFIC_TEST=""

for arg in "$@"; do
  case $arg in
    --verbose|-v)
      VERBOSE=true
      ;;
    --fail-fast|-f)
      FAIL_FAST=true
      ;;
    test-*)
      SPECIFIC_TEST="$arg"
      ;;
  esac
done

echo "========================================================================"
echo "Super Claude Kit Test Suite v2.0.0"
echo "========================================================================"
echo ""
echo "Running tests..."
echo ""

TOTAL_PASSED=0
TOTAL_FAILED=0
START_TIME=$(date +%s)

run_test() {
  local test_file="$1"
  local test_name="$2"
  local index="$3"

  if [ -n "$SPECIFIC_TEST" ] && [ "$test_file" != "$SPECIFIC_TEST" ]; then
    return 0
  fi

  printf "[%d] %-40s" "$index" "$test_name"

  if [ "$VERBOSE" = true ]; then
    echo ""
    bash "$SCRIPT_DIR/$test_file"
    local result=$?
    local passed=0
    local failed=0
  else
    local output=$(bash "$SCRIPT_DIR/$test_file" 2>&1)
    local result=$?
    local passed=$(echo "$output" | grep -c "^\[PASS\]" 2>/dev/null || echo "0")
    local failed=$(echo "$output" | grep -c "^\[FAIL\]" 2>/dev/null || echo "0")
    passed=$(echo "$passed" | tr -d '[:space:]')
    failed=$(echo "$failed" | tr -d '[:space:]')
    passed=${passed:-0}
    failed=${failed:-0}
  fi

  TOTAL_PASSED=$((TOTAL_PASSED + passed))
  TOTAL_FAILED=$((TOTAL_FAILED + failed))

  if [ $result -eq 0 ]; then
    printf " [OK] %d/%d passed\n" "$passed" "$passed"
  else
    printf " [X] %d passed, %d failed\n" "$passed" "$failed"

    if [ "$FAIL_FAST" = true ]; then
      echo ""
      echo "[FAIL] Test failed. Stopping (--fail-fast mode)."
      exit 1
    fi
  fi

  return $result
}

SUITE_FAILED=false

for i in "${!TESTS[@]}"; do
  index=$((i + 1))
  if ! run_test "${TESTS[$i]}" "${TEST_NAMES[$i]}" "$index"; then
    SUITE_FAILED=true
  fi
done

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

if [ "$DURATION" -ge 60 ]; then
  TIME_STR="${DURATION}s ($(($DURATION / 60))m)"
else
  TIME_STR="${DURATION}s"
fi

echo ""
echo "========================================================================"
echo "FINAL RESULTS"
echo "========================================================================"
echo ""
echo "Passed: $TOTAL_PASSED"
[ "$TOTAL_FAILED" -gt 0 ] && echo "Failed: $TOTAL_FAILED"
echo "Time: $TIME_STR"
echo ""
echo "========================================================================"

if [ "$TOTAL_FAILED" -gt 0 ] || [ "$SUITE_FAILED" = true ]; then
  echo "RESULT: SOME TESTS FAILED"
  echo "========================================================================"
  exit 1
else
  echo "RESULT: ALL TESTS PASSED"
  echo "========================================================================"
  exit 0
fi
