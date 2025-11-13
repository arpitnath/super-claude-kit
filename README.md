# Super Claude Kit

**Transform Claude Code from a stateless tourist into a stateful resident.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Claude Code](https://img.shields.io/badge/Claude_Code-Compatible-blue.svg)](https://claude.ai)

---

## The Problem

[Claude Code](https://github.com/anthropics/claude-code) is brilliant, but it's **stateless**. Every session starts from scratch.

You're the tour guide, and Claude is the tourist who keeps asking for directions to the same place.

## The Solution

**Super Claude Kit** adds persistent memory to Claude Code using:

- ✅ **Session state tracking** - Remembers files, tasks, discoveries
- ✅ **Cross-session persistence** - 24-hour memory window
- ✅ **Token-efficient storage** - 52% reduction with TOON format
- ✅ **Smart refresh** - 60-70% fewer context updates
- ✅ **Exploration journal** - Permanent knowledge base

**No external dependencies. No databases. Pure bash + hooks.**

**⭐ If Super Claude Kit helps you, please star the repo!**

---

## Features

### 🧠 Persistent Memory

Claude remembers:
- Files accessed (with timestamps)
- Current tasks (in progress, pending, completed)
- Sub-agent results (Explore, Plan, etc.)
- Session discoveries (patterns, insights, decisions)
- Git state (branch, dirty files, commits)

### 📊 Context Capsule

Before every prompt, Claude sees a compact summary:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 CONTEXT CAPSULE (Updated)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🌿 Git State:
   Branch: main (HEAD: a1b2c3d)
   ⚠️  5 dirty file(s)

📁 Files in Context:
   • server/auth.ts (read, 2m ago)
   • api/gateway.go (edit, 5m ago)

✅ Current Tasks:
   🔄 [IN PROGRESS] Implementing auth system
   ✅ [DONE] Design database schema

💡 Session Discoveries:
   🔍 [pattern] Auth uses JWT + Redis sessions
   🏗️ [architecture] Gateway proxies to microservices

⏱️  Session Info:
   Messages: 8 | Session: 12m

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 🔄 Cross-Session Restoration

Start a new session within 24 hours, and Claude restores:
- Last 10 discoveries
- Last 15 files accessed
- Last 5 sub-agent results
- Previous session metadata

```
🔄 RESTORING FROM PREVIOUS SESSION
Last session ended: 30m ago
Previous session: 15m on branch main

💡 Key Discoveries from Last Session:
   🔍 [pattern] Redis stores session tokens with 24h TTL
   🏗️ [architecture] Auth service uses middleware pattern
```



### 🤖 Specialized Sub-Agents

Super Claude Kit includes 4 built-in sub-agents for common development tasks:

1. **architecture-explorer** - Understand codebases, service boundaries, data flows
2. **database-navigator** - Explore database schemas, migrations, relationships
3. **agent-developer** - Build and debug AI agents with MCP integration
4. **github-issue-tracker** - Create well-formatted GitHub issues from discoveries

**Use them by launching the Task tool with `subagent_type`:**
```
Task tool with subagent_type="architecture-explorer"
```

---

## Installation

### Requirements

- **Claude Code** (any version with hooks)
- **Git** (recommended, but not required)

### Quick Install (Recommended)

```bash
cd your-project
curl -sL https://raw.githubusercontent.com/arpitnath/super-claude-kit/master/install | bash
```

**That's it.** Next time you start Claude Code:

```
🚀 Super Claude Kit ACTIVATED - Context Loaded
```

### What Gets Installed

- ✅ 20 hooks (automatic automation)
- ✅ 2 utility scripts (manual testing & stats)
- ✅ 3 skills (context-saver, exploration-continue, task-router)
- ✅ 4 sub-agents (architecture-explorer, database-navigator, agent-developer, github-issue-tracker)
- ✅ Documentation & usage guides
- ✅ Updated `.gitignore` with session files
- ✅ Updated `CLAUDE.md` with integration instructions

### Test Installation

```bash
# Verify everything works
bash .claude/scripts/test-super-claude.sh

# View usage statistics
bash .claude/scripts/show-stats.sh
```

---

## Usage

### Automatic Features

These work without any manual intervention:

- ✅ Git state tracking (every prompt)
- ✅ Smart refresh (hash-based change detection)
- ✅ Capsule injection (only when state changes)
- ✅ Cross-session persistence (automatic save/restore)
- ✅ Journal sync (discoveries → Markdown)

### Manual Logging (For Claude)

Claude should explicitly log operations:

```bash
# After reading a file
./.claude/hooks/log-file-access.sh "path/to/file" "read"

# After editing a file
./.claude/hooks/log-file-access.sh "path/to/file" "edit"

# After a discovery
./.claude/hooks/log-discovery.sh "pattern" "Auth uses JWT tokens"

# After task update
./.claude/hooks/log-task.sh "in_progress" "Implementing auth"

# After sub-agent completes
./.claude/hooks/log-subagent.sh "Explore" "Found auth in server/auth/"
```

### Utilities

```bash
# Get discovery suggestions
./.claude/hooks/suggest-discoveries.sh

# View session summary
./.claude/hooks/summarize-session.sh

# Force capsule refresh
rm .claude/last_refresh_state.txt
./.claude/hooks/update-capsule.sh
```


---

## Troubleshooting

### Hooks not running?

Check Claude Code configuration:
```bash
cat .claude/config.json
```

Should have:
```json
{
  "hooks": {
    "sessionStart": ".claude/hooks/session-start.sh",
    "userPromptSubmit": ".claude/hooks/pre-task-analysis.sh"
  }
}
```

### Capsule not updating?

Check refresh state:
```bash
cat .claude/last_refresh_state.txt
rm .claude/last_refresh_state.txt  # Force refresh
```

### Session not persisting?

Check persistence file:
```bash
cat .claude/capsule_persist.json | python3 -m json.tool
```

### Logs growing too large?

Session logs clear on new session start. If needed:
```bash
> .claude/session_files.log
> .claude/session_discoveries.log
```

---

## Contributing

Contributions welcome!

**To contribute:**
1. Fork the repo
2. Create a feature branch
3. Submit a pull request



## Acknowledgments

- **[Anthropic](https://www.anthropic.com/)** - For Claude and Claude Code
- **[TOON](https://github.com/toon-format/toon)** - Token-Oriented Object Notation (TOON) – Compact, human-readable, schema-aware JSON for LLM prompts.
- **The developer community** - For inspiration and feedback
- **Early testers** - For bug reports and suggestions

---

## Author

**Arpit Nath**
- GitHub: [@arpitnath](https://github.com/arpitnath)
- LinkedIn: [@Arpit](https://www.linkedin.com/in/arpit-nath-38280a173/)


## License

[MIT License](https://opensource.org/licenses/MIT) - Copyright (c) 2025 Arpit Nath
