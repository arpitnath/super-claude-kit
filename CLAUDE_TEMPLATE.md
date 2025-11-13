# Super Claude Kit Integration

This project uses **Super Claude Kit** - a persistent context memory system for Claude Code that enables cross-message and cross-session memory.

## 🎯 System Overview

Super Claude Kit provides:
- **Persistent Context**: Remember files accessed, tasks worked on, and discoveries made
- **Smart Refresh**: Automatic context updates before each prompt
- **Cross-Session Memory**: Context persists across sessions (24-hour window)
- **Sub-Agent Tracking**: Remember findings from specialized agents
- **Discovery Logging**: Capture architectural insights and patterns

## 📖 Usage Guide

**CRITICAL**: Read and follow `.claude/docs/CAPSULE_USAGE_GUIDE.md`

## 🔒 Production Safety

Super Claude Kit is designed for safe production use:

**Sub-Agents (Read-Only):**
All 4 built-in sub-agents (architecture-explorer, database-navigator, agent-developer, github-issue-tracker) are **read-only**. They can analyze and explore code but cannot modify files or execute destructive operations.

**✅ Sub-agents CAN:**
- Read files (Read tool)
- Search code (Grep tool)
- Find files (Glob tool)
- Fetch web content (WebFetch - architecture-explorer only)

**❌ Sub-agents CANNOT:**
- Execute bash commands (Bash tool removed)
- Modify files (no Edit/Write tools)
- Delete files or run destructive operations

This design prevents accidental file modifications while maintaining full analytical capabilities.

### Required Behavior

Claude (you!) MUST follow these patterns:

#### 1. Check Capsule Before Redundant Operations
```
BEFORE re-reading a file → Check if it's in capsule (Files in Context)
BEFORE running git status → Check capsule (Git State)
BEFORE asking about current task → Check capsule (Current Tasks)
```

#### 2. Logging (Mostly Automatic)

**AUTO-LOGGED (PostToolUse Hook):**
The following are logged automatically - you don't need to call these manually:
- Read/Edit/Write operations → Logged to session_files.log automatically
- Task tool (sub-agents) → Logged to session_subagents.log automatically
- TodoWrite updates → Logged to session_tasks.log automatically

**MANUAL LOGGING REQUIRED (Discoveries Only):**
You must manually log discoveries - you decide what's important:

```bash
./.claude/hooks/log-discovery.sh "<category>" "<insight>"
# Categories: pattern, insight, decision, architecture, bug, optimization, achievement

# Examples:
./.claude/hooks/log-discovery.sh "pattern" "All hooks use set -euo pipefail"
./.claude/hooks/log-discovery.sh "architecture" "System uses microservices"
./.claude/hooks/log-discovery.sh "decision" "Using PostgreSQL for storage"
```

**OPTIONAL MANUAL LOGGING:**
Only needed if PostToolUse hook is disabled:

```bash
# File access (automatic via PostToolUse)
./.claude/hooks/log-file-access.sh "<path>" "read|edit|write"

# Sub-agents (automatic via PostToolUse)
./.claude/hooks/log-subagent.sh "<agent-type>" "<summary-of-findings>"

# Tasks (automatic via TodoWrite + PostToolUse)
./.claude/hooks/log-task.sh "<status>" "<task-description>"
```

#### 3. Workflow Pattern

```
1. Check capsule → See current context
2. Start task → Use TodoWrite (auto-logged)
3. Work on task → Read/edit files (auto-logged)
4. Use sub-agents → Task tool (auto-logged)
5. Log discoveries → Manual logging (you decide what's important)
6. Complete task → Mark as completed (auto-logged via TodoWrite)
```

**Auto-logging coverage: ~95%**
Only discoveries require manual logging - everything else is automatic!

## 🚦 Hooks (Automatic)

These run automatically via `.claude/settings.local.json`:

- **SessionStart**: `session-start.sh` → Initialize capsule, restore previous session
- **UserPromptSubmit**: `pre-task-analysis.sh` → Update capsule with latest changes

## 📊 Verification

Check if Super Claude Kit is working:

```bash
# View current stats
bash .claude/scripts/show-stats.sh

# Test installation
bash .claude/scripts/test-super-claude.sh

# Check logs
ls -la .claude/*.log
```

## 💡 Best Practices

### DO ✅
- Check capsule before redundant file reads
- Log after every Read/Edit/Write operation
- Capture sub-agent findings immediately
- Note architectural discoveries as you learn
- Reference capsule context in responses

### DON'T ❌
- Ignore the capsule (defeats the purpose!)
- Re-read files shown in capsule (unless stale)
- Launch duplicate sub-agents for same task
- Forget to log important operations
- Over-log trivial operations

## 🎓 Quick Reference

```bash
# File operations
./.claude/hooks/log-file-access.sh "<path>" "read|edit|write"

# Sub-agent results
./.claude/hooks/log-subagent.sh "<type>" "<summary>"

# Discoveries
./.claude/hooks/log-discovery.sh "<category>" "<content>"

# Tasks
./.claude/hooks/log-task.sh "<status>" "<description>"

# View stats
bash .claude/scripts/show-stats.sh
```

## 📚 Full Documentation

- **Usage Guide**: `.claude/docs/CAPSULE_USAGE_GUIDE.md` (detailed patterns and examples)
- **System Architecture**: `.claude/docs/SUPER_CLAUDE_SYSTEM_ARCHITECTURE.md`
- **GitHub**: https://github.com/arpitnath/super-claude-kit

---

**Remember**: The capsule is your external memory. Trust it, use it, maintain it!
