import React, { useState } from 'react';
import { api } from '../api';

// CLAUDE.md §1: "Confirm these expansions with me once in the app's
// onboarding/config screen rather than hardcoding a guess."
export default function Onboarding({ config, onSaved }) {
  const [labels, setLabels] = useState(config.marketLabels);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.saveMarketLabels(labels, true);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="max-w-lg w-full bg-white rounded-xl shadow-sm border border-slate-200 p-8">
        <h1 className="text-xl font-semibold text-slate-900 mb-1">Welcome — one quick confirmation</h1>
        <p className="text-sm text-slate-600 mb-6">
          Your reports use four region codes as the top-level "Market" grouping. Confirm what each
          one stands for — this is used as a display label only, never guessed silently.
        </p>
        <div className="space-y-4">
          {Object.entries(labels).map(([code, label]) => (
            <div key={code}>
              <label className="block text-xs font-medium text-slate-500 mb-1">{code}</label>
              <input
                className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={label}
                onChange={(e) => setLabels({ ...labels, [code]: e.target.value })}
              />
            </div>
          ))}
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="mt-6 w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-2.5 rounded-md text-sm"
        >
          {saving ? 'Saving…' : 'Confirm and continue'}
        </button>
      </div>
    </div>
  );
}
