'use strict';

const { db } = require('./db');
const { getMonthlyRates } = require('./rates');

/**
 * Pricing trends over time, by market — avg sale $/acre and avg lease $/SF
 * (net + gross), bucketed monthly, plus the BoC overnight/approx-prime rate
 * for the same months so the two can be overlaid on one chart.
 */

function monthsBack(n, endMonth) {
  const months = [];
  const [y, m] = endMonth.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  for (let i = n - 1; i >= 0; i--) {
    const dd = new Date(d);
    dd.setUTCMonth(dd.getUTCMonth() - i);
    months.push(dd.toISOString().slice(0, 7));
  }
  return months;
}

function avg(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
}

function getTrends(monthsCount = 12) {
  // date_flagged rows excluded — see pulse.js/pricing.js for why (the "2206" typo).
  const rows = db.prepare("SELECT * FROM listings WHERE date_flagged = 0 AND record_date IS NOT NULL").all();
  const latest = rows.reduce((max, r) => (r.record_date > max ? r.record_date : max), '0000-00');
  const endMonth = latest.slice(0, 7) || new Date().toISOString().slice(0, 7);
  const months = monthsBack(monthsCount, endMonth);

  const markets = [...new Set(rows.map((r) => r.market))];
  const byMarket = {};
  for (const mkt of markets) {
    const marketRows = rows.filter((r) => r.market === mkt);
    const salePerAcre = [];
    const leaseNetPsf = [];
    const leaseGrossPsf = [];
    const txnCount = [];
    for (const month of months) {
      const inMonth = marketRows.filter((r) => r.record_date.slice(0, 7) === month);
      const sales = inMonth.filter((r) => r.price_deal_type === 'sale' && r.price_unit === 'total' && r.acres && r.price_amount);
      const leaseNet = inMonth.filter((r) => r.price_deal_type === 'lease' && r.price_unit === 'per_sf' && r.price_basis === 'net');
      const leaseGross = inMonth.filter((r) => r.price_deal_type === 'lease' && r.price_unit === 'per_sf' && r.price_basis === 'gross');
      salePerAcre.push(avg(sales.map((r) => r.price_amount / r.acres)));
      leaseNetPsf.push(avg(leaseNet.map((r) => r.price_amount)));
      leaseGrossPsf.push(avg(leaseGross.map((r) => r.price_amount)));
      txnCount.push(inMonth.filter((r) => r.record_type === 'transaction').length);
    }
    byMarket[mkt] = { salePerAcre, leaseNetPsf, leaseGrossPsf, txnCount };
  }

  const rateByMonth = new Map(getMonthlyRates().map((r) => [r.month, r]));
  const rates = months.map((m) => rateByMonth.get(m) || { month: m, overnightRate: null, approxPrime: null });

  return { months, byMarket, rates };
}

module.exports = { getTrends };
