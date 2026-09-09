'use strict';

const { db } = require('./db');

/**
 * §4E Cluster Map geocoding. Free OSM/Nominatim by default; provider is
 * swappable (config key `geocode_provider`) in case a paid API key gets
 * added later. Every resolved (or failed) query is cached in
 * `geocode_cache` — a query is never re-sent once attempted.
 *
 * Nominatim's usage policy caps at 1 req/sec and requires an identifying
 * User-Agent, so callers must geocode through `geocodeBatch`, which paces
 * itself, rather than firing requests in parallel.
 *
 * Nominatim frequently can't resolve a full "house number + street" civic
 * address for small/rural Ontario towns (verified while building this —
 * see README) but resolves the street or the town just fine. So each row
 * tries progressively coarser queries and keeps the first hit:
 *   1. full address + municipality
 *   2. street only (house number stripped) + municipality
 *   3. municipality alone (falls back to the town centroid)
 * `precision` on the result records which level actually matched, so the
 * map/heatmap can show that a pin is town-level, not a fabricated exact
 * point.
 */

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'ios-market-tracker/0.1 (local personal-use dashboard)';
const RATE_LIMIT_MS = 1100;

// Strip parenthetical annotations we ourselves added to municipality names
// during import corrections (e.g. "Ancaster (Hamilton)", "New Hamburg
// (Wilmot Twp, Waterloo Region)") — Nominatim chokes on these otherwise.
function cleanMunicipality(municipality) {
  if (!municipality) return municipality;
  return municipality.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

function stripHouseNumber(address) {
  return address.replace(/^\s*\d+[a-zA-Z]?\s*[-&]?\s*\d*\s*/, '').trim();
}

function buildCandidateQueries(address, municipality) {
  const muni = cleanMunicipality(municipality);
  const queries = [];
  if (address) queries.push({ q: [address, muni, 'Ontario', 'Canada'].filter(Boolean).join(', '), precision: 'address' });
  const street = address ? stripHouseNumber(address) : null;
  if (street && street !== address) queries.push({ q: [street, muni, 'Ontario', 'Canada'].filter(Boolean).join(', '), precision: 'street' });
  if (muni) queries.push({ q: [muni, 'Ontario', 'Canada'].filter(Boolean).join(', '), precision: 'municipality' });
  return queries;
}

function getCached(query) {
  return db.prepare('SELECT * FROM geocode_cache WHERE query = ?').get(query);
}

function setCached(query, lat, lon, precision) {
  db.prepare('INSERT OR REPLACE INTO geocode_cache (query, lat, lon, provider) VALUES (?, ?, ?, ?)').run(
    query, lat, lon, `nominatim:${precision}`
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function nominatimSearch(q) {
  const url = `${NOMINATIM_URL}?format=json&limit=1&countrycodes=ca&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) return null;
  const results = await res.json();
  if (results.length === 0) return null;
  return { lat: parseFloat(results[0].lat), lon: parseFloat(results[0].lon) };
}

/** Geocode one address, trying progressively coarser queries; paces itself. */
async function geocodeAddress(address, municipality) {
  const candidates = buildCandidateQueries(address, municipality);
  for (const { q, precision } of candidates) {
    const cached = getCached(q);
    if (cached) {
      if (cached.lat != null) return { lat: cached.lat, lon: cached.lon, precision };
      continue; // this exact query is known to fail — try the next, coarser one
    }
    let result = null;
    try {
      result = await nominatimSearch(q);
    } catch (err) {
      console.error('Geocode request failed for', q, err.message);
    }
    setCached(q, result?.lat ?? null, result?.lon ?? null, precision);
    await sleep(RATE_LIMIT_MS);
    if (result) return { ...result, precision };
  }
  return { lat: null, lon: null, precision: null };
}

/** Geocode up to `limit` listings that don't have lat/lon yet. */
async function geocodeBatch(limit = 20) {
  const rows = db
    .prepare('SELECT source_key, address, municipality FROM listings WHERE lat IS NULL AND address IS NOT NULL LIMIT ?')
    .all(limit);

  let resolved = 0, failed = 0;
  for (const row of rows) {
    const result = await geocodeAddress(row.address, row.municipality);
    if (result.lat != null) {
      db.prepare('UPDATE listings SET lat = ?, lon = ?, geocode_precision = ? WHERE source_key = ?').run(
        result.lat, result.lon, result.precision, row.source_key
      );
      resolved++;
    } else {
      // Permanently give up on this row so it stops being retried forever —
      // it's excluded from "needs geocoding" via geocode_attempted, and the
      // map/heatmap simply won't have a point for it.
      db.prepare('UPDATE listings SET geocode_attempted = 1 WHERE source_key = ?').run(row.source_key);
      failed++;
    }
  }
  const remaining = db.prepare('SELECT COUNT(*) as n FROM listings WHERE lat IS NULL AND geocode_attempted = 0').get().n;
  return { processed: rows.length, resolved, failed, remaining };
}

let backgroundRunning = false;

/**
 * Keep geocoding in the background until every row has a lat/lon (or has
 * permanently failed to resolve). Safe to call as often as you like — a
 * second call while one is already running is a no-op, so "geocode after
 * every import" + "geocode on server startup" never race each other.
 */
async function ensureBackgroundGeocoding() {
  if (backgroundRunning) return;
  backgroundRunning = true;
  try {
    let result;
    do {
      result = await geocodeBatch(20);
    } while (result.processed > 0 && result.remaining > 0);
  } catch (err) {
    console.error('Background geocoding stopped early:', err.message);
  } finally {
    backgroundRunning = false;
  }
}

module.exports = { geocodeBatch, buildCandidateQueries, ensureBackgroundGeocoding };
