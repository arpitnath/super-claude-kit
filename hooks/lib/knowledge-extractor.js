/**
 * Knowledge Extractor - Transforms session activity into structured knowledge records.
 *
 * Extracts four types of knowledge:
 * - File knowledge: role classification on Write/Edit (not Read)
 * - Module knowledge: directory-level aggregation when 3+ files touched
 * - Bug knowledge: re-saves error-detective/debugger findings to knowledge namespace
 * - Decision knowledge: pattern-matches assistant transcript for decision language
 *
 * All extraction is heuristic — no LLM calls. Fits within hook timeouts (10-15s).
 * Non-critical: failures are silently caught by callers.
 */

import { crewNamespace } from './crew-detect.js';
import { existsSync, readFileSync, statSync } from 'fs';
import { basename, dirname, relative, resolve } from 'path';
import { homedir } from 'os';

/** Paths to skip — noise that shouldn't generate knowledge records */
const SKIP_PATTERNS = [
  'node_modules', '.git/', 'package-lock.json', 'bun.lock',
  'yarn.lock', 'pnpm-lock.yaml', '.DS_Store', 'Thumbs.db',
  '.claude/', 'dist/', 'build/', '.next/', '__pycache__/',
  'coverage/', '.nyc_output/', '.cache/'
];

/** Max decisions extracted per session */
const MAX_DECISIONS_PER_SESSION = 5;

/** Max transcript file size to process (20MB) */
const MAX_TRANSCRIPT_SIZE = 20 * 1024 * 1024;

/** Max lines to read from transcript tail */
const MAX_TRANSCRIPT_LINES = 500;

/** Min files in a directory to create module knowledge */
const MIN_FILES_FOR_MODULE = 3;

/**
 * Classify a file's role from its path. Pure heuristic.
 * Returns the first matching role — order matters.
 */
function classifyFileRole(filePath) {
  const lower = filePath.toLowerCase();
  const base = basename(filePath).toLowerCase();

  // Test files
  if (lower.includes('__test__') || lower.includes('.test.') ||
      lower.includes('.spec.') || lower.includes('_test.') ||
      lower.includes('/test/') || lower.includes('/tests/')) {
    return 'test';
  }

  // Config files
  if (lower.includes('/config/') || lower.includes('.config.') ||
      base.endsWith('.env') || base.endsWith('.yml') || base.endsWith('.yaml') ||
      base.endsWith('.toml') || base === 'tsconfig.json' ||
      base === 'jest.config.js' || base === 'vitest.config.ts' ||
      base === '.eslintrc.js' || base === '.prettierrc') {
    return 'config';
  }

  // Infrastructure
  if (base === 'dockerfile' || base.startsWith('docker-compose') ||
      base === 'makefile' || lower.includes('/deploy/') ||
      lower.includes('/infra/') || lower.includes('/terraform/')) {
    return 'infra';
  }

  // Middleware
  if (lower.includes('/middleware/') || lower.includes('middleware.')) {
    return 'middleware';
  }

  // Routes / API
  if (lower.includes('/route/') || lower.includes('/routes/') ||
      lower.includes('/api/') || lower.includes('/endpoints/')) {
    return 'route';
  }

  // Models / Schema
  if (lower.includes('/model/') || lower.includes('/models/') ||
      lower.includes('/schema/') || lower.includes('/schemas/') ||
      lower.includes('/entity/') || lower.includes('/entities/')) {
    return 'model';
  }

  // Hooks
  if (lower.includes('/hook/') || lower.includes('/hooks/')) {
    return 'hook';
  }

  // Components (UI)
  if (lower.includes('/component/') || lower.includes('/components/') ||
      lower.includes('/views/') || lower.includes('/pages/')) {
    return 'component';
  }

  // Migrations
  if (lower.includes('/migration/') || lower.includes('/migrations/')) {
    return 'migration';
  }

  // Utilities / Libraries
  if (lower.includes('/util/') || lower.includes('/utils/') ||
      lower.includes('/helpers/') || lower.includes('/lib/') ||
      lower.includes('/shared/') || lower.includes('/common/')) {
    return 'utility';
  }

  // Entry points
  if (base === 'index.ts' || base === 'index.js' || base === 'main.ts' ||
      base === 'main.js' || base === 'app.ts' || base === 'app.js' ||
      base === 'server.ts' || base === 'server.js' || base === 'main.go' ||
      base === 'main.py') {
    return 'entry-point';
  }

  // Documentation
  if (base.endsWith('.md') || base.endsWith('.mdx')) {
    return 'documentation';
  }

  return 'source';
}

