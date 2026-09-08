import React, { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer } from 'recharts';
import { api } from '../api';

const MARKET_COLORS = {
  MWO: '#2563eb',
  SWO: '#16a34a',
  'Core GTA': '#d97706',
  'Non-Core GTA': '#9333ea',
};

export default function Volume({ config }) {
  const [data, setData] = useState(null);
  const [metric, setMetric] = useState('count'); // count | acres | sqft
  const [which, setWhich] = useState('transactions'); // transactions | availabilities

  useEffect(() => {
    api.getVolume().then(setData).catch(() => {});
  }, []);

  if (!data) return <p className="text-sm text-slate-400">Loading…</p>;

  const series = data[which];

  // Flatten series' per-bucket objects (keyed by `${market}__${type}`) into
  // one row per month for Recharts, keeping each market+type as its own bar key.
  const monthMap = {};
  for (const bucket of series.series) {
    monthMap[bucket.month] = monthMap[bucket.month] || { month: bucket.month };
    for (const [k, v] of Object.entries(bucket)) {
      if (k === 'month') continue;
      monthMap[bucket.month][`${k}__val`] = v[metric === 'count' ? 'count' : metric];
    }
  }
  const chartRows = series.months.map((m) => monthMap[m] || { month: m });

  const barKeys = [];
  for (const mkt of Object.keys(config.marketLabels)) {
    for (const type of ['Low Coverage', 'Land']) {
      barKeys.push({ key: `${mkt}__${type}__val`, market: mkt, type });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-3 bg-white border border-slate-200 rounded-xl p-4">
        <select value={which} onChange={(e) => setWhich(e.target.value)} className="border border-slate-300 rounded-md px-3 py-1.5 text-sm">
          <option value="transactions">Transactions (sold)</option>
          <option value="availabilities">Availabilities (listed)</option>
        </select>
        <select value={metric} onChange={(e) => setMetric(e.target.value)} className="border border-slate-300 rounded-md px-3 py-1.5 text-sm">
          <option value="count">Count</option>
          <option value="acres">Total acreage</option>
          <option value="sqft">Total sq ft</option>
        </select>
        <p className="text-xs text-slate-500 self-center ml-2">Bucketed by month of transaction/list date (not upload date).</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4" style={{ height: 420 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartRows}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {barKeys.map(({ key, market, type }) => (
              <Bar
                key={key}
                dataKey={key}
                stackId="stack"
                name={`${market} · ${type}`}
                fill={MARKET_COLORS[market]}
                fillOpacity={type === 'Land' ? 0.5 : 1}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
