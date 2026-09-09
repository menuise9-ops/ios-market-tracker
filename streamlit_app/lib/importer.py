"""Excel importer — ported from importer.js. Sheet/column matching by
header text (never fixed index), dedup/upsert logic, price/date/type
parsing per row. See the big comment above `resolve_match()` for the one
deliberate deviation from a literal reading of CLAUDE.md's dedup spec.
"""

import hashlib
import json
import os
import shutil
import datetime as dt
import openpyxl

from . import db
from .price_parser import parse_price
from .type_normalizer import normalize_type_of_land
from .field_parsers import (
    parse_numeric_field,
    parse_coverage_pct,
    parse_taxes_numeric,
    parse_date_field,
    normalize_vendor,
)

RESALE_MAX_DAYS_SAME_EVENT = 45
RESALE_MAX_PRICE_DELTA_FRACTION = 0.05

SHEET_TYPES = [
    ("MWO", "transaction", lambda n: n.startswith("mwo") and "transact" in n),
    ("MWO", "availability", lambda n: n.startswith("mwo") and "availab" in n),
    ("SWO", "transaction", lambda n: n.startswith("swo") and "transact" in n),
    ("SWO", "availability", lambda n: n.startswith("swo") and "availab" in n),
    ("Non-Core GTA", "transaction", lambda n: _is_noncore(n) and "transact" in n),
    ("Non-Core GTA", "availability", lambda n: _is_noncore(n) and "availab" in n),
    ("Core GTA", "transaction", lambda n: n.startswith("core gta") and "transact" in n),
    ("Core GTA", "availability", lambda n: n.startswith("core gta") and "availab" in n),
]


def _is_noncore(n):
    return "non-core gta" in n or "non core gta" in n


def normalize_sheet_name(name):
    return " ".join((name or "").strip().split()).lower()


def match_sheet_type(sheet_name):
    norm = normalize_sheet_name(sheet_name)
    for market, record_type, test in SHEET_TYPES:
        if test(norm):
            return market, record_type
    return None


HEADER_VARIANTS = {
    "type_of_land": ["type of land"],
    "sqft": ["sq. ft.", "sq ft", "sq.ft.", "sqft", "sq. ft"],
    "acres": ["acres"],
    "coverage_pct": ["building coverage % (when applicable)", "building coverage %", "building coverage"],
    "date": ["transaction date", "list date", "last updated date", "date"],
    "address": ["address"],
    "municipality": ["municipality"],
    "price": ["price"],
    "taxes": ["taxes/tmi", "taxes / tmi", "taxes"],
    "zoning": ["zoning"],
    "vendor": ["vendor", "purchasor", "seller"],
    "notes": ["notes"],
}


def normalize_header(h):
    return " ".join(str(h if h is not None else "").strip().split()).lower()


def build_column_map(header_row):
    normalized = [normalize_header(h) for h in header_row]
    col_map = {}
    for field, variants in HEADER_VARIANTS.items():
        idx = -1
        for variant in variants:
            if variant in normalized:
                idx = normalized.index(variant)
                break
        col_map[field] = idx
    return col_map


def is_row_empty(row):
    return all(c is None or str(c).strip() == "" for c in row)


def cell(row, idx):
    if idx is None or idx < 0 or idx >= len(row):
        return None
    return row[idx]


def compute_base_key_raw(market, record_type, address, municipality, type_of_land_normalized):
    def norm(s):
        if s is None:
            return ""
        s = str(s).strip().lower()
        s = s.replace(".", "").replace(",", "")
        return " ".join(s.split())

    return "|".join([market, record_type, norm(address), norm(municipality), type_of_land_normalized or ""])


def sha1(s):
    return hashlib.sha1(s.encode("utf-8")).hexdigest()


def days_between(iso_a, iso_b):
    if not iso_a or not iso_b:
        return float("inf")
    a = dt.datetime.strptime(iso_a, "%Y-%m-%d")
    b = dt.datetime.strptime(iso_b, "%Y-%m-%d")
    return abs((b - a).days)


