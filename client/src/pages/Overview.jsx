import React, { useEffect, useState } from 'react';
import { api } from '../api';

const TYPES = ['Low Coverage', 'Land'];
const STATUSES = ['available', 'sold'];

function fmtMoney(n) {
  if (n === null || n === undefined) return '—';
  return '$' + Math.round(n).toLocaleString();
}

function MetricCell({ label, stat }) {
  if (!stat || stat.n === 0) {
    return (
      <div className="text-xs text-slate-400">
        {label}: <span className="italic">no comps (n=0)</span>
      </div>
    );
  }
  return (
    <div className="text-xs text-slate-700">
      <span className="text-slate-500">{label}:</span> <span className="font-semibold">{fmtMoney(stat.avg)}</span>{' '}
      <span className="text-slate-400">
        (n={stat.n}, {fmtMoney(stat.min)}–{fmtMoney(stat.max)})
      </span>
    </div>
  );
}

export default function Overview({ config }) {
  const [market, setMarket] = useState('');
  const [municipality, setMunicipality] = useState('');
  const [municipalities, setMunicipalities] = useState([]);
  const [includeFlagged, setIncludeFlagged] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const markets = Object.keys(config.marketLabels);

  useEffect(() => {
    api.getMunicipalities(market || undefined).then(setMunicipalities).catch(() => {});
  }, [market]);

  useEffect(() => {
    setLoading(true);
    api
      .getOverview({ market: market || undefined, municipality: municipality || undefined, includeFlagged: String(includeFlagged) })
      .then(setData)
      .finally(() => setLoading(false));
  }, [market, municipality, includeFlagged]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 bg-white border border-slate-200 rounded-xl p-4">
        <select
          value={market}
          onChange={(e) => { setMarket(e.target.value); setMunicipality(''); }}
          className="border border-slate-300 rounded-md px-3 py-1.5 text-sm"
        >
          <option value="">All Markets</option>
          {markets.map((m) => (
            <option key={m} value={m}>{config.marketLabels[m]} ({m})</option>
          ))}
        </select>
        <select
          value={municipality}
          onChange={(e) => setMunicipality(e.target.value)}
          className="border border-slate-300 rounded-md px-3 py-1.5 text-sm"
        >
          <option value="">All Municipalities</option>
          {municipalities.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-600 ml-auto">
          <input type="checkbox" checked={includeFlagged} onChange={(e) => setIncludeFlagged(e.target.checked)} />
          Include flagged/suppressed rows in averages
        </label>
      </div>

      {data && (
        <p className="text-xs text-slate-500">
          {data.excludedCount} of {data.totalRows} matching row(s) excluded from averages
          {!includeFlagged && ' (needs-review / suppressed / missing price)'} — toggle above to include them.
        </p>
      )}

      {loading && <p className="text-sm text-slate-400">Loading…</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {data &&
          markets
            .filter((m) => !market || m === market)
            .map((mkt) =>
              TYPES.map((type) => (
                <div key={`${mkt}-${type}`} className="bg-white border border-slate-200 rounded-xl p-4">
                  <h3 className="font-semibold text-slate-900 text-sm mb-1">
                    {config.marketLabels[mkt]} <span className="text-slate-400 font-normal">· {type}</span>
                  </h3>
                  {STATUSES.map((status) => {
                    const cell = data.cells[`${mkt}|${type}|${status}`];
                    return (
                      <div key={status} className="mt-3 border-t border-slate-100 pt-2 first:border-0 first:pt-0">
                        <div className="text-xs font-medium text-slate-500 uppercase mb-1">
                          {status === 'sold' ? 'Sold' : 'Available'} ({cell?.totalListings ?? 0})
                        </div>
                        <div className="space-y-0.5">
                          <MetricCell label="Avg sale price" stat={cell?.avgSalePrice} />
                          <MetricCell label="Avg $/SF net" stat={cell?.avgLeaseSfNet} />
                          <MetricCell label="Avg $/SF gross" stat={cell?.avgLeaseSfGross} />
                          <MetricCell label="Avg $/acre" stat={cell?.avgPerAcre} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
      </div>
    </div>
  );
}
