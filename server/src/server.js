'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const express = require('express');
const cors = require('cors');
const multer = require('multer');

const { db } = require('./db');
const { importFile } = require('./importer');
const { getOverview } = require('./overview');
const { getVendors, mergeVendors } = require('./vendors');
const { getVolume } = require('./volume');
const { listReviewQueue, resolveReviewItem } = require('./reviewQueue');
const { estimate } = require('./pricing');
const { geocodeBatch } = require('./geocode');

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: path.join(os.tmpdir(), 'ios-tracker-uploads') });

// ---------------------------------------------------------------------------
// Config (§1: confirm Market label expansions in-app, not hardcoded)
// ---------------------------------------------------------------------------
app.get('/api/config', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM app_config').all();
  const config = {};
  for (const r of rows) config[r.key] = r.value;
  res.json({
    marketLabels: JSON.parse(config.market_labels || '{}'),
    marketLabelsConfirmed: config.market_labels_confirmed === 'true',
  });
});

app.post('/api/config/market-labels', (req, res) => {
  const { labels, confirmed } = req.body;
  if (labels) {
    db.prepare('UPDATE app_config SET value = ? WHERE key = ?').run(JSON.stringify(labels), 'market_labels');
  }
  if (typeof confirmed === 'boolean') {
    db.prepare('UPDATE app_config SET value = ? WHERE key = ?').run(String(confirmed), 'market_labels_confirmed');
  }
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Market Overview (§4B)
// ---------------------------------------------------------------------------
app.get('/api/overview', (req, res) => {
  const { market, municipality, includeFlagged } = req.query;
  const result = getOverview({
    market: market || null,
    municipality: municipality || null,
    includeFlagged: includeFlagged === 'true',
  });
  res.json(result);
});

app.get('/api/municipalities', (req, res) => {
  const { market } = req.query;
  const sql = market
    ? 'SELECT DISTINCT municipality FROM listings WHERE market = ? AND municipality IS NOT NULL ORDER BY municipality'
    : 'SELECT DISTINCT municipality FROM listings WHERE municipality IS NOT NULL ORDER BY municipality';
  const rows = market ? db.prepare(sql).all(market) : db.prepare(sql).all();
  res.json(rows.map((r) => r.municipality));
});

// ---------------------------------------------------------------------------
// Listings (drill-down / raw table)
// ---------------------------------------------------------------------------
app.get('/api/listings', (req, res) => {
  const { market, municipality, type, status, needsReview } = req.query;
  let sql = 'SELECT * FROM listings WHERE 1=1';
  const params = [];
  if (market) { sql += ' AND market = ?'; params.push(market); }
  if (municipality) { sql += ' AND municipality = ?'; params.push(municipality); }
  if (type) { sql += ' AND type_of_land_normalized = ?'; params.push(type); }
  if (status === 'sold') { sql += " AND record_type = 'transaction'"; }
  if (status === 'available') { sql += " AND record_type = 'availability'"; }
  if (needsReview === 'true') { sql += ' AND needs_review = 1'; }
  sql += ' ORDER BY record_date DESC';
  res.json(db.prepare(sql).all(...params));
});

// ---------------------------------------------------------------------------
// Upload (§4A)
// ---------------------------------------------------------------------------
app.post('/api/import', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  const ext = path.extname(req.file.originalname).toLowerCase();
  if (ext !== '.xlsx') {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Only .xlsx files are supported.' });
  }
  try {
    // importFile() archives by basename — give it a temp path whose basename
    // matches the user's original filename so the /data/raw/ archive keeps
    // the name they uploaded, not multer's random temp name.
    const renamedPath = path.join(path.dirname(req.file.path), req.file.originalname);
    fs.renameSync(req.file.path, renamedPath);
    const summary = importFile(renamedPath);
    fs.unlinkSync(renamedPath);
    res.json(summary);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.get('/api/import-batches', (req, res) => {
  res.json(db.prepare('SELECT * FROM import_batches ORDER BY id DESC').all());
});

// ---------------------------------------------------------------------------
// Vendor Tracker (§4C)
// ---------------------------------------------------------------------------
app.get('/api/vendors', (req, res) => {
  res.json(getVendors());
});

app.post('/api/vendors/merge', (req, res) => {
  const { fromName, intoName } = req.body;
  if (!fromName || !intoName) return res.status(400).json({ error: 'fromName and intoName are required.' });
  mergeVendors(fromName, intoName);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Volume (§4D)
// ---------------------------------------------------------------------------
app.get('/api/volume', (req, res) => {
  res.json(getVolume());
});

// ---------------------------------------------------------------------------
// Review Queue (§4G)
// ---------------------------------------------------------------------------
app.get('/api/review-queue', (req, res) => {
  res.json(listReviewQueue());
});

app.post('/api/review-queue/:sourceKey/resolve', (req, res) => {
  try {
    const result = resolveReviewItem(req.params.sourceKey, req.body || {});
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

// ---------------------------------------------------------------------------
// Off-Market Pricing Tool (§4F)
// ---------------------------------------------------------------------------
app.get('/api/pricing-estimate', (req, res) => {
  const { market, municipality, type, acres, sqft } = req.query;
  if (!market || !type) return res.status(400).json({ error: 'market and type are required.' });
  res.json(
    estimate({
      market,
      municipality: municipality || null,
      type,
      acres: acres ? parseFloat(acres) : null,
      sqft: sqft ? parseFloat(sqft) : null,
    })
  );
});

// ---------------------------------------------------------------------------
// Cluster Map (§4E)
// ---------------------------------------------------------------------------
app.get('/api/map-points', (req, res) => {
  const rows = db.prepare('SELECT * FROM listings WHERE lat IS NOT NULL AND lon IS NOT NULL').all();
  const ungeocoded = db.prepare('SELECT COUNT(*) as n FROM listings WHERE lat IS NULL').get().n;
  res.json({ points: rows, ungeocodedRemaining: ungeocoded });
});

app.post('/api/geocode/run', async (req, res) => {
  const limit = req.body?.limit || 20;
  try {
    const result = await geocodeBatch(limit);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`IOS Tracker API listening on http://localhost:${PORT}`);
});

module.exports = app;