def resolve_match(record_type, base_key_raw, new_date_iso, new_price_amount):
    """See importer.js's `resolveMatch` for the full rationale: availabilities
    match on identity alone (a persisting listing updates in place); a
    transaction only matches an existing row if date+price look like the
    same event, otherwise it's treated as a distinct sale (e.g. a resale)
    and inserted under a disambiguated key, flagged for review.
    """
    base_hash = sha1(base_key_raw)
    existing = db.query_one("SELECT * FROM listings WHERE source_key = ?", (base_hash,))

    if existing is None:
        return {"mode": "insert", "source_key": base_hash, "existing": None, "flag_reason": None}

    if record_type == "availability":
        return {"mode": "update", "source_key": base_hash, "existing": existing, "flag_reason": None}

    day_diff = days_between(existing["record_date"], new_date_iso)
    price_close = True
    if existing["price_amount"] is not None and new_price_amount is not None and existing["price_amount"] != 0:
        price_close = abs(existing["price_amount"] - new_price_amount) / abs(existing["price_amount"]) <= RESALE_MAX_PRICE_DELTA_FRACTION

    if day_diff <= RESALE_MAX_DAYS_SAME_EVENT and price_close:
        return {"mode": "update", "source_key": base_hash, "existing": existing, "flag_reason": None}

    disambiguated_hash = sha1(f"{base_key_raw}#{new_date_iso or 'unknown-date'}")
    existing_disambiguated = db.query_one("SELECT * FROM listings WHERE source_key = ?", (disambiguated_hash,))
    if existing_disambiguated is not None:
        return {"mode": "update", "source_key": disambiguated_hash, "existing": existing_disambiguated, "flag_reason": None}

    return {
        "mode": "insert_flagged",
        "source_key": disambiguated_hash,
        "existing": None,
        "flag_reason": (
            f"Possible resale: a {record_type} already on file at this address/type has a different date "
            f"and/or price (existing: {existing['record_date']}, "
            f"${existing['price_amount'] if existing['price_amount'] is not None else 'n/a'}). "
            "Confirm this is a separate transaction, not a duplicate/correction."
        ),
    }


def apply_overrides(source_key, row):
    overrides = db.query("SELECT field, value FROM manual_overrides WHERE source_key = ?", (source_key,))
    for o in overrides:
        field, value = o["field"], o["value"]
        if value == "null":
            row[field] = None
        else:
            try:
                if isinstance(row.get(field), (int, float)):
                    row[field] = float(value)
                else:
                    row[field] = value
            except (TypeError, ValueError):
                row[field] = value
    return row


def archive_raw_file(file_path):
    os.makedirs(db.RAW_DIR, exist_ok=True)
    base = os.path.basename(file_path)
    dest = os.path.join(db.RAW_DIR, base)
    if os.path.exists(dest):
        with open(dest, "rb") as f1, open(file_path, "rb") as f2:
            if f1.read() == f2.read():
                return dest
        stem, ext = os.path.splitext(base)
        n = 2
        while os.path.exists(os.path.join(db.RAW_DIR, f"{stem} ({n}){ext}")):
            n += 1
        dest = os.path.join(db.RAW_DIR, f"{stem} ({n}){ext}")
    shutil.copyfile(file_path, dest)
    return dest


INSERT_SQL = """
INSERT INTO listings (
  source_key, record_type, market, sheet_name_raw, municipality, address,
  type_of_land_raw, type_of_land_normalized, sqft, sqft_raw, acres, acres_raw,
  building_coverage_pct, record_date, record_date_raw, date_flagged,
  price_raw, price_status, price_deal_type, price_amount, price_unit, price_basis,
  price_confidence, price_review_reason, taxes_raw, taxes_numeric, zoning,
  vendor_raw, vendor_normalized, notes, needs_review, review_reasons,
  first_seen_date, last_seen_date, first_seen_batch_id, last_seen_batch_id
) VALUES (
  :source_key, :record_type, :market, :sheet_name_raw, :municipality, :address,
  :type_of_land_raw, :type_of_land_normalized, :sqft, :sqft_raw, :acres, :acres_raw,
  :building_coverage_pct, :record_date, :record_date_raw, :date_flagged,
  :price_raw, :price_status, :price_deal_type, :price_amount, :price_unit, :price_basis,
  :price_confidence, :price_review_reason, :taxes_raw, :taxes_numeric, :zoning,
  :vendor_raw, :vendor_normalized, :notes, :needs_review, :review_reasons,
  :first_seen_date, :last_seen_date, :first_seen_batch_id, :last_seen_batch_id
)
"""

