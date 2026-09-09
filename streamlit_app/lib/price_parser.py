"""Price parsing for the messy `Price` column — ported 1:1 from the Node
app's priceParser.js. Never treat Price as a single number; parse_price()
always returns a dict:

{
  "raw": str,
  "status": "parsed" | "suppressed" | "missing" | "needs_review",
  "deal_type": "sale" | "lease" | None,
  "amount": float | None,
  "unit": "total" | "per_sf" | "per_acre" | "per_month" | "per_year" | None,
  "basis": "net" | "gross" | "unspecified",
  "confidence": "high" | "low",
  "review_reason": str | None,
  "reason_code": str | None,
}
"""

import re

CONFIG = {
    # A bare, suffix-less number below this is assumed to be a $/SF lease rate.
    "bare_number_lease_ceiling": 200,
    # A bare, suffix-less number above this is assumed to be a total sale price.
    "bare_number_sale_floor": 100_000,
}

_SUPPRESSED_RE = re.compile(r"supp?ress?ed", re.I)
_MILLIONS_RE = re.compile(r"\$?\s*([\d.]+)\s*[Mm]\b")
_PLAIN_NUMBER_RE = re.compile(r"^-?\d+(\.\d+)?$")
_NUMBER_RE = re.compile(r"\$?\s*([\d,]+(?:\.\d+)?)")

_PER_ACRE_RE = re.compile(r"/\s*acre", re.I)
_PER_SF_RE = re.compile(r"/\s*(sft|sf|sq\s*\.?\s*ft|ft)\b", re.I)
_PSF_RE = re.compile(r"\bpsf\b", re.I)
_PER_MONTH_RE = re.compile(r"/\s*month\b|\bmonth\b", re.I)
_PER_YEAR_RE = re.compile(r"/\s*(yr|year)\b", re.I)
_PER_SF_PER_YEAR_RE = re.compile(r"/\s*(sft|sf|sq\s*\.?\s*ft|ft)\s*/\s*(yr|year)", re.I)
_NET_RE = re.compile(r"\bnet\b", re.I)
_GROSS_RE = re.compile(r"\bgross\b", re.I)


def _clean_number_string(s):
    return s.replace("$", "").replace(",", "").strip()


def _parse_abbreviated_millions(raw):
    m = _MILLIONS_RE.search(raw)
    if not m:
        return None
    try:
        return float(m.group(1)) * 1_000_000
    except ValueError:
        return None


def _parse_plain_number(s):
    cleaned = _clean_number_string(s)
    if not _PLAIN_NUMBER_RE.match(cleaned):
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def _detect_unit_and_basis(raw):
    unit = None
    basis = "unspecified"

    if _PER_ACRE_RE.search(raw):
        unit = "per_acre"
    elif _PER_SF_RE.search(raw) or _PSF_RE.search(raw):
        unit = "per_sf"
    elif _PER_MONTH_RE.search(raw):
        unit = "per_month"
    elif _PER_YEAR_RE.search(raw):
        unit = "per_year"

    if _PER_SF_PER_YEAR_RE.search(raw):
        unit = "per_sf"

    if _NET_RE.search(raw):
        basis = "net"
    elif _GROSS_RE.search(raw):
        basis = "gross"

    if unit is None and basis == "unspecified":
        return None
    return {"unit": unit, "basis": basis}


