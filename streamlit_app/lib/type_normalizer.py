"""Type of Land normalization — ported from typeNormalizer.js.

Observed raw values: "Low Coverage", "Low Coverage Property", "Low Coverage
Propety" (typo), "Land", "Improved Land", "Unimproved Land", "Unimproved".
Normalize to two canonical buckets: "Low Coverage" and "Land". Raw value is
always kept alongside the normalized one for audit.
"""

import re


def normalize_type_of_land(raw):
    if raw is None:
        return {"raw": None, "normalized": None}
    s = str(raw).strip()
    lower = s.lower()

    if lower == "":
        return {"raw": s, "normalized": None}

    if re.search(r"low\s*coverage", lower) or re.search(r"cover(a|e)ge", lower):
        return {"raw": s, "normalized": "Low Coverage"}

    if re.search(r"land", lower) or re.search(r"greenfield", lower):
        return {"raw": s, "normalized": "Land"}

    return {"raw": s, "normalized": None}
