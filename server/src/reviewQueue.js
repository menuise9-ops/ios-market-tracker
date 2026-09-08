'use strict';

const { db } = require('./db');

const EDITABLE_FIELDS = new Set([
  'price_amount', 'price_unit', 'price_basis', 'price_deal_type', 'price_status',
  'record_date', 'type_of_land_normalized', 'vendor_normalized', 'notes',
]);

function listReviewQueue() {
  const rows = db.prepare('SELECT * FROM listings WHERE needs_review = 1 ORDER BY updated_at DESC').all();
  return rows.map((r) => ({
    ...r,
    review_reasons: r.review_reasons ? JSON.parse(r.review_reasons) : [],
  }));
}

/**
 * Resolve one row. `updates` are applied to the listing AND recorded in
 * manual_overrides so future re-imports never clobber the correction
 * (CLAUDE.md §3). If `confirmPatternCode` is given, this exact price-parsing
 * pattern is marked confirmed app-wide (future imports stop flagging it —
 * see importer.js's `confirmedPatterns` check) and every *other* currently
 * flagged row carrying that same reason code is retroactively un-flagged too
 * (never silent: the caller gets back how many rows that touched).
 */
function resolveReviewItem(sourceKey, { updates = {}, confirmPatternCode = null } = {}) {
  const existing = db.prepare('SELECT * FROM listings WHERE source_key = ?').get(sourceKey);
  if (!existing) throw new Error('No listing found for that source_key.');

  const setClauses = [];
  const params = {};
  for (const [field, value] of Object.entries(updates)) {
    if (!EDITABLE_FIELDS.has(field)) continue;
    setClauses.push(`${field} = @${field}`);
    params[field] = value;
    db.prepare(
      'INSERT INTO manual_overrides (source_key, field, value, reason) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(source_key, field) DO UPDATE SET value = excluded.value, created_at = datetime(\'now\')'
    ).run(sourceKey, field, value === null ? 'null' : String(value), 'resolved via review queue');
  }

  // Clear this row's own review_reasons — it's been explicitly resolved.
  if (setClauses.length > 0) {
    params.source_key = sourceKey;
    db.prepare(`UPDATE listings SET ${setClauses.join(', ')} WHERE source_key = @source_key`).run(params);
  }
  db.prepare('UPDATE listings SET needs_review = 0, review_reasons = NULL WHERE source_key = ?').run(sourceKey);

  let bulkAffected = 0;
  if (confirmPatternCode) {
    db.prepare('INSERT OR IGNORE INTO pattern_confirmations (reason_code) VALUES (?)').run(confirmPatternCode);

    const others = db.prepare("SELECT source_key, review_reasons FROM listings WHERE needs_review = 1 AND source_key != ?").all(sourceKey);
    for (const row of others) {
      const reasons = JSON.parse(row.review_reasons || '[]');
      if (!reasons.some((r) => r.code === confirmPatternCode)) continue;
      const remaining = reasons.filter((r) => r.code !== confirmPatternCode);
      db.prepare(
        'UPDATE listings SET review_reasons = ?, needs_review = ?, price_status = CASE WHEN price_status = \'needs_review\' THEN \'parsed\' ELSE price_status END, price_confidence = \'high\' WHERE source_key = ?'
      ).run(remaining.length ? JSON.stringify(remaining) : null, remaining.length ? 1 : 0, row.source_key);
      bulkAffected++;
    }
  }

  return { ok: true, bulkAffected };
}

module.exports = { listReviewQueue, resolveReviewItem, EDITABLE_FIELDS };