/**
 * Check if a file path should be skipped (noise).
 */
function shouldSkip(filePath) {
  const lower = filePath.toLowerCase();
  return SKIP_PATTERNS.some(p => lower.includes(p));
}

/**
 * Extract file knowledge on Write/Edit operations.
 * Called from post-tool-use.js — must be fast (single blink.save).
 *
 * @param {import('blink-query').Blink} blink - Open blink instance
 * @param {string} filePath - Absolute file path
 * @param {string} action - 'write' or 'edit'
 * @param {string} projectHash - Project hash for namespacing
 * @param {object|null} crewId - Crew identity or null
 * @param {string} sessionId - Current session ID
 */
export function extractFileKnowledge(blink, filePath, action, projectHash, crewId, sessionId) {
  if (shouldSkip(filePath)) return;

  const cwd = process.cwd();
  const relativePath = filePath.startsWith(cwd)
    ? relative(cwd, filePath)
    : filePath;
  const fileName = basename(filePath);
  const role = classifyFileRole(filePath);

  const verb = action === 'write' ? 'Created' : 'Modified';
  const summary = `${verb} ${role}: ${fileName}`;

  blink.save({
    namespace: crewNamespace('knowledge/files', crewId, projectHash),
    title: relativePath,
    summary,
    type: 'SUMMARY',
    content: {
      filePath,
      relativePath,
      action,
      role,
      sessionId,
      timestamp: Date.now(),
      understanding_depth: 'deep'
    },
    tags: ['knowledge', 'file', role, action]
  });
}

/**
 * Extract session-level knowledge: modules, bugs, decisions.
 * Called from pre-compact.js and session-end.js after handoff generation.
 *
 * @param {import('blink-query').Blink} blink - Open blink instance
 * @param {string} sessionId - Current session ID
 * @param {string} projectHash - Project hash for namespacing
 * @param {object|null} crewId - Crew identity or null
 */
export function extractSessionKnowledge(blink, sessionId, projectHash, crewId) {
  // Phase A: Module knowledge
  extractModuleKnowledge(blink, sessionId, projectHash, crewId);

  // Phase B: Bug knowledge
  extractBugKnowledge(blink, sessionId, projectHash, crewId);

  // Phase C: Decision knowledge (from transcript)
  extractDecisionKnowledge(blink, sessionId, projectHash, crewId);
}

/**
 * Phase A: Group files by directory, save module summaries for dirs with 3+ files.
 */
function extractModuleKnowledge(blink, sessionId, projectHash, crewId) {
  try {
    const filesNs = crewNamespace(`session/${sessionId}/files`, crewId, projectHash);
    const fileRecords = blink.list(filesNs);
    if (fileRecords.length < MIN_FILES_FOR_MODULE) return;

    const cwd = process.cwd();
    const dirGroups = {};

    for (const record of fileRecords) {
      try {
        const content = typeof record.content === 'string'
          ? JSON.parse(record.content)
          : record.content;

        const filePath = content?.filePath || '';
        const action = content?.action || 'read';
        const relPath = filePath.startsWith(cwd) ? relative(cwd, filePath) : filePath;
        const dir = dirname(relPath);

        if (!dir || dir === '.' || shouldSkip(filePath)) continue;

        if (!dirGroups[dir]) dirGroups[dir] = [];
        dirGroups[dir].push({ name: basename(relPath), action });
      } catch { /* skip malformed records */ }
    }

    for (const [dir, files] of Object.entries(dirGroups)) {
      if (files.length < MIN_FILES_FOR_MODULE) continue;

      const writes = files.filter(f => f.action === 'write').length;
      const edits = files.filter(f => f.action === 'edit').length;
      const reads = files.filter(f => f.action === 'read').length;
      const fileNames = files.map(f => f.name).join(', ');

      blink.save({
        namespace: crewNamespace('knowledge/modules', crewId, projectHash),
        title: dir,
        summary: `${files.length} files in ${dir}: ${fileNames}. Actions: ${writes}W/${edits}E/${reads}R`,
        type: 'SUMMARY',
        content: {
          directory: dir,
          files,
          sessionId,
          timestamp: Date.now()
        },
        tags: ['knowledge', 'module', sessionId]
      });
    }
  } catch { /* non-critical */ }
}

