#!/usr/bin/env node
/**
 * SessionEnd Hook - Capsule Integration
 *
 * Finalizes the session by creating a session summary record in Capsule.
 * Crew-aware: scopes to teammate namespace and writes to shared DB.
 */

import { Blink } from 'blink-query';
import { createInterface } from 'readline';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { resolve } from 'path';
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
    // Read hook input from stdin
    const rl = createInterface({ input: process.stdin });
    let inputJson = '';

    for await (const line of rl) {
      inputJson += line;
    }

    const input = JSON.parse(inputJson);
    const sessionId = input.session_id || 'default';
    if (isDisabled()) process.exit(0);
    const projectHash = getProjectHash();
    const currentBranch = getCurrentBranch();

    // Shared DB in crew mode, local otherwise
    const blink = new Blink({ dbPath: getCapsuleDbPath() });
    const crewId = getCrewIdentity();

    // Query session activity (from this teammate's namespace)
    const filesNs = crewNamespace(`session/${sessionId}/files`, crewId, projectHash);
    const agentsNs = crewNamespace(`session/${sessionId}/subagents`, crewId, projectHash);
    const sessionFiles = blink.list(filesNs);
    const sessionSubagents = blink.list(agentsNs);

    // Create session summary
    const teammateSuffix = crewId ? ` (${crewId.teammate_name})` : '';
    const summary = [
      `Session ${sessionId}${teammateSuffix}`,
      `Files accessed: ${sessionFiles.length}`,
      `Sub-agents used: ${sessionSubagents.length}`,
      `Completed at: ${new Date().toISOString()}`
    ].join(' | ');

    // Save SESSION record (META = structured session metadata)
    blink.save({
      namespace: crewNamespace('session', crewId, projectHash),
      title: `Session ${new Date().toISOString()}`,
      summary,
      type: 'META',
      content: {
        sessionId,
        teammateName: crewId?.teammate_name || null,
        branch: currentBranch,
        filesCount: sessionFiles.length,
        subagentsCount: sessionSubagents.length,
        endedAt: Date.now()
      },
      tags: ['session', sessionId, ...(crewId ? [crewId.teammate_name] : [])]
    });

    // Generate and save handoff document (SUMMARY type for direct consumption)
    const handoff = generateHandoff(getCapsuleDbPath(), sessionId, crewId, projectHash);
    blink.save({
      namespace: crewNamespace(`session/${sessionId}/handoff`, crewId, projectHash),
      title: `Session ${sessionId} Handoff`,
      summary: handoff,
      type: 'SUMMARY',
      content: {
        sessionId,
        teammateName: crewId?.teammate_name || null,
        branch: currentBranch,
        generatedAt: Date.now()
      },
      tags: ['handoff', sessionId, ...(crewId ? [crewId.teammate_name] : [])]
    });

    // Extract session knowledge (modules, bugs, decisions)
    try {
      const { extractSessionKnowledge } = await import('./lib/knowledge-extractor.js');
      extractSessionKnowledge(blink, sessionId, projectHash, crewId);
    } catch { /* knowledge extraction is non-critical */ }

    blink.close();

    // Update team-state.json when in crew mode
    if (crewId) {
      try {
        const profileName = crewId.profile_name || 'default';
        const baseStateDir = resolve(homedir(), '.claude', 'crew', projectHash);
        const profileStateDir = resolve(baseStateDir, profileName);

        // Try profile-scoped path first, then legacy flat path
        let statePath = resolve(profileStateDir, 'team-state.json');
        if (!existsSync(statePath)) {
          statePath = resolve(baseStateDir, 'team-state.json');
        }

        if (existsSync(statePath)) {
          const state = JSON.parse(readFileSync(statePath, 'utf-8'));
          if (state.teammates?.[crewId.teammate_name]) {
            state.teammates[crewId.teammate_name].last_active = new Date().toISOString();
            state.teammates[crewId.teammate_name].status = 'idle';
            state.updated_at = new Date().toISOString();
            writeFileSync(statePath, JSON.stringify(state, null, 2));
          }
        }
      } catch { /* best effort */ }
    }

    // No output needed for SessionEnd
    process.exit(0);

  } catch (error) {
    console.error(`[session-end.js] Error: ${error.message}`);
    process.exit(0);
  }
}

main();
