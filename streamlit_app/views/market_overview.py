import streamlit as st

from lib.overview import get_overview, MARKETS, TYPES
from lib import db
from lib.fmt import fmt_money


def _metric_line(label, stat):
    if not stat or stat["n"] == 0:
        st.caption(f"{label}: *no comps (n=0)*")
        return
    st.markdown(
        f"<span style='color:#64748b'>{label}:</span> <b>{fmt_money(stat['avg'])}</b> "
        f"<span style='color:#94a3b8;font-size:12px'>(n={stat['n']}, {fmt_money(stat['min'])}–{fmt_money(stat['max'])})</span>",
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
    idx = 0
    n_cols = 4
    grid = st.columns(n_cols)
    for mkt in show_markets:
        for typ in TYPES:
            with grid[idx % n_cols]:
                with st.container(border=True):
                    st.markdown(f"**{labels.get(mkt, mkt)}** <span style='color:#94a3b8'>· {typ}</span>", unsafe_allow_html=True)
                    for status, title in [("available", "AVAILABLE"), ("sold", "SOLD")]:
                        cell = data["cells"][f"{mkt}|{typ}|{status}"]
                        st.markdown(f"<div style='font-size:11px;font-weight:600;color:#64748b;margin-top:8px'>{title} ({cell['total_listings']})</div>", unsafe_allow_html=True)
                        _metric_line("Avg sale price", cell["avg_sale_price"])
                        _metric_line("Avg $/SF net", cell["avg_lease_sf_net"])
                        _metric_line("Avg $/SF gross", cell["avg_lease_sf_gross"])
                        _metric_line("Avg $/acre", cell["avg_per_acre"])
            idx += 1
