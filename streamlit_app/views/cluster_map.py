import math
import streamlit as st
import folium
from folium.plugins import HeatMap
from streamlit_folium import st_folium

from lib import db, geocode
from lib.fmt import fmt_price_cell

MARKET_COLORS = {"MWO": "#2563eb", "SWO": "#16a34a", "Core GTA": "#d97706", "Non-Core GTA": "#9333ea"}
ONTARIO_CENTER = [43.7, -80.3]


def render(config):
    labels = config["market_labels"]
    st.title("Cluster Map")

    remaining = db.query_one("SELECT COUNT(*) as n FROM listings WHERE lat IS NULL AND geocode_attempted = 0")["n"]
    failed = db.query_one("SELECT COUNT(*) as n FROM listings WHERE lat IS NULL AND geocode_attempted = 1")["n"]
    points = [dict(r) for r in db.query("SELECT * FROM listings WHERE lat IS NOT NULL AND lon IS NOT NULL")]

    with st.container(border=True):
        c1, c2, c3, c4 = st.columns([3, 2, 2, 2])
        msg = f"{len(points)} plotted"
        if remaining:
            msg += f" · {remaining} pending"
        if failed:
            msg += f" · {failed} couldn't be located"
        c1.markdown(msg)
        view_mode = c2.radio("View", ["Pins", "Heatmap", "Both"], index=2, horizontal=True, label_visibility="collapsed")
        status_filter = c3.radio("Status", ["All", "Sold", "Available"], index=0, horizontal=True, label_visibility="collapsed")
        if remaining and c4.button(f"Geocode remaining {remaining}"):
            progress = st.progress(0.0, text="Geocoding…")

            def cb(done, total):
                progress.progress(done / total, text=f"Geocoding… {done}/{total}")

            geocode.geocode_batch(limit=min(remaining, 30), progress_cb=cb)
            st.rerun()

    if status_filter != "All":
        wanted = "transaction" if status_filter == "Sold" else "availability"
        points = [p for p in points if p["record_type"] == wanted]

    m = folium.Map(location=ONTARIO_CENTER, zoom_start=8, tiles="OpenStreetMap")

    if view_mode in ("Heatmap", "Both") and points:
        heat_data = []
        for p in points:
            intensity = 0.4
            if p["price_amount"] and p["price_unit"] == "total" and p["price_amount"] > 0:
                intensity = min(math.log10(p["price_amount"]) / 7, 1)
            heat_data.append([p["lat"], p["lon"], intensity])
        HeatMap(heat_data, radius=22, blur=18, max_zoom=12,
                gradient={0.2: "#2563eb", 0.4: "#16a34a", 0.6: "#f59e0b", 0.8: "#ea580c", 1.0: "#dc2626"}).add_to(m)

    if view_mode in ("Pins", "Both"):
        for p in points:
            sold = p["record_type"] == "transaction"
            color = MARKET_COLORS.get(p["market"], "#64748b")
            precision_note = f"<br><i style='color:#b45309'>Approximate location ({p['geocode_precision']}-level)</i>" if p["geocode_precision"] != "address" else ""
            popup_html = (
                f"<b>{p['address']}</b><br>{p['municipality']} · {labels.get(p['market'], p['market'])}<br>"
                f"{p['type_of_land_normalized'] or ''} · {'Sold' if sold else 'Available'}<br>{p['record_date']}<br>"
                f"<b>{fmt_price_cell(p)}</b>{precision_note}"
            )
            folium.CircleMarker(
                location=[p["lat"], p["lon"]],
                radius=7 if sold else 5,
                color=color, fill=True, fill_color=color,
                fill_opacity=0.85 if sold else 0.35, weight=2,
                dash_array=None if p["type_of_land_normalized"] != "Land" else "3,2",
                popup=folium.Popup(popup_html, max_width=250),
            ).add_to(m)

    st_folium(m, use_container_width=True, height=560, returned_objects=[])

    legend = " ".join(
        f"<span style='display:inline-flex;align-items:center;gap:4px;margin-right:14px'>"
        f"<span style='width:10px;height:10px;border-radius:50%;background:{c};display:inline-block'></span>{labels.get(mkt, mkt)}</span>"
        for mkt, c in MARKET_COLORS.items()
    )
    st.markdown(
        f"<div style='font-size:12px;color:#64748b'>{legend}"
        f"· solid fill = sold, faint = available · dashed border = Land, solid border = Low Coverage</div>",
        unsafe_allow_html=True,
    )
