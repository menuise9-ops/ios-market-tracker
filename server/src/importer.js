'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const XLSX = require('xlsx');

const { db, RAW_DIR } = require('./db');
const { parsePrice } = require('./priceParser');
const { normalizeTypeOfLand } = require('./typeNormalizer');
const {
  parseNumericField,
  parseCoveragePct,
  parseTaxesNumeric,
  parseDateField,
  normalizeVendor,
} = require('./fieldParsers');

// ---------------------------------------------------------------------------
// Dedup / matching design (deviates slightly from a literal reading of
// CLAUDE.md §3, documented here on purpose — see the comment above
// `resolveMatch()` for why).
// ---------------------------------------------------------------------------

const RESALE_CONFIG = {
  // A transaction at the same address, with a date more than this many days
  // apart from the one already on file, is treated as a *distinct* second
  // transaction (e.g. a resale/flip) rather than the same event re-confirmed.
  maxDaysSameEvent: 45,
  // ...or a price that differs by more than this fraction is also treated as
  // a distinct event, even if the dates are close.
  maxPriceDeltaFraction: 0.05,
};

const SHEET_TYPES = [
  { market: 'MWO', recordType: 'transaction', test: (n) => n.startsWith('mwo') && n.includes('transact') },
  { market: 'MWO', recordType: 'availability', test: (n) => n.startsWith('mwo') && n.includes('availab') },
  { market: 'SWO', recordType: 'transaction', test: (n) => n.startsWith('swo') && n.includes('transact') },
  { market: 'SWO', recordType: 'availability', test: (n) => n.startsWith('swo') && n.includes('availab') },
  { market: 'Non-Core GTA', recordType: 'transaction', test: (n) => /non.?core gta/.test(n) && n.includes('transact') },
  { market: 'Non-Core GTA', recordType: 'availability', test: (n) => /non.?core gta/.test(n) && n.includes('availab') },
  { market: 'Core GTA', recordType: 'transaction', test: (n) => n.startsWith('core gta') && n.includes('transact') },
  { market: 'Core GTA', recordType: 'availability', test: (n) => n.startsWith('core gta') && n.includes('availab') },
];

function normalizeSheetName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function matchSheetType(sheetName) {
  const norm = normalizeSheetName(sheetName);
  for (const t of SHEET_TYPES) {
    if (t.test(norm)) return { market: t.market, recordType: t.recordType };
  }
  return null;
}

const HEADER_VARIANTS = {
  typeOfLand: ['type of land'],
  sqft: ['sq. ft.', 'sq ft', 'sq.ft.', 'sqft', 'sq. ft'],
  acres: ['acres'],
  coveragePct: ['building coverage % (when applicable)', 'building coverage %', 'building coverage'],
  date: ['transaction date', 'list date', 'last updated date', 'date'],
  address: ['address'],
  municipality: ['municipality'],
  price: ['price'],
  taxes: ['taxes/tmi', 'taxes / tmi', 'taxes'],
  zoning: ['zoning'],
  vendor: ['vendor', 'purchasor', 'seller'],
  notes: ['notes'],
};

