'use strict';

const DATE_SANITY_CONFIG = {
  minYear: 2020,
  // "current_year+1" per spec — computed at call time, not baked in.
};

/** Sq.Ft. / Acres: null (not 0) when unparseable, e.g. "N/A", "None - MPAC". */
function parseNumericField(raw) {
  if (raw === null || raw === undefined) return { value: null, raw: null };
  if (typeof raw === 'number') return { value: raw, raw: String(raw) };
  const s = String(raw).trim();
  if (s === '') return { value: null, raw: s };
  const cleaned = s.replace(/,/g, '');
  if (/^-?\d+(\.\d+)?$/.test(cleaned)) {
    return { value: parseFloat(cleaned), raw: s };
  }
  return { value: null, raw: s }; // "N/A", "None - MPAC", etc. — keep raw, no guessing
}

/**
 * Building Coverage % — source files store this as a fraction (0.0982...) with
 * a percent number format, or occasionally as literal text like "18%"/"N/A".
 */
function parseCoveragePct(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return raw <= 1 ? raw : raw / 100;
  const s = String(raw).trim();
  const m = s.match(/^(-?\d+(\.\d+)?)\s*%$/);
  if (m) return parseFloat(m[1]) / 100;
  return null;
}

/**
 * Taxes/TMI: store raw as-is always; extract a numeric $ value only when the
 * pattern is confidently parseable ("$52,500 Annual", "$9,900/Yr", plain "5.5").
 * Narrative strings ("50% of Hydro Bill") and "N/A" are left null, never guessed.
 */
function parseTaxesNumeric(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (s === '' || /^n\/?a$/i.test(s)) return null;
  if (/%/.test(s) && /of\s+\w+/i.test(s)) return null; // "50% of Hydro Bill" — narrative, don't guess
  const m = s.match(/\$?\s*([\d,]+(?:\.\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ''));
  return Number.isNaN(n) ? null : n;
}

/**
 * Date parsing + sanity check. Accepts a JS Date (from SheetJS cellDates:true),
 * an Excel serial number, or a string. Returns { iso, raw, flagged } — flagged
 * is true when the parsed year falls outside [minYear, currentYear+1], per spec
 * ("typo'd year 2206 instead of 2026" must be caught, not silently kept/discarded).
 */
function parseDateField(raw) {
  const rawStr = raw instanceof Date ? raw.toISOString() : String(raw ?? '');
  const nowYear = new Date().getFullYear();
  const maxYear = nowYear + 1;

  let d = null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    d = raw;
  } else if (typeof raw === 'number') {
    // Excel serial date (days since 1899-12-30)
    d = new Date(Date.UTC(1899, 11, 30) + raw * 86400000);
  } else if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) d = parsed;
  }

  if (!d || Number.isNaN(d.getTime())) {
    return { iso: null, raw: rawStr, flagged: false };
  }

  const year = d.getUTCFullYear();
  const flagged = year < DATE_SANITY_CONFIG.minYear || year > maxYear;
  const iso = d.toISOString().slice(0, 10);
  return { iso, raw: rawStr, flagged };
}

/** Normalize vendor name for grouping (casing/whitespace) while keeping raw. */
function normalizeVendor(raw) {
  if (raw === null || raw === undefined) return { raw: null, normalized: null };
  const s = String(raw).replace(/ /g, ' ').trim(); // strip stray non-breaking spaces (seen in source files)
  if (s === '') return { raw: s, normalized: null };
  if (/^unknown$/i.test(s)) return { raw: s, normalized: 'Unknown' };
  const normalized = s
    .replace(/\s+/g, ' ')
    .replace(/[.,]+$/, '')
    .toUpperCase();
  return { raw: s, normalized };
}

module.exports = {
  parseNumericField,
  parseCoveragePct,
  parseTaxesNumeric,
  parseDateField,
  normalizeVendor,
  DATE_SANITY_CONFIG,
};
