"""Review Queue — ported from reviewQueue.js."""

import json

from . import db

EDITABLE_FIELDS = {
    "price_amount", "price_unit", "price_basis", "price_deal_type", "price_status",
    "record_date", "type_of_land_normalized", "vendor_normalized", "notes",
}


def list_review_queue():
    rows = db.query("SELECT * FROM listings WHERE needs_review = 1 ORDER BY updated_at DESC")
    out = []
    for r in rows:
        d = dict(r)
        d["review_reasons"] = json.loads(d["review_reasons"]) if d["review_reasons"] else []
        out.append(d)
    return out


def resolve_review_item(source_key, updates=None, confirm_pattern_code=None):
    updates = updates or {}
    existing = db.query_one("SELECT * FROM listings WHERE source_key = ?", (source_key,))
    if existing is None:
        raise ValueError("No listing found for that source_key.")

    conn = db.get_conn()
    set_clauses = []
    params = {}
    for field, value in updates.items():
        if field not in EDITABLE_FIELDS:
            continue
        set_clauses.append(f"{field} = :{field}")
        params[field] = value
        conn.execute(
            "INSERT INTO manual_overrides (source_key, field, value, reason) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(source_key, field) DO UPDATE SET value = excluded.value, created_at = datetime('now')",
            (source_key, field, "null" if value is None else str(value), "resolved via review queue"),
        )

    if set_clauses:
        params["source_key"] = source_key
        conn.execute(f"UPDATE listings SET {', '.join(set_clauses)} WHERE source_key = :source_key", params)
    conn.execute("UPDATE listings SET needs_review = 0, review_reasons = NULL WHERE source_key = ?", (source_key,))
    conn.commit()

    bulk_affected = 0
    if confirm_pattern_code:
        conn.execute("INSERT OR IGNORE INTO pattern_confirmations (reason_code) VALUES (?)", (confirm_pattern_code,))
        others = db.query("SELECT source_key, review_reasons FROM listings WHERE needs_review = 1 AND source_key != ?", (source_key,))
        for row in others:
            reasons = json.loads(row["review_reasons"] or "[]")
            if not any(r["code"] == confirm_pattern_code for r in reasons):
                continue
            remaining = [r for r in reasons if r["code"] != confirm_pattern_code]
            conn.execute(
                "UPDATE listings SET review_reasons = ?, needs_review = ?, "
                "price_status = CASE WHEN price_status = 'needs_review' THEN 'parsed' ELSE price_status END, "
                "price_confidence = 'high' WHERE source_key = ?",
                (json.dumps(remaining) if remaining else None, 1 if remaining else 0, row["source_key"]),
            )
            bulk_affected += 1
        conn.commit()

    return {"ok": True, "bulk_affected": bulk_affected}
