#!/usr/bin/env node
/**
 * dep-linker.js — Dependency Resolution for the Codebase Map
 *
 * Runs after map-scanner.js populates capsule.db with AST records.
 * Reads file records from map/{hash}/ast/, resolves import specifiers to
 * actual file paths, builds imported_by reverse edges, identifies hub files
 * and entry points, and updates directory COLLECTIONs and the project overview.
 *
 * Usage (API): import { linkDependencies } from './dep-linker.js'
 * Usage (CLI): node dep-linker.js [projectRoot]
 */

import { Blink } from 'blink-query';
import { resolve, dirname, basename, join, extname } from 'path';
import { existsSync } from 'fs';
import { createHash } from 'crypto';
import { execSync } from 'child_process';
import { homedir } from 'os';

// Extensions to probe when resolving bare relative specifiers
const PROBE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go'];

// Index file names to try when a specifier resolves to a directory
const INDEX_BASENAMES = ['index.ts', 'index.tsx', 'index.js', 'index.jsx', 'index.py', '__init__.py'];

// Basenames (without extension) that mark a file as an entry point when it has no importers
const ENTRY_POINT_BASENAMES = new Set(['index', 'main', 'app', 'server', 'cmd', 'cli', 'start']);

// ─── helpers ──────────────────────────────────────────────────────────────────

