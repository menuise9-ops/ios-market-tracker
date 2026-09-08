'use strict';

// Build-order step 2: run the importer against the 3 sample files, in the
// order they'd realistically be uploaded, and print console summaries —
// no UI yet. `npm run import` from server/.

const path = require('node:path');
const { importFile } = require('./importer');
const { db } = require('./db');

const files = [
  'IOS Bi-Weekly Report - May 2026 - June 2026 - Final (1).xlsx',
  'IOS Bi-Weekly Report - June 19 - July 3.xlsx',
  'IOS Bi-Weekly Report - August 10 - September 4.xlsx',
].map((f) => path.join(__dirname, '..', '..', 'data', 'raw', f));

for (const f of files) {
  console.log('\n=== Importing:', path.basename(f), '===');
  const summary = importFile(f);
  console.log(`  added:    ${summary.rowsAdded}`);
  console.log(`  updated:  ${summary.rowsUpdated}`);
  console.log(`  flagged:  ${summary.rowsFlagged}`);
  console.log(`  skipped:  ${summary.rowsSkipped}`);
  console.log(`  date range: ${summary.dateRange.start} .. ${summary.dateRange.end}`);
  if (summary.unmatchedSheets.length) {
    console.log('  UNMATCHED SHEETS (not recognized as one of the 8 types):', summary.unmatchedSheets);
  }
  if (summary.flaggedRows.length) {
    console.log('  flagged rows:');
    for (const r of summary.flaggedRows) {
      console.log(`    - ${r.address}: ${r.reasons.map((x) => x.text).join(' | ')}`);
    }
  }
}

console.log('\n=== Final listings table summary ===');
const totalRows = db.prepare('SELECT COUNT(*) as n FROM listings').get();
console.log('Total listing rows (deduped across all 3 files):', totalRows.n);

const byMarketType = db.prepare(`
  SELECT market, record_type, type_of_land_normalized, COUNT(*) as n
  FROM listings GROUP BY market, record_type, type_of_land_normalized
  ORDER BY market, record_type
`).all();
console.table(byMarketType);

const needsReview = db.prepare('SELECT COUNT(*) as n FROM listings WHERE needs_review = 1').get();
console.log('Rows needing review:', needsReview.n);

const batches = db.prepare('SELECT id, filename, rows_added, rows_updated, rows_flagged, rows_skipped FROM import_batches').all();
console.log('\nImport batches:');
console.table(batches);

db.close();
