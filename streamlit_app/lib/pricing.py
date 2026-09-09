"""Off-Market Pricing Tool — ported from pricing.js. Recent comps (last 3
months) carry more weight, exponential decay with a 3-month half-life.
"""

import datetime as dt

from . import db

HALF_LIFE_MONTHS = 3
MIN_COMPS = 3


def _months_ago(iso, now_iso):
    if not iso or not now_iso:
        return None
    a = dt.datetime.strptime(iso, "%Y-%m-%d")
    b = dt.datetime.strptime(now_iso, "%Y-%m-%d")
    return (b - a).days / 30.44


def _recency_weight(iso, now_iso):
    m = _months_ago(iso, now_iso)
    if m is None or m < 0:
        return 1
    return 0.5 ** (m / HALF_LIFE_MONTHS)


def _weighted_avg(items, value_fn, weight_fn):
    w_sum = v_sum = 0
    for it in items:
        v = value_fn(it)
        if v is None:
            continue
        w = weight_fn(it)
        w_sum += w
        v_sum += v * w
    return v_sum / w_sum if w_sum > 0 else None


def _get_latest_date():
    row = db.query_one("SELECT MAX(record_date) as d FROM listings WHERE date_flagged = 0")
    return row["d"] if row and row["d"] else dt.datetime.now().strftime("%Y-%m-%d")


def _fetch_candidates(market, municipality, type_):
    sql = ("SELECT * FROM listings WHERE market = ? AND type_of_land_normalized = ? "
           "AND needs_review = 0 AND price_status NOT IN ('suppressed','missing')")
    params = [market, type_]
    if municipality:
        sql += " AND municipality = ?"
        params.append(municipality)
    return [dict(r) for r in db.query(sql, params)]


def _to_comp(r, w):
    return {
        "source_key": r["source_key"], "address": r["address"], "municipality": r["municipality"],
        "record_type": r["record_type"], "date": r["record_date"], "price_raw": r["price_raw"],
        "price_amount": r["price_amount"], "price_unit": r["price_unit"], "price_basis": r["price_basis"],
        "acres": r["acres"], "sqft": r["sqft"], "weight": round(w * 100) / 100,
    }


def estimate(market, municipality, type_, acres=None, sqft=None):
    now_iso = _get_latest_date()

    candidates = _fetch_candidates(market, municipality, type_)
    used_fallback = False
    if municipality and len(candidates) < MIN_COMPS:
        market_level = _fetch_candidates(market, None, type_)
        if len(market_level) > len(candidates):
            candidates = market_level
            used_fallback = True

    def w(r):
        return _recency_weight(r["record_date"], now_iso)

    sale_rows = [r for r in candidates if r["price_deal_type"] == "sale" and r["price_unit"] == "total" and r["record_type"] == "transaction"]
    sale_per_acre_rows = [r for r in sale_rows if r["acres"]]

    avg_sale_total = _weighted_avg(sale_rows, lambda r: r["price_amount"], w)
    avg_sale_per_acre = _weighted_avg(sale_per_acre_rows, lambda r: r["price_amount"] / r["acres"], w)
    sale_amounts = [r["price_amount"] for r in sale_rows if r["price_amount"] is not None]

    sale_estimate, sale_basis = avg_sale_total, "avg_total"
    if acres and avg_sale_per_acre:
        sale_estimate, sale_basis = avg_sale_per_acre * acres, "per_acre_x_target_acres"

    lease_rows = [r for r in candidates if r["price_deal_type"] == "lease" and r["price_unit"] == "per_sf"]
    lease_net_rows = [r for r in lease_rows if r["price_basis"] == "net"]
    lease_gross_rows = [r for r in lease_rows if r["price_basis"] == "gross"]

    avg_lease_net_psf = _weighted_avg(lease_net_rows, lambda r: r["price_amount"], w)
    avg_lease_gross_psf = _weighted_avg(lease_gross_rows, lambda r: r["price_amount"], w)
    lease_amounts = [r["price_amount"] for r in lease_rows if r["price_amount"] is not None]

    return {
        "inputs": {"market": market, "municipality": municipality, "type": type_, "acres": acres, "sqft": sqft},
        "used_market_level_fallback": used_fallback,
        "sale": {
            "n": len(sale_rows), "estimate": sale_estimate, "estimate_basis": sale_basis,
            "avg_total": avg_sale_total, "avg_per_acre": avg_sale_per_acre,
            "min": min(sale_amounts) if sale_amounts else None, "max": max(sale_amounts) if sale_amounts else None,
            "comps": [_to_comp(r, w(r)) for r in sale_rows],
        },
        "lease": {
            "n": len(lease_rows), "avg_net_psf": avg_lease_net_psf, "avg_gross_psf": avg_lease_gross_psf,
            "estimate_net_total": avg_lease_net_psf * sqft if (sqft and avg_lease_net_psf) else None,
            "estimate_gross_total": avg_lease_gross_psf * sqft if (sqft and avg_lease_gross_psf) else None,
            "min": min(lease_amounts) if lease_amounts else None, "max": max(lease_amounts) if lease_amounts else None,
            "comps": [_to_comp(r, w(r)) for r in lease_rows],
        },
    }
