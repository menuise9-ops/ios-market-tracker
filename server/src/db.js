'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'app.db');
const RAW_DIR = path.join(DATA_DIR, 'raw');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(RAW_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS import_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  archived_path TEXT,
  uploaded_at TEXT DEFAULT (datetime('now')),
  date_range_start TEXT,
  date_range_end TEXT,
  rows_added INTEGER DEFAULT 0,
  rows_updated INTEGER DEFAULT 0,
  rows_flagged INTEGER DEFAULT 0,
  rows_skipped INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT UNIQUE NOT NULL,
  record_type TEXT NOT NULL CHECK(record_type IN ('transaction','availability')),
  market TEXT NOT NULL,
  sheet_name_raw TEXT,
  municipality TEXT,
  address TEXT,
  type_of_land_raw TEXT,
  type_of_land_normalized TEXT,
  sqft REAL,
  sqft_raw TEXT,
  acres REAL,
  acres_raw TEXT,
  building_coverage_pct REAL,
  record_date TEXT,
  record_date_raw TEXT,
  date_flagged INTEGER DEFAULT 0,
  price_raw TEXT,
  price_status TEXT,
  price_deal_type TEXT,
  price_amount REAL,
  price_unit TEXT,
  price_basis TEXT,
  price_confidence TEXT,
  price_review_reason TEXT,
  taxes_raw TEXT,
  taxes_numeric REAL,
  zoning TEXT,
  vendor_raw TEXT,
  vendor_normalized TEXT,
  notes TEXT,
  needs_review INTEGER DEFAULT 0,
  review_reasons TEXT,
  lat REAL,
  lon REAL,
  first_seen_date TEXT,
  last_seen_date TEXT,
  first_seen_batch_id INTEGER REFERENCES import_batches(id),
  last_seen_batch_id INTEGER REFERENCES import_batches(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_listings_market ON listings(market);
CREATE INDEX IF NOT EXISTS idx_listings_municipality ON listings(municipality);
CREATE INDEX IF NOT EXISTS idx_listings_record_type ON listings(record_type);
CREATE INDEX IF NOT EXISTS idx_listings_vendor_normalized ON listings(vendor_normalized);
CREATE INDEX IF NOT EXISTS idx_listings_needs_review ON listings(needs_review);

CREATE TABLE IF NOT EXISTS manual_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL,
  field TEXT NOT NULL,
  value TEXT,
  reason TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(source_key, field)
);

CREATE TABLE IF NOT EXISTS vendor_merges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_name TEXT NOT NULL UNIQUE,
  into_name TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS geocode_cache (
  query TEXT PRIMARY KEY,
  lat REAL,
  lon REAL,
  provider TEXT,
  resolved_at TEXT DEFAULT (datetime('now'))
);

-- CLAUDE.md §2: "once I confirm a few, you can raise confidence for that
-- pattern going forward — but don't do this silently." A row here means the
-- Review Queue confirmed that price-parsing pattern enough times that future
-- imports stop flagging it (still shown, just no longer queued).
CREATE TABLE IF NOT EXISTS pattern_confirmations (
  reason_code TEXT PRIMARY KEY,
  confirmed_at TEXT DEFAULT (datetime('now'))
);

-- Cached Bank of Canada overnight rate observations (see rates.js). This is
-- the one place the app calls out to the internet for something other than
-- geocoding — cached so a later offline run still has whatever was fetched.
CREATE TABLE IF NOT EXISTS boc_rates (
  date TEXT PRIMARY KEY,
  overnight_rate REAL,
  fetched_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;

db.exec(SCHEMA);

// Lightweight column migrations — SQLite's ALTER TABLE ADD COLUMN has no
// IF NOT EXISTS, so check pragma table_info first to stay idempotent across
// restarts (no separate migration framework for a single-table app like this).
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}
ensureColumn('listings', 'geocode_precision', 'TEXT');
ensureColumn('listings', 'geocode_attempted', 'INTEGER DEFAULT 0');

// Seed the region-label config once, with defaults the onboarding screen can
// override (CLAUDE.md §1: "confirm these expansions with me ... rather than
// hardcoding a guess").
const DEFAULT_MARKET_LABELS = {
  MWO: 'Mid-Western Ontario',
  SWO: 'South-Western Ontario',
  'Core GTA': 'Core GTA',
  'Non-Core GTA': 'Non-Core GTA',
};

function seedConfigIfMissing(key, value) {
  const row = db.prepare('SELECT value FROM app_config WHERE key = ?').get(key);
  if (!row) {
    db.prepare('INSERT INTO app_config (key, value) VALUES (?, ?)').run(key, value);
  }
}

seedConfigIfMissing('market_labels', JSON.stringify(DEFAULT_MARKET_LABELS));
seedConfigIfMissing('market_labels_confirmed', 'false');

module.exports = { db, DATA_DIR, DB_PATH, RAW_DIR };
