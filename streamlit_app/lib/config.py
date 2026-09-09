"""App config (region-label confirmation, etc.) — ported from the config
routes in server.js.
"""

import json

from . import db

DEFAULT_MARKET_LABELS = {
    "MWO": "Mid-Western Ontario",
    "SWO": "South-Western Ontario",
    "Core GTA": "Core GTA",
    "Non-Core GTA": "Non-Core GTA",
}


def get_config():
    rows = db.query("SELECT key, value FROM app_config")
    cfg = {r["key"]: r["value"] for r in rows}
    return {
        "market_labels": json.loads(cfg.get("market_labels") or "{}") or DEFAULT_MARKET_LABELS,
        "market_labels_confirmed": cfg.get("market_labels_confirmed") == "true",
    }


def save_market_labels(labels=None, confirmed=None):
    if labels is not None:
        db.execute("UPDATE app_config SET value = ? WHERE key = 'market_labels'", (json.dumps(labels),))
    if confirmed is not None:
        db.execute("UPDATE app_config SET value = ? WHERE key = 'market_labels_confirmed'", (str(confirmed).lower(),))
