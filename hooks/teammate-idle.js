#!/usr/bin/env node
/**
 * TeammateIdle Hook - Capsule Integration
 *
 * Saves state when a teammate goes idle. Generates a handoff document,
 * saves it to Capsule with the 'teammate-idle' tag, and updates
 * team-state.json to reflect the idle status.
 *
 * Crew-aware: scopes to teammate namespace in the shared DB.
 */

import { Blink } from 'blink-query';
import { createInterface } from 'readline';
import { getCapsuleDbPath, getCrewIdentity, crewNamespace, getProjectHash, isDisabled } from './lib/crew-detect.js';
import { generateHandoff } from './lib/handoff-generator.js';
import { saveWithWikilinks } from './lib/wikilink-save.js';
import { updateTeammateState } from '../crew/lib/team-state-manager.js';

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
    const crewId = getCrewIdentity();

    // Shared DB in crew mode, local otherwise
    const dbPath = getCapsuleDbPath();
    const blink = new Blink({ dbPath });

    // Generate handoff document from session activity
    const handoff = generateHandoff(dbPath, sessionId, crewId, projectHash);

    // Save handoff to Capsule with 'teammate-idle' tag
    saveWithWikilinks(blink, {
      namespace: crewNamespace(`session/${sessionId}/handoff`, crewId, projectHash),
      title: `Teammate Idle — Session ${sessionId}`,
      summary: handoff,
      type: 'SUMMARY',
      content: {
        sessionId,
        teammateName: crewId?.teammate_name || input.teammate_name || null,
        teamName: crewId?.team_name || input.team_name || null,
        idleAt: Date.now()
      },
      tags: ['handoff', 'teammate-idle', sessionId, ...(crewId ? [crewId.teammate_name] : [])]
    }, projectHash);

    blink.close();

    // Update team-state.json when in crew mode
    if (crewId) {
      try {
        const profileName = crewId.profile_name || 'default';
        updateTeammateState(projectHash, crewId.teammate_name, {
          status: 'idle',
          last_active: new Date().toISOString()
        }, profileName);
      } catch { /* best effort */ }
    }

    process.exit(0);

  } catch (error) {
    console.error(`[teammate-idle.js] Error: ${error.message}`);
    process.exit(0);
  }
}

main();
