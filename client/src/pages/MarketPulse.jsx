import React, { useEffect, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Bar, ComposedChart, Legend } from 'recharts';
import { api } from '../api';

function fmtMoney(n) {
  if (n === null || n === undefined) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return '$' + Math.round(n).toLocaleString();
}

function Delta({ curr, prior }) {
  if (curr === null || prior === null || prior === 0) {
    return <span className="text-xs text-slate-400">no prior-period comps</span>;
  }
  const pct = ((curr - prior) / Math.abs(prior)) * 100;
  const up = pct >= 0;
  return (
    <span className={`text-xs font-medium ${up ? 'text-emerald-600' : 'text-red-600'}`}>
      {up ? '▲' : '▼'} {Math.abs(pct).toFixed(0)}% vs prior period
    </span>
  );
}

const SEVERITY_BORDER = {
  high: 'border-l-red-500',
  medium: 'border-l-amber-500',
  info: 'border-l-blue-500',
};

const INSIGHT_LABEL = {
  biggest_deal: 'Deal',
  price_move: 'Pricing',
  repeat_vendor: 'Vendor',
  stale_listing: 'Listing',
  last_import: 'Import',
  data_quality: 'Data quality',
};

export default function MarketPulse({ config, onNavigate }) {
  const [pulse, setPulse] = useState(null);

  useEffect(() => {
    api.getPulse().then(setPulse).catch(() => {});
  }, []);

  if (!pulse) return <p className="text-sm text-slate-400">Loading…</p>;

  const o = pulse.overall;

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Market Pulse</h1>
          <p className="text-sm text-slate-500">
            As of {pulse.asOf} · last {pulse.periodDays} days vs the {pulse.periodDays} before that · {pulse.totalListings} listings on file
          </p>
        </div>
        {pulse.needsReviewCount > 0 && (
          <button
            onClick={() => onNavigate('review')}
            className="text-xs bg-amber-100 text-amber-800 border border-amber-300 rounded-full px-3 py-1 font-medium hover:bg-amber-200"
          >
            {pulse.needsReviewCount} need review
          </button>
        )}
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Deals closed" value={o.current.dealsClosed} delta={<Delta curr={o.current.dealsClosed} prior={o.prior.dealsClosed} />} />
        <KpiCard label="Sale volume" value={fmtMoney(o.current.totalVolume)} delta={<Delta curr={o.current.totalVolume} prior={o.prior.totalVolume} />} />
        <KpiCard label="Avg deal size" value={fmtMoney(o.current.avgDealSize)} delta={<Delta curr={o.current.avgDealSize} prior={o.prior.avgDealSize} />} />
        <KpiCard label="New availabilities" value={o.current.newAvailabilities} delta={<Delta curr={o.current.newAvailabilities} prior={o.prior.newAvailabilities} />} />
      </div>

      {/* Insights */}
      {pulse.insights.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-700">Insights</h2>
          {pulse.insights.map((ins, i) => (
            <div key={i} className={`flex gap-3 items-start text-sm bg-white border border-slate-200 border-l-[3px] rounded-lg px-3 py-2.5 ${SEVERITY_BORDER[ins.severity] || SEVERITY_BORDER.info}`}>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 pt-0.5 w-20 shrink-0">
                {INSIGHT_LABEL[ins.type] || 'Note'}
              </span>
              <span className="text-slate-700">{ins.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* Trend chart */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <h2 className="text-sm font-semibold text-slate-700 mb-3">Activity over time</h2>
        <div style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={pulse.trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 12 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} tickFormatter={(v) => fmtMoney(v)} />
              <Tooltip formatter={(v, name) => (name === 'volume' ? fmtMoney(v) : v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="left" dataKey="transactions" name="Transactions" fill="#2563eb" />
              <Bar yAxisId="left" dataKey="availabilities" name="New availabilities" fill="#94a3b8" />
              <Area yAxisId="right" type="monotone" dataKey="volume" name="Sale volume ($)" fill="#16a34a33" stroke="#16a34a" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Per-market breakdown */}
      <div>
        <h2 className="text-sm font-semibold text-slate-700 mb-2">By market (last {pulse.periodDays} days)</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Object.entries(pulse.byMarket).map(([mkt, data]) => (
            <div key={mkt} className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="font-medium text-slate-900 text-sm mb-2">{config.marketLabels[mkt] || mkt}</div>
              <div className="text-2xl font-bold text-slate-900">{data.current.dealsClosed}</div>
              <div className="text-xs text-slate-500 mb-1">deals closed</div>
              <div className="text-sm font-semibold text-slate-700">{fmtMoney(data.current.totalVolume)}</div>
              <div className="text-xs text-slate-500">volume · {data.current.newAvailabilities} new listings</div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent activity feed */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-slate-700">Recent activity</h2>
          <button onClick={() => onNavigate('overview')} className="text-xs text-blue-600 hover:underline">
            View full grid →
          </button>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
          {pulse.recentActivity.map((r) => (
            <div key={r.source_key} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <div className="flex items-center gap-3">
                <StatusBadge recordType={r.record_type} />
                <div>
                  <div className="font-medium text-slate-900">{r.address}</div>
                  <div className="text-xs text-slate-500">
                    {r.municipality} · {config.marketLabels[r.market] || r.market} · {r.type_of_land_normalized || '—'}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-medium text-slate-900">
                  {r.price_amount != null && r.price_unit === 'total' ? fmtMoney(r.price_amount) : r.price_raw}
                </div>
                <div className="text-xs text-slate-500">{r.record_date}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, delta }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <div className="text-2xl font-bold text-slate-900">{value ?? '—'}</div>
      <div className="mt-1">{delta}</div>
    </div>
  );
}

function StatusBadge({ recordType }) {
  const sold = recordType === 'transaction';
  return (
    <span className={`text-[10px] font-semibold uppercase px-2 py-1 rounded-full ${sold ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
      {sold ? 'Sold' : 'Available'}
    </span>
  );
}
