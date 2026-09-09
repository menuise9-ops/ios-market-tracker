"""Bank of Canada target overnight rate (series V39079) — ported from
rates.js. The one external data source besides geocoding; cached locally
so an offline run still has whatever was fetched last time. Canadian bank
prime is conventionally overnight + 2.20%; computed here and labeled
"approximate" rather than pretending it's an official series.
"""

import datetime as dt
import requests

from . import db

PRIME_SPREAD = 2.20
VALET_URL = "https://www.bankofcanada.ca/valet/observations/V39079/json"
REFRESH_AFTER_HOURS = 24


def refresh_if_stale():
    latest = db.query_one("SELECT MAX(fetched_at) as t FROM boc_rates")
    if latest and latest["t"]:
        fetched = dt.datetime.strptime(latest["t"], "%Y-%m-%d %H:%M:%S")
        age_hours = (dt.datetime.utcnow() - fetched).total_seconds() / 3600
        if age_hours < REFRESH_AFTER_HOURS:
            return {"refreshed": False}
    try:
        res = requests.get(f"{VALET_URL}?start_date=2024-01-01", timeout=15)
        if not res.ok:
            return {"refreshed": False, "error": f"HTTP {res.status_code}"}
        payload = res.json()
        rows = []
        for obs in payload.get("observations", []):
            v = obs.get("V39079", {}).get("v")
            if v is not None:
                rows.append((obs["d"], float(v)))
        db.executemany("INSERT OR REPLACE INTO boc_rates (date, overnight_rate) VALUES (?, ?)", rows)
        return {"refreshed": True, "count": len(rows)}
    except requests.RequestException as err:
        return {"refreshed": False, "error": str(err)}


def get_monthly_rates():
    rows = db.query("SELECT date, overnight_rate FROM boc_rates ORDER BY date ASC")
    by_month = {}
    for r in rows:
        by_month[r["date"][:7]] = r["overnight_rate"]  # later dates overwrite -> last obs of month wins
    return [
        {"month": m, "overnight_rate": rate, "approx_prime": round((rate + PRIME_SPREAD) * 100) / 100}
        for m, rate in by_month.items()
    ]
