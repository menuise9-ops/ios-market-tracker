'use strict';

/**
 * Price parsing for the messy `Price` column (§2 of CLAUDE.md).
 *
 * Never treat Price as a single number. parsePrice() always returns a structured
 * object:
 *
 * {
 *   raw: string,
 *   status: "parsed" | "suppressed" | "missing" | "needs_review",
 *   dealType: "sale" | "lease" | null,
 *   amount: number | null,
 *   unit: "total" | "per_sf" | "per_acre" | "per_month" | "per_year" | null,
 *   basis: "net" | "gross" | "unspecified",
 *   confidence: "high" | "low",
 *   reviewReason: string | null
 * }
 *
 * Tunable thresholds live in PRICE_PARSER_CONFIG (not buried magic numbers) so they
 * can be adjusted from one place (and later exposed in a config screen) without
 * touching the parsing logic itself.
 */

const PRICE_PARSER_CONFIG = {
  // A bare, suffix-less number below this is assumed to be a $/SF lease rate.
  bareNumberLeaseCeiling: 200,
  // A bare, suffix-less number above this is assumed to be a total sale price.
  bareNumberSaleFloor: 100000,
  // Between the two thresholds above, a bare number is genuinely ambiguous.
};

function cleanNumberString(s) {
  return s.replace(/[$,]/g, '').trim();
}

