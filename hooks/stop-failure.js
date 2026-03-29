#!/usr/bin/env node
/**
 * StopFailure Hook - Emergency Save on API Errors
 *
 * Fires when Claude Code stops due to an API error or unexpected failure.
 * Performs an emergency save of the session handoff so context is not
 * lost on unexpected exits.
 *
 * Extra defensive: double try/catch, ultra-fast, never blocks.
 * Template: session-end.js
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
  // Outer try/catch — absolute last resort, must always exit 0
  try {
    let input = {};
    try {
      const rl = createInterface({ input: process.stdin });
      let inputJson = '';
      for await (const line of rl) {
        inputJson += line;
      }
      input = JSON.parse(inputJson);
    } catch {
      // Can't parse input — use defaults and continue saving
    }

    const sessionId = input.session_id || 'default';
    const errorMessage = input.error || input.reason || 'Unknown error';
    const stopReason = input.stop_reason || input.reason || 'failure';

    if (isDisabled()) process.exit(0);

    const projectHash = getProjectHash();
    const crewId = getCrewIdentity();
    const dbPath = getCapsuleDbPath();
    const branch = getCurrentBranch();

    // Inner try/catch — DB operations may fail, but we still exit 0
    try {
      const handoff = generateHandoff(dbPath, sessionId, crewId, projectHash);

      const blink = new Blink({ dbPath });

      // Emergency handoff save
      blink.save({
        namespace: crewNamespace(`session/${sessionId}/handoff`, crewId, projectHash),
        title: `Emergency handoff ${sessionId}`,
        summary: handoff,
        type: 'SUMMARY',
        content: {
          sessionId,
          teammateName: crewId?.teammate_name || null,
          branch,
          trigger: 'stop-failure',
          errorMessage,
          stopReason,
          generatedAt: Date.now()
        },
        tags: ['handoff', 'emergency', sessionId, ...(crewId ? [crewId.teammate_name] : [])]
      });

      // Save error details as META record for diagnostics
      blink.save({
        namespace: crewNamespace(`session/${sessionId}/errors`, crewId, projectHash),
        title: `Error ${new Date().toISOString()}`,
        summary: `API error in session ${sessionId}: ${String(errorMessage).slice(0, 200)}`,
        type: 'META',
        content: {
          sessionId,
          teammateName: crewId?.teammate_name || null,
          branch,
          errorMessage,
          stopReason,
          occurredAt: Date.now()
        },
        tags: ['error', 'emergency', sessionId, ...(crewId ? [crewId.teammate_name] : [])]
      });

      blink.close();
    } catch {
      // Inner catch — DB save failed, still exit cleanly
    }

    process.exit(0);

  } catch {
    // Outer catch — absolute fallback, never block the stop event
    process.exit(0);
  }
}

main();
