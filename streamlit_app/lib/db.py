"""SQLite connection + schema — a faithful port of the Node app's db.js so
this Streamlit deployment shares the exact same data model (and can even
open the same seed data — see below).

Persistence note (read this before assuming data survives forever here):
Streamlit Community Cloud's filesystem generally survives sleep/wake, but a
git push or a full container rebuild resets it to whatever's committed in
the repo. So on first run we seed from `data/seed.db` (a real snapshot of
the working local app's data at the time this was deployed) rather than
starting empty — but anything uploaded *through this deployed app* only
lives until the next rebuild, unless it's exported and re-committed as a
new seed. Use the "Backup / Restore" panel (in the sidebar) to download the
current database periodically if you want to keep new uploads durable.
"""

import os
import shutil
import sqlite3
import streamlit as st

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(APP_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "app.db")
SEED_PATH = os.path.join(DATA_DIR, "seed.db")
RAW_DIR = os.path.join(DATA_DIR, "raw")

SCHEMA = """
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
  geocode_precision TEXT,
  geocode_attempted INTEGER DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS pattern_confirmations (
  reason_code TEXT PRIMARY KEY,
  confirmed_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS boc_rates (
  date TEXT PRIMARY KEY,
  overnight_rate REAL,
  fetched_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT
);
"""

DEFAULT_MARKET_LABELS = {
    "MWO": "Mid-Western Ontario",
    "SWO": "South-Western Ontario",
    "Core GTA": "Core GTA",
    "Non-Core GTA": "Non-Core GTA",
}


def _bootstrap_files():
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(RAW_DIR, exist_ok=True)
    if not os.path.exists(DB_PATH):
        if os.path.exists(SEED_PATH):
            shutil.copyfile(SEED_PATH, DB_PATH)
        # else: sqlite3.connect() below creates a fresh empty file


def _init_schema(conn):
    conn.executescript(SCHEMA)
    # Idempotent column migrations for anyone opening an older seed.db.
    cols = {row[1] for row in conn.execute("PRAGMA table_info(listings)")}
    if "geocode_precision" not in cols:
        conn.execute("ALTER TABLE listings ADD COLUMN geocode_precision TEXT")
    if "geocode_attempted" not in cols:
        conn.execute("ALTER TABLE listings ADD COLUMN geocode_attempted INTEGER DEFAULT 0")
    import json as _json
    row = conn.execute("SELECT value FROM app_config WHERE key='market_labels'").fetchone()
    if not row:
        conn.execute(
            "INSERT INTO app_config (key, value) VALUES ('market_labels', ?)",
            (_json.dumps(DEFAULT_MARKET_LABELS),),
        )
    row = conn.execute("SELECT value FROM app_config WHERE key='market_labels_confirmed'").fetchone()
    if not row:
        conn.execute("INSERT INTO app_config (key, value) VALUES ('market_labels_confirmed', 'false')")
    conn.commit()


@st.cache_resource
def _connection():
    """One shared, cached connection per Streamlit server process."""
    _bootstrap_files()
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    _init_schema(conn)
    return conn


def get_conn():
    return _connection()


def query(sql, params=()):
    """SELECT helper -> list[sqlite3.Row]."""
    return get_conn().execute(sql, params).fetchall()


def query_one(sql, params=()):
    return get_conn().execute(sql, params).fetchone()


def execute(sql, params=()):
    conn = get_conn()
    cur = conn.execute(sql, params)
    conn.commit()
    return cur


def executemany(sql, seq_of_params):
    conn = get_conn()
    conn.executemany(sql, seq_of_params)
    conn.commit()
