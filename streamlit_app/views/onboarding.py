import streamlit as st

from lib.config import save_market_labels


def render(config):
    st.title("Welcome — one quick confirmation")
    st.write(
        "Your reports use four region codes as the top-level \"Market\" grouping. Confirm what each one "
        "stands for — this is used as a display label only, never guessed silently."
    )
    labels = dict(config["market_labels"])
    for code in list(labels.keys()):
        labels[code] = st.text_input(code, value=labels[code])

    if st.button("Confirm and continue", type="primary"):
        save_market_labels(labels, True)
        st.rerun()