// "$1.65M" / "$2.387M" / "1.5m" -> 1650000 / 2387000 / 1500000
function parseAbbreviatedMillions(raw) {
  const m = raw.match(/\$?\s*([\d.]+)\s*[Mm]\b/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (Number.isNaN(n)) return null;
  return n * 1_000_000;
}

function parsePlainNumber(s) {
  const cleaned = cleanNumberString(s);
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = parseFloat(cleaned);
  return Number.isNaN(n) ? null : n;
}

/**
 * Detect unit/basis from suffix keywords. Returns partial result or null if no
 * keyword suffix matched at all.
 */
function detectUnitAndBasis(raw) {
  const lower = raw.toLowerCase();

  let unit = null;
  let basis = 'unspecified';

  if (/\/\s*acre/.test(lower)) unit = 'per_acre';
  else if (/\/\s*(sft|sf|sq\s*\.?\s*ft|ft)\b/.test(lower) || /\bpsf\b/.test(lower)) unit = 'per_sf';
  else if (/\/\s*month\b/.test(lower) || /\bmonth\b/.test(lower)) unit = 'per_month';
  else if (/\/\s*(yr|year)\b/.test(lower)) unit = 'per_year';

  // "/SF/Yr" style compound units — /SF wins for `unit` (it's the more specific
  // per-area rate); note the /Yr time-basis in reviewReason territory is handled
  // by the caller when needed. We don't need a separate field for it per the
  // spec's shape, so per_sf takes priority when both are present.
  if (/\/\s*(sft|sf|sq\s*\.?\s*ft|ft)\s*\/\s*(yr|year)/.test(lower)) unit = 'per_sf';

  if (/\bnet\b/.test(lower)) basis = 'net';
  else if (/\bgross\b/.test(lower)) basis = 'gross';

  if (!unit && basis === 'unspecified') return null;
  return { unit, basis };
}

/**
 * @param {string|number|null|undefined} rawValue - raw cell value
 * @param {{sqft?: number|null, acres?: number|null}} [rowContext]
 * @returns {object} structured price result, see file header
 */
function parsePrice(rawValue, rowContext = {}) {
  const rawOriginal = rawValue === null || rawValue === undefined ? '' : String(rawValue);
  const raw = rawOriginal;
  const trimmed = raw.trim();

  const base = {
    raw: rawOriginal,
    status: 'missing',
    dealType: null,
    amount: null,
    unit: null,
    basis: 'unspecified',
    confidence: 'high',
    reviewReason: null,
  };

  if (trimmed === '' || /^fill in price$/i.test(trimmed) || /^n\/?a$/i.test(trimmed)) {
    return { ...base, status: 'missing' };
  }

  // --- Suppressed (with or without an embedded list price) ---
  if (/supp?ress?ed/i.test(trimmed)) {
    const embeddedM = parseAbbreviatedMillions(trimmed);
    const embeddedPlain = embeddedM === null ? parsePlainNumber(trimmed.replace(/supp?ress?ed/i, '').replace(/[-:]/g, '').replace(/list/i, '')) : null;
    const amount = embeddedM !== null ? embeddedM : embeddedPlain;
    return {
      ...base,
      status: 'suppressed',
      dealType: 'sale',
      amount: amount !== null ? amount : null,
      unit: amount !== null ? 'total' : null,
      confidence: amount !== null ? 'high' : 'high',
      reviewReason: amount !== null
        ? 'Sale price suppressed; amount shown is the ASKING/list price, not a confirmed sale price.'
        : 'Sale price suppressed with no list price disclosed.',
    };
  }

  // --- Abbreviated millions: "$1.65M" / "$2.387M" ---
  const millions = parseAbbreviatedMillions(trimmed);
  if (millions !== null) {
    return {
      ...base,
      status: 'parsed',
      dealType: 'sale',
      amount: millions,
      unit: 'total',
      basis: 'unspecified',
      confidence: 'high',
    };
  }

  // --- Suffix-keyword driven detection (high confidence) ---
  const unitBasis = detectUnitAndBasis(trimmed);
  if (unitBasis) {
    // pull the numeric amount out (first number in the string)
    const numMatch = trimmed.match(/\$?\s*([\d,]+(?:\.\d+)?)/);
    const amount = numMatch ? parseFloat(numMatch[1].replace(/,/g, '')) : null;

    const dealType = unitBasis.unit ? 'lease' : (amount !== null && amount > PRICE_PARSER_CONFIG.bareNumberSaleFloor ? 'sale' : 'lease');

    let reviewReason = null;
    let status = 'parsed';

    // "$41,000 Net" — net basis but no per-SF/month/year unit given: monthly vs
    // annual is genuinely ambiguous per spec, flag it.
    if (unitBasis.basis === 'net' && !unitBasis.unit) {
      status = 'needs_review';
      reviewReason = 'Net lease amount given with no unit (per SF / per month / per year) — basis is ambiguous.';
    }
    // "$5,500 Gross" with no unit — likely per-month, but flag for confirmation.
    if (unitBasis.basis === 'gross' && !unitBasis.unit) {
      status = 'needs_review';
      reviewReason = 'Gross lease amount given with no unit — assumed per-month, please confirm.';
    }
    // "$19/ft" — per-SF unit but basis (net vs gross) unstated.
    if (unitBasis.unit === 'per_sf' && unitBasis.basis === 'unspecified') {
      status = 'needs_review';
      reviewReason = 'Per-SF lease rate with no net/gross basis stated.';
    }

    return {
      ...base,
      status,
      dealType,
      amount,
      unit: unitBasis.unit || (unitBasis.basis === 'gross' ? 'per_month' : null),
      basis: unitBasis.basis,
      confidence: 'high',
      reviewReason,
    };
  }

  // --- Bare number, no suffix at all ---
  const bare = parsePlainNumber(trimmed);
  if (bare !== null) {
    if (bare > PRICE_PARSER_CONFIG.bareNumberSaleFloor) {
      return {
        ...base,
        status: 'needs_review',
        dealType: 'sale',
        amount: bare,
        unit: 'total',
        basis: 'unspecified',
        confidence: 'low',
        reviewReason: `Bare number > ${PRICE_PARSER_CONFIG.bareNumberSaleFloor.toLocaleString()} with no currency/unit suffix — assumed total sale price.`,
      };
    }
    if (bare < PRICE_PARSER_CONFIG.bareNumberLeaseCeiling && (rowContext.sqft || rowContext.acres)) {
      return {
        ...base,
        status: 'needs_review',
        dealType: 'lease',
        amount: bare,
        unit: 'per_sf',
        basis: 'unspecified',
        confidence: 'low',
        reviewReason: `Bare number < ${PRICE_PARSER_CONFIG.bareNumberLeaseCeiling} with no suffix — assumed $/SF lease rate.`,
      };
    }
    // In the dead zone between the two thresholds, or no sqft/acres context to
    // support the lease-rate guess: too ambiguous to guess at all.
    return {
      ...base,
      status: 'needs_review',
      dealType: null,
      amount: bare,
      unit: null,
      basis: 'unspecified',
      confidence: 'low',
      reviewReason: 'Bare number with no suffix and no clear size context — could not confidently classify as sale price or lease rate.',
    };
  }

  // --- Nothing matched at all ---
  return {
    ...base,
    status: 'needs_review',
    confidence: 'low',
    reviewReason: `Unrecognized price format: "${rawOriginal}".`,
  };
}

module.exports = { parsePrice, PRICE_PARSER_CONFIG };
