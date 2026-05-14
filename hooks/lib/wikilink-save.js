/**
 * wikilink-save.js — save a blink record and extract [[wikilinks]]
 *                    from its summary into ALIAS records.
 *
 * wikilinks resolve eager-only. references to records that do not yet
 * exist are dropped. they do not auto-heal when the target is later saved.
 *
 * The save commits atomically before extraction runs. Wikilink extraction
 * is best-effort: failures are swallowed (logged only under CCK_DEBUG) and
 * never propagate back to the caller. Search is scoped to the current
 * project's namespace (`proj/{projectHash}`) to prevent cross-project
 * ALIAS leaks.
 */

import { extractWikiLinks } from 'blink-query';

/**
 * @param {import('blink-query').Blink} blink - Open blink instance
 * @param {object} input - SaveInput passed straight to blink.save()
 * @param {string} projectHash - 12-char project hash for namespace scoping
 * @returns {object} The saved BlinkRecord (regardless of extraction outcome)
 */
export function saveWithWikilinks(blink, input, projectHash) {
  const saved = blink.save(input);
  try {
    const prefix = `proj/${projectHash}`;
    const scopedFacade = {
      search: (kw, opts) => blink.search(kw, { ...opts, namespace: prefix }),
      saveMany: (inputs) => blink.saveMany(inputs),
    };
    extractWikiLinks(scopedFacade, [saved]);
  } catch (err) {
    if (process.env.CCK_DEBUG) {
      console.error('[cck] wikilink extraction failed:', err.message);
    }
  }
  return saved;
}
