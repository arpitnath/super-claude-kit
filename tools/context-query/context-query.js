#!/usr/bin/env node
/**
 * Context-Query Tool v3.0 - Query Capsule context database
 * Uses blink-query for namespace/type-aware querying
 */

import { Blink } from 'blink-query';
import { saveWithWikilinks } from '../../hooks/lib/wikilink-save.js';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { execSync } from 'child_process';

function findCapsuleDb() {
  const globalDb = join(homedir(), '.claude', 'capsule.db');
  if (existsSync(globalDb)) return globalDb;
  let dir = process.cwd();
  while (dir !== '/') {
    const dbPath = join(dir, '.claude', 'capsule.db');
    if (existsSync(dbPath)) return dbPath;
    dir = dirname(dir);
  }
  return null;
}

function getProjectHash() {
  let identifier;
  try {
    identifier = execSync('git remote get-url origin', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    identifier = process.cwd();
  }
  return createHash('sha256').update(identifier).digest('hex').slice(0, 12);
}

function getAllRecords(blink) {
  const hash = getProjectHash();
  let projRecords = [];
  try { projRecords = blink.list(`proj/${hash}/session`, 'recent'); } catch { /* no proj records */ }
  let projCrew = [];
  try { projCrew = blink.list(`proj/${hash}/crew`, 'recent'); } catch { /* no crew records */ }
  let solo = [];
  try { solo = blink.list('session', 'recent'); } catch { /* no legacy records */ }
  let crew = [];
  try { crew = blink.list('crew', 'recent'); } catch { /* no crew records */ }
  return [...projRecords, ...projCrew, ...solo, ...crew];
}

const dbPath = findCapsuleDb();
if (!dbPath) {
  console.log('No capsule.db found. Context will be available after your first session.');
  process.exit(0);
}

const blink = new Blink({ dbPath });
const [,, cmd = 'help', arg, limitArg] = process.argv;

try {
  switch (cmd) {
    case 'search': {
      if (!arg) {
        console.log('Usage: context-query search <term>');
        process.exit(1);
      }
      const results = blink.search(arg, { limit: parseInt(limitArg) || 10 });
      console.log(`## Capsule Search: ${arg}\n`);
      if (results.length === 0) {
        console.log(`No results found for '${arg}'`);
      } else {
        results.forEach(r => {
          console.log(`- **[${r.type}]** ${r.title}`);
          if (r.summary) console.log(`  ${r.summary.replace(/\n/g, ' ').slice(0, 120)}`);
        });
      }
      break;
    }

    case 'files': {
      const limit = parseInt(arg) || 20;
      const all = getAllRecords(blink);
      const fileRecords = all.filter(r => r.namespace?.includes('/files')).slice(0, limit);
      console.log(`## Recent File Operations (${fileRecords.length})\n`);
      if (fileRecords.length === 0) {
        console.log('No file operations recorded yet');
      } else {
        fileRecords.forEach(r => {
          console.log(`- **${r.title}**: ${r.summary?.replace(/\n/g, ' ').slice(0, 100) || ''}`);
        });
      }
      break;
    }

    case 'agents': {
      const limit = parseInt(arg) || 10;
      const all = getAllRecords(blink);
      const agentRecords = all.filter(r => r.namespace?.includes('/subagents')).slice(0, limit);
      console.log(`## Sub-Agent History (${agentRecords.length})\n`);
      if (agentRecords.length === 0) {
        console.log('No sub-agent records found');
      } else {
        agentRecords.forEach(r => {
          console.log(`- **${r.title}**`);
          if (r.summary) console.log(`  ${r.summary.replace(/\n/g, ' ').slice(0, 120)}`);
        });
      }
      break;
    }

    case 'sessions': {
      const limit = parseInt(arg) || 5;
      const all = getAllRecords(blink);
      const sessionRecords = all.filter(r =>
        r.namespace?.endsWith('/session') || r.namespace === 'session' || (r.namespace?.includes('crew') && r.type === 'META')
      ).slice(0, limit);
      console.log(`## Session History (${sessionRecords.length})\n`);
      if (sessionRecords.length === 0) {
        console.log('No session records found');
      } else {
        sessionRecords.forEach(r => {
          console.log(`- **${r.title}**`);
          if (r.summary) console.log(`  ${r.summary.replace(/\n/g, ' ').slice(0, 120)}`);
        });
      }
      break;
    }

    case 'recent': {
      const limit = parseInt(arg) || 15;
      const all = getAllRecords(blink).slice(0, limit);
      console.log(`## Recent Activity (${all.length})\n`);
      all.forEach(r => {
        console.log(`- [${r.type}] **${r.title}** (${r.namespace})`);
        if (r.summary) console.log(`  ${r.summary.replace(/\n/g, ' ').slice(0, 80)}`);
      });
      break;
    }

    case 'ns': {
      if (!arg) {
        console.log('Usage: context-query ns <namespace> [limit]');
        console.log('Example: context-query ns "session" 10');
        process.exit(1);
      }
      const limit = parseInt(limitArg) || 10;
      const results = blink.query(`${arg} limit ${limit}`);
      console.log(`## Namespace: ${arg} (${results.length})\n`);
      if (results.length === 0) {
        console.log('No records in this namespace');
      } else {
        results.forEach(r => {
          console.log(`- **[${r.type}]** ${r.title}`);
          if (r.summary) console.log(`  ${r.summary.replace(/\n/g, ' ').slice(0, 120)}`);
        });
      }
      break;
    }

    case 'save': {
      if (!arg) {
        console.log('Usage: context-query save <namespace> <title> <summary> [type]');
        console.log('Types: SUMMARY (default), META, COLLECTION, SOURCE, ALIAS');
        console.log('');
        console.log('Examples:');
        console.log('  save discoveries "OAuth flow" "Uses PKCE with refresh tokens"');
        console.log('  save session/notes "DB schema" "Users table has soft deletes" META');
        process.exit(1);
      }
      const namespace = arg;
      const title = process.argv[4];
      const summary = process.argv[5];
      const type = process.argv[6] || 'SUMMARY';
      if (!title || !summary) {
        console.log('Error: title and summary are required');
        console.log('Usage: context-query save <namespace> <title> <summary> [type]');
        process.exit(1);
      }
      saveWithWikilinks(blink, { namespace, title, summary, type, tags: [] }, getProjectHash());
      console.log(`Saved to ${namespace}: "${title}" [${type}]`);
      break;
    }

    case 'update': {
      if (!arg) {
        console.log('Usage: context-query update <search-term> <new-summary>');
        console.log('');
        console.log('Finds the most recent record matching the search term and updates it.');
        console.log('');
        console.log('Examples:');
        console.log('  update "OAuth flow" "Now uses PKCE + DPoP with 15min token expiry"');
        process.exit(1);
      }
      const searchTerm = arg;
      const newSummary = process.argv[4];
      if (!newSummary) {
        console.log('Error: new summary is required');
        process.exit(1);
      }
      const matches = blink.search(searchTerm, undefined, 1);
      if (matches.length === 0) {
        console.log(`No record found matching '${searchTerm}'`);
        process.exit(1);
      }
      const record = matches[0];
      blink.save({
        namespace: record.namespace,
        title: record.title,
        summary: newSummary,
        type: record.type,
        tags: record.tags || []
      });
      console.log(`Updated "${record.title}" in ${record.namespace}`);
      console.log(`  Old: ${record.summary?.replace(/\n/g, ' ').slice(0, 80)}`);
      console.log(`  New: ${newSummary.slice(0, 80)}`);
      break;
    }

    case 'discoveries': {
      const limit = parseInt(arg) || 50;
      const hash = getProjectHash();
      let allDiscoveries = [];

      // Query all possible discovery namespaces
      const namespaces = [
        'discoveries',                            // legacy global
        `proj/${hash}/discoveries`,              // project-scoped
        `proj/${hash}/crew/_shared/discoveries`, // crew shared
      ];

      namespaces.forEach(ns => {
        try {
          const result = blink.resolve(ns);
          // blink.resolve returns {status, record} — content has child refs
          // Resolve each child fully to get created_at, summary, etc.
          if (result?.record?.content && Array.isArray(result.record.content)) {
            for (const child of result.record.content) {
              try {
                const full = blink.resolve(child.path);
                if (full?.record) allDiscoveries.push(full.record);
              } catch { /* skip unresolvable */ }
            }
          } else if (result?.record?.summary) {
            allDiscoveries.push(result.record);
          }
        } catch {
          // Namespace doesn't exist, skip
        }
      });

      // Sort by timestamp descending
      allDiscoveries.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
      const discoveries = allDiscoveries.slice(0, limit);

      console.log(`## Discoveries (${discoveries.length})\n`);
      if (discoveries.length === 0) {
        console.log('No discoveries saved yet.');
        console.log('');
        console.log('Save a discovery:');
        console.log('  context-query save discoveries "Finding title" "Summary of the discovery"');
      } else {
        discoveries.forEach(r => {
          const date = r.created_at ? new Date(r.created_at).toISOString().split('T')[0] : 'unknown';
          console.log(`- **${r.title}** (${date})`);
          if (r.summary) {
            console.log(`  ${r.summary.replace(/\n/g, ' ')}`);
          }
          console.log('');
        });
      }
      break;
    }

    case 'stats': {
      const all = getAllRecords(blink);
      const byType = {};
      let files = 0, agents = 0;
      const sessions = new Set();
      all.forEach(r => {
        byType[r.type] = (byType[r.type] || 0) + 1;
        if (r.namespace?.includes('/files')) files++;
        if (r.namespace?.includes('/subagents')) agents++;
        const match = r.namespace?.match(/session\/([^/]+)/);
        if (match) sessions.add(match[1]);
      });
      console.log(`## Capsule Stats\n`);
      console.log(`- Total records: ${all.length}`);
      console.log(`- Files tracked: ${files}`);
      console.log(`- Sub-agents: ${agents}`);
      console.log(`- Sessions: ${sessions.size}`);
      console.log(`- Types: ${Object.entries(byType).map(([k,v]) => `${k}(${v})`).join(', ')}`);
      break;
    }

    case 'backlinks': {
      if (!arg) {
        console.log('Usage: context-query backlinks <title-or-path>');
        process.exit(1);
      }

      // Auto-detect: contains slash → path; else title (resolved via search)
      let targetPath, targetTitle;
      if (arg.includes('/')) {
        targetPath = arg;
        targetTitle = arg;
      } else {
        const candidates = blink.search(arg, { limit: 1 });
        if (candidates.length === 0) {
          console.log(`No record found matching title: ${arg}`);
          break;
        }
        targetPath = candidates[0].path;
        targetTitle = candidates[0].title;
      }

      const { linked, mentioned } = blink.backlinks(targetPath);

      console.log(`## Backlinks for: ${targetTitle}\n`);
      console.log(`  Path: ${targetPath}\n`);

      console.log(`### LINKED — ${linked.length} ALIAS record${linked.length !== 1 ? 's' : ''}\n`);
      if (linked.length === 0) {
        console.log('  (none)');
      } else {
        linked.forEach(r => {
          console.log(`- **[${r.type}]** ${r.title}`);
          console.log(`  ns: ${r.namespace}`);
          if (r.summary) console.log(`  ${r.summary.replace(/\n/g, ' ').slice(0, 120)}`);
        });
      }

      console.log(`\n### MENTIONED — ${mentioned.length} FTS soft link${mentioned.length !== 1 ? 's' : ''}\n`);
      if (mentioned.length === 0) {
        console.log('  (none)');
      } else {
        mentioned.forEach(r => {
          console.log(`- **[${r.type}]** ${r.title}`);
          console.log(`  ns: ${r.namespace}`);
          if (r.summary) console.log(`  ${r.summary.replace(/\n/g, ' ').slice(0, 120)}`);
        });
      }
      break;
    }

    default:
      console.log(`## Capsule Context Query\n`);
      console.log(`Usage: bash $HOME/.claude/cck/tools/context-query/context-query.sh <command> [args]\n`);
      console.log(`Read:`);
      console.log(`  search <term>             Search records by keyword`);
      console.log(`  files [limit]             Recent file operations (default: 20)`);
      console.log(`  agents [limit]            Sub-agent invocation history (default: 10)`);
      console.log(`  sessions [limit]          Session summaries (default: 5)`);
      console.log(`  recent [limit]            All recent activity (default: 15)`);
      console.log(`  discoveries [limit]       All saved discoveries (default: 50)`);
      console.log(`  ns <namespace>            Query specific Capsule namespace`);
      console.log(`  backlinks <title-or-path> Find records linking to a target (slash=path, else title)`);
      console.log(`  stats                     Database statistics`);
      console.log(``);
      console.log(`Write:`);
      console.log(`  save <ns> <title> <summary> [type]   Save a record`);
      console.log(`  update <search> <new-summary>        Update most recent match`);
  }
} finally {
  blink.close();
}
