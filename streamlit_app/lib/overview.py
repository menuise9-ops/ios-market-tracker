"""Market Overview aggregation — ported from overview.js."""

from . import db

MARKETS = ["MWO", "SWO", "Core GTA", "Non-Core GTA"]
TYPES = ["Low Coverage", "Land"]
STATUSES = ["available", "sold"]


def _avg(arr):
    return sum(arr) / len(arr) if arr else None


def _stat(rows, pick):
    amounts = [v for v in (pick(r) for r in rows) if v is not None]
    return {
        "n": len(amounts),
        "avg": _avg(amounts),
        "min": min(amounts) if amounts else None,
        "max": max(amounts) if amounts else None,
    }


def get_overview(market=None, municipality=None, include_flagged=False):
    sql = "SELECT * FROM listings WHERE 1=1"
    params = []
    if market:
        sql += " AND market = ?"
        params.append(market)
    if municipality:
        sql += " AND municipality = ?"
        params.append(municipality)
    all_rows = [dict(r) for r in db.query(sql, params)]

    def is_flagged(r):
        return r["needs_review"] == 1 or r["price_status"] in ("suppressed", "missing")

    excluded_count = sum(1 for r in all_rows if not include_flagged and is_flagged(r))
    usable = all_rows if include_flagged else [r for r in all_rows if not is_flagged(r)]

    cells = {}
    for mkt in MARKETS:
        for typ in TYPES:
            for status in STATUSES:
                record_type = "transaction" if status == "sold" else "availability"
                rows = [r for r in usable if r["market"] == mkt and r["type_of_land_normalized"] == typ and r["record_type"] == record_type]
                sale_rows = [r for r in rows if r["price_deal_type"] == "sale" and r["price_unit"] == "total"]
                lease_net_rows = [r for r in rows if r["price_deal_type"] == "lease" and r["price_unit"] == "per_sf" and r["price_basis"] == "net"]
                lease_gross_rows = [r for r in rows if r["price_deal_type"] == "lease" and r["price_unit"] == "per_sf" and r["price_basis"] == "gross"]
                acre_rows = [r for r in rows if r["acres"] and (r["price_unit"] == "per_acre" or (r["price_deal_type"] == "sale" and r["price_unit"] == "total"))]

                key = f"{mkt}|{typ}|{status}"
                cells[key] = {
                    "market": mkt,
                    "type": typ,
                    "status": status,
                    "total_listings": len(rows),
                    "avg_sale_price": _stat(sale_rows, lambda r: r["price_amount"]),
                    "avg_lease_sf_net": _stat(lease_net_rows, lambda r: r["price_amount"]),
                    "avg_lease_sf_gross": _stat(lease_gross_rows, lambda r: r["price_amount"]),
                    "avg_per_acre": _stat(acre_rows, lambda r: (r["price_amount"] if r["price_unit"] == "per_acre" else (r["price_amount"] / r["acres"] if r["acres"] else None))),
                }
    return {"cells": cells, "excluded_count": excluded_count, "include_flagged": include_flagged, "total_rows": len(all_rows)}
