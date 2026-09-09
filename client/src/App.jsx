import React, { useState, useEffect } from 'react';
import { api } from './api';
import Onboarding from './pages/Onboarding.jsx';
import MarketPulse from './pages/MarketPulse.jsx';
import Upload from './pages/Upload.jsx';
import Overview from './pages/Overview.jsx';
import Vendors from './pages/Vendors.jsx';
import Volume from './pages/Volume.jsx';
import PricingTrends from './pages/PricingTrends.jsx';
import ReviewQueue from './pages/ReviewQueue.jsx';
import PricingTool from './pages/PricingTool.jsx';
import MapView from './pages/MapView.jsx';

const NAV_SECTIONS = [
  {
    label: 'Analyze',
    items: [
      { id: 'pulse', label: 'Market Pulse', icon: '⚡' },
      { id: 'overview', label: 'Market Overview', icon: '📊' },
      { id: 'trends', label: 'Pricing Trends', icon: '💹' },
      { id: 'vendors', label: 'Vendor Leaderboard', icon: '🏢' },
      { id: 'volume', label: 'Volume Trends', icon: '📈' },
      { id: 'map', label: 'Cluster Map', icon: '🗺️' },
      { id: 'pricing', label: 'Off-Market Pricing', icon: '🎯' },
    ],
  },
  {
    label: 'Manage Data',
    items: [
      { id: 'upload', label: 'Upload Report', icon: '⬆️' },
      { id: 'review', label: 'Review Queue', icon: '🔍', badgeKey: 'reviewCount' },
    ],
  },
];

export default function App() {
  const [tab, setTab] = useState('pulse');
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
    return <Onboarding config={config} onSaved={() => refreshConfig()} />;
  }

  const badges = { reviewCount };

  return (
    <div className="min-h-screen bg-slate-50 flex">
      <aside className="w-60 bg-slate-900 text-white flex flex-col shrink-0 h-screen sticky top-0 overflow-y-auto">
        <div className="px-5 py-5 border-b border-slate-800">
          <h1 className="text-base font-bold leading-tight">Ontario IOS<br />Market Tracker</h1>
          <p className="text-[11px] text-slate-500 mt-1">Local · SQLite · persists across restarts</p>
        </div>
        <nav className="flex-1 py-3 overflow-y-auto">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label} className="mb-4">
              <div className="px-5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                {section.label}
              </div>
              {section.items.map((item) => {
                const badgeVal = item.badgeKey ? badges[item.badgeKey] : 0;
                return (
                  <button
                    key={item.id}
                    onClick={() => setTab(item.id)}
                    className={`w-full flex items-center gap-2.5 px-5 py-2 text-sm font-medium transition-colors ${
                      tab === item.id
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    <span className="text-base leading-none">{item.icon}</span>
                    <span className="flex-1 text-left">{item.label}</span>
                    {badgeVal > 0 && (
                      <span className="inline-flex items-center justify-center rounded-full bg-amber-500 text-white text-[11px] w-5 h-5">
                        {badgeVal}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="px-5 py-4 border-t border-slate-800">
          <button
            className="text-[11px] text-slate-500 hover:text-white underline"
            onClick={() => api.saveMarketLabels(config.marketLabels, false).then(refreshConfig)}
          >
            Edit region labels
          </button>
        </div>
      </aside>

      <main className="flex-1 p-6 min-w-0">
        {tab === 'pulse' && <MarketPulse config={config} onNavigate={setTab} />}
        {tab === 'overview' && <Overview config={config} />}
        {tab === 'trends' && <PricingTrends config={config} />}
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
