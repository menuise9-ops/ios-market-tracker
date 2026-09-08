'use strict';

const { db } = require('./db');

/**
 * §4B Market Overview stats. For each Market × Type × Status cell:
 *  - avg sale price (total)
 *  - avg $/SF net lease rate
 *  - avg $/SF gross lease rate
 *  - avg $/Acre (land sales, and lease-per-acre where applicable)
 *  - sample size (n) for every stat — never shown without it
 *  - min/max range alongside the average
 *
 * needs_review / suppressed rows are excluded from these averages by default
 * (a caller-controlled toggle), with the excluded count always reported so
 * an average is never silently thin.
 */

function avg(arr) {
  if (arr.length === 0) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stat(rows, pickAmount) {
  const amounts = rows.map(pickAmount).filter((v) => v !== null && v !== undefined && !Number.isNaN(v));
  return {
    n: amounts.length,
    avg: avg(amounts),
    min: amounts.length ? Math.min(...amounts) : null,
    max: amounts.length ? Math.max(...amounts) : null,
  };
}

function getOverview({ market, municipality, includeFlagged = false } = {}) {
  let sql = 'SELECT * FROM listings WHERE 1=1';
  const params = [];
  if (market) {
    sql += ' AND market = ?';
    params.push(market);
  }
  if (municipality) {
    sql += ' AND municipality = ?';
    params.push(municipality);
  }
  const all = db.prepare(sql).all(...params);

  const excludedCount = all.filter((r) => !includeFlagged && (r.needs_review === 1 || r.price_status === 'suppressed' || r.price_status === 'missing')).length;
  const usable = includeFlagged ? all : all.filter((r) => r.needs_review !== 1 && r.price_status !== 'suppressed' && r.price_status !== 'missing');

  const cells = {};
  for (const mkt of ['MWO', 'SWO', 'Core GTA', 'Non-Core GTA']) {
    for (const type of ['Low Coverage', 'Land']) {
      for (const status of ['available', 'sold']) {
        const recordType = status === 'sold' ? 'transaction' : 'availability';
        const rows = usable.filter(
          (r) => r.market === mkt && r.type_of_land_normalized === type && r.record_type === recordType
        );
        const saleRows = rows.filter((r) => r.price_deal_type === 'sale' && r.price_unit === 'total');
        const leaseSfNetRows = rows.filter((r) => r.price_deal_type === 'lease' && r.price_unit === 'per_sf' && r.price_basis === 'net');
        const leaseSfGrossRows = rows.filter((r) => r.price_deal_type === 'lease' && r.price_unit === 'per_sf' && r.price_basis === 'gross');
        const acreRows = rows.filter((r) => r.acres && (r.price_unit === 'per_acre' || (r.price_deal_type === 'sale' && r.price_unit === 'total')));

        const key = `${mkt}|${type}|${status}`;
        cells[key] = {
          market: mkt,
          type,
          status,
          totalListings: rows.length,
          avgSalePrice: stat(saleRows, (r) => r.price_amount),
          avgLeaseSfNet: stat(leaseSfNetRows, (r) => r.price_amount),
          avgLeaseSfGross: stat(leaseSfGrossRows, (r) => r.price_amount),
          avgPerAcre: stat(
            acreRows,
            (r) => (r.price_unit === 'per_acre' ? r.price_amount : r.acres ? r.price_amount / r.acres : null)
          ),
        };
      }
    }
  }

  return { cells, excludedCount, includeFlagged, totalRows: all.length };
}

module.exports = { getOverview };
