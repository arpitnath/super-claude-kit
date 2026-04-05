/**
 * AST Extractor — regex-based import/export extraction for JS/TS/Python/Go.
 *
 * Input:  file path (string)
 * Output: { language, exports: [{name, kind}], imports: [{specifier}], line_count }
 *
 * No tree-sitter, no TypeScript compiler. Pure regex.
 * Handles the 80% case; does not handle dynamic imports or complex macros.
 */

import { readFileSync } from 'fs';
import { extname } from 'path';

/** Detect language from file extension */
function detectLanguage(filePath) {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case '.ts':
    case '.tsx': return 'typescript';
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs': return 'javascript';
    case '.py': return 'python';
    case '.go': return 'go';
    default: return 'unknown';
  }
}

/** Strip block comments and string literals to avoid false positives */
function stripComments(src, language) {
  if (language === 'python') {
    // Remove triple-quoted strings and # comments
    src = src.replace(/"""[\s\S]*?"""/g, '""').replace(/'''[\s\S]*?'''/g, "''");
    src = src.replace(/#.*/g, '');
    return src;
  }
  if (language === 'go') {
    // Remove block comments and line comments
    src = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
    return src;
  }
  // JS/TS: remove block comments (keep line comments for now; they rarely contain import)
  src = src.replace(/\/\*[\s\S]*?\*\//g, '');
  src = src.replace(/\/\/.*/g, '');
  return src;
}

// ── JS/TS patterns ────────────────────────────────────────────────────────────

const JS_IMPORT_PATTERNS = [
  // import X from 'path'
  // import { X, Y } from 'path'
  // import * as X from 'path'
  // import 'path' (side-effect)
  /^import\s+(?:[\w*{},\s]+\s+from\s+)?['"]([^'"]+)['"]/m,
];

const JS_REQUIRE_PATTERN = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

const JS_EXPORT_PATTERNS = [
  { re: /^export\s+default\s+(?:function|class)\s+(\w+)/gm, kind: 'default' },
  { re: /^export\s+(?:async\s+)?function\s+(\w+)/gm, kind: 'function' },
  { re: /^export\s+class\s+(\w+)/gm, kind: 'class' },
  { re: /^export\s+(?:const|let|var)\s+(\w+)/gm, kind: 'variable' },
  { re: /^export\s+type\s+(\w+)/gm, kind: 'type' },
  { re: /^export\s+interface\s+(\w+)/gm, kind: 'interface' },
  { re: /^export\s+enum\s+(\w+)/gm, kind: 'enum' },
  // export { X, Y } — named re-exports
  { re: /^export\s+\{([^}]+)\}/gm, kind: 'named-group' },
];

// Separate check for export default (no name)
const JS_EXPORT_DEFAULT_RE = /^export\s+default\b/m;

// module.exports = { X, Y } or module.exports.X = ...
const MODULE_EXPORTS_PATTERN = /module\.exports\s*=\s*\{([^}]+)\}/g;
const MODULE_EXPORTS_DIRECT = /module\.exports\.(\w+)\s*=/g;

