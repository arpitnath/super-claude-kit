/**
 * Worktree Registry - Shared library for managing worktrees.json
 *
 * Manages the project-scoped worktree registry at:
 *   ~/.claude/crew/{projectHash}/worktrees.json
 *
 * Also handles writing/removing crew-identity.json files in worktrees.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';

/**
 * Get the path to the project-scoped worktrees.json file.
 * @param {string} projectHash - 12-char project hash
 * @returns {string} Absolute path to worktrees.json
 */
function getRegistryPath(projectHash) {
  return resolve(homedir(), '.claude', 'crew', projectHash, 'worktrees.json');
}

/**
 * Read the worktree registry for a project.
 * Returns parsed JSON or an empty registry if the file doesn't exist.
 *
 * @param {string} projectHash - 12-char project hash
 * @returns {{ worktrees: Array<{name: string, branch: string, path: string}> }}
 */
export function readRegistry(projectHash) {
  const registryPath = getRegistryPath(projectHash);
  if (!existsSync(registryPath)) {
    return { worktrees: [] };
  }
  try {
    return JSON.parse(readFileSync(registryPath, 'utf-8'));
  } catch {
    return { worktrees: [] };
  }
}

/**
 * Register a worktree in the project's worktrees.json.
 * Skips if an entry with the same name already exists.
 *
 * @param {string} projectHash - 12-char project hash
 * @param {{ name: string, branch: string, path: string }} worktree - Worktree to register
 */
export function registerWorktree(projectHash, { name, branch, path }) {
  const registryPath = getRegistryPath(projectHash);
  const registry = readRegistry(projectHash);

  // Skip if already registered
  if (registry.worktrees.some(wt => wt.name === name)) {
    return;
  }

  registry.worktrees.push({ name, branch, path, registered_at: new Date().toISOString() });
  registry.updated_at = new Date().toISOString();

  mkdirSync(resolve(homedir(), '.claude', 'crew', projectHash), { recursive: true });
  writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n');
}

/**
 * Remove a worktree from the project's worktrees.json by name.
 *
 * @param {string} projectHash - 12-char project hash
 * @param {string} name - Worktree name to remove
 */
export function deregisterWorktree(projectHash, name) {
  const registryPath = getRegistryPath(projectHash);
  const registry = readRegistry(projectHash);

  const before = registry.worktrees.length;
  registry.worktrees = registry.worktrees.filter(wt => wt.name !== name);

  if (registry.worktrees.length === before) return; // nothing changed

  registry.updated_at = new Date().toISOString();
  writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n');
}

/**
 * Write a crew-identity.json file into a worktree root.
 *
 * @param {string} worktreePath - Absolute path to the worktree root
 * @param {{ teammate_name: string, project_root: string, branch: string, [key: string]: any }} identity
 */
export function writeCrewIdentity(worktreePath, identity) {
  const identityPath = resolve(worktreePath, 'crew-identity.json');
  const payload = {
    ...identity,
    created_at: identity.created_at || new Date().toISOString()
  };
  writeFileSync(identityPath, JSON.stringify(payload, null, 2) + '\n');
}

/**
 * Remove crew-identity.json from a worktree root (best effort).
 *
 * @param {string} worktreePath - Absolute path to the worktree root
 */
export function removeCrewIdentity(worktreePath) {
  const identityPath = resolve(worktreePath, 'crew-identity.json');
  try {
    if (existsSync(identityPath)) {
      rmSync(identityPath);
    }
  } catch { /* best effort */ }

  // Also clean up .claude/crew-identity.json if present
  const legacyPath = resolve(worktreePath, '.claude', 'crew-identity.json');
  try {
    if (existsSync(legacyPath)) {
      rmSync(legacyPath);
    }
  } catch { /* best effort */ }
}
