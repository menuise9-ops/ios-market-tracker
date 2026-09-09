"""Dates, sq ft/acres, taxes, vendor name normalization — ported from
fieldParsers.js.
"""

import re
import datetime as dt

DATE_SANITY_MIN_YEAR = 2020


def parse_numeric_field(raw):
    """Sq.Ft. / Acres: None (not 0) when unparseable, e.g. 'N/A', 'None - MPAC'."""
    if raw is None:
        return {"value": None, "raw": None}
    if isinstance(raw, (int, float)):
        return {"value": float(raw), "raw": str(raw)}
    s = str(raw).strip()
    if s == "":
        return {"value": None, "raw": s}
    cleaned = s.replace(",", "")
    if re.match(r"^-?\d+(\.\d+)?$", cleaned):
        return {"value": float(cleaned), "raw": s}
    return {"value": None, "raw": s}


def parse_coverage_pct(raw):
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        return float(raw) if raw <= 1 else float(raw) / 100
    s = str(raw).strip()
    m = re.match(r"^(-?\d+(\.\d+)?)\s*%$", s)
    if m:
        return float(m.group(1)) / 100
    return None


def parse_taxes_numeric(raw):
    if raw is None:
        return None
    s = str(raw).strip()
    if s == "" or re.match(r"^n/?a$", s, re.I):
        return None
    if "%" in s and re.search(r"of\s+\w+", s, re.I):
        return None  # "50% of Hydro Bill" — narrative, don't guess
    m = re.search(r"\$?\s*([\d,]+(?:\.\d+)?)", s)
    if not m:
        return None
    try:
        return float(m.group(1).replace(",", ""))
    except ValueError:
        return None


def parse_date_field(raw):
    """Returns {iso, raw, flagged}. flagged=True when the parsed year is
    outside [MIN_YEAR, current_year+1] — e.g. the known '2206' instead of
    '2026' typo — so it's caught, not silently kept or discarded.
    """
    now_year = dt.datetime.now().year
    max_year = now_year + 1

    d = None
    raw_str = ""
    if isinstance(raw, dt.datetime):
        d = raw
        raw_str = raw.isoformat()
    elif isinstance(raw, dt.date):
        d = dt.datetime(raw.year, raw.month, raw.day)
        raw_str = raw.isoformat()
    elif isinstance(raw, (int, float)):
        # Excel serial date (days since 1899-12-30)
        raw_str = str(raw)
        try:
            d = dt.datetime(1899, 12, 30) + dt.timedelta(days=raw)
        except (OverflowError, ValueError):
            d = None
    elif isinstance(raw, str) and raw.strip() != "":
        raw_str = raw
        for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%m/%d/%Y", "%m/%d/%y", "%Y-%m-%d %H:%M:%S"):
            try:
                d = dt.datetime.strptime(raw.strip(), fmt)
                break
            except ValueError:
                continue
    elif raw is None:
        raw_str = ""

    if d is None:
        return {"iso": None, "raw": raw_str, "flagged": False}

    year = d.year
    flagged = year < DATE_SANITY_MIN_YEAR or year > max_year
    return {"iso": d.strftime("%Y-%m-%d"), "raw": raw_str, "flagged": flagged}


def normalize_vendor(raw):
    if raw is None:
        return {"raw": None, "normalized": None}
    s = str(raw).replace("\xa0", " ").strip()
    if s == "":
        return {"raw": s, "normalized": None}
    if re.match(r"^unknown$", s, re.I):
        return {"raw": s, "normalized": "Unknown"}
    normalized = re.sub(r"\s+", " ", s)
    normalized = re.sub(r"[.,]+$", "", normalized).upper()
    return {"raw": s, "normalized": normalized}
