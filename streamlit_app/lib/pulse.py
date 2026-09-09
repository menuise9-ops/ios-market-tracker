"""Market Pulse — ported from pulse.js. Everything derived fresh from
`listings` on every call. "Now" is the latest *unflagged* record_date in
the dataset (excluding the known '2206' typo pattern — see get_latest_date).
"""

import datetime as dt

from . import db

PERIOD_DAYS = 60


def get_latest_date():
    row = db.query_one("SELECT MAX(record_date) as d FROM listings WHERE date_flagged = 0")
    return row["d"] if row and row["d"] else dt.datetime.now().strftime("%Y-%m-%d")


def _add_days(iso, days):
    d = dt.datetime.strptime(iso, "%Y-%m-%d") + dt.timedelta(days=days)
    return d.strftime("%Y-%m-%d")


def _days_between(a_iso, b_iso):
    a = dt.datetime.strptime(a_iso, "%Y-%m-%d")
    b = dt.datetime.strptime(b_iso, "%Y-%m-%d")
    return (b - a).days


def _usable_rows():
    return [dict(r) for r in db.query("SELECT * FROM listings WHERE price_status != 'missing'")]


def _in_range(row, start, end):
    return row["record_date"] and start <= row["record_date"] <= end


def _pct_change(curr, prior):
    if prior in (None, 0) or curr is None:
        return None
    return ((curr - prior) / abs(prior)) * 100


def _period_kpis(rows, market=None):
    txns = [r for r in rows if r["record_type"] == "transaction" and (not market or r["market"] == market)]
    avails = [r for r in rows if r["record_type"] == "availability" and (not market or r["market"] == market)]
    sale_txns = [r for r in txns if r["price_deal_type"] == "sale" and r["price_unit"] == "total" and r["price_amount"] is not None]
    total_volume = sum(r["price_amount"] for r in sale_txns)
    return {
        "deals_closed": len(txns),
        "new_availabilities": len(avails),
        "total_volume": total_volume,
        "avg_deal_size": total_volume / len(sale_txns) if sale_txns else None,
        "sale_comp_count": len(sale_txns),
    }


def _avg_per_acre(rows):
    with_acre = [r for r in rows if r["price_deal_type"] == "sale" and r["price_unit"] == "total" and r["acres"] and r["price_amount"] is not None]
    if not with_acre:
        return None
    return sum(r["price_amount"] / r["acres"] for r in with_acre) / len(with_acre)


def _build_monthly_series(rows, months_back=9):
    now = get_latest_date()
    y, m = int(now[:4]), int(now[5:7])
    months = []
    for i in range(months_back - 1, -1, -1):
        mm = m - i
        yy = y
        while mm <= 0:
            mm += 12
            yy -= 1
        months.append(f"{yy:04d}-{mm:02d}")

    by_month = {mo: {"month": mo, "transactions": 0, "availabilities": 0, "volume": 0} for mo in months}
    for r in rows:
        if not r["record_date"]:
            continue
        mo = r["record_date"][:7]
        if mo not in by_month:
            continue
        b = by_month[mo]
        if r["record_type"] == "transaction":
            b["transactions"] += 1
            if r["price_deal_type"] == "sale" and r["price_unit"] == "total" and r["price_amount"]:
                b["volume"] += r["price_amount"]
        else:
            b["availabilities"] += 1
    return [by_month[mo] for mo in months]


