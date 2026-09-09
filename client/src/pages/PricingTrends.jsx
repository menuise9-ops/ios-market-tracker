import React, { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer } from 'recharts';
import { api } from '../api';

const MARKET_COLORS = {
  MWO: '#2563eb',
  SWO: '#16a34a',
  'Core GTA': '#d97706',
  'Non-Core GTA': '#9333ea',
};
const RATE_COLOR = '#64748b';

export default function PricingTrends({ config }) {
  const [months, setMonths] = useState(12);
  const [data, setData] = useState(null);

  useEffect(() => {
    api.getTrends(months).then(setData).catch(() => {});
  }, [months]);

  if (!data) return <p className="text-sm text-slate-400">Loading…</p>;

  const markets = Object.keys(data.byMarket);
  const rateByMonth = new Map(data.rates.map((r) => [r.month, r.approxPrime]));

  const saleRows = data.months.map((m, i) => {
    const row = { month: m, approxPrime: rateByMonth.get(m) };
    for (const mkt of markets) row[mkt] = data.byMarket[mkt].salePerAcre[i];
    return row;
  });
  const leaseNetRows = data.months.map((m, i) => {
    const row = { month: m };
    for (const mkt of markets) row[mkt] = data.byMarket[mkt].leaseNetPsf[i];
    return row;
  });
  const leaseGrossRows = data.months.map((m, i) => {
    const row = { month: m };
    for (const mkt of markets) row[mkt] = data.byMarket[mkt].leaseGrossPsf[i];
    return row;
  });

  const haveRates = data.rates.some((r) => r.approxPrime != null);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Pricing Trends</h1>
          <p className="text-sm text-slate-500">Monthly averages by market — sparse months (few or no comps) show as gaps, not zero.</p>
        </div>
        <div className="flex gap-1 bg-slate-100 rounded-md p-0.5">
          {[6, 12, 24].map((m) => (
            <button key={m} onClick={() => setMonths(m)} className={`text-xs px-3 py-1 rounded ${months === m ? 'bg-white shadow text-slate-900 font-medium' : 'text-slate-500'}`}>
              {m}mo
            </button>
          ))}
        </div>
      </div>

      <ChartCard
        title="Sale price per acre"
        subtitle={haveRates ? 'Right axis: approximate bank prime rate (BoC overnight + 2.20%)' : 'Bank of Canada rate overlay unavailable (offline on first run?)'}
        rows={saleRows}
        markets={markets}
        config={config}
        yFormatter={(v) => `$${(v / 1_000_000).toFixed(1)}M`}
        showRate={haveRates}
      />
      <ChartCard
        title="Lease rate — $/SF net"
        rows={leaseNetRows}
        markets={markets}
        config={config}
        yFormatter={(v) => `$${v.toFixed(2)}`}
      />
      <ChartCard
        title="Lease rate — $/SF gross"
        rows={leaseGrossRows}
        markets={markets}
        config={config}
        yFormatter={(v) => `$${v.toFixed(2)}`}
      />
    </div>
  );
}

function ChartCard({ title, subtitle, rows, markets, config, yFormatter, showRate }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
      {subtitle && <p className="text-xs text-slate-400 mb-2">{subtitle}</p>}
      <div style={{ height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="left" tick={{ fontSize: 11 }} tickFormatter={yFormatter} width={70} />
            {showRate && <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} width={40} />}
            <Tooltip formatter={(v, name) => (name === 'approxPrime' ? `${v}%` : typeof v === 'number' ? yFormatter(v) : v)} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {markets.map((m) => (
              <Line
                key={m}
                yAxisId="left"
                type="monotone"
                dataKey={m}
                name={config.marketLabels[m] || m}
                stroke={MARKET_COLORS[m]}
                connectNulls
                dot={{ r: 3 }}
              />
            ))}
            {showRate && (
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="approxPrime"
                name="Approx. prime rate"
                stroke={RATE_COLOR}
                strokeDasharray="4 3"
                connectNulls
                dot={false}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