def parse_price(raw_value, sqft=None, acres=None):
    raw_original = "" if raw_value is None else str(raw_value)
    trimmed = raw_original.strip()

    base = {
        "raw": raw_original,
        "status": "missing",
        "deal_type": None,
        "amount": None,
        "unit": None,
        "basis": "unspecified",
        "confidence": "high",
        "review_reason": None,
        "reason_code": None,
    }

    if trimmed == "" or re.match(r"^fill in price$", trimmed, re.I) or re.match(r"^n/?a$", trimmed, re.I):
        return {**base, "status": "missing"}

    # --- Suppressed (with or without an embedded list price) ---
    if _SUPPRESSED_RE.search(trimmed):
        embedded_m = _parse_abbreviated_millions(trimmed)
        embedded_plain = None
        if embedded_m is None:
            stripped = _SUPPRESSED_RE.sub("", trimmed)
            stripped = re.sub(r"[-:]", "", stripped)
            stripped = re.sub(r"list", "", stripped, flags=re.I)
            embedded_plain = _parse_plain_number(stripped)
        amount = embedded_m if embedded_m is not None else embedded_plain
        return {
            **base,
            "status": "suppressed",
            "deal_type": "sale",
            "amount": amount,
            "unit": "total" if amount is not None else None,
            "confidence": "high",
            "review_reason": (
                "Sale price suppressed; amount shown is the ASKING/list price, not a confirmed sale price."
                if amount is not None
                else "Sale price suppressed with no list price disclosed."
            ),
            "reason_code": "suppressed_with_list" if amount is not None else "suppressed_no_list",
        }

    # --- Abbreviated millions: "$1.65M" / "$2.387M" ---
    millions = _parse_abbreviated_millions(trimmed)
    if millions is not None:
        return {**base, "status": "parsed", "deal_type": "sale", "amount": millions, "unit": "total"}

    # --- Suffix-keyword driven detection (high confidence) ---
    unit_basis = _detect_unit_and_basis(trimmed)
    if unit_basis is not None:
        num_match = _NUMBER_RE.search(trimmed)
        amount = float(num_match.group(1).replace(",", "")) if num_match else None

        deal_type = "lease" if unit_basis["unit"] else (
            "sale" if amount is not None and amount > CONFIG["bare_number_sale_floor"] else "lease"
        )

        status = "parsed"
        review_reason = None
        reason_code = None

        if unit_basis["basis"] == "net" and not unit_basis["unit"]:
            status = "needs_review"
            review_reason = "Net lease amount given with no unit (per SF / per month / per year) — basis is ambiguous."
            reason_code = "net_no_unit"
        if unit_basis["basis"] == "gross" and not unit_basis["unit"]:
            status = "needs_review"
            review_reason = "Gross lease amount given with no unit — assumed per-month, please confirm."
            reason_code = "gross_no_unit"
        if unit_basis["unit"] == "per_sf" and unit_basis["basis"] == "unspecified":
            status = "needs_review"
            review_reason = "Per-SF lease rate with no net/gross basis stated."
            reason_code = "per_sf_no_basis"

        unit = unit_basis["unit"] or ("per_month" if unit_basis["basis"] == "gross" else None)
        return {
            **base,
            "status": status,
            "deal_type": deal_type,
            "amount": amount,
            "unit": unit,
            "basis": unit_basis["basis"],
            "confidence": "high",
            "review_reason": review_reason,
            "reason_code": reason_code,
        }

    # --- Bare number, no suffix at all ---
    bare = _parse_plain_number(trimmed)
    if bare is not None:
        if bare > CONFIG["bare_number_sale_floor"]:
            return {
                **base,
                "status": "needs_review",
                "deal_type": "sale",
                "amount": bare,
                "unit": "total",
                "confidence": "low",
                "review_reason": f"Bare number > {CONFIG['bare_number_sale_floor']:,} with no currency/unit suffix — assumed total sale price.",
                "reason_code": "bare_large_number_sale",
            }
        if bare < CONFIG["bare_number_lease_ceiling"] and (sqft or acres):
            return {
                **base,
                "status": "needs_review",
                "deal_type": "lease",
                "amount": bare,
                "unit": "per_sf",
                "confidence": "low",
                "review_reason": f"Bare number < {CONFIG['bare_number_lease_ceiling']} with no suffix — assumed $/SF lease rate.",
                "reason_code": "bare_small_number_lease",
            }
        return {
            **base,
            "status": "needs_review",
            "deal_type": None,
            "amount": bare,
            "unit": None,
            "confidence": "low",
            "review_reason": "Bare number with no suffix and no clear size context — could not confidently classify as sale price or lease rate.",
            "reason_code": "bare_number_ambiguous",
        }

    # --- Nothing matched at all ---
    return {
        **base,
        "status": "needs_review",
        "confidence": "low",
        "review_reason": f'Unrecognized price format: "{raw_original}".',
        "reason_code": "unrecognized_price_format",
    }
