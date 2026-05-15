#!/usr/bin/env node
/**
 * SubagentStart Hook - Inject Capsule Context into Subagents
 *
 * Fires when a subagent (Task tool) is spawned. Injects a concise
 * context snapshot so subagents have awareness of project state
 * without needing the full session history.
 *
 * Intentionally brief — subagents have limited context budgets.
 * Template: session-start.js (context injection pattern)
 */

import { Blink } from 'blink-query';
import { createInterface } from 'readline';
import { getCapsuleDbPath, getCrewIdentity, crewNamespace, getProjectHash, isDisabled } from './lib/crew-detect.js';

async function main() {
  try {
    const rl = createInterface({ input: process.stdin });
    let inputJson = '';
    for await (const line of rl) {
      inputJson += line;
    }

    const input = JSON.parse(inputJson);
    const sessionId = input.session_id || 'default';
    if (isDisabled()) process.exit(0);

    const projectHash = getProjectHash();
    const crewId = getCrewIdentity();
    const dbPath = getCapsuleDbPath();

    const blink = new Blink({ dbPath });
    const contextParts = [];

    // Top 5 discoveries (most accessed)
    try {
      const discoveryNs = crewId
        ? (projectHash ? `proj/${projectHash}/crew/_shared/discoveries` : 'crew/_shared/discoveries')
        : crewNamespace('discoveries', null, projectHash);
      const topDiscoveries = blink.query(`${discoveryNs} order by hit_count desc limit 5`);

      if (topDiscoveries.length > 0) {
        contextParts.push(
          `## Key Discoveries\n` +
          topDiscoveries.map(d => `- ${d.title}: ${d.summary?.slice(0, 80) || ''}`).join('\n')
        );
      }
    } catch {
      // Graceful degradation
    }

    // Recent file ops for this session (limit 5)
    try {
      const filesNs = crewNamespace(`session/${sessionId}/files`, crewId, projectHash);
      const recentFiles = blink.list(filesNs).slice(0, 5);

      if (recentFiles.length > 0) {
        contextParts.push(
          `## Recent Files\n` +
          recentFiles.map(f => `- ${f.title}: ${f.summary?.slice(0, 60) || ''}`).join('\n')
        );
      }
    } catch {
      // Graceful degradation
    }

    // Crew mode: include shared team discoveries
    if (crewId) {
      try {
        const sharedNs = projectHash
          ? `proj/${projectHash}/crew/_shared/discoveries`
          : 'crew/_shared/discoveries';
        const sharedResult = blink.resolve(sharedNs);

        let discoveries = [];
        if (sharedResult?.record?.content && Array.isArray(sharedResult.record.content)) {
          for (const child of sharedResult.record.content) {
            try {
              const full = blink.resolve(child.path);
              if (full?.record) discoveries.push(full.record);
            } catch { /* skip */ }
          }
        } else if (sharedResult?.record?.summary) {
          discoveries = [sharedResult.record];
        }

        discoveries.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        const recent = discoveries.slice(0, 3);

        if (recent.length > 0) {
          const lines = ['## Shared Team Discoveries'];
          recent.forEach(d => {
            const source = d.content?.source_teammate || 'unknown';
            lines.push(`- [${source}]: ${d.summary?.slice(0, 80) || d.title}`);
          });
          contextParts.push(lines.join('\n'));
        }
      } catch {
        // Graceful degradation
      }
    }

    blink.close();

    const context = contextParts.length > 0
      ? `# Capsule Context\n\n${contextParts.join('\n\n')}\n\n---`
      : '';

    const response = {
      hookSpecificOutput: {
        hookEventName: 'SubagentStart',
        additionalContext: context
      }
    };

    console.log(JSON.stringify(response));

  } catch (error) {
    // Graceful degradation — never block subagent spawn
    process.exit(0);
  }
}

main();
