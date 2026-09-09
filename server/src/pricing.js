'use strict';

const { db } = require('./db');

/**
 * §4F Off-Market Pricing Tool. Recent comps (last 3 months) carry more
 * weight than older ones (6+ months) — implemented as exponential decay,
 * half-life 3 months, so it degrades smoothly rather than a hard cliff.
 * "now" is the latest record_date in the dataset (not wall-clock time),
 * since the source data's own dates run into 2026+ — see CLAUDE.md's date
 * examples. Every number returned is accompanied by the actual comps used,
 * never a bare estimate.
 */

const HALF_LIFE_MONTHS = 3;

function monthsAgo(iso, nowIso) {
  if (!iso || !nowIso) return null;
  const a = new Date(iso).getTime();
  const b = new Date(nowIso).getTime();
  return (b - a) / (1000 * 60 * 60 * 24 * 30.44);
}

function recencyWeight(iso, nowIso) {
  const m = monthsAgo(iso, nowIso);
  if (m === null || m < 0) return 1;
  return Math.pow(0.5, m / HALF_LIFE_MONTHS);
}

function weightedAvg(items, valueFn, weightFn) {
  let wSum = 0, vSum = 0;
  for (const it of items) {
    const v = valueFn(it);
    if (v === null || v === undefined || Number.isNaN(v)) continue;
    const w = weightFn(it);
    wSum += w;
    vSum += v * w;
  }
  return wSum > 0 ? vSum / wSum : null;
}

function getLatestDate() {
  // Exclude date_flagged rows (e.g. the known "2206" instead of "2026" typo,
  // see CLAUDE.md §1) — a bad future date would otherwise poison recency
  // weighting for every comp in the dataset.
  const row = db.prepare("SELECT MAX(record_date) as d FROM listings WHERE date_flagged = 0").get();
  return row?.d || new Date().toISOString().slice(0, 10);
}

function fetchCandidates({ market, municipality, type }) {
  let sql = `SELECT * FROM listings WHERE market = ? AND type_of_land_normalized = ?
             AND needs_review = 0 AND price_status NOT IN ('suppressed','missing')`;
  const params = [market, type];
  if (municipality) {
    sql += ' AND municipality = ?';
    params.push(municipality);
  }
  return db.prepare(sql).all(...params);
}

function estimate({ market, municipality, type, acres, sqft }) {
  const nowIso = getLatestDate();

  let candidates = fetchCandidates({ market, municipality, type });
  let usedFallback = false;
  const MIN_COMPS = 3;
  if (municipality && candidates.length < MIN_COMPS) {
    const marketLevel = fetchCandidates({ market, municipality: null, type });
    if (marketLevel.length > candidates.length) {
      candidates = marketLevel;
      usedFallback = true;
    }
  }

  const saleRows = candidates.filter((r) => r.price_deal_type === 'sale' && r.price_unit === 'total' && r.record_type === 'transaction');
  const salePerAcreRows = saleRows.filter((r) => r.acres);
  const w = (r) => recencyWeight(r.record_date, nowIso);

  const avgSaleTotal = weightedAvg(saleRows, (r) => r.price_amount, w);
  const avgSalePerAcre = weightedAvg(salePerAcreRows, (r) => r.price_amount / r.acres, w);
  const saleAmounts = saleRows.map((r) => r.price_amount).filter((v) => v != null);

  let saleEstimate = avgSaleTotal;
  let saleEstimateBasis = 'avg_total';
  if (acres && avgSalePerAcre) {
    saleEstimate = avgSalePerAcre * acres;
    saleEstimateBasis = 'per_acre_x_target_acres';
  }

  const leaseRows = candidates.filter((r) => r.price_deal_type === 'lease' && r.price_unit === 'per_sf');
  const leaseNetRows = leaseRows.filter((r) => r.price_basis === 'net');
  const leaseGrossRows = leaseRows.filter((r) => r.price_basis === 'gross');

  const avgLeaseNetPsf = weightedAvg(leaseNetRows, (r) => r.price_amount, w);
  const avgLeaseGrossPsf = weightedAvg(leaseGrossRows, (r) => r.price_amount, w);
  const leaseAmounts = leaseRows.map((r) => r.price_amount).filter((v) => v != null);

  const toComp = (r) => ({
    sourceKey: r.source_key,
    address: r.address,
    municipality: r.municipality,
    recordType: r.record_type,
    date: r.record_date,
    priceRaw: r.price_raw,
    priceAmount: r.price_amount,
    priceUnit: r.price_unit,
    priceBasis: r.price_basis,
    acres: r.acres,
    sqft: r.sqft,
    weight: Math.round(w(r) * 100) / 100,
  });

  return {
    inputs: { market, municipality, type, acres, sqft },
    usedMarketLevelFallback: usedFallback,
    sale: {
      n: saleRows.length,
      estimate: saleEstimate,
      estimateBasis: saleEstimateBasis,
      avgTotal: avgSaleTotal,
      avgPerAcre: avgSalePerAcre,
      min: saleAmounts.length ? Math.min(...saleAmounts) : null,
      max: saleAmounts.length ? Math.max(...saleAmounts) : null,
      comps: saleRows.map(toComp),
    },
    lease: {
      n: leaseRows.length,
      avgNetPsf: avgLeaseNetPsf,
      avgGrossPsf: avgLeaseGrossPsf,
      estimateNetTotal: sqft && avgLeaseNetPsf ? avgLeaseNetPsf * sqft : null,
      estimateGrossTotal: sqft && avgLeaseGrossPsf ? avgLeaseGrossPsf * sqft : null,
      min: leaseAmounts.length ? Math.min(...leaseAmounts) : null,
      max: leaseAmounts.length ? Math.max(...leaseAmounts) : null,
      comps: leaseRows.map(toComp),
    },
  };
}

module.exports = { estimate };
