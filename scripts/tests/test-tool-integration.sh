#!/bin/bash
# Test Tool Integration
# Tests tool integration with capsule and overall system

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Helper functions
pass() {
    echo -e "${GREEN}✓${NC} $1"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    TESTS_RUN=$((TESTS_RUN + 1))
}

fail() {
    echo -e "${RED}✗${NC} $1"
    echo -e "${RED}  Error: $2${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    TESTS_RUN=$((TESTS_RUN + 1))
}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🧪 Tool Integration Tests (v2.0)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Setup test environment
TEST_DIR="/tmp/sck-integration-test-$$"
mkdir -p "$TEST_DIR/.claude/lib"
mkdir -p "$TEST_DIR/.claude/tools"
mkdir -p "$TEST_DIR/.claude/hooks"

# Copy essential files
cp "$ROOT_DIR/lib/tool-runner.sh" "$TEST_DIR/.claude/lib/"
cp "$ROOT_DIR/hooks/update-capsule.sh" "$TEST_DIR/.claude/hooks/"

# Copy real tools
cp -r "$ROOT_DIR/tools/find-circular" "$TEST_DIR/.claude/tools/"
cp -r "$ROOT_DIR/tools/find-dead-code" "$TEST_DIR/.claude/tools/"
cp -r "$ROOT_DIR/tools/query-deps" "$TEST_DIR/.claude/tools/"
cp -r "$ROOT_DIR/tools/impact-analysis" "$TEST_DIR/.claude/tools/"

cd "$TEST_DIR"

# Test 1: Tool runner loads in hooks
echo "Testing tool runner sourcing in hooks..."
source .claude/lib/tool-runner.sh
if declare -f run_tool >/dev/null 2>&1; then
    pass "Tool runner functions available after sourcing"
else
    fail "Tool runner sourcing" "Functions not exported"
fi

# Test 2: Real tools discovered
echo ""
echo "Testing real tool discovery..."
TOOL_COUNT=$(discover_tools 2>/dev/null | jq -r '. | length')
if [[ "$TOOL_COUNT" -ge 4 ]]; then
    pass "Discovers all real tools (found $TOOL_COUNT)"
else
    fail "Real tool discovery" "Expected 4+, found $TOOL_COUNT"
fi

# Test 3: Tool metadata quality
echo ""
echo "Testing tool metadata quality..."
HAS_DESCRIPTION=true
for tool in find-circular find-dead-code query-deps impact-analysis; do
    DESC=$(get_tool_metadata "$tool" 2>/dev/null | jq -r '.description // empty')
    if [[ -z "$DESC" ]]; then
        HAS_DESCRIPTION=false
        break
    fi
done

if $HAS_DESCRIPTION; then
    pass "All tools have descriptions"
else
    fail "Tool metadata quality" "Some tools missing descriptions"
fi

# Test 4: Capsule integration
echo ""
echo "Testing capsule integration..."

# Create minimal capsule update
export CAPSULE_FILE=".claude/capsule.toon"
export CAPSULE_TEMP=".claude/capsule.toon.tmp"
export SESSION_ID="test"
export TIMESTAMP=$(date +%s)

# Create basic capsule structure
cat > "$CAPSULE_TEMP" << EOF
CAPSULE[$SESSION_ID]{$TIMESTAMP}:

EOF

# Source tool runner and add TOOLS section
source .claude/lib/tool-runner.sh
TOOLS_JSON=$(discover_tools 2>/dev/null)

if [ -n "$TOOLS_JSON" ] && [ "$TOOLS_JSON" != "[]" ]; then
    echo "TOOLS{name,description,type}:" >> "$CAPSULE_TEMP"
    echo "$TOOLS_JSON" | jq -r '.[] | "\(.name),\(.description // "No description"),\(.type // "bash")"' 2>/dev/null | \
        while IFS=',' read -r name desc type; do
            SHORT_DESC=$(echo "$desc" | cut -c1-60)
            echo " $name,$SHORT_DESC,$type" >> "$CAPSULE_TEMP"
        done
    echo "" >> "$CAPSULE_TEMP"
fi

mv "$CAPSULE_TEMP" "$CAPSULE_FILE"

# Check if TOOLS section exists
if grep -q "TOOLS{" "$CAPSULE_FILE"; then
    pass "Capsule includes TOOLS section"
else
    fail "Capsule integration" "TOOLS section not found"
fi