/**
 * Phase B: Re-save debugging agent findings to knowledge/bugs namespace.
 */
function extractBugKnowledge(blink, sessionId, projectHash, crewId) {
  try {
    const agentsNs = crewNamespace(`session/${sessionId}/subagents`, crewId, projectHash);
    const agentRecords = blink.list(agentsNs);

    const debugAgents = ['error-detective', 'debugger'];

    for (const record of agentRecords) {
      try {
        const content = typeof record.content === 'string'
          ? JSON.parse(record.content)
          : record.content;

        const agentType = content?.agentType || '';
        if (!debugAgents.includes(agentType)) continue;

        const prompt = content?.prompt || record.summary || '';
        const title = prompt.slice(0, 60).replace(/\n/g, ' ').trim();
        if (!title) continue;

        blink.save({
          namespace: crewNamespace('knowledge/bugs', crewId, projectHash),
          title,
          summary: `${agentType} investigation: ${prompt.slice(0, 200)}`,
          type: 'SUMMARY',
          content: {
            agentType,
            originalPrompt: prompt.slice(0, 500),
            sessionId,
            timestamp: Date.now()
          },
          tags: ['knowledge', 'bug', agentType, sessionId]
        });
      } catch { /* skip malformed records */ }
    }
  } catch { /* non-critical */ }
}

/** Decision language patterns — conservative to avoid false positives */
const DECISION_PATTERNS = [
  /\b(?:decided|choosing|chose) to ([\w\s,'-]{5,80})/i,
  /\bwent with ([\w\s,'-]{5,60})/i,
  /\brejected ([\w\s,'-]{5,60}) because ([\w\s,'-]{5,80})/i,
  /\bthe approach (?:is|was|will be) to ([\w\s,'-]{5,80})/i,
  /\b(?:opted|opting) for ([\w\s,'-]{5,60})/i,
  /\binstead of ([\w\s,'-]{5,60}),?\s*(?:we|I|chose|went|decided)/i
];

/**
 * Phase C: Extract decisions from the session transcript.
 */
function extractDecisionKnowledge(blink, sessionId, projectHash, crewId) {
  try {
    const transcriptPath = getTranscriptPath(sessionId);
    if (!transcriptPath || !existsSync(transcriptPath)) return;

    const stat = statSync(transcriptPath);
    if (stat.size > MAX_TRANSCRIPT_SIZE) return;

    const content = readFileSync(transcriptPath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    const tailLines = lines.slice(-MAX_TRANSCRIPT_LINES);

    let decisionsFound = 0;

    for (const line of tailLines) {
      if (decisionsFound >= MAX_DECISIONS_PER_SESSION) break;

      try {
        const entry = JSON.parse(line);
        if (entry.type !== 'assistant') continue;

        const message = entry.message;
        if (!message?.content) continue;

        // Extract text blocks from assistant messages
        const textBlocks = Array.isArray(message.content)
          ? message.content.filter(b => b.type === 'text').map(b => b.text)
          : [String(message.content)];

        for (const text of textBlocks) {
          if (decisionsFound >= MAX_DECISIONS_PER_SESSION) break;

          for (const pattern of DECISION_PATTERNS) {
            const match = text.match(pattern);
            if (!match) continue;

            const decisionText = match[0].slice(0, 200).trim();
            const title = decisionText.slice(0, 60).replace(/\n/g, ' ').trim();
            if (!title || title.length < 10) continue;

            blink.save({
              namespace: crewNamespace('knowledge/decisions', crewId, projectHash),
              title,
              summary: decisionText,
              type: 'META',
              content: {
                decision: decisionText,
                sessionId,
                timestamp: Date.now(),
                source: 'transcript'
              },
              tags: ['knowledge', 'decision', sessionId]
            });

            decisionsFound++;
            break; // One decision per text block max
          }
        }
      } catch { /* skip unparseable lines */ }
    }
  } catch { /* non-critical — transcript reading is best-effort */ }
}

/**
 * Derive the transcript JSONL path for a session.
 */
function getTranscriptPath(sessionId) {
  try {
    const cwd = process.cwd();
    const slug = cwd.replace(/\//g, '-');
    return resolve(homedir(), '.claude', 'projects', slug, `${sessionId}.jsonl`);
  } catch {
    return null;
  }
}
