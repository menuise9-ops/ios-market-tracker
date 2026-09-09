import os
import sys
from functools import partial

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import streamlit as st

from lib import db, config as cfg
from lib.rates import refresh_if_stale
from views import (
    onboarding, market_pulse, market_overview, pricing_trends,
    vendor_leaderboard, volume_trends, cluster_map, off_market_pricing,
    upload_report, review_queue,
)

st.set_page_config(page_title="Ontario IOS Market Tracker", page_icon="🏭", layout="wide")

# Fetch the BoC rate series once per server process (cheap no-op if fresh).
if "boc_rates_checked" not in st.session_state:
    refresh_if_stale()
    st.session_state["boc_rates_checked"] = True

config = cfg.get_config()

if not config["market_labels_confirmed"]:
    onboarding.render(config)
    st.stop()

with st.sidebar:
    st.markdown("### Ontario IOS\nMarket Tracker")
    st.caption("SQLite · persists while this instance is running")

pulse_page = st.Page(partial(market_pulse.render, config), title="Market Pulse", icon="⚡", url_path="pulse", default=True)
overview_page = st.Page(partial(market_overview.render, config), title="Market Overview", icon="📊", url_path="overview")
trends_page = st.Page(partial(pricing_trends.render, config), title="Pricing Trends", icon="💹", url_path="trends")
vendors_page = st.Page(partial(vendor_leaderboard.render, config), title="Vendor Leaderboard", icon="🏢", url_path="vendors")
volume_page = st.Page(partial(volume_trends.render, config), title="Volume Trends", icon="📈", url_path="volume")
map_page = st.Page(partial(cluster_map.render, config), title="Cluster Map", icon="🗺️", url_path="map")
pricing_page = st.Page(partial(off_market_pricing.render, config), title="Off-Market Pricing", icon="🎯", url_path="pricing")
upload_page = st.Page(partial(upload_report.render, config), title="Upload Report", icon="⬆️", url_path="upload")
review_page = st.Page(partial(review_queue.render, config), title="Review Queue", icon="🔍", url_path="review")

nav = st.navigation({
    "Analyze": [pulse_page, overview_page, trends_page, vendors_page, volume_page, map_page, pricing_page],
    "Manage Data": [upload_page, review_page],
})

with st.sidebar:
    st.divider()
    with st.expander("Backup / Restore"):
        st.caption(
            "This deployment's storage isn't guaranteed to survive a redeploy. "
            "Download the database periodically if you want new uploads to stick around."
        )
        try:
            with open(db.DB_PATH, "rb") as f:
                st.download_button("⬇️ Download current database", f.read(), file_name="ios_tracker_backup.db", mime="application/octet-stream")
        except FileNotFoundError:
            pass
        restore_file = st.file_uploader("Restore from a .db backup", type=["db"], key="restore_uploader")
        if restore_file is not None and st.button("Restore now (overwrites current data)"):
            db.get_conn().close()
            with open(db.DB_PATH, "wb") as f:
                f.write(restore_file.getbuffer())
            st.cache_resource.clear()
            st.success("Restored — reloading…")
            st.rerun()

nav.run()