function getCapsuleDbPath() {
  const globalDbPath = resolve(homedir(), '.claude', 'capsule.db');
  if (existsSync(globalDbPath)) return globalDbPath;
  let dir = process.cwd();
  while (dir !== '/') {
    const candidate = resolve(dir, '.claude', 'capsule.db');
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  return resolve(process.cwd(), '.claude', 'capsule.db');
}

export function computeProjectHash(projectRoot) {
  let identifier;
  try {
    identifier = execSync('git remote get-url origin', {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    identifier = projectRoot;
  }
  return createHash('sha256').update(identifier).digest('hex').slice(0, 12);
}

/**
 * Derive the relative file path from a blink record.
 * Handles three storage patterns that map-scanner might use:
 *   1. content.relativePath is authoritative (preferred)
 *   2. namespace = map/{hash}/ast/{relDir}, title = filename.ts
 *   3. namespace = map/{hash}/ast/{relPath.ts} (full path as namespace)
 */
function deriveRelativePath(record, astNs) {
  let content;
  try {
    content = typeof record.content === 'string'
      ? JSON.parse(record.content)
      : record.content || {};
  } catch {
    content = {};
  }

  if (content.relativePath) return { relPath: content.relativePath.replace(/\\/g, '/'), content };

  const nsStripped = record.namespace.replace(new RegExp(`^${escapeRegex(astNs)}/?`), '');

  if (nsStripped === '') {
    // Pattern 3 or standalone: title holds path
    return { relPath: record.title.replace(/\\/g, '/'), content };
  }

  // Check if the stripped ns itself looks like a file path (has an extension)
  if (/\.[a-zA-Z0-9]+$/.test(nsStripped)) {
    return { relPath: nsStripped.replace(/\\/g, '/'), content };
  }

  // Pattern 2: dir in ns, filename in title
  return { relPath: `${nsStripped}/${record.title}`.replace(/\\/g, '/'), content };
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Resolve one import specifier to a relative file path.
 * Returns { specifier, resolved: 'src/foo/bar.ts' | null, external: bool }.
 */
function resolveImport(specifier, importerRelPath, fileSet) {
  // Non-relative → external (npm package, Node built-in, Go stdlib, etc.)
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
    return { specifier, resolved: null, external: true };
  }

  const importerDir = dirname(importerRelPath);
  // Normalise to forward slashes and strip leading ./
  const base = join(importerDir, specifier).replace(/\\/g, '/');

  // 1. Exact match (specifier already has extension)
  if (fileSet.has(base)) return { specifier, resolved: base, external: false };

  // 2. Probe extensions
  for (const ext of PROBE_EXTENSIONS) {
    const candidate = base + ext;
    if (fileSet.has(candidate)) return { specifier, resolved: candidate, external: false };
  }

  // 3. Index files (specifier points at a directory)
  for (const indexFile of INDEX_BASENAMES) {
    const candidate = `${base}/${indexFile}`;
    if (fileSet.has(candidate)) return { specifier, resolved: candidate, external: false };
  }

  // 4. Strip existing extension on specifier and re-probe (e.g. import from './foo.js' in TS)
  const baseNoExt = base.replace(/\.[^/.]+$/, '');
  if (baseNoExt !== base) {
    for (const ext of PROBE_EXTENSIONS) {
      const candidate = baseNoExt + ext;
      if (fileSet.has(candidate)) return { specifier, resolved: candidate, external: false };
    }
  }

  return { specifier, resolved: null, external: false };
}

function parseContent(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

// ─── main export ──────────────────────────────────────────────────────────────

/**
 * Link all file records in map/{projectHash}/ast/ with resolved dependency edges.
 *
 * @param {string} projectRoot - Absolute path to the project root
 * @param {string} projectHash - 12-char SHA256 prefix for this project
 */
export async function linkDependencies(projectRoot, projectHash) {
  const dbPath = getCapsuleDbPath();
  const blink = new Blink({ dbPath });

  const astNs = `map/${projectHash}/ast`;

  // ── 1. Fetch all records under the ast namespace ──────────────────────────
  let allRecords = [];
  try {
    allRecords = await blink.list(astNs);
  } catch (err) {
    console.error(`dep-linker: failed to list namespace ${astNs}:`, err.message);
    blink.close();
    return { hubFiles: [], entryPoints: [], fileCount: 0 };
  }

  // ── 2. Separate file records (META) from directories (COLLECTION/SUMMARY) ─
  const fileRecords = allRecords.filter(r => r.type === 'META');

  if (fileRecords.length === 0) {
    console.log(`dep-linker: no file records found in ${astNs}. Run map-scanner first.`);
    blink.close();
    return { hubFiles: [], entryPoints: [], fileCount: 0 };
  }

  // ── 3. Build file map: relPath → { record, content } ─────────────────────
  const files = new Map(); // relPath → { record, content }

  for (const record of fileRecords) {
    const { relPath, content } = deriveRelativePath(record, astNs);
    if (!relPath) continue;
    // Prefer the most recently updated record if duplicates exist
    if (!files.has(relPath) || record.updated_at > files.get(relPath).record.updated_at) {
      files.set(relPath, { record, content });
    }
  }

  const fileSet = new Set(files.keys());

  // ── 4. Resolve imports; accumulate imported_by ────────────────────────────
  const resolvedImportsMap = new Map(); // relPath → resolved import objects
  const importedByMap = new Map();      // relPath → Set<importer relPath>
  for (const relPath of fileSet) importedByMap.set(relPath, new Set());

  for (const [relPath, { content }] of files) {
    const rawImports = Array.isArray(content.imports) ? content.imports : [];
    const resolvedList = [];

    for (const imp of rawImports) {
      // Imports may already be objects (partially resolved) or plain strings
      const specifier = typeof imp === 'string' ? imp : (imp.specifier || String(imp));
      const result = resolveImport(specifier, relPath, fileSet);
      resolvedList.push(result);

      if (result.resolved) {
        if (!importedByMap.has(result.resolved)) {
          importedByMap.set(result.resolved, new Set());
        }
        importedByMap.get(result.resolved).add(relPath);
      }
    }

    resolvedImportsMap.set(relPath, resolvedList);
  }

  // ── 5. Write enriched file records back ──────────────────────────────────
  const fileSavePromises = [];
  for (const [relPath, { record, content }] of files) {
    const updatedContent = {
      ...content,
      relativePath: relPath,
      imports: resolvedImportsMap.get(relPath) || [],
      imported_by: Array.from(importedByMap.get(relPath) || []),
    };

    fileSavePromises.push(
      blink.save({
        namespace: record.namespace,
        title: record.title,
        type: 'META',
        summary: record.summary || relPath,
        tags: record.tags || [],
        content: updatedContent,
      })
    );
  }
  await Promise.all(fileSavePromises);

  // ── 6. Hub files: top 10 by imported_by count ────────────────────────────
  const ranked = Array.from(files.keys())
    .map(relPath => ({
      path: relPath,
      role: files.get(relPath).content.role,
      imported_by_count: (importedByMap.get(relPath) || new Set()).size,
    }))
    .sort((a, b) => b.imported_by_count - a.imported_by_count);

  const hubFiles = ranked
    .filter(f => f.imported_by_count > 0)
    .slice(0, 10)
    .map(f => ({ path: f.path, imported_by_count: f.imported_by_count }));

  // ── 7. Entry points: 0 importers + role or name match ────────────────────
  const entryPoints = ranked
    .filter(f => {
      if (f.imported_by_count > 0) return false;
      if (f.role === 'entry-point') return true;
      const base = basename(f.path, extname(f.path));
      return ENTRY_POINT_BASENAMES.has(base);
    })
    .map(f => ({ path: f.path, role: f.role || 'unknown' }));

  // ── 8. Update directory COLLECTION records ────────────────────────────────
  const dirMap = new Map(); // dir → relPaths[]
  for (const relPath of files.keys()) {
    const dir = dirname(relPath).replace(/\\/g, '/');
    if (!dirMap.has(dir)) dirMap.set(dir, []);
    dirMap.get(dir).push(relPath);
  }

  const collectionSaves = [];
  for (const [dir, dirFiles] of dirMap) {
    const totalImporters = dirFiles.reduce(
      (sum, f) => sum + (importedByMap.get(f) || new Set()).size, 0
    );
    const keyFiles = dirFiles
      .map(f => ({ path: f, count: (importedByMap.get(f) || new Set()).size }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map(f => f.path);

    const dirNs = (dir === '.' || dir === '') ? astNs : `${astNs}/${dir}`;
    const dirTitle = (dir === '.' || dir === '') ? 'root' : basename(dir);

    collectionSaves.push(
      blink.save({
        namespace: dirNs,
        title: dirTitle,
        type: 'COLLECTION',
        summary: `${dirFiles.length} file${dirFiles.length !== 1 ? 's' : ''}, ${totalImporters} total importers`,
        content: {
          total_importers: totalImporters,
          key_files: keyFiles,
          file_count: dirFiles.length,
        },
      })
    );
  }
  await Promise.all(collectionSaves);

  // ── 9. Update project overview ────────────────────────────────────────────
  // Read existing overview content so we can merge (not replace)
  let existingOverview = {};
  try {
    const overviewRecords = await blink.list(`map/${projectHash}`);
    const ov = overviewRecords.find(r => r.title === 'overview');
    if (ov) existingOverview = parseContent(ov.content);
  } catch { /* no existing overview */ }

  await blink.save({
    namespace: `map/${projectHash}`,
    title: 'overview',
    type: 'META',
    summary: `${files.size} files linked. Hubs: ${hubFiles.slice(0, 3).map(h => basename(h.path)).join(', ') || 'none'}`,
    content: {
      ...existingOverview,
      hub_files: hubFiles,
      entry_points: entryPoints,
      total_files: files.size,
      dep_linked_at: new Date().toISOString(),
    },
  });

  blink.close();

  // ── 10. Print summary ─────────────────────────────────────────────────────
  const hubLabel = hubFiles.slice(0, 5).map(h => `${h.path}(${h.imported_by_count})`).join(', ') || 'none';
  const epLabel = entryPoints.map(e => e.path).join(', ') || 'none';
  console.log(`Linked ${files.size} files. Hub files: [${hubLabel}]. Entry points: [${epLabel}].`);

  return { hubFiles, entryPoints, fileCount: files.size };
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

const isMain = process.argv[1]
  && (process.argv[1] === new URL(import.meta.url).pathname
      || process.argv[1].endsWith('dep-linker.js'));

if (isMain) {
  const projectRoot = resolve(process.argv[2] || process.cwd());
  const projectHash = computeProjectHash(projectRoot);
  console.log(`dep-linker: project root = ${projectRoot}`);
  console.log(`dep-linker: project hash = ${projectHash}`);
  linkDependencies(projectRoot, projectHash).catch(err => {
    console.error('dep-linker error:', err.message);
    process.exit(1);
  });
}
