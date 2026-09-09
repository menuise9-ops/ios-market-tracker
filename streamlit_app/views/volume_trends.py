import streamlit as st
import plotly.graph_objects as go

from lib.volume import get_volume

MARKET_COLORS = {"MWO": "#2563eb", "SWO": "#16a34a", "Core GTA": "#d97706", "Non-Core GTA": "#9333ea"}
TYPES = ["Low Coverage", "Land"]


def render(config):
    labels = config["market_labels"]
    st.title("Volume Trends")

    c1, c2 = st.columns(2)
    which = c1.selectbox("Series", ["transactions", "availabilities"], format_func=lambda v: "Transactions (sold)" if v == "transactions" else "Availabilities (listed)")
    metric = c2.selectbox("Metric", ["count", "acres", "sqft"], format_func=lambda v: {"count": "Count", "acres": "Total acreage", "sqft": "Total sq ft"}[v])

    data = get_volume()[which]
    months = data["months"]
    by_month = {m: {} for m in months}
    for bucket in data["series"]:
        for k, v in bucket.items():
            if k == "month":
                continue
            by_month[bucket["month"]][k] = v.get(metric, v.get("count"))

    fig = go.Figure()
    for mkt in labels.keys():
        for typ in TYPES:
            key = f"{mkt}__{typ}"
            values = [by_month[m].get(key, 0) for m in months]
            fig.add_bar(x=months, y=values, name=f"{labels.get(mkt, mkt)} · {typ}",
                        marker_color=MARKET_COLORS.get(mkt, "#64748b"),
                        marker_opacity=0.5 if typ == "Land" else 1.0)
    fig.update_layout(barmode="stack", height=420, margin=dict(l=10, r=10, t=10, b=10), plot_bgcolor="white",
                       legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="left", x=0, font=dict(size=10)))
    st.plotly_chart(fig, use_container_width=True)
    st.caption("Bucketed by month of transaction/list date (not upload date).")
