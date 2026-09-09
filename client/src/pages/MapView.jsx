import React, { useEffect, useState, useCallback } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.heat';
import { api } from '../api';

const MARKET_COLORS = {
  MWO: '#2563eb',
  SWO: '#16a34a',
  'Core GTA': '#d97706',
  'Non-Core GTA': '#9333ea',
};

const ONTARIO_CENTER = [43.7, -80.3];

function fmtMoney(n) {
  if (n === null || n === undefined) return null;
  return '$' + Math.round(n).toLocaleString();
}

function HeatLayer({ points }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    const heat = L.heatLayer(points.map((p) => [p.lat, p.lon, p.intensity]), {
      radius: 28,
      blur: 22,
      maxZoom: 12,
      gradient: { 0.2: '#2563eb', 0.4: '#16a34a', 0.6: '#f59e0b', 0.8: '#ea580c', 1.0: '#dc2626' },
    }).addTo(map);
    return () => map.removeLayer(heat);
  }, [map, points]);
  return null;
}

export default function MapView({ config }) {
  const [points, setPoints] = useState([]);
  const [remaining, setRemaining] = useState(0);
  const [permanentlyFailed, setPermanentlyFailed] = useState(0);
  const [geocoding, setGeocoding] = useState(false);
  const [progress, setProgress] = useState(null);
  const [viewMode, setViewMode] = useState('both'); // markers | heatmap | both
  const [statusFilter, setStatusFilter] = useState('all'); // all | transaction | availability

  const load = useCallback(() => {
    api.getMapPoints().then((r) => {
      setPoints(r.points);
      setRemaining(r.ungeocodedRemaining);
      setPermanentlyFailed(r.permanentlyFailed || 0);
    });
  }, []);

  useEffect(load, [load]);

  const runGeocoding = async () => {
    setGeocoding(true);
    try {
      let left = remaining;
      let done = 0;
      const total = remaining;
      while (left > 0) {
        const r = await fetch('/api/geocode/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ limit: 20 }),
        }).then((res) => res.json());
        done += r.processed;
        left = r.remaining;
        setProgress({ done, total });
        load();
        if (r.processed === 0) break;
      }
    } finally {
      setGeocoding(false);
      setProgress(null);
    }
  };

  const filtered = points.filter((p) => statusFilter === 'all' || p.record_type === statusFilter);
  const heatPoints = filtered.map((p) => ({
    lat: p.lat,
    lon: p.lon,
    intensity: p.price_amount && p.price_unit === 'total' ? Math.min(Math.log10(p.price_amount) / 7, 1) : 0.4,
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">Cluster Map</h1>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center gap-4">
        <div className="text-sm text-slate-600">
          {points.length} plotted
          {remaining > 0 && <span className="text-amber-600"> · {remaining} pending</span>}
          {permanentlyFailed > 0 && <span className="text-slate-400"> · {permanentlyFailed} couldn't be located</span>}
        </div>

        <div className="flex gap-1 bg-slate-100 rounded-md p-0.5">
          {['markers', 'heatmap', 'both'].map((m) => (
            <button
              key={m}
              onClick={() => setViewMode(m)}
              className={`text-xs px-3 py-1 rounded ${viewMode === m ? 'bg-white shadow text-slate-900 font-medium' : 'text-slate-500'}`}
            >
              {m === 'markers' ? 'Pins' : m === 'heatmap' ? 'Heatmap' : 'Both'}
            </button>
          ))}
        </div>

        <div className="flex gap-1 bg-slate-100 rounded-md p-0.5">
          {[['all', 'All'], ['transaction', 'Sold'], ['availability', 'Available']].map(([v, l]) => (
            <button
              key={v}
              onClick={() => setStatusFilter(v)}
              className={`text-xs px-3 py-1 rounded ${statusFilter === v ? 'bg-white shadow text-slate-900 font-medium' : 'text-slate-500'}`}
            >
              {l}
            </button>
          ))}
        </div>

        {remaining > 0 && (
          <button
            onClick={runGeocoding}
            disabled={geocoding}
            className="ml-auto bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-1.5 rounded-md"
          >
            {geocoding ? `Geocoding… ${progress ? `${progress.done}/${progress.total}` : ''}` : `Geocode remaining ${remaining}`}
          </button>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden" style={{ height: 560 }}>
        <MapContainer center={ONTARIO_CENTER} zoom={8} style={{ height: '100%', width: '100%' }}>
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          />
          {(viewMode === 'heatmap' || viewMode === 'both') && <HeatLayer points={heatPoints} />}
          {(viewMode === 'markers' || viewMode === 'both') &&
            filtered.map((p) => (
              <CircleMarker
                key={p.source_key}
                center={[p.lat, p.lon]}
                radius={p.record_type === 'transaction' ? 7 : 5}
                pathOptions={{
                  color: MARKET_COLORS[p.market] || '#64748b',
                  fillColor: MARKET_COLORS[p.market] || '#64748b',
                  fillOpacity: p.record_type === 'transaction' ? 0.85 : 0.35,
                  weight: p.type_of_land_normalized === 'Land' ? 1 : 2,
                  dashArray: p.type_of_land_normalized === 'Land' ? '3,2' : null,
                }}
              >
                <Popup>
                  <div className="text-xs space-y-1">
                    <div className="font-semibold">{p.address}</div>
                    <div>{p.municipality} · {config.marketLabels[p.market] || p.market}</div>
                    <div>{p.type_of_land_normalized} · {p.record_type === 'transaction' ? 'Sold' : 'Available'}</div>
                    <div>{p.record_date}</div>
                    <div className="font-medium">
                      {p.price_unit === 'total' ? fmtMoney(p.price_amount) || p.price_raw : p.price_raw}
                    </div>
                    {p.geocode_precision !== 'address' && (
                      <div className="text-amber-600">Approximate location ({p.geocode_precision}-level)</div>
                    )}
                    {p.notes && <div className="text-slate-500 italic">{p.notes}</div>}
                  </div>
                </Popup>
              </CircleMarker>
            ))}
        </MapContainer>
      </div>

      <div className="flex gap-4 text-xs text-slate-500 flex-wrap">
        {Object.entries(MARKET_COLORS).map(([m, c]) => (
          <span key={m} className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full inline-block" style={{ background: c }} /> {config.marketLabels[m] || m}
          </span>
        ))}
        <span>· solid fill = sold, faint = available · dashed border = Land, solid border = Low Coverage</span>
      </div>
    </div>
  );
}
