import streamlit as st
import plotly.graph_objects as go

from lib.pulse import get_pulse
from lib.fmt import fmt_money, fmt_price_cell, esc_md

SEVERITY_COLOR = {"high": "#dc2626", "medium": "#d97706", "info": "#2563eb"}
INSIGHT_LABEL = {
    "biggest_deal": "Deal", "price_move": "Pricing", "repeat_vendor": "Vendor",
    "stale_listing": "Listing", "last_import": "Import", "data_quality": "Data quality",
}


def _delta_pct(curr, prior):
    if curr is None or prior in (None, 0):
        return None
    return ((curr - prior) / abs(prior)) * 100


def render(config):
    pulse = get_pulse()
    labels = config["market_labels"]

    st.title("Market Pulse")
    st.caption(
        f"As of {pulse['as_of']} · last {pulse['period_days']} days vs the {pulse['period_days']} before that "
        f"· {pulse['total_listings']} listings on file"
    )
    if pulse["needs_review_count"] > 0:
        st.warning(f"⚠️ {pulse['needs_review_count']} listing(s) need review — see the Review Queue page.")

    o = pulse["overall"]
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Deals closed", o["current"]["deals_closed"], _fmt_delta(_delta_pct(o["current"]["deals_closed"], o["prior"]["deals_closed"])))
    c2.metric("Sale volume", fmt_money(o["current"]["total_volume"], compact=True), _fmt_delta(_delta_pct(o["current"]["total_volume"], o["prior"]["total_volume"])))
    c3.metric("Avg deal size", fmt_money(o["current"]["avg_deal_size"], compact=True), _fmt_delta(_delta_pct(o["current"]["avg_deal_size"], o["prior"]["avg_deal_size"])))
    c4.metric("New availabilities", o["current"]["new_availabilities"], _fmt_delta(_delta_pct(o["current"]["new_availabilities"], o["prior"]["new_availabilities"])))

    st.subheader("Insights", divider="gray")
    if not pulse["insights"]:
        st.caption("No notable insights this period.")
    for ins in pulse["insights"]:
        color = SEVERITY_COLOR.get(ins["severity"], SEVERITY_COLOR["info"])
        label = INSIGHT_LABEL.get(ins["type"], "Note")
        st.markdown(
            f"""<div style="border-left:3px solid {color};background:#fff;border:1px solid #e2e8f0;
            border-left-width:3px;border-radius:6px;padding:10px 14px;margin-bottom:6px;display:flex;gap:12px;">
            <span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.03em;
            color:#94a3b8;width:90px;flex-shrink:0;padding-top:2px;">{label}</span>
            <span style="color:#334155;font-size:14px;">{esc_md(ins['text'])}</span></div>""",
            unsafe_allow_html=True,
        )

    st.subheader("Activity over time", divider="gray")
    trend = pulse["trend"]
    months = [t["month"] for t in trend]
    fig = go.Figure()
    fig.add_bar(x=months, y=[t["transactions"] for t in trend], name="Transactions", marker_color="#2563eb")
    fig.add_bar(x=months, y=[t["availabilities"] for t in trend], name="New availabilities", marker_color="#94a3b8")
    fig.add_trace(go.Scatter(x=months, y=[t["volume"] for t in trend], name="Sale volume ($)",
                              yaxis="y2", mode="lines", line=dict(color="#16a34a", width=2), fill="tozeroy",
                              fillcolor="rgba(22,163,74,0.15)"))
    fig.update_layout(
        barmode="group", height=320, margin=dict(l=10, r=10, t=10, b=10),
        yaxis=dict(title="Count"), yaxis2=dict(title="Volume ($)", overlaying="y", side="right", showgrid=False),
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="left", x=0),
        plot_bgcolor="white",
    )
    st.plotly_chart(fig, use_container_width=True)

    st.subheader(f"By market (last {pulse['period_days']} days)", divider="gray")
    cols = st.columns(len(pulse["by_market"]) or 1)
    for i, (mkt, data) in enumerate(pulse["by_market"].items()):
        with cols[i % len(cols)]:
            with st.container(border=True):
                st.markdown(f"**{labels.get(mkt, mkt)}**")
                st.markdown(f"### {data['current']['deals_closed']}")
                st.caption("deals closed")
                st.markdown(f"**{fmt_money(data['current']['total_volume'], compact=True)}**")
                st.caption(f"volume · {data['current']['new_availabilities']} new listings")

    st.subheader("Recent activity", divider="gray")
    for r in pulse["recent_activity"]:
        sold = r["record_type"] == "transaction"
        badge_color = "#059669" if sold else "#2563eb"
        badge_bg = "#d1fae5" if sold else "#dbeafe"
        with st.container(border=True):
            cols = st.columns([1, 5, 3])
            cols[0].markdown(
                f"<span style='background:{badge_bg};color:{badge_color};font-size:10px;font-weight:700;"
                f"padding:3px 8px;border-radius:99px;text-transform:uppercase;'>{'Sold' if sold else 'Available'}</span>",
                unsafe_allow_html=True,
            )
            cols[1].markdown(f"**{r['address']}**  \n<span style='color:#64748b;font-size:12px;'>{r['municipality']} · "
                              f"{labels.get(r['market'], r['market'])} · {r['type_of_land_normalized'] or '—'}</span>",
                              unsafe_allow_html=True)
            cols[2].markdown(f"<div style='text-align:right'><b>{fmt_price_cell(r)}</b><br>"
                              f"<span style='color:#64748b;font-size:12px'>{r['record_date']}</span></div>",
                              unsafe_allow_html=True)


def _fmt_delta(pct):
    if pct is None:
        return None
    return f"{pct:+.0f}% vs prior period"
