"""Shared display formatting helpers used across views."""


def fmt_money(n, compact=False):
    if n is None:
        return "—"
    if compact:
        a = abs(n)
        if a >= 1_000_000:
            return f"${n / 1_000_000:.2f}M"
        if a >= 1_000:
            return f"${n / 1_000:.0f}K"
    return f"${round(n):,}"


def fmt_price_cell(row):
    """Only render as a dollar figure when the unit is a flat total —
    otherwise show the original raw string (a $/SF lease rate formatted as
    a money total reads as nonsense, e.g. '$18' for '$17.95/SF Net')."""
    if row.get("price_amount") is not None and row.get("price_unit") == "total":
        return fmt_money(row["price_amount"])
    return row.get("price_raw") or "—"
