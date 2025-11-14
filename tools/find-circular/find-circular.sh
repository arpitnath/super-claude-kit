#!/usr/bin/env bash
# Find circular dependencies

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

CIRCULAR=$(toon_get_circular "$GRAPH_FILE")

if [ -z "$CIRCULAR" ]; then
    echo "No circular dependencies found"
    exit 0
fi

CYCLE_COUNT=$(echo "$CIRCULAR" | wc -l | tr -d ' ')

echo "Found $CYCLE_COUNT circular dependency cycle(s):"
echo ""

INDEX=1
echo "$CIRCULAR" | while IFS= read -r cycle; do
    echo "Cycle $INDEX:"
    echo "  $cycle" | tr '>' $'\n  → '
    echo ""
    INDEX=$((INDEX + 1))
done
