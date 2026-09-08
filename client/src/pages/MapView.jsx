import React, { useEffect, useState, useCallback } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
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

export default function MapView({ config }) {
  const [points, setPoints] = useState([]);
  const [remaining, setRemaining] = useState(0);
  const [geocoding, setGeocoding] = useState(false);
  const [progress, setProgress] = useState(null);

  const load = useCallback(() => {
    api.getMapPoints().then((r) => {
      setPoints(r.points);
      setRemaining(r.ungeocodedRemaining);
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

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between">
        <div className="text-sm text-slate-600">
          {points.length} plotted · {remaining} not yet geocoded
          <span className="text-xs text-slate-400 ml-2">(free OSM/Nominatim, rate-limited to 1 req/sec, cached forever)</span>
        </div>
        {remaining > 0 && (
          <button
            onClick={runGeocoding}
            disabled={geocoding}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-md"
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
          {points.map((p) => (
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
                  <div className="font-medium">{fmtMoney(p.price_amount) || p.price_raw}</div>
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
