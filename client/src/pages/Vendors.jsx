import React, { useEffect, useState } from 'react';
import { api } from '../api';

function fmtMoney(n) {
  if (n === null || n === undefined) return '—';
  return '$' + Math.round(n).toLocaleString();
}

const CONCENTRATION_COPY = {
  fragmented: { label: 'Fragmented', color: 'text-emerald-700 bg-emerald-50 border-emerald-200', note: 'No single seller dominates — activity is spread across many vendors.' },
  moderate: { label: 'Moderately concentrated', color: 'text-amber-700 bg-amber-50 border-amber-200', note: 'A handful of vendors account for a meaningful share of volume.' },
  concentrated: { label: 'Concentrated', color: 'text-red-700 bg-red-50 border-red-200', note: 'A small number of vendors dominate transaction volume.' },
};

export default function Vendors() {
  const [data, setData] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [busyPair, setBusyPair] = useState(null);

  const load = () => api.getVendors().then(setData).catch(() => {});
  useEffect(() => { load(); }, []);

  const merge = async (fromName, intoName) => {
    setBusyPair(`${fromName}|${intoName}`);
    try {
      await api.mergeVendors(fromName, intoName);
      load();
    } finally {
      setBusyPair(null);
    }
  };

  if (!data) return <p className="text-sm text-slate-400">Loading…</p>;

  const conc = CONCENTRATION_COPY[data.concentration.label];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Vendor Leaderboard</h1>
        <p className="text-sm text-slate-500">Ranked by transaction volume — repeat sellers are the pattern signal to watch.</p>
      </div>

      <div className={`border rounded-xl p-4 flex items-center justify-between ${conc.color}`}>
        <div>
          <div className="font-semibold text-sm">Market structure: {conc.label}</div>
          <div className="text-xs opacity-80">{conc.note}</div>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold">HHI {data.concentration.hhi}</div>
          <div className="text-xs opacity-70">&lt;1500 fragmented · 1500-2500 moderate · &gt;2500 concentrated</div>
        </div>
      </div>

      {data.suggestions.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <h3 className="font-semibold text-amber-900 text-sm mb-2">Possible same entity — confirm to merge</h3>
          <div className="space-y-2">
            {data.suggestions.map((s) => (
              <div key={`${s.a}|${s.b}`} className="flex items-center justify-between text-sm bg-white rounded-md px-3 py-2">
                <span>
                  <span className="font-medium">{s.a}</span> <span className="text-slate-400">vs</span>{' '}
                  <span className="font-medium">{s.b}</span>
                </span>
                <div className="flex gap-2">
                  <button disabled={busyPair === `${s.a}|${s.b}`} onClick={() => merge(s.a, s.b)} className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 disabled:opacity-50">
                    Merge into "{s.b}"
                  </button>
                  <button disabled={busyPair === `${s.b}|${s.a}`} onClick={() => merge(s.b, s.a)} className="text-xs bg-slate-600 text-white px-2 py-1 rounded hover:bg-slate-700 disabled:opacity-50">
                    Merge into "{s.a}"
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        <div className="grid grid-cols-[2.5rem_1fr_6rem_8rem_8rem] gap-2 px-4 py-2 text-[11px] font-semibold uppercase text-slate-400">
          <span>#</span><span>Vendor</span><span className="text-right">Deals</span><span className="text-right">Volume</span><span className="text-right">Avg deal</span>
        </div>
        {data.vendors.map((v, i) => (
          <VendorRow key={v.vendorName} v={v} rank={i + 1} expanded={expanded === v.vendorName} onToggle={() => setExpanded(expanded === v.vendorName ? null : v.vendorName)} />
        ))}
      </div>

      <BrokerPlaceholder />
    </div>
  );
}

function VendorRow({ v, rank, expanded, onToggle }) {
  return (
    <div>
      <button onClick={onToggle} className="w-full grid grid-cols-[2.5rem_1fr_6rem_8rem_8rem] gap-2 items-center px-4 py-3 text-left hover:bg-slate-50">
        <span className="text-sm font-bold text-slate-400">{rank}</span>
        <div>
          <div className="font-medium text-slate-900 text-sm">{v.vendorName}</div>
          <div className="text-xs text-slate-500">{v.markets.join(', ')} · {v.municipalities.slice(0, 3).join(', ')}{v.municipalities.length > 3 ? '…' : ''}</div>
        </div>
        <span className="text-right text-sm font-semibold">{v.dealCount}</span>
        <span className="text-right text-sm font-semibold">{fmtMoney(v.totalVolume)}</span>
        <span className="text-right text-sm text-slate-500">{fmtMoney(v.avgDealSize)}</span>
      </button>
      {expanded && (
        <div className="px-4 pb-3">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 text-left">
                <th className="py-1">Address</th><th>Municipality</th><th>Date</th><th className="text-right">Price</th>
              </tr>
            </thead>
            <tbody>
              {v.properties.map((p) => (
                <tr key={p.sourceKey} className="border-t border-slate-100">
                  <td className="py-1">{p.address}</td>
                  <td>{p.municipality}</td>
                  <td>{p.date}</td>
                  <td className="text-right">{p.price != null && p.priceUnit === 'total' ? fmtMoney(p.price) : p.priceRaw}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BrokerPlaceholder() {
  return (
    <div className="border border-dashed border-slate-300 rounded-xl p-5 bg-slate-50">
      <h3 className="font-semibold text-slate-700 text-sm mb-1">Broker &amp; Brokerage Leaderboard — not available yet</h3>
      <p className="text-sm text-slate-500">
        The biweekly report format tracked today (Type of Land, Address, Price, Zoning, Vendor, Notes…) doesn't
        capture listing brokerage, co-op brokerage, or agent name — so there's nothing to rank. To light this up,
        the source reports would need a <span className="font-medium">Brokerage</span> / <span className="font-medium">Co-Op Brokerage</span> /{' '}
        <span className="font-medium">Listing Agent</span> column (the raw MLS sheets this data originally came from do have
        this — it just isn't in the tracker format the importer reads today).
      </p>
    </div>
  );
}
