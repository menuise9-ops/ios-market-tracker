"""Cluster-map geocoding — ported from geocode.js. Free OSM/Nominatim,
cached forever in geocode_cache. Nominatim frequently can't resolve a full
house-number address for small/rural Ontario towns (verified while
building the Node version) but resolves the street or the town just fine,
so each row tries progressively coarser queries and keeps the first hit.

Streamlit has no real background-worker concept, so geocoding here runs
synchronously in small batches driven by the Cluster Map page's own
"Geocode remaining" button + a progress bar, rather than an always-on
background loop.
"""

import re
import time
import requests

from . import db

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "ios-market-tracker-streamlit/0.1 (local personal-use dashboard)"
RATE_LIMIT_SECONDS = 1.1

_PAREN_RE = re.compile(r"\s*\([^)]*\)\s*")
_HOUSE_NUMBER_RE = re.compile(r"^\s*\d+[a-zA-Z]?\s*[-&]?\s*\d*\s*")


def clean_municipality(municipality):
    if not municipality:
        return municipality
    return re.sub(r"\s+", " ", _PAREN_RE.sub(" ", municipality)).strip()


def strip_house_number(address):
    return _HOUSE_NUMBER_RE.sub("", address).strip()


def build_candidate_queries(address, municipality):
    muni = clean_municipality(municipality)
    queries = []
    if address:
        queries.append({"q": ", ".join(filter(None, [address, muni, "Ontario", "Canada"])), "precision": "address"})
    street = strip_house_number(address) if address else None
    if street and street != address:
        queries.append({"q": ", ".join(filter(None, [street, muni, "Ontario", "Canada"])), "precision": "street"})
    if muni:
        queries.append({"q": ", ".join(filter(None, [muni, "Ontario", "Canada"])), "precision": "municipality"})
    return queries


def _get_cached(query):
    return db.query_one("SELECT * FROM geocode_cache WHERE query = ?", (query,))


def _set_cached(query, lat, lon, precision):
    db.execute(
        "INSERT OR REPLACE INTO geocode_cache (query, lat, lon, provider) VALUES (?, ?, ?, ?)",
        (query, lat, lon, f"nominatim:{precision}"),
    )


def _nominatim_search(q):
    url = f"{NOMINATIM_URL}?format=json&limit=1&countrycodes=ca&q={requests.utils.quote(q)}"
    res = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=10)
    if not res.ok:
        return None
    results = res.json()
    if not results:
        return None
    return {"lat": float(results[0]["lat"]), "lon": float(results[0]["lon"])}


def geocode_address(address, municipality):
    for candidate in build_candidate_queries(address, municipality):
        q, precision = candidate["q"], candidate["precision"]
        cached = _get_cached(q)
        if cached is not None:
            if cached["lat"] is not None:
                return {"lat": cached["lat"], "lon": cached["lon"], "precision": precision}
            continue  # this exact query is known to fail — try the next, coarser one
        result = None
        try:
            result = _nominatim_search(q)
        except requests.RequestException as err:
            print(f"Geocode request failed for {q}: {err}")
        _set_cached(q, result["lat"] if result else None, result["lon"] if result else None, precision)
        time.sleep(RATE_LIMIT_SECONDS)
        if result:
            return {**result, "precision": precision}
    return {"lat": None, "lon": None, "precision": None}


def geocode_batch(limit=20, progress_cb=None):
    """Geocode up to `limit` listings that don't have lat/lon yet.
    progress_cb(done, total) is called after each row, if given.
    """
    rows = db.query(
        "SELECT source_key, address, municipality FROM listings WHERE lat IS NULL AND address IS NOT NULL LIMIT ?",
        (limit,),
    )
    resolved = failed = 0
    for i, row in enumerate(rows):
        result = geocode_address(row["address"], row["municipality"])
        if result["lat"] is not None:
            db.execute(
                "UPDATE listings SET lat = ?, lon = ?, geocode_precision = ? WHERE source_key = ?",
                (result["lat"], result["lon"], result["precision"], row["source_key"]),
            )
            resolved += 1
        else:
            db.execute("UPDATE listings SET geocode_attempted = 1 WHERE source_key = ?", (row["source_key"],))
            failed += 1
        if progress_cb:
            progress_cb(i + 1, len(rows))
    remaining = db.query_one(
        "SELECT COUNT(*) as n FROM listings WHERE lat IS NULL AND geocode_attempted = 0"
    )["n"]
    return {"processed": len(rows), "resolved": resolved, "failed": failed, "remaining": remaining}
