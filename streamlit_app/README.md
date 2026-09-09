# Ontario IOS Market Tracker — Streamlit edition

A faithful Python/Streamlit port of the Node+React app in the repo root
(`../server`, `../client`), built so it can be deployed to **Streamlit
Community Cloud** and stay reachable with a persistent URL, independent of
any particular chat session or local machine.

Same data model, same price parser, same dedup logic, same feature set —
see [`../CLAUDE.md`](../CLAUDE.md) for the original project brief they both
implement. `lib/` mirrors `../server/src/*.js` module-for-module; if you
change parsing/dedup behavior, change it in both places (or treat this as
the canonical one going forward and retire the Node version — your call).

## Persistence — read this before relying on it

Streamlit Community Cloud's filesystem survives sleep/wake, but a `git
push` or an app reboot resets it to whatever's committed in the repo. So:

- `data/seed.db` is a **committed snapshot** of the tracker's data at
  deploy time (70 listings, fully geocoded, BoC rates cached). The app
  copies it to `data/app.db` on first run if `app.db` doesn't exist yet —
  so a fresh/reset deployment never starts empty.
- Anything you upload *through the live deployed app* after that persists
  only until the next reset. Use the **Backup / Restore** panel in the
  sidebar to download `app.db` periodically, and if you want a new upload
  to become the permanent baseline, replace `data/seed.db` with that
  download and push it.

## Running locally

```bash
cd streamlit_app
pip install -r requirements.txt
streamlit run main.py
```

## Deploying to Streamlit Community Cloud

1. Push this repo to GitHub (needs to be a repo Streamlit Cloud can read —
   public, or private with the GitHub App installed).
2. Go to [share.streamlit.io](https://share.streamlit.io), sign in with
   GitHub, click **New app**.
3. Pick this repo/branch, and set the main file path to
   `streamlit_app/main.py`.
4. Deploy. First boot seeds from `data/seed.db` automatically.

## Layout

```
main.py           entry point — nav, onboarding gate, backup/restore panel
views/            one module per page, each with a render(config) function
lib/              ported backend logic (db, parsers, importer, pulse, etc.)
data/seed.db      committed snapshot the app boots from (see above)
.streamlit/       theme config
```
