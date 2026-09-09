"""Vendor Leaderboard — ported from vendors.js. Groups transactions by
normalized vendor name, plus Levenshtein "possible same entity" suggestions
and an HHI-based market-concentration read.
"""

from . import db


def _levenshtein(a, b):
    m, n = len(a), len(b)
    dp = [[0] * (n + 1) for _ in range(m + 1)]
    for i in range(m + 1):
        dp[i][0] = i
    for j in range(n + 1):
        dp[0][j] = j
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            dp[i][j] = dp[i - 1][j - 1] if a[i - 1] == b[j - 1] else 1 + min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    return dp[m][n]


def _get_vendor_merges():
    return {r["from_name"]: r["into_name"] for r in db.query("SELECT from_name, into_name FROM vendor_merges")}


def _resolve_vendor_name(normalized, merges):
    current = normalized
    hops = 0
    while current in merges and hops < 10:
        current = merges[current]
        hops += 1
    return current


def get_vendors():
    merges = _get_vendor_merges()
    rows = [dict(r) for r in db.query(
        "SELECT * FROM listings WHERE record_type = 'transaction' AND vendor_normalized IS NOT NULL"
    )]

    by_vendor = {}
    for r in rows:
        key = _resolve_vendor_name(r["vendor_normalized"], merges)
        by_vendor.setdefault(key, []).append(r)

    vendors = []
    for name, deals in by_vendor.items():
        if name == "Unknown":
            continue
        with_price = [d for d in deals if d["price_amount"] is not None and d["price_unit"] == "total"]
        total_volume = sum(d["price_amount"] for d in with_price)
        vendors.append({
            "vendor_name": name,
            "deal_count": len(deals),
            "total_volume": total_volume,
            "avg_deal_size": total_volume / len(with_price) if with_price else None,
            "markets": sorted({d["market"] for d in deals}),
            "municipalities": sorted({d["municipality"] for d in deals if d["municipality"]}),
            "properties": [
                {
                    "address": d["address"], "municipality": d["municipality"], "market": d["market"],
                    "date": d["record_date"], "price": d["price_amount"], "price_unit": d["price_unit"],
                    "price_raw": d["price_raw"], "source_key": d["source_key"],
                }
                for d in deals
            ],
        })
    vendors.sort(key=lambda v: (-v["deal_count"], -v["total_volume"]))

    total_volume_all = sum(v["total_volume"] for v in vendors)
    hhi = sum(((v["total_volume"] / total_volume_all) * 100) ** 2 for v in vendors) if total_volume_all > 0 else 0
    concentration_label = "concentrated" if hhi > 2500 else "moderate" if hhi > 1500 else "fragmented"

    names = [v["vendor_name"] for v in vendors]
    suggestions = []
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            a, b = names[i], names[j]
            if a == b:
                continue
            dist = _levenshtein(a, b)
            max_len = max(len(a), len(b))
            if max_len > 0 and dist / max_len < 0.2 and dist <= 4:
                suggestions.append({"a": a, "b": b, "distance": dist})

    return {
        "vendors": vendors,
        "suggestions": suggestions,
        "concentration": {"hhi": round(hhi), "label": concentration_label, "total_volume_all": total_volume_all},
    }


def merge_vendors(from_name, into_name):
    db.execute("INSERT OR REPLACE INTO vendor_merges (from_name, into_name) VALUES (?, ?)", (from_name, into_name))
