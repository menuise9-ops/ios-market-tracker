import React, { useEffect, useState } from 'react';
import { api } from '../api';

function fmtMoney(n) {
  if (n === null || n === undefined) return '—';
  return '$' + Math.round(n).toLocaleString();
}

export default function PricingTool({ config }) {
  const [market, setMarket] = useState('MWO');
  const [municipality, setMunicipality] = useState('');
  const [municipalities, setMunicipalities] = useState([]);
  const [type, setType] = useState('Low Coverage');
  const [acres, setAcres] = useState('');
  const [sqft, setSqft] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.getMunicipalities(market).then(setMunicipalities).catch(() => {});
  }, [market]);

  const run = async () => {
    setLoading(true);
    try {
      const r = await api.getPricingEstimate({
        market, municipality: municipality || undefined, type,
        acres: acres || undefined, sqft: sqft || undefined,
      });
      setResult(r);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-5 grid grid-cols-2 md:grid-cols-6 gap-3 items-end">
        <Field label="Market">
          <select value={market} onChange={(e) => { setMarket(e.target.value); setMunicipality(''); }} className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm">
            {Object.keys(config.marketLabels).map((m) => <option key={m} value={m}>{config.marketLabels[m]}</option>)}
          </select>
        </Field>
        <Field label="Municipality (optional)">
          <select value={municipality} onChange={(e) => setMunicipality(e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm">
            <option value="">Market-wide</option>
            {municipalities.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Type">
          <select value={type} onChange={(e) => setType(e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm">
            <option>Low Coverage</option>
            <option>Land</option>
          </select>
        </Field>
        <Field label="Acres">
          <input type="number" value={acres} onChange={(e) => setAcres(e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm" />
        </Field>
        <Field label="Sq Ft">
          <input type="number" value={sqft} onChange={(e) => setSqft(e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm" />
        </Field>
        <button onClick={run} disabled={loading} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-md">
          {loading ? 'Estimating…' : 'Get estimate'}
        </button>
      </div>

      {result && (
        <>
          {result.usedMarketLevelFallback && (
            <p className="text-xs text-amber-700 bg-amber-50 rounded px-3 py-2">
              Too few comps in that municipality — fell back to market-wide comps for {config.marketLabels[market]}.
            </p>
          )}
          <div className="grid md:grid-cols-2 gap-4">
            <EstimateCard
              title="Sale scenario"
              n={result.sale.n}
              lines={[
                ['Estimate', fmtMoney(result.sale.estimate)],
                ['Avg total (all comps)', fmtMoney(result.sale.avgTotal)],
                ['Avg $/acre', result.sale.avgPerAcre ? fmtMoney(result.sale.avgPerAcre) : '—'],
                ['Range', `${fmtMoney(result.sale.min)} – ${fmtMoney(result.sale.max)}`],
              ]}
            />
            <EstimateCard
              title="Lease scenario"
              n={result.lease.n}
              lines={[
                ['Est. total (net, if Sq Ft given)', fmtMoney(result.lease.estimateNetTotal)],
                ['Est. total (gross, if Sq Ft given)', fmtMoney(result.lease.estimateGrossTotal)],
                ['Avg $/SF net', result.lease.avgNetPsf ? '$' + result.lease.avgNetPsf.toFixed(2) : '—'],
                ['Avg $/SF gross', result.lease.avgGrossPsf ? '$' + result.lease.avgGrossPsf.toFixed(2) : '—'],
              ]}
            />
          </div>

          <CompsTable title="Sale comps used" comps={result.sale.comps} />
          <CompsTable title="Lease comps used" comps={result.lease.comps} />
        </>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-[10px] font-medium text-slate-500 uppercase mb-0.5">{label}</label>
      {children}
    </div>
  );
}

function EstimateCard({ title, n, lines }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <h3 className="font-semibold text-slate-900 mb-1">{title}</h3>
      <p className="text-xs text-slate-500 mb-3">n = {n} comp(s), recent-weighted (3-month half-life)</p>
      <div className="space-y-1">
        {lines.map(([label, val]) => (
          <div key={label} className="flex justify-between text-sm">
            <span className="text-slate-500">{label}</span>
            <span className="font-medium">{val}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CompsTable({ title, comps }) {
  if (comps.length === 0) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <h4 className="text-sm font-semibold text-slate-900 mb-2">{title} ({comps.length}) — sanity-check these, drop outliers yourself</h4>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500 text-left">
              <th className="py-1">Address</th><th>Type</th><th>Date</th><th>Weight</th><th className="text-right">Price</th>
            </tr>
          </thead>
          <tbody>
            {comps.map((c) => (
              <tr key={c.sourceKey} className="border-t border-slate-100">
                <td className="py-1">{c.address} <span className="text-slate-400">({c.municipality})</span></td>
                <td>{c.recordType}</td>
                <td>{c.date}</td>
                <td>{c.weight}</td>
                <td className="text-right">{c.priceRaw}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
