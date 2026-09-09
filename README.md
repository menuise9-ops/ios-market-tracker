# Ontario IOS Market Tracker

Local dashboard for tracking biweekly Industrial Outdoor Storage (IOS) market reports.
See [`CLAUDE.md`](./CLAUDE.md) for the full project brief this was built against.

**Two implementations of the same brief live in this repo:**
- `server/` + `client/` — the original Node/Express + React app, below.
- [`streamlit_app/`](./streamlit_app/) — a Python/Streamlit port with the same data
  model and feature set, built so it can be deployed to Streamlit Community Cloud
  for a persistent URL that doesn't depend on this machine or a chat session staying
  around. See its own [README](./streamlit_app/README.md) for deploy steps and an
  important note on data persistence there.

## Running it (Node/React version)

This machine didn't have Node.js installed, so a portable copy lives in `.tools/`
(gitignored — it's a dev-machine convenience, not part of the app). Every command
below needs it on `PATH` for that shell session:

```powershell
$env:PATH = "$PWD\.tools\node-v24.19.0-win-x64;$env:PATH"
```

If you'd rather install Node.js normally system-wide instead (recommended for
day-to-day use — the portable copy is a fallback), run this once and approve the
UAC prompt it triggers, then you won't need the `$env:PATH` line above ever again:

```powershell
winget install --id OpenJS.NodeJS.LTS -e
```

### First-time setup

```bash
npm run install:all
```

### Start the app (backend + frontend together)

```bash
npm run dev
```

- Backend API: http://localhost:4000
- Frontend dashboard: http://localhost:5173 ← open this one

### Import files from the command line (no UI)

Useful for bulk-loading history or debugging the importer:

```bash
npm run import
```

This runs `server/src/importCli.js`, which currently points at the 3 sample files
copied into `data/raw/` during development. Edit that file's `files` array to point
at other `.xlsx` reports if you want to re-run it against a different set.

## Project layout

```
CLAUDE.md         — the project brief (source of truth for requirements)
data/
  raw/            — untouched archive of every uploaded .xlsx (gitignored)
  app.db          — SQLite database (gitignored — this is where everything persists)
server/           — Express API + Excel importer (Node, plain JS, no build step)
  src/
    priceParser.js      — §2: the Price column parser
    typeNormalizer.js   — §1: Type of Land normalization
    fieldParsers.js     — dates, sq ft/acres, taxes, vendor name normalization
    importer.js         — sheet/column matching, dedup, upsert logic
    overview.js         — §4B Market Overview aggregation
    db.js               — SQLite schema (uses Node's built-in node:sqlite)
    server.js           — Express routes
client/           — React + Vite + Tailwind + Recharts + Leaflet dashboard
```

## Workflow notes (see CLAUDE.md §6)

- Commits happen after every working, tested increment — check `git log` for the
  running history of what was built when.
- Git tags mark verified milestones: `beta-v1` = build steps 1–4 (importer + dedup +
  Market Overview + Upload UI) working end-to-end against the 3 real sample files
  without crashing or double-counting on re-upload.
- `/data/raw/` is never modified programmatically except to add new uploads.

## A deliberate deviation from CLAUDE.md §3, worth knowing about

The spec defines the dedup `source_key` as a hash of `(market, sheet_type, address,
municipality, type_of_land, date)`. Taken completely literally, an **availability**
whose "Last Updated Date" ticks forward on every biweekly re-upload (the common
case — a listing just sitting on the market) would get a brand-new key every time,
which defeats the stated goal one paragraph earlier in the brief ("recognize it's
the same underlying property, not double-count it" / "compute days-on-market for
availabilities that persist across multiple biweekly files").

So `importer.js` matches **without** date in the key, and only falls back to
treating a same-address **transaction** as a distinct second event (e.g. a resale)
when the incoming row's date/price are far enough from what's already on file —
see the big comment above `resolveMatch()` in `server/src/importer.js` for the
exact thresholds and the real case (367 Michener Rd, Guelph) that this guards
against.
