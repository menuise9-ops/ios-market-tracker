import streamlit as st

from lib.review_queue import list_review_queue, resolve_review_item

UNIT_OPTIONS = ["total", "per_sf", "per_acre", "per_month", "per_year"]
BASIS_OPTIONS = ["net", "gross", "unspecified"]
DEAL_TYPE_OPTIONS = ["sale", "lease"]

PRICE_REASON_CODES = {
    "bare_large_number_sale", "bare_small_number_lease", "bare_number_ambiguous",
    "net_no_unit", "gross_no_unit", "per_sf_no_basis",
}


def render(config):
    st.title("Review Queue")
    rows = list_review_queue()
    if not rows:
        st.success("Nothing needs review right now.")
        return

    st.caption(f"{len(rows)} row(s) flagged. Confirm or correct each — corrections are saved as overrides and survive future re-imports.")

    for row in rows:
        key = row["source_key"]
        with st.container(border=True):
            st.markdown(f"**{row['address']}** <span style='color:#94a3b8'>· {row['municipality']} · {row['market']}</span>", unsafe_allow_html=True)
            st.caption(f"{row['record_type']} · raw price: \"{row['price_raw']}\"")
            for r in row["review_reasons"]:
                st.markdown(
                    f"<span style='font-size:12px;background:#fffbeb;color:#b45309;border-radius:6px;"
                    f"padding:3px 8px;margin-right:4px'>{r['text']}</span>",
                    unsafe_allow_html=True,
                )

            c1, c2, c3, c4 = st.columns(4)
            amount = c1.number_input("Amount", value=float(row["price_amount"] or 0), key=f"amt_{key}")
            deal_type = c2.selectbox("Deal type", DEAL_TYPE_OPTIONS, index=DEAL_TYPE_OPTIONS.index(row["price_deal_type"]) if row["price_deal_type"] in DEAL_TYPE_OPTIONS else 0, key=f"dt_{key}")
            unit = c3.selectbox("Unit", UNIT_OPTIONS, index=UNIT_OPTIONS.index(row["price_unit"]) if row["price_unit"] in UNIT_OPTIONS else 0, key=f"unit_{key}")
            basis = c4.selectbox("Basis", BASIS_OPTIONS, index=BASIS_OPTIONS.index(row["price_basis"]) if row["price_basis"] in BASIS_OPTIONS else 2, key=f"basis_{key}")

            price_reason = next((r for r in row["review_reasons"] if r["code"] in PRICE_REASON_CODES), None)

            b1, b2 = st.columns(2)
            if b1.button("Confirm this row", key=f"confirm_{key}"):
                resolve_review_item(key, {"price_amount": amount, "price_unit": unit, "price_basis": basis, "price_deal_type": deal_type, "price_status": "parsed"})
                st.rerun()
            if b2.button("Confirm + apply to all matching this pattern", key=f"bulk_{key}", disabled=price_reason is None,
                         help="Also stop flagging this exact pattern on future imports, and un-flag other rows currently flagged for the same reason"):
                resolve_review_item(
                    key, {"price_amount": amount, "price_unit": unit, "price_basis": basis, "price_deal_type": deal_type, "price_status": "parsed"},
                    confirm_pattern_code=price_reason["code"] if price_reason else None,
                )
                st.rerun()
