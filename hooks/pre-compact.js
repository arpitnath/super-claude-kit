#!/usr/bin/env node
/**
 * PreCompact Hook - Session Continuity Before Context Compaction
 *
 * Fires right before Claude Code auto-compacts the context window.
 * Saves a rich handoff document to capsule.db so the post-compaction
 * session can resume with full context of what was happening.
 *
 * This is the most critical moment to save state — we still have
 * full context but it's about to be wiped.
 */

import { Blink } from 'blink-query';
import { createInterface } from 'readline';
import { execSync } from 'child_process';
import { getCapsuleDbPath, getCrewIdentity, crewNamespace, getProjectHash, isDisabled } from './lib/crew-detect.js';
import { generateHandoff } from './lib/handoff-generator.js';

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
    const branch = getCurrentBranch();

    // Generate handoff document while we still have full context
    const handoff = generateHandoff(dbPath, sessionId, crewId, projectHash);

    const blink = new Blink({ dbPath });

    // Save pre-compaction handoff (tagged distinctly so session-start can find the latest)
    blink.save({
      namespace: crewNamespace(`session/${sessionId}/handoff`, crewId, projectHash),
      title: `Pre-compact handoff ${sessionId}`,
      summary: handoff,
      type: 'SUMMARY',
      content: {
        sessionId,
        teammateName: crewId?.teammate_name || null,
        branch,
        trigger: 'pre-compact',
        generatedAt: Date.now()
      },
      tags: ['handoff', 'pre-compact', sessionId, ...(crewId ? [crewId.teammate_name] : [])]
    });

    // Extract session knowledge (modules, bugs, decisions) before context is lost
    try {
      const { extractSessionKnowledge } = await import('./lib/knowledge-extractor.js');
      extractSessionKnowledge(blink, sessionId, projectHash, crewId);
    } catch { /* knowledge extraction is non-critical */ }

    blink.close();
    process.exit(0);

  } catch (error) {
    // Never block compaction — fail silently
    process.exit(0);
  }
}

main();
