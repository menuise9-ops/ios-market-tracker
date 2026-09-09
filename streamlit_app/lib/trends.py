"""Pricing trends over time, by market — ported from trends.js. Avg sale
$/acre and avg lease $/SF (net + gross), bucketed monthly, alongside the
BoC overnight/approx-prime rate for the same months.
"""

import datetime as dt

from . import db
from .rates import get_monthly_rates


def _months_back(n, end_month):
    y, m = int(end_month[:4]), int(end_month[5:7])
    months = []
    for i in range(n - 1, -1, -1):
        mm = m - i
        yy = y
        while mm <= 0:
            mm += 12
            yy -= 1
        months.append(f"{yy:04d}-{mm:02d}")
    return months


def _avg(arr):
    return sum(arr) / len(arr) if arr else None


def get_trends(months_count=12):
    rows = [dict(r) for r in db.query("SELECT * FROM listings WHERE date_flagged = 0 AND record_date IS NOT NULL")]
    latest = max((r["record_date"] for r in rows), default="0000-00")
    end_month = latest[:7] if latest != "0000-00" else dt.datetime.now().strftime("%Y-%m")
    months = _months_back(months_count, end_month)

    markets = sorted({r["market"] for r in rows})
    by_market = {}
    for mkt in markets:
        market_rows = [r for r in rows if r["market"] == mkt]
        sale_per_acre, lease_net_psf, lease_gross_psf, txn_count = [], [], [], []
        for month in months:
            in_month = [r for r in market_rows if r["record_date"][:7] == month]
            sales = [r for r in in_month if r["price_deal_type"] == "sale" and r["price_unit"] == "total" and r["acres"] and r["price_amount"]]
            lease_net = [r for r in in_month if r["price_deal_type"] == "lease" and r["price_unit"] == "per_sf" and r["price_basis"] == "net"]
            lease_gross = [r for r in in_month if r["price_deal_type"] == "lease" and r["price_unit"] == "per_sf" and r["price_basis"] == "gross"]
            sale_per_acre.append(_avg([r["price_amount"] / r["acres"] for r in sales]))
            lease_net_psf.append(_avg([r["price_amount"] for r in lease_net]))
            lease_gross_psf.append(_avg([r["price_amount"] for r in lease_gross]))
            txn_count.append(sum(1 for r in in_month if r["record_type"] == "transaction"))
        by_market[mkt] = {"sale_per_acre": sale_per_acre, "lease_net_psf": lease_net_psf, "lease_gross_psf": lease_gross_psf, "txn_count": txn_count}

    rate_by_month = {r["month"]: r for r in get_monthly_rates()}
    rates = [rate_by_month.get(m, {"month": m, "overnight_rate": None, "approx_prime": None}) for m in months]

    return {"months": months, "by_market": by_market, "rates": rates}
