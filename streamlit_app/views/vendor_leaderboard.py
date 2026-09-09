import streamlit as st

from lib.vendors import get_vendors, merge_vendors
from lib.fmt import fmt_money, fmt_price_cell

CONCENTRATION_COPY = {
    "fragmented": ("Fragmented", "#059669", "#ecfdf5", "No single seller dominates — activity is spread across many vendors."),
    "moderate": ("Moderately concentrated", "#b45309", "#fffbeb", "A handful of vendors account for a meaningful share of volume."),
    "concentrated": ("Concentrated", "#dc2626", "#fef2f2", "A small number of vendors dominate transaction volume."),
}


def render(config):
    st.title("Vendor Leaderboard")
    st.caption("Ranked by transaction volume — repeat sellers are the pattern signal to watch.")

    data = get_vendors()
    label, color, bg, note = CONCENTRATION_COPY[data["concentration"]["label"]]
    with st.container(border=True):
        c1, c2 = st.columns([3, 1])
        c1.markdown(f"<span style='color:{color};font-weight:700'>Market structure: {label}</span><br>"
                     f"<span style='color:#64748b;font-size:13px'>{note}</span>", unsafe_allow_html=True)
        c2.markdown(f"<div style='text-align:right'><span style='font-size:22px;font-weight:700'>HHI {data['concentration']['hhi']}</span><br>"
                     f"<span style='font-size:11px;color:#94a3b8'>&lt;1500 fragmented · 1500-2500 moderate · &gt;2500 concentrated</span></div>",
                     unsafe_allow_html=True)

    if data["suggestions"]:
        st.warning("**Possible same entity — confirm to merge**")
        for s in data["suggestions"]:
            c1, c2, c3 = st.columns([3, 1, 1])
            c1.write(f"**{s['a']}** vs **{s['b']}**")
            if c2.button(f'Merge → "{s["b"]}"', key=f"merge_{s['a']}_{s['b']}"):
                merge_vendors(s["a"], s["b"])
                st.rerun()
            if c3.button(f'Merge → "{s["a"]}"', key=f"merge_{s['b']}_{s['a']}"):
                merge_vendors(s["b"], s["a"])
                st.rerun()

    st.subheader("Leaderboard", divider="gray")
    for i, v in enumerate(data["vendors"]):
        with st.container(border=True):
            c1, c2, c3, c4 = st.columns([0.5, 4, 1.2, 1.5])
            c1.markdown(f"<span style='font-size:18px;font-weight:700;color:#94a3b8'>{i+1}</span>", unsafe_allow_html=True)
            c2.markdown(f"**{v['vendor_name']}**  \n<span style='color:#64748b;font-size:12px'>"
                        f"{', '.join(v['markets'])} · {', '.join(v['municipalities'][:3])}{'…' if len(v['municipalities']) > 3 else ''}</span>",
                        unsafe_allow_html=True)
            c3.markdown(f"<div style='text-align:right'><b>{v['deal_count']}</b><br><span style='font-size:11px;color:#94a3b8'>deals</span></div>", unsafe_allow_html=True)
            c4.markdown(f"<div style='text-align:right'><b>{fmt_money(v['total_volume'])}</b><br>"
                        f"<span style='font-size:11px;color:#94a3b8'>avg {fmt_money(v['avg_deal_size'])}</span></div>", unsafe_allow_html=True)
            with st.expander("Properties"):
                for p in v["properties"]:
                    st.markdown(f"- {p['address']} ({p['municipality']}) · {p['date']} · **{fmt_price_cell({'price_amount': p['price'], 'price_unit': p['price_unit'], 'price_raw': p['price_raw']})}**")

    st.subheader("Broker & Brokerage Leaderboard", divider="gray")
    st.info(
        "**Not available yet.** The biweekly report format tracked today (Type of Land, Address, Price, Zoning, "
        "Vendor, Notes…) doesn't capture listing brokerage, co-op brokerage, or agent name — so there's nothing to "
        "rank. To light this up, the source reports would need a **Brokerage** / **Co-Op Brokerage** / "
        "**Listing Agent** column (the raw MLS sheets this data originally came from do have this — it just isn't "
        "in the tracker format the importer reads today)."
    )
