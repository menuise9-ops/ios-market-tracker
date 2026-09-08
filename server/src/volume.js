'use strict';

const { db } = require('./db');

/**
 * §4D Transaction Volume by Market. Stacked by Market, split Low Coverage vs
 * Land, bucketed by month of `record_date` (the underlying market-activity
 * date, not upload date — see README for why: grouping by upload batch would
 * conflate "when I happened to import a file" with "when the deal actually
 * happened"). Same shape for availabilities (new listings appearing).
 */
function monthBucket(iso) {
  return iso ? iso.slice(0, 7) : 'unknown';
}

function buildVolume(recordType) {
  const rows = db.prepare('SELECT * FROM listings WHERE record_type = ?').all(recordType);
  const buckets = new Map(); // month -> market -> type -> {count, sqft, acres}

  for (const r of rows) {
    const month = monthBucket(r.record_date);
    if (!buckets.has(month)) buckets.set(month, {});
    const b = buckets.get(month);
    const key = `${r.market}__${r.type_of_land_normalized || 'Unclassified'}`;
    if (!b[key]) b[key] = { market: r.market, type: r.type_of_land_normalized || 'Unclassified', count: 0, sqft: 0, acres: 0 };
    b[key].count += 1;
    if (typeof r.sqft === 'number') b[key].sqft += r.sqft;
    if (typeof r.acres === 'number') b[key].acres += r.acres;
  }

  const months = [...buckets.keys()].sort();
  const series = months.map((month) => ({ month, ...buckets.get(month) }));
  return { recordType, months, series };
}

function getVolume() {
  return {
    transactions: buildVolume('transaction'),
    availabilities: buildVolume('availability'),
  };
}

module.exports = { getVolume };