function normalizeHeader(h) {
  return String(h ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Match columns by header text, never by fixed index (CLAUDE.md §1). */
function buildColumnMap(headerRow) {
  const normalized = headerRow.map(normalizeHeader);
  const map = {};
  for (const [field, variants] of Object.entries(HEADER_VARIANTS)) {
    let idx = -1;
    for (const variant of variants) {
      idx = normalized.findIndex((h) => h === variant);
      if (idx !== -1) break;
    }
    map[field] = idx; // -1 if this sheet doesn't have that column (e.g. no vendor col on Availabilities)
  }
  return map;
}

function isRowEmpty(row) {
  return row.every((c) => c === null || c === undefined || String(c).trim() === '');
}

function cell(row, idx) {
  if (idx === -1 || idx === undefined) return null;
  const v = row[idx];
  return v === undefined ? null : v;
}

function computeBaseKeyRaw(market, recordType, address, municipality, typeOfLandNormalized) {
  const norm = (s) => (s == null ? '' : String(s)).trim().toLowerCase().replace(/[.,]/g, '').replace(/\s+/g, ' ');
  return [market, recordType, norm(address), norm(municipality), typeOfLandNormalized || ''].join('|');
}

function sha1(s) {
  return crypto.createHash('sha1').update(s).digest('hex');
}

function daysBetween(isoA, isoB) {
  if (!isoA || !isoB) return Infinity;
  const a = new Date(isoA).getTime();
  const b = new Date(isoB).getTime();
  return Math.abs(a - b) / 86400000;
}

/**
 * Decide whether an incoming transaction row is "the same event already on
 * file, re-confirmed" or "a genuinely new transaction at an address we've
 * already seen" (e.g. a resale/flip).
 *
 * WHY THIS DEVIATES FROM A LITERAL READING OF CLAUDE.md §3:
 * The spec defines source_key as a hash including `date`. Taken completely
 * literally, that would mean an *availability* whose "Last Updated Date"
 * ticks forward on every biweekly re-upload (the common case — a listing
 * just sitting on the market) would get a *new* key every single time,
 * which defeats the stated goal one paragraph earlier: "recognize it's the
 * same underlying property, not double-count it" and "compute days-on-market
 * for availabilities that persist across multiple biweekly files." So:
 *   - Availabilities are matched WITHOUT date in the key (market, recordType,
 *     address, municipality, type_of_land) — same listing persisting across
 *     files updates in place, first_seen_date/last_seen_date track its run.
 *   - Transactions are also matched without date in the *lookup* key, but if
 *     a transaction already on file at that identity has a date/price far
 *     enough from the incoming row (RESALE_CONFIG thresholds), we treat it as
 *     a distinct second sale (real scenario hit during testing: 367 Michener
 *     Rd sold once, then the buyer re-listed it — see the resale case this
 *     guards) and insert a new, disambiguated row flagged for review instead
 *     of silently overwriting the earlier sale.
 */
function resolveMatch(recordType, baseKeyRaw, newDateIso, newPriceAmount) {
  const baseHash = sha1(baseKeyRaw);
  const existing = db.prepare('SELECT * FROM listings WHERE source_key = ?').get(baseHash);

  if (!existing) return { mode: 'insert', sourceKey: baseHash, existing: null };

  if (recordType === 'availability') {
    return { mode: 'update', sourceKey: baseHash, existing };
  }

  // transaction: decide same-event vs distinct-event
  const dayDiff = daysBetween(existing.record_date, newDateIso);
  let priceClose = true;
  if (existing.price_amount != null && newPriceAmount != null && existing.price_amount !== 0) {
    priceClose = Math.abs(existing.price_amount - newPriceAmount) / Math.abs(existing.price_amount) <= RESALE_CONFIG.maxPriceDeltaFraction;
  }

  if (dayDiff <= RESALE_CONFIG.maxDaysSameEvent && priceClose) {
    return { mode: 'update', sourceKey: baseHash, existing };
  }

  // Distinct second transaction at the same address/type — disambiguate.
  const disambiguatedHash = sha1(`${baseKeyRaw}#${newDateIso || 'unknown-date'}`);
  const existingDisambiguated = db.prepare('SELECT * FROM listings WHERE source_key = ?').get(disambiguatedHash);
  if (existingDisambiguated) {
    return { mode: 'update', sourceKey: disambiguatedHash, existing: existingDisambiguated };
  }
  return {
    mode: 'insert_flagged',
    sourceKey: disambiguatedHash,
    existing: null,
    flagReason: `Possible resale: a ${recordType} already on file at this address/type has a different date and/or price (existing: ${existing.record_date}, $${existing.price_amount ?? 'n/a'}). Confirm this is a separate transaction, not a duplicate/correction.`,
  };
}

function applyOverrides(sourceKey, row) {
  const overrides = db.prepare('SELECT field, value FROM manual_overrides WHERE source_key = ?').all(sourceKey);
  for (const o of overrides) {
    if (o.value === 'null') {
      row[o.field] = null;
    } else if (!Number.isNaN(Number(o.value)) && o.value.trim() !== '' && typeof row[o.field] === 'number') {
      row[o.field] = Number(o.value);
    } else {
      row[o.field] = o.value;
    }
  }
  return row;
}

// node:sqlite's Statement#run() throws on a bind object that has keys not
// referenced by the prepared SQL (unlike better-sqlite3, which ignores
// extras) — so each statement gets exactly the params it uses.
function pick(obj, keys) {
  const out = {};
  for (const k of keys) out[k] = obj[k];
  return out;
}

const UPDATE_PARAMS = [
  'record_date', 'record_date_raw', 'date_flagged', 'sqft', 'sqft_raw', 'acres', 'acres_raw',
  'building_coverage_pct', 'price_raw', 'price_status', 'price_deal_type', 'price_amount',
  'price_unit', 'price_basis', 'price_confidence', 'price_review_reason', 'taxes_raw',
  'taxes_numeric', 'zoning', 'vendor_raw', 'vendor_normalized', 'notes', 'needs_review',
  'review_reasons', 'last_seen_date', 'last_seen_batch_id', 'source_key',
];

function archiveRawFile(filePath) {
  const base = path.basename(filePath);
  let dest = path.join(RAW_DIR, base);
  if (fs.existsSync(dest)) {
    const existingBuf = fs.readFileSync(dest);
    const newBuf = fs.readFileSync(filePath);
    if (Buffer.compare(existingBuf, newBuf) === 0) {
      return dest; // identical file already archived, don't duplicate
    }
    const ext = path.extname(base);
    const stem = base.slice(0, -ext.length);
    let n = 2;
    while (fs.existsSync(path.join(RAW_DIR, `${stem} (${n})${ext}`))) n++;
    dest = path.join(RAW_DIR, `${stem} (${n})${ext}`);
  }
  fs.copyFileSync(filePath, dest);
  return dest;
}

/**
 * Import one .xlsx file. Returns the import_batches row (with counts) plus
 * a `flaggedRows` array (source_key + reason) for anything routed to the
 * review queue during this import.
 */
function importFile(filePath) {
  const archivedPath = archiveRawFile(filePath);
  const workbook = XLSX.readFile(filePath, { cellDates: true, sheetStubs: false });

  const insertBatch = db.prepare(
    `INSERT INTO import_batches (filename, archived_path) VALUES (?, ?)`
  );
  const batchInfo = insertBatch.run(path.basename(filePath), archivedPath);
  const batchId = Number(batchInfo.lastInsertRowid);
  const batchDateIso = new Date().toISOString().slice(0, 10);

  let rowsAdded = 0;
  let rowsUpdated = 0;
  let rowsFlagged = 0;
  let rowsSkipped = 0;
  const flaggedRows = [];
  let minDate = null;
  let maxDate = null;

  const insertStmt = db.prepare(`
    INSERT INTO listings (
      source_key, record_type, market, sheet_name_raw, municipality, address,
      type_of_land_raw, type_of_land_normalized, sqft, sqft_raw, acres, acres_raw,
      building_coverage_pct, record_date, record_date_raw, date_flagged,
      price_raw, price_status, price_deal_type, price_amount, price_unit, price_basis,
      price_confidence, price_review_reason, taxes_raw, taxes_numeric, zoning,
      vendor_raw, vendor_normalized, notes, needs_review, review_reasons,
      first_seen_date, last_seen_date, first_seen_batch_id, last_seen_batch_id
    ) VALUES (
      @source_key, @record_type, @market, @sheet_name_raw, @municipality, @address,
      @type_of_land_raw, @type_of_land_normalized, @sqft, @sqft_raw, @acres, @acres_raw,
      @building_coverage_pct, @record_date, @record_date_raw, @date_flagged,
      @price_raw, @price_status, @price_deal_type, @price_amount, @price_unit, @price_basis,
      @price_confidence, @price_review_reason, @taxes_raw, @taxes_numeric, @zoning,
      @vendor_raw, @vendor_normalized, @notes, @needs_review, @review_reasons,
      @first_seen_date, @last_seen_date, @first_seen_batch_id, @last_seen_batch_id
    )
  `);

  const updateStmt = db.prepare(`
    UPDATE listings SET
      record_date = @record_date, record_date_raw = @record_date_raw, date_flagged = @date_flagged,
      sqft = @sqft, sqft_raw = @sqft_raw, acres = @acres, acres_raw = @acres_raw,
      building_coverage_pct = @building_coverage_pct,
      price_raw = @price_raw, price_status = @price_status, price_deal_type = @price_deal_type,
      price_amount = @price_amount, price_unit = @price_unit, price_basis = @price_basis,
      price_confidence = @price_confidence, price_review_reason = @price_review_reason,
      taxes_raw = @taxes_raw, taxes_numeric = @taxes_numeric, zoning = @zoning,
      vendor_raw = @vendor_raw, vendor_normalized = @vendor_normalized, notes = @notes,
      needs_review = @needs_review, review_reasons = @review_reasons,
      last_seen_date = @last_seen_date, last_seen_batch_id = @last_seen_batch_id,
      updated_at = datetime('now')
    WHERE source_key = @source_key
  `);

  const insertUnmatchedSheet = [];

  for (const sheetName of workbook.SheetNames) {
    const sheetType = matchSheetType(sheetName);
    if (!sheetType) {
      insertUnmatchedSheet.push(sheetName);
      continue;
    }
    const { market, recordType } = sheetType;
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
    if (rows.length === 0) continue;

    const headerRow = rows[0];
    const colMap = buildColumnMap(headerRow);

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (isRowEmpty(row)) break; // stop at first fully-empty row (§1)

      const address = cell(row, colMap.address);
      if (address === null || String(address).trim() === '') {
        rowsSkipped++;
        continue;
      }

      const typeInfo = normalizeTypeOfLand(cell(row, colMap.typeOfLand));
      const sqftInfo = parseNumericField(cell(row, colMap.sqft));
      const acresInfo = parseNumericField(cell(row, colMap.acres));
      const coveragePct = parseCoveragePct(cell(row, colMap.coveragePct));
      const dateInfo = parseDateField(cell(row, colMap.date));
      const priceRaw = cell(row, colMap.price);
      const priceInfo = parsePrice(priceRaw, { sqft: sqftInfo.value, acres: acresInfo.value });
      const taxesRaw = cell(row, colMap.taxes);
      const taxesNumeric = parseTaxesNumeric(taxesRaw);
      const zoning = cell(row, colMap.zoning);
      const vendorInfo = normalizeVendor(cell(row, colMap.vendor));
      const notes = cell(row, colMap.notes);
      const municipality = cell(row, colMap.municipality);

      const reviewReasons = [];
      if (typeInfo.normalized === null && typeInfo.raw) {
        reviewReasons.push(`Unrecognized Type of Land value: "${typeInfo.raw}".`);
      }
      if (dateInfo.flagged) {
        reviewReasons.push(`Date looks wrong (parsed year out of sane range): "${dateInfo.raw}".`);
      }
      if (priceInfo.status === 'needs_review') {
        reviewReasons.push(priceInfo.reviewReason);
      }

      const baseKeyRaw = computeBaseKeyRaw(market, recordType, address, municipality, typeInfo.normalized);
      const match = resolveMatch(recordType, baseKeyRaw, dateInfo.iso, priceInfo.amount);
      if (match.flagReason) reviewReasons.push(match.flagReason);

      let rowObj = {
        source_key: match.sourceKey,
        record_type: recordType,
        market,
        sheet_name_raw: sheetName,
        municipality: municipality === null ? null : String(municipality).trim(),
        address: String(address).trim(),
        type_of_land_raw: typeInfo.raw,
        type_of_land_normalized: typeInfo.normalized,
        sqft: sqftInfo.value,
        sqft_raw: sqftInfo.raw,
        acres: acresInfo.value,
        acres_raw: acresInfo.raw,
        building_coverage_pct: coveragePct,
        record_date: dateInfo.iso,
        record_date_raw: dateInfo.raw,
        date_flagged: dateInfo.flagged ? 1 : 0,
        price_raw: priceInfo.raw,
        price_status: priceInfo.status,
        price_deal_type: priceInfo.dealType,
        price_amount: priceInfo.amount,
        price_unit: priceInfo.unit,
        price_basis: priceInfo.basis,
        price_confidence: priceInfo.confidence,
        price_review_reason: priceInfo.reviewReason,
        taxes_raw: taxesRaw === null ? null : String(taxesRaw),
        taxes_numeric: taxesNumeric,
        zoning: zoning === null ? null : String(zoning).trim(),
        vendor_raw: vendorInfo.raw,
        vendor_normalized: vendorInfo.normalized,
        notes: notes === null ? null : String(notes),
        needs_review: reviewReasons.length > 0 ? 1 : 0,
        review_reasons: reviewReasons.length > 0 ? JSON.stringify(reviewReasons) : null,
        last_seen_date: batchDateIso,
        last_seen_batch_id: batchId,
      };

      rowObj = applyOverrides(match.sourceKey, rowObj);

      if (dateInfo.iso) {
        if (!minDate || dateInfo.iso < minDate) minDate = dateInfo.iso;
        if (!maxDate || dateInfo.iso > maxDate) maxDate = dateInfo.iso;
      }

      if (match.mode === 'insert' || match.mode === 'insert_flagged') {
        rowObj.first_seen_date = batchDateIso;
        rowObj.first_seen_batch_id = batchId;
        insertStmt.run(rowObj);
        rowsAdded++;
        if (rowObj.needs_review) {
          rowsFlagged++;
          flaggedRows.push({ source_key: match.sourceKey, address: rowObj.address, reasons: reviewReasons });
        }
      } else {
        updateStmt.run(pick(rowObj, UPDATE_PARAMS));
        rowsUpdated++;
        if (rowObj.needs_review) {
          rowsFlagged++;
          flaggedRows.push({ source_key: match.sourceKey, address: rowObj.address, reasons: reviewReasons });
        }
      }
    }
  }

  db.prepare(
    `UPDATE import_batches SET date_range_start = ?, date_range_end = ?,
       rows_added = ?, rows_updated = ?, rows_flagged = ?, rows_skipped = ? WHERE id = ?`
  ).run(minDate, maxDate, rowsAdded, rowsUpdated, rowsFlagged, rowsSkipped, batchId);

  return {
    batchId,
    filename: path.basename(filePath),
    archivedPath,
    rowsAdded,
    rowsUpdated,
    rowsFlagged,
    rowsSkipped,
    unmatchedSheets: insertUnmatchedSheet,
    flaggedRows,
    dateRange: { start: minDate, end: maxDate },
  };
}

module.exports = { importFile, matchSheetType, buildColumnMap, computeBaseKeyRaw };
