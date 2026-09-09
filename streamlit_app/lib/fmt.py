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


def esc_md(s):
    """Escape a string for safe embedding inside an st.markdown(...,
    unsafe_allow_html=True) call. Streamlit auto-renders `$...$` as LaTeX
    math (KaTeX) whenever a pair of `$` each sit flush against non-space
    text — which any HTML string with two or more dollar amounts (or a
    literal '$' in a label, e.g. "Avg $/SF net") trips constantly, turning
    perfectly good HTML into mangled, spaced-out, italicized garbage with
    stray literal tag text. Swapping '$' for its HTML entity renders
    identically in the browser but is invisible to that markdown-level
    scan, since the source text no longer contains a literal '$'.
    Prefer st.metric/st.write for single values instead — they don't run
    the markdown pipeline at all, so this is only needed when you're
    building custom multi-value HTML by hand."""
    return str(s).replace("$", "&#36;")


def fmt_price_cell(row):
    """Only render as a dollar figure when the unit is a flat total —
    otherwise show the original raw string (a $/SF lease rate formatted as
    a money total reads as nonsense, e.g. '$18' for '$17.95/SF Net')."""
    if row.get("price_amount") is not None and row.get("price_unit") == "total":
        return fmt_money(row["price_amount"])
    return row.get("price_raw") or "—"