UPDATE_SQL = """
UPDATE listings SET
  record_date = :record_date, record_date_raw = :record_date_raw, date_flagged = :date_flagged,
  sqft = :sqft, sqft_raw = :sqft_raw, acres = :acres, acres_raw = :acres_raw,
  building_coverage_pct = :building_coverage_pct,
  price_raw = :price_raw, price_status = :price_status, price_deal_type = :price_deal_type,
  price_amount = :price_amount, price_unit = :price_unit, price_basis = :price_basis,
  price_confidence = :price_confidence, price_review_reason = :price_review_reason,
  taxes_raw = :taxes_raw, taxes_numeric = :taxes_numeric, zoning = :zoning,
  vendor_raw = :vendor_raw, vendor_normalized = :vendor_normalized, notes = :notes,
  needs_review = :needs_review, review_reasons = :review_reasons,
  last_seen_date = :last_seen_date, last_seen_batch_id = :last_seen_batch_id,
  updated_at = datetime('now')
WHERE source_key = :source_key
"""


def import_file(file_path):
    archived_path = archive_raw_file(file_path)
    conn = db.get_conn()

    cur = conn.execute(
        "INSERT INTO import_batches (filename, archived_path) VALUES (?, ?)",
        (os.path.basename(file_path), archived_path),
    )
    batch_id = cur.lastrowid
    batch_date_iso = dt.datetime.now().strftime("%Y-%m-%d")

    confirmed_patterns = {r["reason_code"] for r in db.query("SELECT reason_code FROM pattern_confirmations")}

    rows_added = rows_updated = rows_flagged = rows_skipped = 0
    flagged_rows = []
    min_date = max_date = None
    unmatched_sheets = []

    wb = openpyxl.load_workbook(file_path, read_only=True, data_only=True)
    for sheet_name in wb.sheetnames:
        sheet_type = match_sheet_type(sheet_name)
        if sheet_type is None:
            unmatched_sheets.append(sheet_name)
            continue
        market, record_type = sheet_type
        ws = wb[sheet_name]
        rows_iter = ws.iter_rows(values_only=True)
        try:
            header_row = next(rows_iter)
        except StopIteration:
            continue
        col_map = build_column_map(header_row)

        for row in rows_iter:
            if is_row_empty(row):
                break  # stop at first fully-empty row

            address = cell(row, col_map["address"])
            if address is None or str(address).strip() == "":
                rows_skipped += 1
                continue

            type_info = normalize_type_of_land(cell(row, col_map["type_of_land"]))
            sqft_info = parse_numeric_field(cell(row, col_map["sqft"]))
            acres_info = parse_numeric_field(cell(row, col_map["acres"]))
            coverage_pct = parse_coverage_pct(cell(row, col_map["coverage_pct"]))
            date_info = parse_date_field(cell(row, col_map["date"]))
            price_raw = cell(row, col_map["price"])
            price_info = parse_price(price_raw, sqft=sqft_info["value"], acres=acres_info["value"])
            if price_info["status"] == "needs_review" and price_info["reason_code"] in confirmed_patterns:
                price_info = {**price_info, "status": "parsed", "confidence": "high", "review_reason": None}
            taxes_raw = cell(row, col_map["taxes"])
            taxes_numeric = parse_taxes_numeric(taxes_raw)
            zoning = cell(row, col_map["zoning"])
            vendor_info = normalize_vendor(cell(row, col_map["vendor"]))
            notes = cell(row, col_map["notes"])
            municipality = cell(row, col_map["municipality"])

            review_reasons = []
            if type_info["normalized"] is None and type_info["raw"]:
                review_reasons.append({"code": "unrecognized_type_of_land", "text": f'Unrecognized Type of Land value: "{type_info["raw"]}".'})
            if date_info["flagged"]:
                review_reasons.append({"code": "date_out_of_range", "text": f'Date looks wrong (parsed year out of sane range): "{date_info["raw"]}".'})
            if price_info["status"] == "needs_review":
                review_reasons.append({"code": price_info["reason_code"], "text": price_info["review_reason"]})

            base_key_raw = compute_base_key_raw(market, record_type, address, municipality, type_info["normalized"])
            match = resolve_match(record_type, base_key_raw, date_info["iso"], price_info["amount"])
            if match["flag_reason"]:
                review_reasons.append({"code": "possible_resale", "text": match["flag_reason"]})

            row_obj = {
                "source_key": match["source_key"],
                "record_type": record_type,
                "market": market,
                "sheet_name_raw": sheet_name,
                "municipality": str(municipality).strip() if municipality is not None else None,
                "address": str(address).strip(),
                "type_of_land_raw": type_info["raw"],
                "type_of_land_normalized": type_info["normalized"],
                "sqft": sqft_info["value"],
                "sqft_raw": sqft_info["raw"],
                "acres": acres_info["value"],
                "acres_raw": acres_info["raw"],
                "building_coverage_pct": coverage_pct,
                "record_date": date_info["iso"],
                "record_date_raw": date_info["raw"],
                "date_flagged": 1 if date_info["flagged"] else 0,
                "price_raw": price_info["raw"],
                "price_status": price_info["status"],
                "price_deal_type": price_info["deal_type"],
                "price_amount": price_info["amount"],
                "price_unit": price_info["unit"],
                "price_basis": price_info["basis"],
                "price_confidence": price_info["confidence"],
                "price_review_reason": price_info["review_reason"],
                "taxes_raw": None if taxes_raw is None else str(taxes_raw),
                "taxes_numeric": taxes_numeric,
                "zoning": None if zoning is None else str(zoning).strip(),
                "vendor_raw": vendor_info["raw"],
                "vendor_normalized": vendor_info["normalized"],
                "notes": None if notes is None else str(notes),
                "needs_review": 1 if review_reasons else 0,
                "review_reasons": json.dumps(review_reasons) if review_reasons else None,
                "last_seen_date": batch_date_iso,
                "last_seen_batch_id": batch_id,
            }

            row_obj = apply_overrides(match["source_key"], row_obj)

            if date_info["iso"]:
                if min_date is None or date_info["iso"] < min_date:
                    min_date = date_info["iso"]
                if max_date is None or date_info["iso"] > max_date:
                    max_date = date_info["iso"]

            if match["mode"] in ("insert", "insert_flagged"):
                row_obj["first_seen_date"] = batch_date_iso
                row_obj["first_seen_batch_id"] = batch_id
                conn.execute(INSERT_SQL, row_obj)
                rows_added += 1
                if row_obj["needs_review"]:
                    rows_flagged += 1
                    flagged_rows.append({"source_key": match["source_key"], "address": row_obj["address"], "reasons": review_reasons})
            else:
                conn.execute(UPDATE_SQL, row_obj)
                rows_updated += 1
                if row_obj["needs_review"]:
                    rows_flagged += 1
                    flagged_rows.append({"source_key": match["source_key"], "address": row_obj["address"], "reasons": review_reasons})

    conn.execute(
        "UPDATE import_batches SET date_range_start=?, date_range_end=?, rows_added=?, rows_updated=?, rows_flagged=?, rows_skipped=? WHERE id=?",
        (min_date, max_date, rows_added, rows_updated, rows_flagged, rows_skipped, batch_id),
    )
    conn.commit()
    wb.close()

    return {
        "batch_id": batch_id,
        "filename": os.path.basename(file_path),
        "archived_path": archived_path,
        "rows_added": rows_added,
        "rows_updated": rows_updated,
        "rows_flagged": rows_flagged,
        "rows_skipped": rows_skipped,
        "unmatched_sheets": unmatched_sheets,
        "flagged_rows": flagged_rows,
        "date_range": {"start": min_date, "end": max_date},
    }
