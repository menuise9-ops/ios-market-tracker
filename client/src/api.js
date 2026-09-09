const BASE = '/api';

function qs(params = {}) {
  const clean = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') clean[k] = v;
  }
  return new URLSearchParams(clean).toString();
}

async function req(path, options) {
  const res = await fetch(`${BASE}${path}`, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

export const api = {
  getConfig: () => req('/config'),
  getPulse: () => req('/pulse'),
  getTrends: (months) => req(`/trends${months ? `?months=${months}` : ''}`),
  saveMarketLabels: (labels, confirmed) =>
    req('/config/market-labels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ labels, confirmed }),
    }),
  getOverview: (params = {}) => {
    const s = qs(params);
    return req(`/overview${s ? `?${s}` : ''}`);
  },
  getMunicipalities: (market) => req(`/municipalities${market ? `?market=${encodeURIComponent(market)}` : ''}`),
  getListings: (params = {}) => {
    const s = qs(params);
    return req(`/listings${s ? `?${s}` : ''}`);
  },
  importFile: async (file) => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${BASE}/import`, { method: 'POST', body: form });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Import failed: ${res.status}`);
    }
    return res.json();
  },
  getImportBatches: () => req('/import-batches'),
  getVendors: (params = {}) => {
    const s = qs(params);
    return req(`/vendors${s ? `?${s}` : ''}`);
  },
  mergeVendors: (fromName, intoName) =>
    req('/vendors/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromName, intoName }),
    }),
  getVolume: (params = {}) => {
    const s = qs(params);
    return req(`/volume${s ? `?${s}` : ''}`);
  },
  getReviewQueue: () => req('/review-queue'),
  resolveReview: (sourceKey, fields, opts = {}) =>
    req(`/review-queue/${encodeURIComponent(sourceKey)}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields, ...opts }),
    }),
  getPricingEstimate: (params) => req(`/pricing-estimate?${qs(params)}`),
  getMapPoints: (params = {}) => {
    const s = qs(params);
    return req(`/map-points${s ? `?${s}` : ''}`);
  },
};
