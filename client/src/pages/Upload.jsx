import React, { useState, useCallback, useEffect } from 'react';
import { api } from '../api';

export default function Upload({ onImported }) {
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    api.getImportBatches().then(setHistory).catch(() => {});
  }, []);

  const handleFile = useCallback(
    async (file) => {
      if (!file) return;
      if (!file.name.toLowerCase().endsWith('.xlsx')) {
        setError('Only .xlsx files are supported.');
        return;
      }
      setBusy(true);
      setError(null);
      setSummary(null);
      try {
        const result = await api.importFile(file);
        setSummary(result);
        onImported?.();
        api.getImportBatches().then(setHistory).catch(() => {});
      } catch (e) {
        setError(e.message);
      } finally {
        setBusy(false);
      }
    },
    [onImported]
  );

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFile(e.dataTransfer.files[0]);
        }}
        className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors ${
          dragOver ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-white'
        }`}
      >
        <p className="text-slate-600 mb-3">Drag and drop a biweekly .xlsx report here</p>
        <label className="inline-block bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-md cursor-pointer">
          {busy ? 'Importing…' : 'Choose file'}
          <input
            type="file"
            accept=".xlsx"
            className="hidden"
            disabled={busy}
            onChange={(e) => handleFile(e.target.files[0])}
          />
        </label>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md p-4">{error}</div>
      )}

      {summary && (
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <h3 className="font-semibold text-slate-900 mb-3">Import summary — {summary.filename}</h3>
          <div className="grid grid-cols-4 gap-4 text-center mb-4">
            <Stat label="Added" value={summary.rowsAdded} color="text-emerald-600" />
            <Stat label="Updated (dedup match)" value={summary.rowsUpdated} color="text-blue-600" />
            <Stat label="Flagged for review" value={summary.rowsFlagged} color="text-amber-600" />
            <Stat label="Skipped" value={summary.rowsSkipped} color="text-slate-500" />
          </div>
          {summary.unmatchedSheets?.length > 0 && (
            <p className="text-xs text-red-600 mb-2">
              Unrecognized sheet names (not one of the 8 expected types): {summary.unmatchedSheets.join(', ')}
            </p>
          )}
          {summary.rowsFlagged > 0 && (
            <p className="text-sm text-slate-600">
              {summary.rowsFlagged} row(s) need a look —{' '}
              <a href="#" onClick={(e) => { e.preventDefault(); document.dispatchEvent(new CustomEvent('navigate-review')); }} className="text-blue-600 underline">
                open the Review Queue
              </a>
              .
            </p>
          )}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <h3 className="font-semibold text-slate-900 mb-3">Import history</h3>
        {history.length === 0 ? (
          <p className="text-sm text-slate-500">No imports yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="py-2">File</th>
                <th>Uploaded</th>
                <th>Range</th>
                <th className="text-right">Added</th>
                <th className="text-right">Updated</th>
                <th className="text-right">Flagged</th>
              </tr>
            </thead>
            <tbody>
              {history.map((b) => (
                <tr key={b.id} className="border-b border-slate-100">
                  <td className="py-2">{b.filename}</td>
                  <td>{b.uploaded_at}</td>
                  <td>{b.date_range_start} → {b.date_range_end}</td>
                  <td className="text-right">{b.rows_added}</td>
                  <td className="text-right">{b.rows_updated}</td>
                  <td className="text-right">{b.rows_flagged}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-slate-500 mt-1">{label}</div>
    </div>
  );
}
