import React, { useState, useEffect } from 'react';
import { api } from './api';
import Onboarding from './pages/Onboarding.jsx';
import Upload from './pages/Upload.jsx';
import Overview from './pages/Overview.jsx';
import Vendors from './pages/Vendors.jsx';
import Volume from './pages/Volume.jsx';
import ReviewQueue from './pages/ReviewQueue.jsx';
import PricingTool from './pages/PricingTool.jsx';
import MapView from './pages/MapView.jsx';

const TABS = [
  { id: 'overview', label: 'Market Overview' },
  { id: 'upload', label: 'Upload' },
  { id: 'vendors', label: 'Vendor Tracker' },
  { id: 'volume', label: 'Volume' },
  { id: 'review', label: 'Review Queue' },
  { id: 'pricing', label: 'Off-Market Pricing' },
  { id: 'map', label: 'Cluster Map' },
];

export default function App() {
  const [tab, setTab] = useState('overview');
  const [config, setConfig] = useState(null);
  const [reviewCount, setReviewCount] = useState(0);

  const refreshConfig = () => api.getConfig().then(setConfig).catch(() => {});
  const refreshReviewCount = () =>
    api
      .getReviewQueue()
      .then((rows) => setReviewCount(rows.length))
      .catch(() => {});

  useEffect(() => {
    refreshConfig();
    refreshReviewCount();
    const goToReview = () => setTab('review');
    document.addEventListener('navigate-review', goToReview);
    return () => document.removeEventListener('navigate-review', goToReview);
  }, []);

  if (!config) {
    return <div className="p-8 text-slate-500">Loading…</div>;
  }

  if (!config.marketLabelsConfirmed) {
    return (
      <Onboarding
        config={config}
        onSaved={() => refreshConfig()}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Ontario IOS Market Tracker</h1>
          <p className="text-xs text-slate-400">Local dashboard — data persists in SQLite across restarts</p>
        </div>
        <button
          className="text-xs text-slate-400 hover:text-white underline"
          onClick={() => api.saveMarketLabels(config.marketLabels, false).then(refreshConfig)}
        >
          Edit region labels
        </button>
      </header>

      <nav className="bg-white border-b border-slate-200 px-6 flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
              tab === t.id
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.label}
            {t.id === 'review' && reviewCount > 0 && (
              <span className="ml-2 inline-flex items-center justify-center rounded-full bg-amber-500 text-white text-xs w-5 h-5">
                {reviewCount}
              </span>
            )}
          </button>
        ))}
      </nav>

      <main className="p-6">
        {tab === 'overview' && <Overview config={config} />}
        {tab === 'upload' && <Upload onImported={refreshReviewCount} />}
        {tab === 'vendors' && <Vendors />}
        {tab === 'volume' && <Volume config={config} />}
        {tab === 'review' && <ReviewQueue onChanged={refreshReviewCount} />}
        {tab === 'pricing' && <PricingTool config={config} />}
        {tab === 'map' && <MapView config={config} />}
      </main>
    </div>
  );
}
