#!/usr/bin/env node
/**
 * PostToolUse Hook - Capsule Integration
 *
 * Captures tool operations and saves them to Capsule for future context.
 * Crew-aware: when running in a worktree, uses the shared capsule.db
 * and scopes namespaces to the teammate.
 *
 * Captures:
 * - Read/Write/Edit operations → META records (file operation metadata)
 * - Task tool (sub-agents) → SUMMARY records (direct consumption)
 */

import { Blink } from 'blink-query';
import { createInterface } from 'readline';
import { basename } from 'path';
import { getCapsuleDbPath, getCrewIdentity, crewNamespace, getProjectHash, isDisabled } from './lib/crew-detect.js';

/**
 * Safely resolve a namespace, returning empty array if not found
 */
function tryResolveNamespace(blink, namespace) {
  try {
    const result = blink.resolve(namespace);
    // blink.resolve returns {status, record} — content has child refs
    // Resolve each child fully to get summary for matching
    if (result?.record?.content && Array.isArray(result.record.content)) {
      const records = [];
      for (const child of result.record.content) {
        try {
          const full = blink.resolve(child.path);
          if (full?.record) records.push(full.record);
        } catch { /* skip */ }
      }
      return records;
    } else if (result?.record?.summary) {
      return [result.record];
    }
    return [];
  } catch {
    return [];
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
    if (isDisabled()) process.exit(0);
    const projectHash = getProjectHash();
    const toolName = input.tool_name;
    const toolInput = input.tool_input || {};
    const sessionId = input.session_id || 'default';

    // Shared DB in crew mode, local otherwise
    // Pass file path hint for worktree-based crew identity detection
    const filePath = toolInput.file_path || toolInput.path || '';
    const blink = new Blink({ dbPath: getCapsuleDbPath() });
    const crewId = getCrewIdentity({ filePath });

    // Capture file operations
    if (['Read', 'Write', 'Edit'].includes(toolName)) {
      if (filePath && !filePath.includes('node_modules') && !filePath.includes('.git/')) {
        const fileName = basename(filePath);
        const action = toolName.toLowerCase();

        // Save file operation metadata (META = structured operation data)
        blink.save({
          namespace: crewNamespace(`session/${sessionId}/files`, crewId, projectHash),
          title: fileName,
          summary: `${action}: ${filePath}`,
          type: 'META',
          content: {
            filePath,
            action,
            timestamp: Date.now()
          },
          tags: ['file', action, sessionId, ...(crewId ? [crewId.teammate_name] : [])]
        });

        // Extract file knowledge on Write/Edit (not Read — too noisy)
        if (action === 'write' || action === 'edit') {
          try {
            const { extractFileKnowledge } = await import('./lib/knowledge-extractor.js');
            extractFileKnowledge(blink, filePath, action, projectHash, crewId, sessionId);
          } catch { /* knowledge extraction is non-critical */ }
        }
      }
    }

    // Capture sub-agent results
    if (toolName === 'Task') {
      const agentType = toolInput.subagent_type;
      const prompt = toolInput.prompt;

      if (agentType && prompt) {
        // Save sub-agent invocation (SUMMARY = read directly, no fetching needed)
        blink.save({
          namespace: crewNamespace(`session/${sessionId}/subagents`, crewId, projectHash),
          title: `${agentType} - ${new Date().toISOString()}`,
          summary: prompt.slice(0, 200),
          type: 'SUMMARY',
          content: {
            agentType,
            prompt: prompt.slice(0, 500),
            timestamp: Date.now()
          },
          tags: ['subagent', agentType, sessionId, ...(crewId ? [crewId.teammate_name] : [])]
        });
      }

      // Auto-save discoveries in crew mode when specialist agents find significant insights
      if (crewId && agentType && input.tool_result) {
        try {
          const resultText = typeof input.tool_result === 'string'
            ? input.tool_result
            : JSON.stringify(input.tool_result);

          // Detection heuristic: look for discovery indicators from specialist agents
          const discoveryPatterns = [
            /found\s+([^.]{10,100})/i,
            /discovered\s+([^.]{10,100})/i,
            /identified\s+([^.]{10,100})/i,
            /pattern:\s*([^.]{10,100})/i,
            /issue:\s*([^.]{10,100})/i,
            /important:\s*([^.]{10,100})/i,
            /key finding:\s*([^.]{10,100})/i,
          ];

          // Only capture from specialist agents (not general-purpose)
          const isSpecialist = agentType !== 'general-purpose';

          if (isSpecialist && resultText.length > 100) {
            for (const pattern of discoveryPatterns) {
              const match = resultText.match(pattern);
              if (match) {
                const finding = match[1].trim();

                // Save to crew shared discoveries namespace
                blink.save({
                  namespace: crewNamespace('_shared/discoveries', crewId, projectHash),
                  title: `${agentType}: ${finding.slice(0, 60)}...`,
                  summary: finding,
                  type: 'SUMMARY',
                  content: {
                    source_teammate: crewId.teammate_name,
                    source_agent: agentType,
                    timestamp: Date.now(),
                    prompt_context: prompt.slice(0, 200)
                  },
                  tags: ['discovery', 'crew-shared', agentType, crewId.teammate_name]
                });

                break; // Only save the first significant finding per invocation
              }
            }
          }
        } catch (err) {
          // Graceful degradation - discovery auto-capture is non-critical
        }
      }
    }

    // Discovery surfacing: when Read tool is used, show related discoveries
    let discoveryOutput = '';
    if (toolName === 'Read' && filePath) {
      try {
        const fileName = basename(filePath);

        // Query all discovery records (across all possible namespaces)
        const discoveriesGlobal = tryResolveNamespace(blink, 'discoveries');
        const discoveriesCrewShared = tryResolveNamespace(blink, crewNamespace('_shared/discoveries', crewId, projectHash));
        const discoveriesProj = tryResolveNamespace(blink, crewNamespace('discoveries', null, projectHash));

        const allDiscoveries = [...discoveriesGlobal, ...discoveriesCrewShared, ...discoveriesProj];

        // Filter discoveries that mention this file (path or basename)
        const relatedDiscoveries = allDiscoveries.filter(record => {
          const summaryMatches = record.summary?.includes(filePath) || record.summary?.includes(fileName);
          const contentMatches = typeof record.content === 'string'
            ? (record.content.includes(filePath) || record.content.includes(fileName))
            : false;
          return summaryMatches || contentMatches;
        });

        if (relatedDiscoveries.length > 0) {
          discoveryOutput = '\n## Related Discoveries\n';
          relatedDiscoveries.forEach(d => {
            discoveryOutput += `- **${d.title}**: ${d.summary}\n`;
          });
        }
      } catch (err) {
        // Graceful degradation - discovery surfacing is non-critical
      }
    }

    blink.close();

    // Output discoveries if found (PostToolUse can inject context)
    if (discoveryOutput) {
      console.log(discoveryOutput);
    }

    process.exit(0);

  } catch (error) {
    // Graceful degradation
    console.error(`[post-tool-use.js] Error: ${error.message}`);
    process.exit(0);
  }
}

main();
