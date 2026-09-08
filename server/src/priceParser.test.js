'use strict';
// Quick smoke test against every example pattern listed in CLAUDE.md §2.
// Run with: node src/priceParser.test.js

const { parsePrice } = require('./priceParser');

const cases = [
  ['1550000', {}],
  ['$41,000 Net', {}],
  ['$11,000/Acre Gross', {}],
  ['$5,500 Gross', {}],
  ['$14,000/Month', {}],
  ['$19/ft', {}],
  [17.5, { sqft: 4309, acres: 0.42 }],
  ['Supressed', {}],
  ['Supressed - $12.5M list', {}],
  ['', {}],
  ['$1.65M', {}],
  ['$2.387M', {}],
  ['$0.41/SF/Yr', {}],
];

let failures = 0;
for (const [raw, ctx] of cases) {
  const result = parsePrice(raw, ctx);
  console.log(`${JSON.stringify(raw).padEnd(28)} ->`, JSON.stringify(result));
  if (result.status === undefined) {
    failures++;
  }
}

console.log(failures === 0 ? '\nAll cases produced a structured result.' : `\n${failures} case(s) failed to produce a result.`);
