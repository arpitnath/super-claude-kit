# Super Claude Kit

> Persistent memory and intelligent context management for Claude Code

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Claude Code](https://img.shields.io/badge/Claude_Code-Compatible-blue.svg)](https://claude.ai)
[![Version](https://img.shields.io/badge/version-2.0.1-blue.svg)](https://github.com/arpitnath/super-claude-kit)

---

## Overview

Super Claude Kit transforms Claude Code from a stateless assistant into an intelligent development partner with persistent memory, context awareness, and dependency understanding. Built entirely with bash hooks and lightweight tools, it requires no external dependencies or databases.

### Key Capabilities

- **Persistent Memory** - 24-hour context window preserving files, tasks, and discoveries across sessions
- **Dependency Analysis** - Multi-language dependency graph with impact analysis and circular dependency detection
- **Smart Context Management** - Automatic session state tracking with 52% token reduction using TOON format
- **Quality Automation** - 95% automated logging with intelligent refresh heuristics
- **Progressive Reading** - Semantic chunking for efficient large file exploration

---

## Features

### Context Persistence

Maintains session state across messages and sessions, including:

- Files accessed and modified
- Active tasks and completion status
- Sub-agent execution results
- Architectural discoveries
- Git repository state

### Dependency Graph Analysis

Multi-language dependency scanner supporting TypeScript, JavaScript, Python, and Go:

- **Import/Export Mapping** - Complete dependency relationships
- **Impact Analysis** - Understand change ripple effects before refactoring
- **Circular Dependency Detection** - Tarjan's algorithm for cycle detection
- **Dead Code Identification** - Find unused files and modules
- **Performance** - 1000 files scanned in <5 seconds

### Intelligent Automation

Quality improvement hooks that work automatically:

- **95% Auto-logging** - File operations and tool usage tracked automatically
- **Smart Refresh** - Context updates only when state changes (60-70% reduction)
- **Proactive Warnings** - Prevent redundant operations and token waste
- **Session Persistence** - Auto-save on exit, auto-restore on start

### Specialized Sub-Agents

Production-safe, read-only agents for common development tasks:

- **architecture-explorer** - Understand service boundaries and data flows
- **database-navigator** - Explore schemas, migrations, and relationships
- **agent-developer** - Build and debug AI agents with MCP integration
- **github-issue-tracker** - Create well-formatted issues from discoveries

---

## Installation

### Prerequisites

- Claude Code (any version with hooks support)
- Git (recommended)
- Bash 4.0+

### Quick Install

```bash
cd your-project
curl -fsSL https://raw.githubusercontent.com/arpitnath/super-claude-kit/master/install | bash
```

### Verify Installation

```bash
bash .claude/scripts/test-super-claude.sh
bash .claude/scripts/show-stats.sh
```

---

## Usage

### Automatic Features

Super Claude Kit operates transparently with zero configuration:

- Session state tracking activates on first message
- Dependency graph builds automatically on session start
- Context updates trigger only on state changes
- Discoveries persist across 24-hour window

### Manual Discovery Logging

For significant architectural insights:

```bash
./.claude/hooks/log-discovery.sh "pattern" "Auth uses JWT tokens stored in Redis"
./.claude/hooks/log-discovery.sh "decision" "PostgreSQL chosen for ACID guarantees"
./.claude/hooks/log-discovery.sh "architecture" "Microservices communicate via gRPC"
```

### Dependency Analysis Tools

```bash
./.claude/tools/query-deps/query-deps.sh src/auth.ts
./.claude/tools/impact-analysis/impact-analysis.sh src/database.ts
./.claude/tools/find-circular/find-circular.sh
./.claude/tools/find-dead-code/find-dead-code.sh
```

### Progressive Reader

Efficient reading of large files through semantic chunking:

```bash
progressive-reader --path src/large-file.ts
progressive-reader --chunk 2
progressive-reader --list
```

---

## Architecture

### Core Components

**Context Capsule**
- TOON format for 52% token reduction
- Hash-based change detection
- Smart refresh heuristics

**Dependency Graph**
- AST-based parsing with tree-sitter
- O(n) circular dependency detection
- Reverse dependency mapping

**Hook System**
- SessionStart - Initialize context and build graphs
- UserPromptSubmit - Smart context refresh
- PostToolUse - Automatic operation logging
- PreToolUse - Redundancy prevention
- SessionEnd - Persistent state save

**Tool Runner**
- Sandboxed execution environment
- Permission-based access control
- Cross-platform compatibility

### Performance Characteristics

- **Context Overhead** - <100ms per refresh
- **Graph Building** - 1000 files in <5s, 10000 files in <30s
- **Memory Footprint** - ~20MB for typical projects
- **Token Efficiency** - 52% reduction vs JSON

---

## Documentation

- [Capsule Usage Guide](.claude/docs/CAPSULE_USAGE_GUIDE.md) - Detailed usage patterns and best practices
- [System Architecture](.claude/docs/SUPER_CLAUDE_SYSTEM_ARCHITECTURE.md) - Technical deep dive
- [Progressive Reader Architecture](docs/PROGRESSIVE_READER_ARCHITECTURE.md) - Semantic chunking design
- [Dependency Graph Architecture](docs/DEPENDENCY_GRAPH_ARCHITECTURE.md) - Graph building and analysis
- [Sandboxing Architecture](docs/SANDBOXING_ARCHITECTURE.md) - Security and isolation design
- [CHANGELOG](CHANGELOG.md) - Version history and release notes

---

## Updating

### Check for Updates

```bash
bash .claude/scripts/update-super-claude.sh
```

### Development Mode

```bash
bash .claude/scripts/update-super-claude.sh --dev
```

---

## Configuration

### Settings

Located at `.claude/settings.local.json`:

```json
{
  "permissions": {
    "allow": ["Bash(git add:*)", "Bash(jq:*)"],
    "deny": [],
    "ask": []
  },
  "hooks": {
    "SessionStart": [...],
    "UserPromptSubmit": [...]
  }
}
```

### Customization

- Add custom hooks in `hooks/`
- Create custom tools in `tools/`
- Add specialized agents in `agents/`
- Define reusable skills in `skills/`

---

## Troubleshooting

### Common Issues

**Hooks not executing:**
```bash
# Verify settings
cat .claude/settings.local.json

# Test hook manually
bash .claude/hooks/session-start.sh
```

**Capsule not updating:**
```bash
# Force refresh
rm .claude/last_refresh_state.txt
```

**Dependency graph not building:**
```bash
# Verify scanner installation
ls -la ~/.claude/bin/dependency-scanner

# Rebuild manually
~/.claude/bin/dependency-scanner --path . --output .claude/dep-graph.json
```

### Debug Mode

```bash
CLAUDE_DEBUG_HOOKS=true claude
```

---

## Contributing

Contributions are welcome! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a pull request

### Development Setup

```bash
git clone https://github.com/arpitnath/super-claude-kit.git
cd super-claude-kit
bash install
```

### Running Tests

```bash
bash .claude/scripts/test-super-claude.sh
```

---

## License

[MIT License](LICENSE) - Copyright (c) 2025 Arpit Nath

---

## Acknowledgments

- [Anthropic](https://www.anthropic.com/) - Claude and Claude Code
- [TOON Format](https://github.com/toon-format/toon) - Token-Oriented Object Notation
- [Tree-sitter](https://tree-sitter.github.io/) - Incremental parsing system
- Developer community for feedback and contributions

---

## Author

**Arpit Nath**

- GitHub: [@arpitnath](https://github.com/arpitnath)
- LinkedIn: [Arpit Nath](https://www.linkedin.com/in/arpit-nath-38280a173/)

---

## Support

- **Issues**: [GitHub Issues](https://github.com/arpitnath/super-claude-kit/issues)
- **Discussions**: [GitHub Discussions](https://github.com/arpitnath/super-claude-kit/discussions)
- **Documentation**: [Full Documentation](https://github.com/arpitnath/super-claude-kit/tree/master/.claude/docs)

---

**If Super Claude Kit helps improve your Claude Code workflow, please star the repository!** ⭐
