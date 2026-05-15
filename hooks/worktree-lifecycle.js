#!/usr/bin/env node
/**
 * WorktreeLifecycle Hook - Crew Worktree Registration
 *
 * Handles both WorktreeCreate and WorktreeRemove events in a single hook.
 * Detects the event type from `hook_event_name` in the stdin JSON payload.
 *
 * WorktreeCreate: registers the worktree in the project-scoped registry
 *   and writes a crew-identity.json into the worktree root.
 *
 * WorktreeRemove: deregisters the worktree from the registry
 *   and cleans up any crew-identity.json files in the worktree.
 */

import { createInterface } from 'readline';
import { getProjectHash, isDisabled } from './lib/crew-detect.js';
import {
  registerWorktree,
  deregisterWorktree,
  writeCrewIdentity,
  removeCrewIdentity
} from './lib/worktree-registry.js';

async function main() {
  try {
    // Read hook input from stdin
    const rl = createInterface({ input: process.stdin });
    let inputJson = '';

    for await (const line of rl) {
      inputJson += line;
    }

    const input = JSON.parse(inputJson);
    const eventName = input.hook_event_name;

    if (isDisabled()) process.exit(0);

    const projectHash = getProjectHash();

    if (eventName === 'WorktreeCreate') {
      const { worktree_path, teammate_name, branch, project_root, team_name, profile_name } = input;

      if (!worktree_path || !teammate_name) {
        // Missing required fields — nothing we can do
        process.exit(0);
      }

      // Register in the project-scoped worktrees.json
      registerWorktree(projectHash, {
        name: teammate_name,
        branch: branch || null,
        path: worktree_path
      });

      // Write crew-identity.json into the worktree root
      writeCrewIdentity(worktree_path, {
        teammate_name,
        project_root: project_root || process.cwd(),
        branch: branch || null,
        team_name: team_name || null,
        profile_name: profile_name || 'default'
      });

    } else if (eventName === 'WorktreeRemove') {
      const { worktree_path, teammate_name } = input;

      if (teammate_name) {
        deregisterWorktree(projectHash, teammate_name);
      }

      if (worktree_path) {
        removeCrewIdentity(worktree_path);
      }

    } else {
      // Unknown event — exit silently
    }

    process.exit(0);

  } catch (error) {
    console.error(`[worktree-lifecycle.js] Error: ${error.message}`);
    process.exit(0);
  }
}

main();
