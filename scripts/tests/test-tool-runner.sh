#!/bin/bash
# Test Tool Runner System
# Tests tool discovery, execution, and error handling

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
echo "🧪 Tool Runner Tests (v2.0)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Setup test environment
TEST_DIR="/tmp/sck-test-$$"
mkdir -p "$TEST_DIR/.claude/lib"
mkdir -p "$TEST_DIR/.claude/tools"

# Copy tool runner
cp "$ROOT_DIR/lib/tool-runner.sh" "$TEST_DIR/.claude/lib/"

# Create test tools
mkdir -p "$TEST_DIR/.claude/tools/test-bash-tool"
cat > "$TEST_DIR/.claude/tools/test-bash-tool/tool.json" << 'EOF'
{
  "name": "test-bash-tool",
  "version": "1.0.0",
  "description": "Test bash tool",
  "type": "bash",
  "entry": "test.sh"
}
EOF

cat > "$TEST_DIR/.claude/tools/test-bash-tool/test.sh" << 'EOF'
#!/bin/bash
echo "test-bash-tool executed with args: $*"
exit 0
EOF
chmod +x "$TEST_DIR/.claude/tools/test-bash-tool/test.sh"

mkdir -p "$TEST_DIR/.claude/tools/test-python-tool"
cat > "$TEST_DIR/.claude/tools/test-python-tool/tool.json" << 'EOF'
{
  "name": "test-python-tool",
  "version": "1.0.0",
  "description": "Test python tool",
  "type": "python",
  "entry": "test.py"
}
EOF

cat > "$TEST_DIR/.claude/tools/test-python-tool/test.py" << 'EOF'
#!/usr/bin/env python3
import sys
print(f"test-python-tool executed with args: {sys.argv[1:]}")
sys.exit(0)
EOF
chmod +x "$TEST_DIR/.claude/tools/test-python-tool/test.py"

# Create broken tool
mkdir -p "$TEST_DIR/.claude/tools/broken-tool"
cat > "$TEST_DIR/.claude/tools/broken-tool/tool.json" << 'EOF'
{
  "name": "broken-tool",
  "version": "1.0.0",
  "description": "Broken tool",
  "type": "bash"
}
EOF

cd "$TEST_DIR"

# Test 1: Tool discovery
echo "Testing tool discovery..."
source .claude/lib/tool-runner.sh

TOOLS=$(discover_tools 2>/dev/null | jq -r '.[].name' | sort | tr '\n' ',')
if [[ "$TOOLS" == "broken-tool,test-bash-tool,test-python-tool," ]]; then
    pass "Tool discovery finds all tools"
else
    fail "Tool discovery" "Expected 3 tools, got: $TOOLS"
fi

# Test 2: list_tools function
echo ""
echo "Testing list_tools..."
TOOL_LIST=$(list_tools)
if [[ "$TOOL_LIST" == *"test-bash-tool"* ]] && [[ "$TOOL_LIST" == *"test-python-tool"* ]]; then
    pass "list_tools returns comma-separated list"
else
    fail "list_tools" "Output: $TOOL_LIST"
fi

# Test 3: get_tool_metadata
echo ""
echo "Testing get_tool_metadata..."
METADATA=$(get_tool_metadata "test-bash-tool")
if [[ -n "$METADATA" ]] && [[ "$METADATA" == *"test-bash-tool"* ]]; then
    pass "get_tool_metadata returns correct metadata"
else
    fail "get_tool_metadata" "Empty or wrong metadata"
fi

# Test 4: Execute bash tool
echo ""
echo "Testing bash tool execution..."
OUTPUT=$(run_tool test-bash-tool arg1 arg2 2>&1)
if [[ "$OUTPUT" == *"test-bash-tool executed with args: arg1 arg2"* ]]; then
    pass "Bash tool executes with correct arguments"
else
    fail "Bash tool execution" "Output: $OUTPUT"
fi

# Test 5: Execute python tool
echo ""
echo "Testing python tool execution..."
if command -v python3 >/dev/null 2>&1; then
    OUTPUT=$(run_tool test-python-tool foo bar 2>&1)
    if [[ "$OUTPUT" == *"test-python-tool executed with args: ['foo', 'bar']"* ]]; then
        pass "Python tool executes with correct arguments"
    else
        fail "Python tool execution" "Output: $OUTPUT"
    fi
else
    echo -e "${YELLOW}⊘${NC} Skipped python tool test (python3 not installed)"
fi

# Test 6: Missing tool error
echo ""
echo "Testing error handling..."
OUTPUT=$(run_tool nonexistent-tool 2>&1 || true)
if [[ "$OUTPUT" == *"Tool not found"* ]]; then
    pass "Returns error for missing tool"
else
    fail "Missing tool error" "Expected error message, got: $OUTPUT"
fi

# Test 7: Broken tool metadata
echo ""
echo "Testing broken tool detection..."
OUTPUT=$(run_tool broken-tool 2>&1 || true)
if [[ "$OUTPUT" == *"no entry point"* ]]; then
    pass "Detects tools with missing entry point"
else
    fail "Broken tool detection" "Expected error, got: $OUTPUT"
fi

# Test 8: Tool info
echo ""
echo "Testing tool_info..."
INFO=$(tool_info test-bash-tool 2>/dev/null)
if echo "$INFO" | jq -e '.name == "test-bash-tool"' >/dev/null 2>&1; then
    pass "tool_info returns valid JSON"
else
    fail "tool_info" "Invalid JSON or wrong content"
fi

# Test 9: Cache functionality
echo ""
echo "Testing cache functionality..."
CACHE_FILE="$HOME/.claude/.tools_cache.json"
if [[ -f "$CACHE_FILE" ]]; then
    CACHE_CONTENT=$(cat "$CACHE_FILE")
    if echo "$CACHE_CONTENT" | jq -e 'length > 0' >/dev/null 2>&1; then
        pass "Tool cache is created and valid"
    else
        fail "Tool cache" "Cache file empty or invalid"
    fi
else
    fail "Tool cache" "Cache file not created"
fi

# Test 10: Tool type detection
echo ""
echo "Testing tool type detection..."
BASH_TYPE=$(get_tool_metadata "test-bash-tool" | jq -r '.type')
PYTHON_TYPE=$(get_tool_metadata "test-python-tool" | jq -r '.type')

if [[ "$BASH_TYPE" == "bash" ]] && [[ "$PYTHON_TYPE" == "python" ]]; then
    pass "Tool types detected correctly"
else
    fail "Tool type detection" "bash=$BASH_TYPE, python=$PYTHON_TYPE"
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
