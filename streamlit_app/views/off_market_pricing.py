import streamlit as st

from lib.pricing import estimate
from lib import db
from lib.fmt import fmt_money


def render(config):
    labels = config["market_labels"]
    st.title("Off-Market Pricing Tool")

    with st.container(border=True):
        c1, c2, c3, c4, c5 = st.columns(5)
        market = c1.selectbox("Market", list(labels.keys()), format_func=lambda m: labels.get(m, m))
        munis = db.query("SELECT DISTINCT municipality FROM listings WHERE market = ? AND municipality IS NOT NULL ORDER BY municipality", (market,))
        municipality = c2.selectbox("Municipality", ["Market-wide"] + [m["municipality"] for m in munis])
        type_ = c3.selectbox("Type", ["Low Coverage", "Land"])
        acres = c4.number_input("Acres", min_value=0.0, value=0.0, step=0.1)
        sqft = c5.number_input("Sq Ft", min_value=0.0, value=0.0, step=100.0)
        run = st.button("Get estimate", type="primary")

    if not run:
        return

    result = estimate(
        market, None if municipality == "Market-wide" else municipality, type_,
        acres=acres or None, sqft=sqft or None,
    )

    if result["used_market_level_fallback"]:
        st.info(f"Too few comps in that municipality — fell back to market-wide comps for {labels.get(market, market)}.")

    c1, c2 = st.columns(2)
    with c1, st.container(border=True):
        st.markdown("**Sale scenario**")
        st.caption(f"n = {result['sale']['n']} comp(s), recent-weighted (3-month half-life)")
        st.metric("Estimate", fmt_money(result["sale"]["estimate"]))
        st.write(f"Avg total (all comps): **{fmt_money(result['sale']['avg_total'])}**")
        st.write(f"Avg $/acre: **{fmt_money(result['sale']['avg_per_acre'])}**")
        st.write(f"Range: **{fmt_money(result['sale']['min'])} – {fmt_money(result['sale']['max'])}**")
    with c2, st.container(border=True):
        st.markdown("**Lease scenario**")
        st.caption(f"n = {result['lease']['n']} comp(s), recent-weighted (3-month half-life)")
        st.write(f"Est. total (net, if Sq Ft given): **{fmt_money(result['lease']['estimate_net_total'])}**")
        st.write(f"Est. total (gross, if Sq Ft given): **{fmt_money(result['lease']['estimate_gross_total'])}**")
        st.write(f"Avg $/SF net: **{'${:.2f}'.format(result['lease']['avg_net_psf']) if result['lease']['avg_net_psf'] else '—'}**")
        st.write(f"Avg $/SF gross: **{'${:.2f}'.format(result['lease']['avg_gross_psf']) if result['lease']['avg_gross_psf'] else '—'}**")

    for title, key in [("Sale comps used", "sale"), ("Lease comps used", "lease")]:
        comps = result[key]["comps"]
        if not comps:
            continue
        st.markdown(f"**{title}** ({len(comps)}) — sanity-check these, drop outliers yourself")
        st.dataframe(
            [{"Address": c["address"], "Municipality": c["municipality"], "Type": c["record_type"],
              "Date": c["date"], "Weight": c["weight"], "Price": c["price_raw"]} for c in comps],
            use_container_width=True, hide_index=True,
        )