def _build_insights(rows, current, prior, latest_batch):
    insights = []

    current_sales = [r for r in current if r["record_type"] == "transaction" and r["price_deal_type"] == "sale" and r["price_unit"] == "total" and r["price_amount"]]
    if current_sales:
        biggest = max(current_sales, key=lambda r: r["price_amount"])
        insights.append({
            "type": "biggest_deal", "severity": "info",
            "text": f"Largest sale in the last {PERIOD_DAYS} days: {biggest['address']} ({biggest['municipality']}) at ${round(biggest['price_amount']):,}.",
        })

    markets = sorted({r["market"] for r in rows})
    types = ["Low Coverage", "Land"]
    biggest_move = None
    for mkt in markets:
        for typ in types:
            curr = _avg_per_acre([r for r in current if r["market"] == mkt and r["type_of_land_normalized"] == typ])
            pri = _avg_per_acre([r for r in prior if r["market"] == mkt and r["type_of_land_normalized"] == typ])
            change = _pct_change(curr, pri)
            if change is not None and (biggest_move is None or abs(change) > abs(biggest_move["change"])):
                biggest_move = {"market": mkt, "type": typ, "change": change, "curr": curr, "pri": pri}
    if biggest_move:
        direction = "up" if biggest_move["change"] >= 0 else "down"
        insights.append({
            "type": "price_move", "severity": "high" if abs(biggest_move["change"]) > 15 else "info",
            "text": f"{biggest_move['market']} {biggest_move['type']} avg $/acre is {direction} {abs(biggest_move['change']):.0f}% "
                    f"vs the prior {PERIOD_DAYS} days (${round(biggest_move['pri']):,} → ${round(biggest_move['curr']):,}).",
        })

    vendor_counts = {}
    for r in rows:
        if r["record_type"] != "transaction" or not r["vendor_normalized"] or r["vendor_normalized"] == "Unknown":
            continue
        vendor_counts[r["vendor_normalized"]] = vendor_counts.get(r["vendor_normalized"], 0) + 1
    repeat_vendors = sorted([(k, v) for k, v in vendor_counts.items() if v >= 2], key=lambda kv: -kv[1])
    if repeat_vendors:
        extra = f" ({len(repeat_vendors)} vendors total with 2+ deals.)" if len(repeat_vendors) > 1 else ""
        insights.append({
            "type": "repeat_vendor", "severity": "info",
            "text": f"{repeat_vendors[0][0]} has {repeat_vendors[0][1]} deals on file — worth a closer look as a repeat principal.{extra}",
        })

    active_avail = [r for r in rows if r["record_type"] == "availability" and r["first_seen_date"]]
    if active_avail:
        now = get_latest_date()
        with_age = [(r, _days_between(r["first_seen_date"], now)) for r in active_avail]
        oldest, age = max(with_age, key=lambda t: t[1])
        if age >= 14:
            insights.append({
                "type": "stale_listing", "severity": "high" if age > 90 else "info",
                "text": f"{oldest['address']} ({oldest['municipality']}) has been tracked as available for {age} days — longest currently on file.",
            })

    if latest_batch:
        new_in_last = [r for r in rows if r["first_seen_batch_id"] == latest_batch["id"]]
        updated_in_last = [r for r in rows if r["last_seen_batch_id"] == latest_batch["id"] and r["first_seen_batch_id"] != latest_batch["id"]]
        if new_in_last or updated_in_last:
            insights.append({
                "type": "last_import", "severity": "info",
                "text": f'Last import ("{latest_batch["filename"]}") added {len(new_in_last)} new listing(s) and refreshed {len(updated_in_last)} already-tracked one(s).',
            })

    needs_review = sum(1 for r in rows if r["needs_review"])
    if needs_review > 0:
        insights.append({
            "type": "data_quality", "severity": "high" if needs_review > 20 else "medium",
            "text": f"{needs_review} listing(s) still need review before they're fully trusted in the averages above.",
        })

    return insights


def get_pulse():
    rows = _usable_rows()
    now = get_latest_date()
    period_start = _add_days(now, -PERIOD_DAYS)
    prior_start = _add_days(now, -PERIOD_DAYS * 2)

    current = [r for r in rows if _in_range(r, period_start, now)]
    prior = [r for r in rows if _in_range(r, prior_start, period_start)]

    overall = {"current": _period_kpis(current), "prior": _period_kpis(prior)}
    by_market = {}
    for mkt in sorted({r["market"] for r in rows}):
        by_market[mkt] = {"current": _period_kpis(current, mkt), "prior": _period_kpis(prior, mkt)}

    latest_batch_row = db.query_one("SELECT * FROM import_batches ORDER BY id DESC LIMIT 1")
    latest_batch = dict(latest_batch_row) if latest_batch_row else None

    recent_rows = db.query(
        "SELECT * FROM listings WHERE date_flagged = 0 ORDER BY record_date DESC, updated_at DESC LIMIT 15"
    )
    recent_activity = [dict(r) for r in recent_rows]

    return {
        "as_of": now,
        "period_days": PERIOD_DAYS,
        "overall": overall,
        "by_market": by_market,
        "trend": _build_monthly_series(rows),
        "insights": _build_insights(rows, current, prior, latest_batch),
        "recent_activity": recent_activity,
        "total_listings": len(rows),
        "total_transactions": sum(1 for r in rows if r["record_type"] == "transaction"),
        "total_availabilities": sum(1 for r in rows if r["record_type"] == "availability"),
        "needs_review_count": sum(1 for r in rows if r["needs_review"]),
        "last_import": latest_batch,
    }
