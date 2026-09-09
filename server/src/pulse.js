'use strict';

const { db } = require('./db');

/**
 * Market Pulse — the institutional-style landing screen. Everything here is
 * derived fresh from `listings` on every request (no separate snapshot
 * table to keep in sync) so it's always consistent with the Overview/
 * Vendor/Volume pages; "stored over time" comes from the listings table
 * itself accumulating across imports, not from a bespoke pulse-history log.
 *
 * "Now" is the latest record_date in the dataset, not wall-clock time —
 * same convention as pricing.js, since this data's own dates run into
 * 2026+ regardless of when the app is actually opened.
 */

const PERIOD_DAYS = 60;

function daysBetween(aIso, bIso) {
  return (new Date(bIso).getTime() - new Date(aIso).getTime()) / 86400000;
}

function addDays(iso, days) {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function getLatestDate() {
  // Exclude date_flagged rows (e.g. the known "2206" instead of "2026" typo,
  // see CLAUDE.md §1) — a bad future date would otherwise poison every
  // "now"-relative calculation (recency weighting, days-on-market, periods).
  const row = db.prepare("SELECT MAX(record_date) as d FROM listings WHERE date_flagged = 0").get();
  return row?.d || new Date().toISOString().slice(0, 10);
}

function usableRows() {
  return db.prepare("SELECT * FROM listings WHERE price_status NOT IN ('missing')").all();
}

function inRange(row, start, end) {
  return row.record_date && row.record_date >= start && row.record_date <= end;
}

function sum(arr, fn) {
  return arr.reduce((s, x) => s + (fn(x) ?? 0), 0);
}

function pctChange(curr, prior) {
  if (prior === null || prior === undefined || prior === 0) return null;
  if (curr === null || curr === undefined) return null;
  return ((curr - prior) / Math.abs(prior)) * 100;
}

function periodKpis(rows, market) {
  const txns = rows.filter((r) => r.record_type === 'transaction' && (!market || r.market === market));
  const avails = rows.filter((r) => r.record_type === 'availability' && (!market || r.market === market));
  const saleTxns = txns.filter((r) => r.price_deal_type === 'sale' && r.price_unit === 'total' && r.price_amount != null);
  const totalVolume = sum(saleTxns, (r) => r.price_amount);
  return {
    dealsClosed: txns.length,
    newAvailabilities: avails.length,
    totalVolume,
    avgDealSize: saleTxns.length ? totalVolume / saleTxns.length : null,
    saleCompCount: saleTxns.length,
  };
}

function avgPerAcre(rows) {
  const withAcre = rows.filter((r) => r.price_deal_type === 'sale' && r.price_unit === 'total' && r.acres && r.price_amount != null);
  if (withAcre.length === 0) return null;
  return sum(withAcre, (r) => r.price_amount / r.acres) / withAcre.length;
}

function buildMonthlySeries(rows, monthsBack = 9) {
  const now = getLatestDate();
  const months = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCMonth(d.getUTCMonth() - i);
    months.push(d.toISOString().slice(0, 7));
  }
  const byMonth = new Map(months.map((m) => [m, { month: m, transactions: 0, availabilities: 0, volume: 0 }]));
  for (const r of rows) {
    if (!r.record_date) continue;
    const m = r.record_date.slice(0, 7);
    if (!byMonth.has(m)) continue;
    const bucket = byMonth.get(m);
    if (r.record_type === 'transaction') {
      bucket.transactions += 1;
      if (r.price_deal_type === 'sale' && r.price_unit === 'total' && r.price_amount) bucket.volume += r.price_amount;
    } else {
      bucket.availabilities += 1;
    }
  }
  return months.map((m) => byMonth.get(m));
}

