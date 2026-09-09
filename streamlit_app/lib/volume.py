"""Transaction Volume by Market — ported from volume.js. Bucketed by month
of record_date (the underlying market-activity date, not upload date).
"""

from . import db


def _month_bucket(iso):
    return iso[:7] if iso else "unknown"


def _build_volume(record_type):
    rows = [dict(r) for r in db.query("SELECT * FROM listings WHERE record_type = ?", (record_type,))]
    buckets = {}
    for r in rows:
        month = _month_bucket(r["record_date"])
        buckets.setdefault(month, {})
        key = f"{r['market']}__{r['type_of_land_normalized'] or 'Unclassified'}"
        b = buckets[month].setdefault(key, {"market": r["market"], "type": r["type_of_land_normalized"] or "Unclassified", "count": 0, "sqft": 0, "acres": 0})
        b["count"] += 1
        if isinstance(r["sqft"], (int, float)):
            b["sqft"] += r["sqft"]
        if isinstance(r["acres"], (int, float)):
            b["acres"] += r["acres"]

    months = sorted(buckets.keys())
    series = [{"month": m, **buckets[m]} for m in months]
    return {"record_type": record_type, "months": months, "series": series}


def get_volume():
    return {"transactions": _build_volume("transaction"), "availabilities": _build_volume("availability")}
