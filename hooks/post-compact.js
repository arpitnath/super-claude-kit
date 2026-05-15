#!/usr/bin/env node
/**
 * PostCompact Hook - Session Continuity After Context Compaction
 *
 * Fires right after Claude Code compacts the context window.
 * Re-injects the most recent pre-compact handoff document so the
 * session can resume with full context of what was happening.
 *
 * This is the reverse of pre-compact.js — reads from DB instead of writing.
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

    // Query for most recent handoff tagged 'pre-compact' or 'handoff'
    try {
      const allHandoffs = blink.search('handoff');

      // Filter to this teammate's handoffs in crew mode
      const relevantHandoffs = crewId
        ? allHandoffs.filter(h => h.namespace?.includes(`crew/${crewId.teammate_name}/session`))
        : allHandoffs.filter(h => !h.namespace?.includes('crew/'));

      // Prefer pre-compact tags, then any handoff
      const preCompactHandoffs = relevantHandoffs.filter(h => {
        try {
          const tags = Array.isArray(h.tags) ? h.tags : [];
          return tags.includes('pre-compact');
        } catch {
          return false;
        }
      });

      const candidates = preCompactHandoffs.length > 0 ? preCompactHandoffs : relevantHandoffs;

      // Sort by timestamp (most recent first)
      candidates.sort((a, b) => {
        const aTime = typeof a.content === 'string'
          ? JSON.parse(a.content)?.generatedAt || 0
          : a.content?.generatedAt || 0;
        const bTime = typeof b.content === 'string'
          ? JSON.parse(b.content)?.generatedAt || 0
          : b.content?.generatedAt || 0;
        return bTime - aTime;
      });

      const handoff = candidates[0];
      if (handoff?.summary) {
        const teammateSuffix = crewId ? ` (${crewId.teammate_name})` : '';
        contextParts.push(`## Resuming After Compaction${teammateSuffix}\n\n${handoff.summary}`);
      }
    } catch {
      // Graceful degradation - handoff is optional
    }

    // Query top 3 discoveries
    try {
      const discoveryNs = crewId
        ? (projectHash ? `proj/${projectHash}/crew/_shared/discoveries` : 'crew/_shared/discoveries')
        : crewNamespace('discoveries', null, projectHash);
      const topDiscoveries = blink.query(`${discoveryNs} order by hit_count desc limit 3`);

      if (topDiscoveries.length > 0) {
        contextParts.push(
          `## Top Discoveries\n` +
          topDiscoveries.map(d => `- ${d.title}: ${d.summary?.slice(0, 100) || ''}`).join('\n')
        );
      }
    } catch {
      // Graceful degradation
    }

    blink.close();

    const context = contextParts.length > 0
      ? `# Capsule Context (Post-Compaction)\n\n${contextParts.join('\n\n')}\n\n---`
      : '';

    const response = {
      hookSpecificOutput: {
        hookEventName: 'PostCompact',
        additionalContext: context
      }
    };

    console.log(JSON.stringify(response));

  } catch (error) {
    // Never block post-compaction — fail silently
    process.exit(0);
  }
}

main();