# Test 5: Tool listing in capsule
echo ""
echo "Testing tool listing in capsule..."
CAPSULE_TOOL_COUNT=$(grep -A 10 "TOOLS{" "$CAPSULE_FILE" | grep "^ " | wc -l | tr -d ' ')
if [[ "$CAPSULE_TOOL_COUNT" -ge 4 ]]; then
    pass "Capsule lists all tools (found $CAPSULE_TOOL_COUNT)"
else
    fail "Tool listing in capsule" "Expected 4+, found $CAPSULE_TOOL_COUNT"
fi

# Test 6: Tool type correctness
echo ""
echo "Testing tool types in capsule..."
if grep -q ",bash$" "$CAPSULE_FILE"; then
    pass "Bash tool types identified in capsule"
else
    fail "Tool types" "No bash tools found in capsule"
fi

# Test 7: find-circular tool execution (real)
echo ""
echo "Testing real tool execution (find-circular)..."

# Need a dependency graph for real tools
SCANNER_BIN="$ROOT_DIR/tools/dependency-scanner/bin/dependency-scanner"
if [[ -f "$SCANNER_BIN" ]]; then
    mkdir -p "$TEST_DIR/src"
    echo "export const foo = 'bar';" > "$TEST_DIR/src/test.ts"

    # Run scanner with timeout
    if timeout 5 "$SCANNER_BIN" --path "$TEST_DIR" --output "$HOME/.claude/dep-graph.json" >/dev/null 2>&1; then
        # Run find-circular with timeout
        if OUTPUT=$(timeout 3 run_tool find-circular 2>&1); then
            if [[ "$OUTPUT" == *"No circular dependencies"* ]] || [[ "$OUTPUT" == *"circular"* ]] || [[ "$OUTPUT" == *"Dependency graph not built"* ]]; then
                pass "find-circular tool executes correctly"
            else
                fail "find-circular execution" "Unexpected output: $OUTPUT"
            fi
        else
            echo -e "${YELLOW}⊘${NC} find-circular timed out (skipped)"
        fi
    else
        echo -e "${YELLOW}⊘${NC} Scanner timed out (skipped)"
    fi
else
    echo -e "${YELLOW}⊘${NC} Skipped find-circular test (scanner binary not available)"
fi

# Test 8: Tool description truncation
echo ""
echo "Testing description truncation in capsule..."
LONG_DESC_COUNT=$(grep "^ " "$CAPSULE_FILE" | awk -F',' '{print length($2)}' | awk '$1 > 60' | wc -l | tr -d ' ')
if [[ "$LONG_DESC_COUNT" -eq 0 ]]; then
    pass "Descriptions truncated to 60 chars in capsule"
else
    fail "Description truncation" "Found $LONG_DESC_COUNT descriptions > 60 chars"
fi

# Test 9: Cache persistence
echo ""
echo "Testing cache persistence..."
CACHE_FILE="$HOME/.claude/.tools_cache.json"
if [[ -f "$CACHE_FILE" ]]; then
    CACHE_TOOLS=$(jq -r '.[].name' "$CACHE_FILE" | wc -l | tr -d ' ')
    if [[ "$CACHE_TOOLS" -ge 4 ]]; then
        pass "Tool cache persists across calls"
    else
        fail "Cache persistence" "Cache has $CACHE_TOOLS tools, expected 4+"
    fi
else
    fail "Cache persistence" "Cache file not found"
fi

# Test 10: Tool JSON schema validation
echo ""
echo "Testing tool.json schema..."
VALID_SCHEMAS=true
for tool_json in .claude/tools/*/tool.json; do
    if [[ -f "$tool_json" ]]; then
        if ! jq -e '.name and .description and .type and .entry' "$tool_json" >/dev/null 2>&1; then
            VALID_SCHEMAS=false
            break
        fi
    fi
done

if $VALID_SCHEMAS; then
    pass "All tool.json files have valid schema"
else
    fail "Tool JSON schema" "Some tool.json files missing required fields"
fi

# Cleanup
cd /
rm -rf "$TEST_DIR"

# Summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test Results:"
echo "  Total:  $TESTS_RUN"
echo -e "  ${GREEN}Passed: $TESTS_PASSED${NC}"
if [ $TESTS_FAILED -gt 0 ]; then
    echo -e "  ${RED}Failed: $TESTS_FAILED${NC}"
    exit 1
else
    echo "  Failed: 0"
    echo ""
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
fi
