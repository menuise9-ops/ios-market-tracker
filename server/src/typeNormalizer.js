'use strict';

/**
 * "Type of Land" normalization (CLAUDE.md §1 table, row 1).
 *
 * Observed raw values: "Low Coverage", "Low Coverage Property", "Low Coverage Propety"
 * (typo), "Land", "Improved Land", "Unimproved Land", "Unimproved".
 *
 * Normalize via fuzzy match to two canonical buckets: "Low Coverage" and "Land".
 * The raw value is always kept alongside the normalized one for audit.
 */

function normalizeTypeOfLand(raw) {
  if (raw === null || raw === undefined) {
    return { raw: null, normalized: null };
  }
  const s = String(raw).trim();
  const lower = s.toLowerCase();

  if (lower === '') {
    return { raw: s, normalized: null };
  }

  if (/low\s*coverage/.test(lower) || /cover(a|e)ge/.test(lower)) {
    return { raw: s, normalized: 'Low Coverage' };
  }

  if (/land/.test(lower) || /greenfield/.test(lower)) {
    // Covers "Land", "Improved Land", "Unimproved Land", "Unimproved", "Greenfield"
    return { raw: s, normalized: 'Land' };
  }

  // Unrecognized value — don't guess, surface it as-is so it shows up distinctly
  // in the audit trail rather than silently landing in one bucket.
  return { raw: s, normalized: null };
}

module.exports = { normalizeTypeOfLand };
