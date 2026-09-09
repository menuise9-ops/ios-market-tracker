import streamlit as st
import plotly.graph_objects as go

from lib.trends import get_trends

MARKET_COLORS = {"MWO": "#2563eb", "SWO": "#16a34a", "Core GTA": "#d97706", "Non-Core GTA": "#9333ea"}
RATE_COLOR = "#64748b"


def _chart(title, subtitle, months, series_by_market, rates, labels, y_fmt, show_rate=False):
    st.markdown(f"**{title}**")
    if subtitle:
        st.caption(subtitle)
    fig = go.Figure()
    for mkt, values in series_by_market.items():
        fig.add_trace(go.Scatter(x=months, y=values, name=labels.get(mkt, mkt), mode="lines+markers",
                                  line=dict(color=MARKET_COLORS.get(mkt, "#64748b")), connectgaps=True))
    if show_rate:
        fig.add_trace(go.Scatter(x=months, y=rates, name="Approx. prime rate", mode="lines",
                                  line=dict(color=RATE_COLOR, dash="dash"), yaxis="y2", connectgaps=True))
    layout = dict(height=300, margin=dict(l=10, r=10, t=10, b=10), plot_bgcolor="white",
                  legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="left", x=0))
    if show_rate:
        layout["yaxis2"] = dict(title="Rate %", overlaying="y", side="right", showgrid=False)
    fig.update_layout(**layout)
    st.plotly_chart(fig, use_container_width=True)


def render(config):
    labels = config["market_labels"]
    st.title("Pricing Trends")
    st.caption("Monthly averages by market — sparse months (few or no comps) show as gaps, not zero.")

    months_choice = st.radio("Range", [6, 12, 24], index=1, horizontal=True, format_func=lambda m: f"{m}mo")
    data = get_trends(months_choice)
    months = data["months"]
    markets = list(data["by_market"].keys())
    rates = [r["approx_prime"] for r in data["rates"]]
    have_rates = any(r is not None for r in rates)

    with st.container(border=True):
        _chart(
            "Sale price per acre",
            "Right axis: approximate bank prime rate (BoC overnight + 2.20%)" if have_rates else "Bank of Canada rate overlay unavailable (offline on first run?)",
            months, {m: data["by_market"][m]["sale_per_acre"] for m in markets}, rates, labels,
            lambda v: f"${v/1_000_000:.1f}M", show_rate=have_rates,
        )
    with st.container(border=True):
        _chart("Lease rate — $/SF net", None, months, {m: data["by_market"][m]["lease_net_psf"] for m in markets}, rates, labels, lambda v: f"${v:.2f}")
    with st.container(border=True):
        _chart("Lease rate — $/SF gross", None, months, {m: data["by_market"][m]["lease_gross_psf"] for m in markets}, rates, labels, lambda v: f"${v:.2f}")