function buildInsights(rows, current, prior, latestBatch) {
  const insights = [];

  // Biggest deal this period
  const currentSales = current.filter((r) => r.record_type === 'transaction' && r.price_deal_type === 'sale' && r.price_unit === 'total' && r.price_amount);
  if (currentSales.length) {
    const biggest = currentSales.reduce((a, b) => (b.price_amount > a.price_amount ? b : a));
    insights.push({
      type: 'biggest_deal',
      severity: 'info',
      text: `Largest sale in the last ${PERIOD_DAYS} days: ${biggest.address} (${biggest.municipality}) at $${Math.round(biggest.price_amount).toLocaleString()}.`,
    });
  }

  // Price movers per market+type (avg $/acre, current vs prior)
  const MARKETS = [...new Set(rows.map((r) => r.market))];
  const TYPES = ['Low Coverage', 'Land'];
  let biggestMove = null;
  for (const m of MARKETS) {
    for (const t of TYPES) {
      const curr = avgPerAcre(current.filter((r) => r.market === m && r.type_of_land_normalized === t));
      const pri = avgPerAcre(prior.filter((r) => r.market === m && r.type_of_land_normalized === t));
      const change = pctChange(curr, pri);
      if (change !== null && (!biggestMove || Math.abs(change) > Math.abs(biggestMove.change))) {
        biggestMove = { market: m, type: t, change, curr, pri };
      }
    }
  }
  if (biggestMove) {
    const dir = biggestMove.change >= 0 ? 'up' : 'down';
    insights.push({
      type: 'price_move',
      severity: Math.abs(biggestMove.change) > 15 ? 'high' : 'info',
      text: `${biggestMove.market} ${biggestMove.type} avg $/acre is ${dir} ${Math.abs(biggestMove.change).toFixed(0)}% vs the prior ${PERIOD_DAYS} days ($${Math.round(biggestMove.pri).toLocaleString()} → $${Math.round(biggestMove.curr).toLocaleString()}).`,
    });
  }

  // Repeat vendors (overall, not period-scoped — pattern signal)
  const vendorCounts = new Map();
  for (const r of rows) {
    if (r.record_type !== 'transaction' || !r.vendor_normalized || r.vendor_normalized === 'Unknown') continue;
    vendorCounts.set(r.vendor_normalized, (vendorCounts.get(r.vendor_normalized) || 0) + 1);
  }
  const repeatVendors = [...vendorCounts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]);
  if (repeatVendors.length) {
    insights.push({
      type: 'repeat_vendor',
      severity: 'info',
      text: `${repeatVendors[0][0]} has ${repeatVendors[0][1]} deals on file — worth a closer look as a repeat principal.${repeatVendors.length > 1 ? ` (${repeatVendors.length} vendors total with 2+ deals.)` : ''}`,
    });
  }

  // Longest-active availability still on market
  const activeAvail = rows.filter((r) => r.record_type === 'availability' && r.first_seen_date);
  if (activeAvail.length) {
    const now = getLatestDate();
    const withAge = activeAvail.map((r) => ({ r, age: daysBetween(r.first_seen_date, now) }));
    const oldest = withAge.reduce((a, b) => (b.age > a.age ? b : a));
    if (oldest.age >= 14) {
      insights.push({
        type: 'stale_listing',
        severity: oldest.age > 90 ? 'high' : 'info',
        text: `${oldest.r.address} (${oldest.r.municipality}) has been tracked as available for ${Math.round(oldest.age)} days — longest currently on file.`,
      });
    }
  }

  // What changed since the last import
  if (latestBatch) {
    const newInLastBatch = rows.filter((r) => r.first_seen_batch_id === latestBatch.id);
    const updatedInLastBatch = rows.filter((r) => r.last_seen_batch_id === latestBatch.id && r.first_seen_batch_id !== latestBatch.id);
    if (newInLastBatch.length || updatedInLastBatch.length) {
      insights.push({
        type: 'last_import',
        severity: 'info',
        text: `Last import ("${latestBatch.filename}") added ${newInLastBatch.length} new listing(s) and refreshed ${updatedInLastBatch.length} already-tracked one(s).`,
      });
    }
  }

  // Data quality
  const needsReview = rows.filter((r) => r.needs_review).length;
  if (needsReview > 0) {
    insights.push({
      type: 'data_quality',
      severity: needsReview > 20 ? 'high' : 'medium',
      text: `${needsReview} listing(s) still need review before they're fully trusted in the averages above.`,
    });
  }

  return insights;
}

function getPulse() {
  const rows = usableRows();
  const now = getLatestDate();
  const periodStart = addDays(now, -PERIOD_DAYS);
  const priorStart = addDays(now, -PERIOD_DAYS * 2);

  const current = rows.filter((r) => inRange(r, periodStart, now));
  const prior = rows.filter((r) => inRange(r, priorStart, periodStart));

  const overall = { current: periodKpis(current), prior: periodKpis(prior) };
  const byMarket = {};
  for (const m of [...new Set(rows.map((r) => r.market))]) {
    byMarket[m] = { current: periodKpis(current, m), prior: periodKpis(prior, m) };
  }

  const latestBatch = db.prepare('SELECT * FROM import_batches ORDER BY id DESC LIMIT 1').get();
  // date_flagged rows (e.g. the "2206" typo) are excluded here even though
  // they're still counted everywhere else — a bad date would otherwise sort
  // to the top of "recent" activity and read as misleadingly current.
  const recentActivity = db
    .prepare("SELECT * FROM listings WHERE date_flagged = 0 ORDER BY record_date DESC, updated_at DESC LIMIT 15")
    .all();

  return {
    asOf: now,
    periodDays: PERIOD_DAYS,
    overall,
    byMarket,
    trend: buildMonthlySeries(rows),
    insights: buildInsights(rows, current, prior, latestBatch),
    recentActivity,
    totalListings: rows.length,
    totalTransactions: rows.filter((r) => r.record_type === 'transaction').length,
    totalAvailabilities: rows.filter((r) => r.record_type === 'availability').length,
    needsReviewCount: rows.filter((r) => r.needs_review).length,
    lastImport: latestBatch || null,
  };
}

module.exports = { getPulse };
