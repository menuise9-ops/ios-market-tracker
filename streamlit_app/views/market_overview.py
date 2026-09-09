import streamlit as st

from lib.overview import get_overview, MARKETS, TYPES
from lib import db
from lib.fmt import fmt_money, esc_md

STAT_ROWS = [
    ("Avg sale price", "avg_sale_price"),
    ("Avg $/SF net", "avg_lease_sf_net"),
    ("Avg $/SF gross", "avg_lease_sf_gross"),
    ("Avg $/acre", "avg_per_acre"),
]


def _metric_line(label, stat):
    """Note: money values go through esc_md() before hitting st.markdown —
    Streamlit auto-renders `$...$` as LaTeX whenever two dollar signs end up
    flush against non-space text (which four dollar-formatted numbers on
    one line does constantly), so an un-escaped '$' here silently mangles
    the whole card into stray tag text. See lib/fmt.py for the full story.
    """
    st.markdown(
        f"<span style='color:#64748b;font-size:13px'>{esc_md(label)}</span><br>"
        f"<b style='font-size:15px'>{esc_md(fmt_money(stat['avg']))}</b> "
        f"<span style='color:#94a3b8;font-size:12px'>(n={stat['n']}, {esc_md(fmt_money(stat['min']))}–{esc_md(fmt_money(stat['max']))})</span>",
        unsafe_allow_html=True,
    )


def render(config):
    labels = config["market_labels"]
    st.title("Market Overview")

    col1, col2, col3 = st.columns(3)
    market = col1.selectbox("Market", ["All"] + MARKETS, format_func=lambda m: "All Markets" if m == "All" else f"{labels.get(m, m)} ({m})")
    munis = db.query(
        "SELECT DISTINCT municipality FROM listings WHERE municipality IS NOT NULL"
        + (" AND market = ?" if market != "All" else "") + " ORDER BY municipality",
        (market,) if market != "All" else (),
    )
    municipality = col2.selectbox("Municipality", ["All"] + [m["municipality"] for m in munis])
    include_flagged = col3.checkbox("Include flagged/suppressed rows in averages", value=False)

    data = get_overview(
        market=None if market == "All" else market,
        municipality=None if municipality == "All" else municipality,
        include_flagged=include_flagged,
    )
    st.caption(
        f"{data['excluded_count']} of {data['total_rows']} matching row(s) excluded from averages "
        f"{'' if include_flagged else '(needs-review / suppressed / missing price)'} — toggle above to include them."
    )

    show_markets = MARKETS if market == "All" else [market]
    n_cols = min(4, max(1, len(show_markets) * len(TYPES)))
    grid = st.columns(n_cols)
    idx = 0
    for mkt in show_markets:
        for typ in TYPES:
            with grid[idx % n_cols]:
                with st.container(border=True):
                    st.markdown(f"**{labels.get(mkt, mkt)}** <span style='color:#94a3b8'>· {typ}</span>", unsafe_allow_html=True)
                    for status, title in [("available", "Available"), ("sold", "Sold")]:
                        cell = data["cells"][f"{mkt}|{typ}|{status}"]
                        st.markdown(
                            f"<div style='font-size:11px;font-weight:600;color:#64748b;"
                            f"text-transform:uppercase;margin-top:10px;border-top:1px solid #f1f5f9;padding-top:6px'>"
                            f"{title} · {cell['total_listings']} listing(s)</div>",
                            unsafe_allow_html=True,
                        )
                        rows_with_data = [(label, cell[key]) for label, key in STAT_ROWS if cell[key]["n"] > 0]
                        if not rows_with_data:
                            st.caption("No comps yet.")
                            continue
                        for label, stat in rows_with_data:
                            _metric_line(label, stat)
            idx += 1