function extractJS(src) {
  const cleaned = stripComments(src, 'javascript');
  const imports = [];
  const exports = [];

  // ES imports — match all occurrences
  const importRe = /^import\s+(?:[\w*{},\s]+\s+from\s+)?['"]([^'"]+)['"]/gm;
  for (const m of cleaned.matchAll(importRe)) {
    imports.push({ specifier: m[1] });
  }

  // require()
  for (const m of cleaned.matchAll(JS_REQUIRE_PATTERN)) {
    // Avoid duplicates
    if (!imports.find(i => i.specifier === m[1])) {
      imports.push({ specifier: m[1] });
    }
  }

  // export default (no captured name)
  if (JS_EXPORT_DEFAULT_RE.test(cleaned)) exports.push({ name: 'default', kind: 'default' });

  // ES exports
  for (const { re, kind } of JS_EXPORT_PATTERNS) {
    re.lastIndex = 0;
    if (kind === 'named-group') {
      for (const m of cleaned.matchAll(re)) {
        const names = m[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
        for (const n of names) {
          if (n && !n.startsWith('//')) exports.push({ name: n, kind: 'named' });
        }
      }
    } else {
      for (const m of cleaned.matchAll(re)) {
        if (m[1]) exports.push({ name: m[1], kind });
      }
    }
  }

  // module.exports = { ... }
  for (const m of cleaned.matchAll(MODULE_EXPORTS_PATTERN)) {
    const names = m[1].split(',').map(s => s.trim().split(':')[0].trim()).filter(Boolean);
    for (const n of names) {
      if (n && !exports.find(e => e.name === n)) {
        exports.push({ name: n, kind: 'cjs' });
      }
    }
  }

  // module.exports.X = ...
  for (const m of cleaned.matchAll(MODULE_EXPORTS_DIRECT)) {
    if (m[1] && !exports.find(e => e.name === m[1])) {
      exports.push({ name: m[1], kind: 'cjs' });
    }
  }

  return { imports, exports };
}

// ── Python patterns ──────────────────────────────────────────────────────────

function extractPython(src) {
  const cleaned = stripComments(src, 'python');
  const imports = [];
  const exports = [];

  // import X / import X as Y / import X, Y
  const importRe = /^import\s+([\w.,\s]+)/gm;
  for (const m of cleaned.matchAll(importRe)) {
    for (const part of m[1].split(',')) {
      const mod = part.trim().split(/\s+as\s+/)[0].trim();
      if (mod) imports.push({ specifier: mod });
    }
  }

  // from X import Y / from .X import Y / from ..X import Z
  const fromImportRe = /^from\s+([\w.]+)\s+import\s+([\w*,\s]+)/gm;
  for (const m of cleaned.matchAll(fromImportRe)) {
    const mod = m[1].trim();
    if (mod) imports.push({ specifier: mod });
  }

  // __all__ = [...] defines public exports
  const allMatch = cleaned.match(/__all__\s*=\s*\[([^\]]+)\]/);
  if (allMatch) {
    const names = allMatch[1].match(/['"](\w+)['"]/g) || [];
    for (const n of names) {
      exports.push({ name: n.replace(/['"]/g, ''), kind: 'public' });
    }
  }

  // Top-level def / class as implicit exports
  const defRe = /^def\s+(\w+)\s*\(/gm;
  const classRe = /^class\s+(\w+)[\s(:]/gm;

  for (const m of cleaned.matchAll(defRe)) {
    if (!m[1].startsWith('_')) exports.push({ name: m[1], kind: 'function' });
  }
  for (const m of cleaned.matchAll(classRe)) {
    if (!m[1].startsWith('_')) exports.push({ name: m[1], kind: 'class' });
  }

  return { imports, exports };
}

// ── Go patterns ──────────────────────────────────────────────────────────────

function extractGo(src) {
  const cleaned = stripComments(src, 'go');
  const imports = [];
  const exports = [];

  // Single import: import "path"
  const singleImportRe = /^import\s+(?:\w+\s+)?["']([^"']+)["']/gm;
  for (const m of cleaned.matchAll(singleImportRe)) {
    imports.push({ specifier: m[1] });
  }

  // Block import: import ( ... )
  const blockImportRe = /^import\s*\(([\s\S]*?)\)/gm;
  for (const m of cleaned.matchAll(blockImportRe)) {
    const lineRe = /(?:\w+\s+)?["']([^"']+)["']/g;
    for (const line of m[1].matchAll(lineRe)) {
      imports.push({ specifier: line[1] });
    }
  }

  // Exported identifiers start with uppercase in Go
  const funcRe = /^func\s+(\([^)]+\)\s+)?([A-Z]\w*)\s*\(/gm;
  const typeRe = /^type\s+([A-Z]\w*)\s+/gm;
  const varConstRe = /^(?:var|const)\s+([A-Z]\w*)\s/gm;

  for (const m of cleaned.matchAll(funcRe)) {
    exports.push({ name: m[2], kind: 'function' });
  }
  for (const m of cleaned.matchAll(typeRe)) {
    exports.push({ name: m[1], kind: 'type' });
  }
  for (const m of cleaned.matchAll(varConstRe)) {
    exports.push({ name: m[1], kind: 'variable' });
  }

  return { imports, exports };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Extract imports and exports from a source file.
 *
 * @param {string} filePath - Absolute or relative path to the file
 * @returns {{ language: string, exports: Array<{name:string,kind:string}>, imports: Array<{specifier:string}>, line_count: number }}
 */
export function extractAst(filePath) {
  let src;
  try {
    src = readFileSync(filePath, 'utf-8');
  } catch {
    return { language: 'unknown', exports: [], imports: [], line_count: 0 };
  }

  const language = detectLanguage(filePath);
  const line_count = src.split('\n').length;

  let extracted = { imports: [], exports: [] };

  switch (language) {
    case 'javascript':
    case 'typescript':
      extracted = extractJS(src);
      break;
    case 'python':
      extracted = extractPython(src);
      break;
    case 'go':
      extracted = extractGo(src);
      break;
    default:
      break;
  }

  return {
    language,
    exports: extracted.exports,
    imports: extracted.imports,
    line_count,
  };
}
