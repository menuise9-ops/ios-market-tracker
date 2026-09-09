'use strict';

const { db } = require('./db');

/**
 * Bank of Canada target overnight rate (series V39079), the one external
 * data source this app calls out for besides geocoding — used to overlay
 * financing conditions on the volume/pricing trend charts (request: "how do
 * interest rates affect IOS activity?"). Canadian bank prime is
 * conventionally overnight-rate + 2.20%; we compute that ourselves and
 * label it "approximate" rather than pretend it's an official published
 * series, since actual bank prime can lag or deviate slightly.
 */

const PRIME_SPREAD = 2.20;
const VALET_URL = 'https://www.bankofcanada.ca/valet/observations/V39079/json';
const REFRESH_AFTER_HOURS = 24;

async function refreshIfStale() {
  const latest = db.prepare('SELECT MAX(fetched_at) as t FROM boc_rates').get();
  if (latest?.t) {
    const ageHours = (Date.now() - new Date(latest.t + 'Z').getTime()) / 3600000;
    if (ageHours < REFRESH_AFTER_HOURS) return { refreshed: false };
  }
  try {
    const res = await fetch(`${VALET_URL}?start_date=2024-01-01`);
    if (!res.ok) return { refreshed: false, error: `HTTP ${res.status}` };
    const json = await res.json();
    const insert = db.prepare('INSERT OR REPLACE INTO boc_rates (date, overnight_rate) VALUES (?, ?)');
    for (const obs of json.observations || []) {
      const v = obs.V39079?.v;
      if (v !== undefined) insert.run(obs.d, parseFloat(v));
    }
    return { refreshed: true, count: json.observations?.length || 0 };
  } catch (err) {
    return { refreshed: false, error: err.message };
  }
}

/** Monthly series (last observation of each month) for overlaying on charts. */
function getMonthlyRates() {
  const rows = db.prepare('SELECT date, overnight_rate FROM boc_rates ORDER BY date ASC').all();
  const byMonth = new Map();
  for (const r of rows) {
    byMonth.set(r.date.slice(0, 7), r.overnight_rate); // later dates overwrite -> last obs of month wins
  }
  return [...byMonth.entries()].map(([month, overnightRate]) => ({
    month,
    overnightRate,
    approxPrime: Math.round((overnightRate + PRIME_SPREAD) * 100) / 100,
  }));
}

module.exports = { refreshIfStale, getMonthlyRates, PRIME_SPREAD };
