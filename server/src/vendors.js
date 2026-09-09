'use strict';

const { db } = require('./db');

/**
 * §4C Vendor Tracker. Groups `transaction` rows by normalized vendor name:
 * deal count, total $ volume, avg deal size, markets/municipalities,
 * property list. Vendors with 2+ deals are the "pattern" signal.
 *
 * Also surfaces "possible same entity" suggestions for near-duplicate names
 * (Levenshtein-lite: same after stripping punctuation/common suffixes) —
 * never auto-merged, just suggested for a one-click confirm.
 */

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function getVendorMerges() {
  const rows = db.prepare('SELECT from_name, into_name FROM vendor_merges').all();
  const map = new Map();
  for (const r of rows) map.set(r.from_name, r.into_name);
  return map;
}

function resolveVendorName(normalized, merges) {
  let current = normalized;
  let hops = 0;
  while (merges.has(current) && hops < 10) {
    current = merges.get(current);
    hops++;
  }
  return current;
}

function getVendors() {
  const merges = getVendorMerges();
  const rows = db
    .prepare("SELECT * FROM listings WHERE record_type = 'transaction' AND vendor_normalized IS NOT NULL")
    .all();

  const byVendor = new Map();
  for (const r of rows) {
    const key = resolveVendorName(r.vendor_normalized, merges);
    if (!byVendor.has(key)) byVendor.set(key, []);
    byVendor.get(key).push(r);
  }

  const vendors = [];
  for (const [name, deals] of byVendor.entries()) {
    if (name === 'Unknown') continue; // not a real entity to track
    const withPrice = deals.filter((d) => d.price_amount != null && d.price_unit === 'total');
    const totalVolume = withPrice.reduce((sum, d) => sum + d.price_amount, 0);
    vendors.push({
      vendorName: name,
      dealCount: deals.length,
      totalVolume,
      avgDealSize: withPrice.length ? totalVolume / withPrice.length : null,
      markets: [...new Set(deals.map((d) => d.market))],
      municipalities: [...new Set(deals.map((d) => d.municipality).filter(Boolean))],
      properties: deals.map((d) => ({
        address: d.address,
        municipality: d.municipality,
        market: d.market,
        date: d.record_date,
        price: d.price_amount,
        priceUnit: d.price_unit,
        priceRaw: d.price_raw,
        sourceKey: d.source_key,
      })),
    });
  }
  vendors.sort((a, b) => b.dealCount - a.dealCount || b.totalVolume - a.totalVolume);

  // Market concentration (HHI-style, on $ volume) — answers "is this market
  // fractured or dominated by a few sellers?" HHI is the sum of squared
  // market shares (0-10000 scale); <1500 = fragmented, 1500-2500 = moderate,
  // >2500 = concentrated (US DOJ/FTC's own thresholds, reused here since
  // there's no CRE-specific convention worth inventing).
  const totalVolumeAll = vendors.reduce((s, v) => s + v.totalVolume, 0);
  const hhi = totalVolumeAll > 0
    ? vendors.reduce((s, v) => s + Math.pow((v.totalVolume / totalVolumeAll) * 100, 2), 0)
    : 0;
  const concentration = hhi > 2500 ? 'concentrated' : hhi > 1500 ? 'moderate' : 'fragmented';

  // Possible-same-entity suggestions among *unmerged* vendor names.
  const names = vendors.map((v) => v.vendorName);
  const suggestions = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i], b = names[j];
      if (a === b) continue;
      const dist = levenshtein(a, b);
      const maxLen = Math.max(a.length, b.length);
      if (maxLen > 0 && dist / maxLen < 0.2 && dist <= 4) {
        suggestions.push({ a, b, distance: dist });
      }
    }
  }

  return { vendors, suggestions, concentration: { hhi: Math.round(hhi), label: concentration, totalVolumeAll } };
}

function mergeVendors(fromName, intoName) {
  db.prepare('INSERT OR REPLACE INTO vendor_merges (from_name, into_name) VALUES (?, ?)').run(fromName, intoName);
}

module.exports = { getVendors, mergeVendors };
