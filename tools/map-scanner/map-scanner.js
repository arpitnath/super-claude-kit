#!/usr/bin/env node
/**
 * Map Scanner — walks a git project, classifies every source file,
 * extracts imports/exports, and stores structured records in Capsule.
 *
 * Usage:  node tools/map-scanner/map-scanner.js [projectRoot]
 *         Defaults to cwd if no argument given.
 *
 * Records written:
 *   map/{hash}/ast/{relPath}   META  — per-file AST + role
 *   map/{hash}/ast/{dir}/      META  — per-directory collection
 *   map/{hash}/overview        SUMMARY — tech stack overview
 *   map/{hash}/meta            META  — scan metadata
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { resolve, relative, dirname, extname } from 'path';
import { basename } from 'path';
import { Blink } from 'blink-query';
import { getCapsuleDbPath, getProjectHash } from '../../hooks/lib/crew-detect.js';
import { extractAst } from './ast-extractor.js';

// ── Supported extensions ──────────────────────────────────────────────────────

const SUPPORTED_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go']);

// ── File role classifier (15 categories, from knowledge-extractor.js) ─────────

function classifyFileRole(filePath) {
  const lower = filePath.toLowerCase();
  const base = basename(filePath).toLowerCase();

  if (lower.includes('__test__') || lower.includes('.test.') ||
      lower.includes('.spec.') || lower.includes('_test.') ||
      lower.includes('/test/') || lower.includes('/tests/')) return 'test';

  if (lower.includes('/config/') || lower.includes('.config.') ||
      base.endsWith('.env') || base.endsWith('.yml') || base.endsWith('.yaml') ||
      base.endsWith('.toml') || base === 'tsconfig.json' ||
      base === 'jest.config.js' || base === 'vitest.config.ts' ||
      base === '.eslintrc.js' || base === '.prettierrc') return 'config';

  if (base === 'dockerfile' || base.startsWith('docker-compose') ||
      base === 'makefile' || lower.includes('/deploy/') ||
      lower.includes('/infra/') || lower.includes('/terraform/')) return 'infra';

  if (lower.includes('/middleware/') || lower.includes('middleware.')) return 'middleware';

  if (lower.includes('/route/') || lower.includes('/routes/') ||
      lower.includes('/api/') || lower.includes('/endpoints/')) return 'route';

  if (lower.includes('/model/') || lower.includes('/models/') ||
      lower.includes('/schema/') || lower.includes('/schemas/') ||
      lower.includes('/entity/') || lower.includes('/entities/')) return 'model';

  if (lower.includes('/hook/') || lower.includes('/hooks/')) return 'hook';

  if (lower.includes('/component/') || lower.includes('/components/') ||
      lower.includes('/views/') || lower.includes('/pages/')) return 'component';

  if (lower.includes('/migration/') || lower.includes('/migrations/')) return 'migration';

  if (lower.includes('/util/') || lower.includes('/utils/') ||
      lower.includes('/helpers/') || lower.includes('/lib/') ||
      lower.includes('/shared/') || lower.includes('/common/')) return 'utility';

  if (base === 'index.ts' || base === 'index.js' || base === 'main.ts' ||
      base === 'main.js' || base === 'app.ts' || base === 'app.js' ||
      base === 'server.ts' || base === 'server.js' || base === 'main.go' ||
      base === 'main.py') return 'entry-point';

  if (base.endsWith('.md') || base.endsWith('.mdx')) return 'documentation';

  return 'source';
}

// ── Tech stack detection ──────────────────────────────────────────────────────

function detectTechStack(projectRoot, files) {
  const stack = [];
  const languages = new Set();

  for (const f of files) {
    const ext = extname(f).toLowerCase();
    if (['.ts', '.tsx'].includes(ext)) languages.add('TypeScript');
    else if (['.js', '.jsx', '.mjs', '.cjs'].includes(ext)) languages.add('JavaScript');
    else if (ext === '.py') languages.add('Python');
    else if (ext === '.go') languages.add('Go');
  }
  languages.forEach(l => stack.push(l));

  // Check package.json for frameworks
  const pkgPath = resolve(projectRoot, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (allDeps.react) stack.push('React');
      if (allDeps.next) stack.push('Next.js');
      if (allDeps.vue) stack.push('Vue');
      if (allDeps.express) stack.push('Express');
      if (allDeps.fastify) stack.push('Fastify');
      if (allDeps.vitest || allDeps.jest) stack.push('Testing');
      if (allDeps.typescript) stack.push('TypeScript (explicit dep)');
    } catch { /* ignore */ }
  }

  // Go module
  const goModPath = resolve(projectRoot, 'go.mod');
  if (existsSync(goModPath)) {
    try {
      const content = readFileSync(goModPath, 'utf-8');
      const modMatch = content.match(/^module\s+(\S+)/m);
      if (modMatch) stack.push(`Go module: ${modMatch[1]}`);
    } catch { /* ignore */ }
  }

  // Python requirements
  const reqPath = resolve(projectRoot, 'requirements.txt');
  if (existsSync(reqPath)) {
    try {
      const lines = readFileSync(reqPath, 'utf-8').split('\n').slice(0, 5).map(l => l.split('==')[0].trim()).filter(Boolean);
      if (lines.length) stack.push(`Python deps: ${lines.slice(0, 3).join(', ')}`);
    } catch { /* ignore */ }
  }

  return stack;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const projectRoot = resolve(process.argv[2] || process.cwd());

  console.log(`Map Scanner: scanning ${projectRoot}`);

  // Get git-tracked files
  let allFiles;
  try {
    allFiles = execSync('git ls-files', { cwd: projectRoot, encoding: 'utf-8' })
      .split('\n')
      .map(f => f.trim())
      .filter(Boolean);
  } catch (err) {
    console.error('Error: git ls-files failed. Is this a git repository?', err.message);
    process.exit(1);
  }

  // Filter to supported source files
  const sourceFiles = allFiles.filter(f => SUPPORTED_EXTS.has(extname(f).toLowerCase()));

  console.log(`Found ${allFiles.length} git-tracked files, ${sourceFiles.length} source files to scan.`);

  // Open Capsule DB
  const dbPath = getCapsuleDbPath();
  const blink = new Blink({ dbPath });

  // Compute project hash — run from projectRoot so git remote resolves correctly
  let projectHash;
  try {
    const origin = execSync('git remote get-url origin', {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    const { createHash } = await import('crypto');
    projectHash = createHash('sha256').update(origin).digest('hex').slice(0, 12);
  } catch {
    const { createHash } = await import('crypto');
    projectHash = createHash('sha256').update(projectRoot).digest('hex').slice(0, 12);
  }

  console.log(`Project hash: ${projectHash}`);

  // Per-file scan
  const dirFiles = {}; // dir → [{ relPath, role, language }]

  for (let i = 0; i < sourceFiles.length; i++) {
    const relPath = sourceFiles[i];
    const absPath = resolve(projectRoot, relPath);

    process.stdout.write(`Scanning file ${i + 1} of ${sourceFiles.length}: ${relPath}\n`);

    const ast = extractAst(absPath);
    const role = classifyFileRole(relPath);
    const dir = dirname(relPath);

    // Store per-file META record
    blink.save({
      namespace: `map/${projectHash}/ast/${relPath}`,
      title: relPath,
      summary: `${role} (${ast.language}): ${ast.exports.length} exports, ${ast.imports.length} imports, ${ast.line_count} lines`,
      type: 'META',
      content: {
        relPath,
        absPath,
        role,
        language: ast.language,
        exports: ast.exports,
        imports: ast.imports,
        line_count: ast.line_count,
        scannedAt: Date.now(),
      },
      tags: ['map', 'ast', role, ast.language],
    });

    // Accumulate for directory records
    if (!dirFiles[dir]) dirFiles[dir] = [];
    dirFiles[dir].push({ relPath, role, language: ast.language });
  }

  // Store per-directory COLLECTION records
  for (const [dir, entries] of Object.entries(dirFiles)) {
    const roleCount = {};
    const langCount = {};
    for (const e of entries) {
      roleCount[e.role] = (roleCount[e.role] || 0) + 1;
      langCount[e.language] = (langCount[e.language] || 0) + 1;
    }
    const roleSummary = Object.entries(roleCount).map(([r, n]) => `${n} ${r}`).join(', ');
    const langSummary = Object.entries(langCount).map(([l, n]) => `${n} ${l}`).join(', ');

    const dirNs = dir === '.' ? `map/${projectHash}/ast/_root` : `map/${projectHash}/ast/${dir}/_dir`;
    blink.save({
      namespace: dirNs,
      title: dir,
      summary: `${entries.length} files — ${roleSummary} [${langSummary}]`,
      type: 'META',
      content: {
        dir,
        files: entries.map(e => e.relPath),
        roleBreakdown: roleCount,
        languageBreakdown: langCount,
        fileCount: entries.length,
        scannedAt: Date.now(),
      },
      tags: ['map', 'dir', dir],
    });
  }

  // Get last scan git SHA
  let lastScanSha;
  try {
    lastScanSha = execSync('git rev-parse --short HEAD', {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
  } catch {
    lastScanSha = 'unknown';
  }

  // Detect tech stack
  const techStack = detectTechStack(projectRoot, sourceFiles);

  // Language breakdown
  const langBreakdown = {};
  for (const f of sourceFiles) {
    const ext = extname(f).toLowerCase();
    langBreakdown[ext] = (langBreakdown[ext] || 0) + 1;
  }

  // Store project overview SUMMARY
  blink.save({
    namespace: `map/${projectHash}/overview`,
    title: 'Project Overview',
    summary: `${sourceFiles.length} source files across ${Object.keys(dirFiles).length} directories. Stack: ${techStack.join(', ') || 'unknown'}.`,
    type: 'SUMMARY',
    content: {
      projectRoot,
      projectHash,
      techStack,
      languageBreakdown: langBreakdown,
      directoryCount: Object.keys(dirFiles).length,
      fileCount: sourceFiles.length,
      lastScanSha,
      scannedAt: Date.now(),
    },
    tags: ['map', 'overview'],
  });

  // Store scan meta META
  blink.save({
    namespace: `map/${projectHash}/meta`,
    title: 'Scan Metadata',
    summary: `Scanned ${sourceFiles.length} files, sha ${lastScanSha}, ${new Date().toISOString()}`,
    type: 'META',
    content: {
      projectRoot,
      projectHash,
      file_count: sourceFiles.length,
      languages: [...new Set(sourceFiles.map(f => extname(f).toLowerCase()))],
      last_scan_sha: lastScanSha,
      timestamp: Date.now(),
    },
    tags: ['map', 'meta'],
  });

  console.log(`\nScan complete.`);
  console.log(`  Files scanned:   ${sourceFiles.length}`);
  console.log(`  Directories:     ${Object.keys(dirFiles).length}`);
  console.log(`  Tech stack:      ${techStack.join(', ') || 'unknown'}`);
  console.log(`  Last SHA:        ${lastScanSha}`);
  console.log(`  Capsule DB:      ${dbPath}`);
  console.log(`  Namespace:       map/${projectHash}/`);
}

main().catch(err => {
  console.error('map-scanner failed:', err);
  process.exit(1);
});
