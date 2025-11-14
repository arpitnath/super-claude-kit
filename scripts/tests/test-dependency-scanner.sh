#!/bin/bash
# Test Dependency Scanner Binary
# Tests scanner execution, output format, and accuracy

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
echo "🧪 Dependency Scanner Tests (v2.0)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if scanner binary exists
SCANNER_BIN="$ROOT_DIR/tools/dependency-scanner/bin/dependency-scanner"
if [[ ! -f "$SCANNER_BIN" ]]; then
    echo -e "${YELLOW}⊘${NC} Scanner binary not found, building..."
    cd "$ROOT_DIR/tools/dependency-scanner"
    if go build -o bin/dependency-scanner . 2>/dev/null; then
        echo -e "${GREEN}✓${NC} Built scanner binary"
    else
        echo -e "${RED}✗${NC} Failed to build scanner binary"
        echo "Skipping dependency scanner tests"
        exit 0
    fi
fi

# Setup test project
TEST_DIR="/tmp/sck-scanner-test-$$"
mkdir -p "$TEST_DIR/src"

# Create test files with dependencies
cat > "$TEST_DIR/src/auth.ts" << 'EOF'
export function login(username: string) {
    return `Logged in: ${username}`;
}

export function logout() {
    console.log("Logged out");
}
EOF

cat > "$TEST_DIR/src/user.ts" << 'EOF'
import { login } from './auth';

export class User {
    constructor(private name: string) {}

    authenticate() {
        return login(this.name);
    }
}
EOF

cat > "$TEST_DIR/src/app.ts" << 'EOF'
import { User } from './user';
import { logout } from './auth';

const user = new User('admin');
user.authenticate();
logout();
EOF

cat > "$TEST_DIR/src/isolated.ts" << 'EOF'
// This file is not imported by anyone
export function unused() {
    return "I am dead code";
}
EOF

cd "$TEST_DIR"

# Test 1: Scanner execution
echo "Testing scanner execution..."
OUTPUT_FILE="$TEST_DIR/deps.json"
if "$SCANNER_BIN" --path "$TEST_DIR" --output "$OUTPUT_FILE" >/dev/null 2>&1; then
    pass "Scanner executes without errors"
else
    fail "Scanner execution" "Binary exited with error"
fi

# Test 2: Output file creation
echo ""
echo "Testing output file creation..."
if [[ -f "$OUTPUT_FILE" ]]; then
    pass "Creates output JSON file"
else
    fail "Output file creation" "File not found: $OUTPUT_FILE"
fi

# Test 3: JSON structure validation
echo ""
echo "Testing JSON structure..."
if jq -e '.Files' "$OUTPUT_FILE" >/dev/null 2>&1 && \
   jq -e '.Circular' "$OUTPUT_FILE" >/dev/null 2>&1 && \
   jq -e '.DeadCode' "$OUTPUT_FILE" >/dev/null 2>&1; then
    pass "Output has correct JSON structure"
else
    fail "JSON structure" "Missing required fields"
fi

# Test 4: File detection
echo ""
echo "Testing file detection..."
FILE_COUNT=$(jq '.Files | length' "$OUTPUT_FILE")
if [[ "$FILE_COUNT" -eq 4 ]]; then
    pass "Detects all 4 TypeScript files"
else
    fail "File detection" "Expected 4 files, found $FILE_COUNT"
fi

# Test 5: Import detection
echo ""
echo "Testing import detection..."
USER_IMPORTS=$(jq -r '.Files | to_entries[] | select(.value.Path | contains("user.ts")) | .value.Imports | length' "$OUTPUT_FILE")
if [[ "$USER_IMPORTS" -ge 1 ]]; then
    pass "Detects imports in user.ts"
else
    fail "Import detection" "Expected at least 1 import in user.ts"
fi

# Test 6: Dead code detection
echo ""
echo "Testing dead code detection..."
DEAD_CODE=$(jq '.DeadCode | length' "$OUTPUT_FILE")
if [[ "$DEAD_CODE" -ge 1 ]]; then
    # Check if isolated.ts is in dead code
    if jq -e '.DeadCode[] | select(. | contains("isolated.ts"))' "$OUTPUT_FILE" >/dev/null 2>&1; then
        pass "Detects dead code (isolated.ts)"
    else
        fail "Dead code detection" "isolated.ts not marked as dead code"
    fi
else
    fail "Dead code detection" "Expected at least 1 dead file, found $DEAD_CODE"
fi

# Test 7: Circular dependency detection (should be none)
echo ""
echo "Testing circular dependency detection..."
CIRCULAR=$(jq '.Circular | length' "$OUTPUT_FILE")
if [[ "$CIRCULAR" -eq 0 ]]; then
    pass "No false circular dependencies detected"
else
    fail "Circular dependency detection" "Found $CIRCULAR cycles (expected 0)"
fi

# Test 8: Create circular dependency and detect it
echo ""
echo "Testing circular dependency detection (positive case)..."
cat > "$TEST_DIR/src/circular-a.ts" << 'EOF'
import { funcB } from './circular-b';
export function funcA() { funcB(); }
EOF

cat > "$TEST_DIR/src/circular-b.ts" << 'EOF'
import { funcA } from './circular-a';
export function funcB() { funcA(); }
EOF

"$SCANNER_BIN" --path "$TEST_DIR" --output "$OUTPUT_FILE" >/dev/null 2>&1
CIRCULAR=$(jq '.Circular | length' "$OUTPUT_FILE")
if [[ "$CIRCULAR" -ge 1 ]]; then
    pass "Detects circular dependencies"
else
    fail "Circular dependency detection" "Failed to detect circular dependency"
fi

# Test 9: Verbose mode
echo ""
echo "Testing verbose mode..."
VERBOSE_OUTPUT=$("$SCANNER_BIN" --path "$TEST_DIR" --output /dev/null --verbose 2>&1)
if [[ "$VERBOSE_OUTPUT" == *"Scanning directory"* ]]; then
    pass "Verbose mode provides detailed output"
else
    fail "Verbose mode" "No verbose output detected"
fi

# Test 10: Version flag
echo ""
echo "Testing version flag..."
VERSION_OUTPUT=$("$SCANNER_BIN" --version 2>&1)
if [[ "$VERSION_OUTPUT" == *"v2.0"* ]] || [[ "$VERSION_OUTPUT" == *"2.0"* ]]; then
    pass "Version flag works"
else
    fail "Version flag" "Output: $VERSION_OUTPUT"
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
