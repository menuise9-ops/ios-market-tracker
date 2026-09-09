import os
import tempfile
import streamlit as st

from lib import db, importer, geocode


def render(config):
    st.title("Upload Report")
    st.caption(
        "Drag and drop a biweekly .xlsx report. Re-uploading a file (or one with overlapping listings) "
        "never creates duplicates — matching rows are updated in place, and any manual corrections you've "
        "made in the Review Queue are always re-applied on top."
    )

    uploaded = st.file_uploader("Choose an .xlsx file", type=["xlsx"])
    if uploaded is not None:
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, uploaded.name)
            with open(path, "wb") as f:
                f.write(uploaded.getbuffer())
            with st.spinner("Importing…"):
                summary = importer.import_file(path)

        c1, c2, c3, c4 = st.columns(4)
        c1.metric("Added", summary["rows_added"])
        c2.metric("Updated (dedup match)", summary["rows_updated"])
        c3.metric("Flagged for review", summary["rows_flagged"])
        c4.metric("Skipped", summary["rows_skipped"])

        if summary["unmatched_sheets"]:
            st.error(f"Unrecognized sheet names (not one of the 8 expected types): {', '.join(summary['unmatched_sheets'])}")
        if summary["rows_flagged"] > 0:
            st.info(f"{summary['rows_flagged']} row(s) need a look — open **Review Queue** from the sidebar.")

        with st.spinner("Geocoding new listings for the map (this can take a bit — rate-limited to 1/sec)…"):
            geocode.geocode_batch(limit=40)

        st.success("Import complete.")

    st.subheader("Import history", divider="gray")
    batches = db.query("SELECT id, filename, uploaded_at, date_range_start, date_range_end, rows_added, rows_updated, rows_flagged, rows_skipped FROM import_batches ORDER BY id DESC")
    if not batches:
        st.caption("No imports yet.")
    else:
        st.dataframe(
            [dict(b) for b in batches],
            use_container_width=True, hide_index=True,
        )
