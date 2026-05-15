#!/usr/bin/env node
/**
 * SessionStart Hook - Capsule Integration
 *
 * Queries Capsule for recent context and injects it into the Claude Code session.
 * Crew-aware: shared capsule.db with personal + team context in worktree mode.
 */

import { Blink } from 'blink-query';
import { createInterface } from 'readline';
import { getCapsuleDbPath, getCrewIdentity, crewNamespace, getProjectHash, isDisabled } from './lib/crew-detect.js';
import { existsSync, readFileSync, rmSync, unlinkSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

function getCurrentBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
  } catch {
    return null;
  }
}

function cleanupV2Artifacts() {
  const localClaude = resolve(process.cwd(), '.claude');
  const versionFile = resolve(localClaude, '.super-claude-version');
  if (!existsSync(versionFile)) return false;
  const dirsToRemove = ['hooks', 'tools', 'agents', 'skills', 'scripts', 'docs', 'lib', 'memory'];
  for (const dir of dirsToRemove) {
    const p = resolve(localClaude, dir);
    if (existsSync(p)) { try { rmSync(p, { recursive: true, force: true }); } catch {} }
  }
  try { unlinkSync(versionFile); } catch {}
  return true;
}

async function main() {
  try {
    const rl = createInterface({ input: process.stdin });
    let inputJson = '';

    for await (const line of rl) {
      inputJson += line;
    }

    const input = JSON.parse(inputJson);
    if (isDisabled()) process.exit(0);
    const didCleanup = cleanupV2Artifacts();
    const projectHash = getProjectHash();
    const sessionId = input.session_id || 'default';

    const blink = new Blink({ dbPath: getCapsuleDbPath() });
    const crewId = getCrewIdentity();

    const contextParts = [];

    try {
      const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
      const pruned = blink.db.prepare('DELETE FROM records WHERE updated_at < ?').run(cutoff);
      if (pruned.changes > 0) {
        contextParts.push(`[CCK] Auto-pruned ${pruned.changes} stale records.`);
      }
    } catch { /* don't block session start if prune fails */ }

    const sessionNs = crewNamespace('session', crewId, projectHash);
    const currentBranch = getCurrentBranch();

    // Query for most recent handoff document
    let handoffRecord = null;
    try {
      // Search for handoff records with the handoff tag
      const handoffTag = 'handoff';
      const allHandoffs = blink.search(handoffTag);

      // Filter to this teammate's handoffs in crew mode
      const relevantHandoffs = crewId
        ? allHandoffs.filter(h => h.namespace?.includes(`crew/${crewId.teammate_name}/session`))
        : allHandoffs.filter(h => !h.namespace?.includes('crew/'));

      // Sort by timestamp (most recent first)
      relevantHandoffs.sort((a, b) => {
        const aTime = typeof a.content === 'string'
          ? JSON.parse(a.content)?.generatedAt || 0
          : a.content?.generatedAt || 0;
        const bTime = typeof b.content === 'string'
          ? JSON.parse(b.content)?.generatedAt || 0
          : b.content?.generatedAt || 0;
        return bTime - aTime;
      });

      handoffRecord = relevantHandoffs[0];
    } catch {
      // Graceful degradation - handoff is optional
    }

    // Inject handoff prominently if found
    if (handoffRecord?.summary) {
      const teammateSuffix = crewId ? ` (${crewId.teammate_name})` : '';
      contextParts.push(`## Session Handoff${teammateSuffix}\n\n${handoffRecord.summary}`);
    } else {
      // Fallback to legacy session summary if no handoff available
      const recentSessions = blink.list(sessionNs, 'recent').slice(0, 10);

      let branchSession = null;
      let fallbackSession = null;

      if (currentBranch) {
        // Find the most recent session on the current branch
        for (const session of recentSessions) {
          try {
            const content = typeof session.content === 'string'
              ? JSON.parse(session.content)
              : session.content;

            if (content?.branch === currentBranch) {
              branchSession = session;
              break;
            }

            // Keep first session as fallback
            if (!fallbackSession) {
              fallbackSession = session;
            }
          } catch {
            // If content parsing fails, use as fallback
            if (!fallbackSession) {
              fallbackSession = session;
            }
          }
        }
      } else {
        // No git branch detected, use most recent session
        fallbackSession = recentSessions[0];
      }

      const sessionToShow = branchSession || fallbackSession;
      if (sessionToShow) {
        const header = branchSession && currentBranch
          ? `## Branch Context (${currentBranch})`
          : `## Last Session`;
        contextParts.push(`${header}\n${sessionToShow.summary || sessionToShow.title}`);
      }
    }

    const discoveryNs = crewId
      ? (projectHash ? `proj/${projectHash}/crew/_shared/discoveries` : 'crew/_shared/discoveries')
      : crewNamespace('discoveries', null, projectHash);
    const topDiscoveries = blink.query(`${discoveryNs} order by hit_count desc limit 5`);

    if (topDiscoveries.length > 0) {
      contextParts.push(
        `## Top Discoveries\n` +
        topDiscoveries.map(d => `- ${d.title}: ${d.summary?.slice(0, 100) || ''}`).join('\n')
      );
    }

    // Surface file knowledge from previous sessions
    try {
      const knowledgeNs = crewNamespace('knowledge/files', crewId, projectHash);
      const recentKnowledge = blink.query(`${knowledgeNs} order by updated_at desc limit 5`);
      if (recentKnowledge.length > 0) {
        contextParts.push(
          `## File Knowledge\n` +
          recentKnowledge.map(k => `- ${k.title}: ${k.summary?.slice(0, 100) || ''}`).join('\n')
        );
      }
    } catch { /* graceful degradation */ }

    const recentFiles = blink.search('file', undefined, 3);

    if (recentFiles.length > 0) {
      contextParts.push(
        `## Recent Files\n` +
        recentFiles.map(f => `- ${f.title}: ${f.summary?.slice(0, 80) || ''}`).join('\n')
      );
    }

    if (crewId) {
      const teamSessions = blink.list('crew', 'recent').slice(0, 3);
      const otherTeammates = teamSessions.filter(s =>
        !s.namespace.startsWith(`crew/${crewId.teammate_name}`)
      );
      if (otherTeammates.length > 0) {
        contextParts.push(
          `## Team Activity\n` +
          otherTeammates.map(s => `- ${s.title}: ${s.summary?.slice(0, 80) || ''}`).join('\n')
        );
      }

      // Shared team discoveries
      try {
        const sharedDiscoveryNs = crewNamespace('_shared/discoveries', crewId, projectHash);
        const result = blink.resolve(sharedDiscoveryNs);

        let discoveries = [];
        if (result?.record?.content && Array.isArray(result.record.content)) {
          // Resolve each child fully to get summary, source_teammate, etc.
          for (const child of result.record.content) {
            try {
              const full = blink.resolve(child.path);
              if (full?.record) discoveries.push(full.record);
            } catch { /* skip */ }
          }
        } else if (result?.record?.summary) {
          discoveries = [result.record];
        }

        // Sort by timestamp descending, show recent 5
        discoveries.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        const recentDiscoveries = discoveries.slice(0, 5);

        if (recentDiscoveries.length > 0) {
          const lines = ['## Shared Team Discoveries'];
          recentDiscoveries.forEach(d => {
            const source = d.content?.source_teammate || 'unknown';
            const sourceAgent = d.content?.source_agent ? ` (${d.content.source_agent})` : '';
            lines.push(`- [${source}${sourceAgent}]: ${d.summary || d.title}`);
          });
          contextParts.push(lines.join('\n'));
        }
      } catch (err) {
        // Graceful degradation - discovery surfacing is non-critical
      }
    }

    // Team profile awareness — inject .crew-config.json context
    const crewConfigPath = resolve(process.cwd(), '.crew-config.json');
    if (existsSync(crewConfigPath)) {
      try {
        const crewConfig = JSON.parse(readFileSync(crewConfigPath, 'utf-8'));
        const baseStateDir = resolve(homedir(), '.claude', 'crew', projectHash);

        if (crewConfig.profiles) {
          // New multi-profile format
          const profileNames = Object.keys(crewConfig.profiles);
          let parts = [`## Crew Profiles: ${profileNames.join(', ')}`];
          if (crewConfig.default) parts.push(`Default: ${crewConfig.default}`);

          // Load worktrees.json for path information
          const worktreesPath = resolve(baseStateDir, 'worktrees.json');
          const worktreeMap = {};
          if (existsSync(worktreesPath)) {
            try {
              const worktreesData = JSON.parse(readFileSync(worktreesPath, 'utf-8'));
              for (const wt of worktreesData.worktrees || []) {
                worktreeMap[wt.name] = wt.path;
              }
            } catch { /* silent */ }
          }

          for (const pName of profileNames) {
            const profile = crewConfig.profiles[pName];
            parts.push(`\n### ${pName}: ${profile.name}`);
            parts.push(`Teammates: ${profile.teammates.map(t => t.name).join(', ')}`);

            const statePath = resolve(baseStateDir, pName, 'team-state.json');
            if (existsSync(statePath)) {
              const state = JSON.parse(readFileSync(statePath, 'utf-8'));
              const ageHours = Math.round((Date.now() - new Date(state.updated_at).getTime()) / 3600000);

              // Stale threshold (profile > top-level > default 4h)
              const staleAfterHours = profile.stale_after_hours ?? crewConfig.stale_after_hours ?? 4;
              const isStale = ageHours > staleAfterHours;

              parts.push('');
              parts.push('| Teammate | Status | Branch | Worktree |');
              parts.push('|----------|--------|--------|----------|');
              for (const [name, mate] of Object.entries(state.teammates || {})) {
                const wtPath = mate.worktree_path || worktreeMap[name] || 'N/A';
                const shortPath = wtPath !== 'N/A' ? wtPath.split('/').slice(-2).join('/') : 'N/A';
                parts.push(`| ${name} | ${mate.status} | ${mate.branch || 'unknown'} | ${shortPath} |`);
              }
              parts.push('');
              parts.push(`Last active: ${ageHours}h ago${isStale ? ' (STALE)' : ''}`);

              // Inject teammate activity if in lead session (no crewId) and team is active
              if (!crewId && !isStale) {
                try {
                  const __filename = fileURLToPath(import.meta.url);
                  const __dirname = dirname(__filename);
                  const { getTeammateActivity, detectOverlaps } = await import(
                    join(__dirname, '..', 'crew', 'lib', 'activity-monitor.js')
                  );

                  const activities = getTeammateActivity(getCapsuleDbPath(), projectHash, { limit: 3 });

                  if (activities.length > 0) {
                    parts.push('');
                    parts.push('## Teammate Activity');
                    for (const activity of activities) {
                      const ageMinutes = Math.round((Date.now() - activity.lastActive) / 60000);
                      const files = activity.recentOps.map(op => op.file.split('/').pop()).join(', ');
                      if (files) {
                        parts.push(`- ${activity.teammateName}: ${files} (${ageMinutes}m ago)`);
                      }
                    }

                    // Check for overlaps
                    const overlaps = detectOverlaps(activities);
                    if (overlaps.length > 0) {
                      parts.push('');
                      parts.push('⚠️  **Overlap Warning:**');
                      for (const overlap of overlaps) {
                        const fileName = overlap.file.split('/').pop();
                        parts.push(`- ${fileName}: touched by ${overlap.teammates.join(', ')}`);
                      }
                    }
                  }
                } catch (err) {
                  // Graceful degradation - activity monitoring is non-critical
                }
              }

              if (!isStale) {
                parts.push(`\nResumable. Use \`cck crew start ${pName}\` to launch.`);
              } else {
                parts.push(`\nStale (>${staleAfterHours}h). Use \`cck crew start ${pName}\` for fresh launch.`);
              }
            } else {
              parts.push(`No previous session. Use \`cck crew start ${pName}\` to launch.`);
            }
          }
          contextParts.push(parts.join('\n'));
        } else if (crewConfig.team) {
          // Old single-team format
          let parts = [`## Team: ${crewConfig.team.name}`];
          parts.push(`Teammates: ${crewConfig.team.teammates.map(t => t.name).join(', ')}`);

          // Load worktrees.json for path information
          const worktreesPath = resolve(baseStateDir, 'worktrees.json');
          const worktreeMap = {};
          if (existsSync(worktreesPath)) {
            try {
              const worktreesData = JSON.parse(readFileSync(worktreesPath, 'utf-8'));
              for (const wt of worktreesData.worktrees || []) {
                worktreeMap[wt.name] = wt.path;
              }
            } catch { /* silent */ }
          }

          // Check both old flat path and new profile-scoped path
          const oldStatePath = resolve(baseStateDir, 'team-state.json');
          const newStatePath = resolve(baseStateDir, 'default', 'team-state.json');
          const statePath = existsSync(newStatePath) ? newStatePath : oldStatePath;

          if (existsSync(statePath)) {
            const state = JSON.parse(readFileSync(statePath, 'utf-8'));
            const ageHours = Math.round((Date.now() - new Date(state.updated_at).getTime()) / 3600000);

            // Stale threshold (top-level > default 4h)
            const staleAfterHours = crewConfig.stale_after_hours ?? 4;
            const isStale = ageHours > staleAfterHours;

            parts.push('');
            parts.push('| Teammate | Status | Branch | Worktree |');
            parts.push('|----------|--------|--------|----------|');
            for (const [name, mate] of Object.entries(state.teammates || {})) {
              const wtPath = mate.worktree_path || worktreeMap[name] || 'N/A';
              const shortPath = wtPath !== 'N/A' ? wtPath.split('/').slice(-2).join('/') : 'N/A';
              parts.push(`| ${name} | ${mate.status} | ${mate.branch || 'unknown'} | ${shortPath} |`);
            }
            parts.push('');
            parts.push(`Last active: ${ageHours}h ago${isStale ? ' (STALE)' : ''}`);

            // Inject teammate activity if in lead session (no crewId) and team is active
            if (!crewId && !isStale) {
              try {
                const __filename = fileURLToPath(import.meta.url);
                const __dirname = dirname(__filename);
                const { getTeammateActivity, detectOverlaps } = await import(
                  join(__dirname, '..', 'crew', 'lib', 'activity-monitor.js')
                );

                const activities = getTeammateActivity(getCapsuleDbPath(), projectHash, { limit: 3 });

                if (activities.length > 0) {
                  parts.push('');
                  parts.push('## Teammate Activity');
                  for (const activity of activities) {
                    const ageMinutes = Math.round((Date.now() - activity.lastActive) / 60000);
                    const files = activity.recentOps.map(op => op.file.split('/').pop()).join(', ');
                    if (files) {
                      parts.push(`- ${activity.teammateName}: ${files} (${ageMinutes}m ago)`);
                    }
                  }

                  // Check for overlaps
                  const overlaps = detectOverlaps(activities);
                  if (overlaps.length > 0) {
                    parts.push('');
                    parts.push('⚠️  **Overlap Warning:**');
                    for (const overlap of overlaps) {
                      const fileName = overlap.file.split('/').pop();
                      parts.push(`- ${fileName}: touched by ${overlap.teammates.join(', ')}`);
                    }
                  }
                }
              } catch (err) {
                // Graceful degradation - activity monitoring is non-critical
              }
            }

            if (!isStale) {
              parts.push('\nTeammates may be resumable. Use `cck crew start` to launch.');
            } else {
              parts.push(`\nStale (>${staleAfterHours}h). Use \`cck crew start\` for fresh launch.`);
            }
          } else {
            parts.push('No previous team session. Use `cck crew start` to launch.');
          }
          contextParts.push(parts.join('\n'));
        }
      } catch { /* silent */ }
    }

    let context = contextParts.length > 0
      ? `# Capsule Context\n\n${contextParts.join('\n\n')}\n\n---`
      : '';

    if (didCleanup) {
      context += '\n\n[CCK] Cleaned up local v2 artifacts from this project.';
    }

    blink.close();

    const response = {
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: context
      }
    };

    console.log(JSON.stringify(response));

  } catch (error) {
    // Graceful degradation - don't block session start if database doesn't exist yet
    if (error.code === 'SQLITE_CANTOPEN' || error.message?.includes('no such file')) {
      process.exit(0);
    }

    console.error(`[session-start.js] Error: ${error.message}`);
    process.exit(0);
  }
}

main();
