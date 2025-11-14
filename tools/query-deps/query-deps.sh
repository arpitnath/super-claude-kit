#!/usr/bin/env bash
# Query dependencies - shows imports and importers for a file

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="$(cd "$SCRIPT_DIR/../../lib" && pwd)"

source "$LIB_DIR/toon-parser.sh"

GRAPH_FILE="${DEP_GRAPH_FILE:-$HOME/.claude/dep-graph.toon}"

if [ $# -lt 1 ]; then
    echo "Usage: $0 <file-path> [graph-file]"
    echo ""
    echo "Query dependency information for a file"
    echo ""
    echo "Arguments:"
    echo "  file-path   Path to the file to query"
    echo "  graph-file  Optional: path to TOON graph file (default: ~/.claude/dep-graph.toon)"
    exit 1
fi

TARGET_FILE="$1"
if [ $# -ge 2 ]; then
    GRAPH_FILE="$2"
fi

if [ ! -f "$GRAPH_FILE" ]; then
    echo "Error: Graph file not found: $GRAPH_FILE"
    echo "Run the dependency scanner first to generate the graph"
    exit 1
fi

if ! toon_file_exists "$GRAPH_FILE" "$TARGET_FILE"; then
    echo "Error: File not found in dependency graph: $TARGET_FILE"
    exit 1
fi

LANGUAGE=$(toon_get_language "$GRAPH_FILE" "$TARGET_FILE")

echo "File: $TARGET_FILE"
echo "Language: $LANGUAGE"
echo ""

echo "Imports:"
IMPORTS=$(toon_get_imports "$GRAPH_FILE" "$TARGET_FILE")
if [ -z "$IMPORTS" ]; then
    echo "  (none)"
else
    echo "$IMPORTS" | while IFS= read -r import; do
        echo "  - $import"
    done
fi
echo ""

echo "Imported by:"
IMPORTERS=$(toon_get_importers "$GRAPH_FILE" "$TARGET_FILE")
if [ -z "$IMPORTERS" ]; then
    echo "  (none)"
else
    echo "$IMPORTERS" | while IFS= read -r importer; do
        echo "  - $importer"
    done
fi
echo ""

IMPORTER_COUNT=$(toon_count_importers "$GRAPH_FILE" "$TARGET_FILE")
echo "Total importers: $IMPORTER_COUNT"
