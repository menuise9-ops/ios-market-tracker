import React, { useEffect, useState } from 'react';
import { api } from '../api';

const UNIT_OPTIONS = ['total', 'per_sf', 'per_acre', 'per_month', 'per_year'];
const BASIS_OPTIONS = ['net', 'gross', 'unspecified'];
const DEAL_TYPE_OPTIONS = ['sale', 'lease'];

export default function ReviewQueue({ onChanged }) {
  const [rows, setRows] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState(null);

  const load = () =>
    api.getReviewQueue().then((r) => {
      setRows(r);
      const d = {};
      for (const row of r) {
        d[row.source_key] = {
          price_amount: row.price_amount,
          price_unit: row.price_unit || 'total',
          price_basis: row.price_basis || 'unspecified',
          price_deal_type: row.price_deal_type || 'sale',
        };
      }
      setDrafts(d);
    });

  useEffect(() => {
    load();
  }, []);

  const resolve = async (row, applyToAll) => {
    setBusy(row.source_key);
    const draft = drafts[row.source_key];
    const priceReason = row.review_reasons.find((r) =>
      ['bare_large_number_sale', 'bare_small_number_lease', 'bare_number_ambiguous', 'net_no_unit', 'gross_no_unit', 'per_sf_no_basis'].includes(r.code)
    );
    try {
      await api.resolveReview(row.source_key, {
        price_amount: draft.price_amount,
        price_unit: draft.price_unit,
        price_basis: draft.price_basis,
        price_deal_type: draft.price_deal_type,
        price_status: 'parsed',
      }, applyToAll && priceReason ? { confirmPatternCode: priceReason.code } : {});
      await load();
      onChanged?.();
    } finally {
      setBusy(null);
    }
  };

  if (!rows) return <p className="text-sm text-slate-400">Loading…</p>;
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">Nothing needs review right now.</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">{rows.length} row(s) flagged. Confirm or correct each — corrections are saved as overrides and survive future re-imports.</p>
      {rows.map((row) => (
        <div key={row.source_key} className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="font-medium text-slate-900 text-sm">
                {row.address} <span className="text-slate-400">· {row.municipality} · {row.market}</span>
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                {row.record_type} · raw price: <span className="font-mono bg-slate-100 px-1 rounded">"{row.price_raw}"</span>
              </div>
              <ul className="mt-2 space-y-1">
                {row.review_reasons.map((r, i) => (
                  <li key={i} className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1 inline-block mr-1">
                    {r.text}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="Amount">
              <input
                type="number"
                className="w-full border border-slate-300 rounded px-2 py-1 text-sm"
                value={drafts[row.source_key]?.price_amount ?? ''}
                onChange={(e) => setDrafts({ ...drafts, [row.source_key]: { ...drafts[row.source_key], price_amount: e.target.value === '' ? null : parseFloat(e.target.value) } })}
              />
            </Field>
            <Field label="Deal type">
              <Select value={drafts[row.source_key]?.price_deal_type} options={DEAL_TYPE_OPTIONS}
                onChange={(v) => setDrafts({ ...drafts, [row.source_key]: { ...drafts[row.source_key], price_deal_type: v } })} />
            </Field>
            <Field label="Unit">
              <Select value={drafts[row.source_key]?.price_unit} options={UNIT_OPTIONS}
                onChange={(v) => setDrafts({ ...drafts, [row.source_key]: { ...drafts[row.source_key], price_unit: v } })} />
            </Field>
            <Field label="Basis">
              <Select value={drafts[row.source_key]?.price_basis} options={BASIS_OPTIONS}
                onChange={(v) => setDrafts({ ...drafts, [row.source_key]: { ...drafts[row.source_key], price_basis: v } })} />
            </Field>
          </div>

          <div className="mt-3 flex gap-2">
            <button
              disabled={busy === row.source_key}
              onClick={() => resolve(row, false)}
              className="text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-md"
            >
              Confirm this row
            </button>
            <button
              disabled={busy === row.source_key}
              onClick={() => resolve(row, true)}
              className="text-xs bg-slate-700 hover:bg-slate-800 disabled:opacity-50 text-white px-3 py-1.5 rounded-md"
              title="Also stop flagging this exact pattern on future imports, and un-flag other rows currently flagged for the same reason"
            >
              Confirm + apply to all matching this pattern
            </button>
          </div>
        </div>
      ))}
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

function Select({ value, options, onChange }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1 text-sm">
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}
