#!/usr/bin/env bash
# Find dead code (unused files)

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$(cd "$SCRIPT_DIR/../../lib" && pwd)"

source "$LIB_DIR/toon-parser.sh"

GRAPH_FILE="${DEP_GRAPH_FILE:-$HOME/.claude/dep-graph.toon}"

if [ $# -ge 1 ]; then
    GRAPH_FILE="$1"
fi

if [ ! -f "$GRAPH_FILE" ]; then
    echo "Error: Graph file not found: $GRAPH_FILE"
    echo "Run the dependency scanner first to generate the graph"
    exit 1
fi

DEADCODE=$(toon_get_deadcode "$GRAPH_FILE")

if [ -z "$DEADCODE" ]; then
    echo "No dead code found - all files are imported somewhere"
    exit 0
fi

DEAD_COUNT=$(echo "$DEADCODE" | wc -l | tr -d ' ')

echo "Found $DEAD_COUNT potentially unused file(s):"
echo ""

echo "$DEADCODE" | while IFS= read -r dead_file; do
    echo "  - $dead_file"
done
echo ""

echo "Note: These files are not imported by any other file in the project."
echo "They may be entry points or genuinely unused code."
