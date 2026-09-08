'use strict';

const { db } = require('./db');

/**
 * §4E Cluster Map geocoding. Free OSM/Nominatim by default; provider is
 * swappable (config key `geocode_provider`) in case a paid API key gets
 * added later. Every resolved (or failed) query is cached in
 * `geocode_cache` — a row is never re-geocoded once attempted.
 *
 * Nominatim's usage policy caps at 1 req/sec and requires an identifying
 * User-Agent, so callers must geocode through `geocodeBatch`, which paces
 * itself, rather than firing requests in parallel.
 */

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'ios-market-tracker/0.1 (local personal-use dashboard)';
const RATE_LIMIT_MS = 1100;

function buildQuery(address, municipality) {
  return [address, municipality, 'Ontario', 'Canada'].filter(Boolean).join(', ');
}

function getCached(query) {
  return db.prepare('SELECT * FROM geocode_cache WHERE query = ?').get(query);
}

async function geocodeOne(query) {
  const cached = getCached(query);
  if (cached) return cached;

  let lat = null, lon = null;
  try {
    const url = `${NOMINATIM_URL}?format=json&limit=1&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (res.ok) {
      const results = await res.json();
      if (results.length > 0) {
        lat = parseFloat(results[0].lat);
        lon = parseFloat(results[0].lon);
      }
    }
  } catch (err) {
    console.error('Geocode failed for', query, err.message);
  }

  db.prepare('INSERT OR REPLACE INTO geocode_cache (query, lat, lon, provider) VALUES (?, ?, ?, ?)').run(
    query, lat, lon, 'nominatim'
  );
  return { query, lat, lon, provider: 'nominatim' };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Geocode up to `limit` listings that don't have lat/lon yet. Paced to respect Nominatim. */
async function geocodeBatch(limit = 20) {
  const rows = db
    .prepare('SELECT source_key, address, municipality FROM listings WHERE lat IS NULL AND address IS NOT NULL LIMIT ?')
    .all(limit);

  let resolved = 0, failed = 0;
  for (const row of rows) {
    const query = buildQuery(row.address, row.municipality);
    const result = await geocodeOne(query);
    if (result.lat != null) {
      db.prepare('UPDATE listings SET lat = ?, lon = ? WHERE source_key = ?').run(result.lat, result.lon, row.source_key);
      resolved++;
    } else {
      failed++;
    }
    await sleep(RATE_LIMIT_MS);
  }
  const remaining = db.prepare('SELECT COUNT(*) as n FROM listings WHERE lat IS NULL').get().n;
  return { processed: rows.length, resolved, failed, remaining };
}

module.exports = { geocodeBatch, buildQuery };
