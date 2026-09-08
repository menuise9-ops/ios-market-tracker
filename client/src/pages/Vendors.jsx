import React, { useEffect, useState } from 'react';
import { api } from '../api';

function fmtMoney(n) {
  if (n === null || n === undefined) return '—';
  return '$' + Math.round(n).toLocaleString();
}

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

  const repeat = data.vendors.filter((v) => v.dealCount >= 2);
  const single = data.vendors.filter((v) => v.dealCount === 1);

  return (
    <div className="space-y-6">
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
                  <button
                    disabled={busyPair === `${s.a}|${s.b}`}
                    onClick={() => merge(s.a, s.b)}
                    className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 disabled:opacity-50"
                  >
                    Merge into "{s.b}"
                  </button>
                  <button
                    disabled={busyPair === `${s.b}|${s.a}`}
                    onClick={() => merge(s.b, s.a)}
                    className="text-xs bg-slate-600 text-white px-2 py-1 rounded hover:bg-slate-700 disabled:opacity-50"
                  >
                    Merge into "{s.a}"
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <section>
        <h2 className="font-semibold text-slate-900 mb-2">Repeat vendors (2+ deals) — {repeat.length}</h2>
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
          {repeat.map((v) => (
            <VendorRow key={v.vendorName} v={v} expanded={expanded === v.vendorName} onToggle={() => setExpanded(expanded === v.vendorName ? null : v.vendorName)} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="font-semibold text-slate-900 mb-2">Single-deal vendors — {single.length}</h2>
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
          {single.map((v) => (
            <VendorRow key={v.vendorName} v={v} expanded={expanded === v.vendorName} onToggle={() => setExpanded(expanded === v.vendorName ? null : v.vendorName)} />
          ))}
        </div>
      </section>
    </div>
  );
}

function VendorRow({ v, expanded, onToggle }) {
  return (
    <div>
      <button onClick={onToggle} className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50">
        <div>
          <div className="font-medium text-slate-900 text-sm">{v.vendorName}</div>
          <div className="text-xs text-slate-500">{v.markets.join(', ')} · {v.municipalities.slice(0, 3).join(', ')}{v.municipalities.length > 3 ? '…' : ''}</div>
        </div>
        <div className="text-right text-sm">
          <div className="font-semibold">{v.dealCount} deal{v.dealCount !== 1 ? 's' : ''}</div>
          <div className="text-xs text-slate-500">{fmtMoney(v.totalVolume)} total · avg {fmtMoney(v.avgDealSize)}</div>
        </div>
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
                  <td className="text-right">{p.price ? fmtMoney(p.price) : p.priceRaw}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
