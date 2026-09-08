# Ontario IOS Market Tracker — Claude Code Build Prompt

Paste this whole document into Claude Code as your project brief (save it as `CLAUDE.md` in
the repo root first — Claude Code will read it automatically on every session).

---

## 0. What this is

A local web app that ingests biweekly Industrial Outdoor Storage (IOS) market reports
(Excel files) for Ontario, normalizes the messy source data, and gives me a persistent,
queryable dashboard I can use to price off-market opportunities. New files get uploaded
every ~2 weeks; the app must accumulate history, not just show the latest file.

**Non-negotiables:**
- Runs locally (no cloud dependency required for core functionality).
- Data persists across restarts and across new file uploads (SQLite, not in-memory).
- Re-uploading a file (or a file with overlapping listings) must never create duplicate
  comps or silently overwrite my manual corrections.
- Ambiguous data gets flagged for my review, never silently guessed and hidden.

---

## 1. Source data — exact structure (already inspected, don't re-derive from scratch)

Each uploaded `.xlsx` file has **8 sheets**, always in this pattern:

```
MWO Transactions          MWO Availabilities
Core GTA Transactions     Core GTA Availabilities
Non-Core GTA Transactions Non-Core GTA Availabilities
SWO Transactions          SWO Availabilities
```

- `MWO` = Mid-Western Ontario, `SWO` = South-Western Ontario, `Core GTA` / `Non-Core GTA`
  self-explanatory. **Confirm these expansions with me once in the app's onboarding/config
  screen rather than hardcoding a guess** — they're used as display labels.
- Sheet names are inconsistent between files (e.g. `"Core GTA Transactions "` with a
  trailing space in one file, no trailing space in another). **Trim and case-normalize
  sheet names when matching against the 8 expected sheet types.**
- These 4 sheet-pairs are the top-level **"Market"** dimension. `Municipality` (e.g.
  Brampton, Guelph, Hamilton) is the **sub-market** dimension within each Market.

### Columns (Transactions sheets)
`Type of Land | Sq. Ft. | Acres | Building Coverage % (When Applicable) | Transaction date
| Address | Municipality | Price | Taxes/TMI | Zoning | Vendor (or "Purchasor" in older
files) | Notes`

### Columns (Availabilities sheets)
Same as above minus the vendor/purchasor column, and `Transaction date` becomes `List Date`
(or `Last Updated Date` in some SWO files). **Match columns by header text, never by fixed
column index** — order shifts between files (SWO puts `Zoning` before `Taxes/TMI`; others
don't).

### Known data-quality issues to handle explicitly

| Field | What you'll see | Handling rule |
|---|---|---|
| `Type of Land` | `Low Coverage`, `Low Coverage Property`, `Low Coverage Propety` (typo), `Land`, `Improved Land`, `Unimproved Land`, `Unimproved` | Normalize via fuzzy match to two canonical buckets: **Low Coverage** and **Land**. Log the raw value alongside the normalized one so I can audit the mapping. |
| `Price` | Wildly inconsistent — see below | See §2, dedicated parser. Never treated as a single numeric column. |
| `Taxes/TMI` | `N/A`, plain numbers (`5.5`), `$52,500 Annual`, `50% of Hydro Bill`, `$9,900/Yr`, `$3.75 (2026)` | Store raw string as-is in a `taxes_raw` field. Attempt to extract a numeric `$` value into `taxes_numeric` when the pattern is confidently parseable; otherwise leave null and don't guess. |
| `Sq. Ft.` | Sometimes `N/A` or `None - MPAC` (land with no building) | Store as null, not 0. Don't let null sq ft zero out $/SF calcs — exclude those rows from $/SF averages, include them in $/Acre averages. |
| `Transaction date` / `List Date` | At least one file has a typo'd year (`2206` instead of `2026`) | Sanity-check: any parsed year outside [2020, current_year+1] gets flagged to the review queue rather than silently kept or discarded. |
| Vendor name | `Unknown`, inconsistent capitalization/punctuation across entries for what's likely the same entity | Normalize casing/whitespace for grouping, but keep the raw value too. Don't attempt aggressive entity resolution (e.g. guessing two similarly-named companies are the same) without flagging it as a *suggested* match I can confirm. |
| Blank rows | Every sheet has many fully-empty trailing rows (files are padded) | Stop reading a sheet at the first row that's empty across all columns; don't error on it. |
| File size vs. row count | Files are 10–46MB despite having only a handful of populated rows (leftover formatting/cached ranges) | Parse with a library that handles this gracefully (e.g. `openpyxl` with `read_only=True`, or an equivalent streaming reader) — don't load the whole workbook into memory naively. |

---

## 2. Price parsing — the hard part, get this right

The `Price` column mixes **sale prices** and **lease rates** in the same field, distinguished
(when distinguished at all) only by suffix text. Observed patterns, verbatim:

```
1550000                      → plain number, ambiguous (see heuristic below)
"$41,000 Net"                 → lease, net basis, amount ambiguous (monthly vs annual — flag)
"$11,000/Acre Gross"          → lease, gross, per-acre
"$5,500 Gross"                → lease, gross, likely per-month (flag for confirmation)
"$14,000/Month"               → lease, per month
"$19/ft"                      → lease, $ per SF (basis unstated — flag net vs gross)
17.5   (bare, in a $/context) → likely $/SF net, no $ sign — LOW CONFIDENCE, flag
"Supressed"                   → price withheld/confidential
"Supressed - $12.5M list"     → withheld, but a list price is embedded — extract it, tag as "list price (asking), sale confirmed suppressed"
"Fill in price" / blank       → missing, not yet entered
"$1.65M", "$2.387M"           → sale price, abbreviated M = million
"$0.41/SF/Yr"                 → lease, $/SF/year
```

Build a dedicated `parsePrice(rawValue, rowContext)` function that returns a structured
object, not a single number:

```ts
{
  raw: string,                  // original cell value, untouched, always kept
  status: "parsed" | "suppressed" | "missing" | "needs_review",
  dealType: "sale" | "lease" | null,
  amount: number | null,
  unit: "total" | "per_sf" | "per_acre" | "per_month" | "per_year" | null,
  basis: "net" | "gross" | "unspecified",
  confidence: "high" | "low",
  reviewReason: string | null   // populated whenever status is "needs_review"
}
```

Heuristics (all should be tunable constants, not buried magic numbers):
- Suffix keywords (`/Acre`, `/SF`, `/ft`, `/Month`, `/Yr`, `Net`, `Gross`) drive unit/basis
  detection directly — these are `high` confidence.
- A bare number with no suffix: if it's small (say < 200) and Sq. Ft. or Acres is populated,
  assume `per_sf` lease rate at `low` confidence and route to the review queue. If it's large
  (> 100,000), assume `total` sale price at `low` confidence, still queued for review on
  first sight of that pattern (once I confirm a few, you can raise confidence for that
  pattern going forward — but don't do this silently; show me what you inferred).
- `"Supressed"` variants → `status: "suppressed"`, extract any embedded list price into
  `amount` with a note that it's an asking price, not a confirmed sale price.
- Never average a `needs_review` or `suppressed` row into the headline stats by default —
  give me a toggle to include/exclude them, defaulting to **excluded**, with a visible count
  of how many rows were excluded so I know the average isn't silently thin.

---

## 3. Data model (SQLite)

One `listings` table covering both transactions and availabilities, with a `record_type`
column (`transaction` | `availability`), plus the structured price fields from §2 flattened
into columns. Key additional fields:

- `source_key` — a stable hash of (market, sheet_type, address, municipality, type_of_land,
  date) used as the **dedup identity**. This is the single most important design decision:
  when I re-upload a file where a listing reappears (still available, or now showing as a
  transaction), the app must recognize it's the same underlying property, not double-count
  it. On conflict: update mutable fields (price, notes), preserve `first_seen_date` and any
  manual review corrections I've made, and record `last_seen_date` so you can compute
  days-on-market for availabilities that persist across multiple biweekly files.
- `manual_overrides` — a separate table keyed by `source_key`, storing any correction I make
  in the UI (e.g. re-tagging a price's unit/basis, fixing a typo'd date, merging two vendor
  names). On every import, overrides are re-applied on top of freshly parsed data — imports
  never clobber my corrections.
- `import_batches` — one row per file upload (filename, upload timestamp, date range covered,
  row counts parsed/flagged/skipped) so I can audit what came from where.

Keep the **raw parsed rows and the raw uploaded files** in an untouched `/data/raw/` archive
folder (just copy each uploaded xlsx there with its original name) so any parsing bug can be
fixed later by re-running the importer against history, without needing me to re-upload
anything.

---

## 4. Features (dashboard)

### A. Upload
Drag-and-drop `.xlsx` upload. On import, show a summary: rows added, rows updated
(dedup matches), rows flagged for review, rows skipped (fully unparseable), with a link
straight into the review queue for anything flagged.

### B. Market Overview (the core ask)
For each **Market** (MWO / Core GTA / Non-Core GTA / SWO) × **Type** (Low Coverage / Land) ×
**Status** (Available / Sold):
- Avg sale price (total)
- Avg $/SF net lease rate
- Avg $/SF gross lease rate
- Avg $/Acre (both for land sales and for lease-per-acre where applicable)
- Sample size (n) for every stat shown — never show an average without its n, since some
  cells will have very few comps
- Min/max range alongside the average
- Filter/drill down by Municipality within a Market

### C. Vendor Tracker
Group `transactions` by normalized vendor name: deal count, total $ volume, avg deal size,
markets/municipalities they've transacted in, list of properties. Surface vendors with 2+
deals prominently (that's the "pattern" signal — repeat sellers, portfolio disposals, likely
principals to build relationships with). Include a "possible same entity" suggestion list
for near-duplicate vendor names (e.g. punctuation/capitalization differences) that I can
merge with one click — never auto-merge.

### D. Transaction Volume by Market
Stacked bar chart: transaction count (and separately, total acreage/SF transacted) by
Market, split Low Coverage vs Land, per biweekly period — so the trend builds up as I upload
more files over time. Same view for availabilities (new listings appearing vs. going stale)
if useful.

### E. Cluster Map
Geocode `Address + Municipality + "Ontario, Canada"` (cache results — never re-geocode a
row you've already resolved; use a free geocoder like Nominatim/OSM by default, but make the
geocoding provider swappable in config in case I add a paid API key later). Plot markers
colored by Market and shaped/styled by Status (available vs sold) and Type (Low Coverage vs
Land). Clicking a marker shows the full record including price breakdown and notes.

### F. Off-Market Pricing Tool
The actual point of this whole thing. A simple form: Market, Municipality (optional,
falls back to Market-level comps if too few in the municipality), Type (Low Coverage/Land),
Acreage and/or Sq Ft. Output: a suggested price range for both a sale and a lease scenario,
computed from the filtered comp set (recent-weighted — comps from the last 3 months should
carry more weight than 6+ months old), with the actual comps used listed transparently below
the estimate so I can sanity-check it and drop outliers myself.

### G. Review Queue
Every row with `status: needs_review` or a flagged date/vendor anomaly, listed in one place
with the raw source value visible, my best-guess parse shown as an editable suggestion, and
a one-click confirm/correct action that writes to `manual_overrides`.

---

## 5. Tech stack (keep it boring and easy for you to iterate on)
- Backend: Node.js + Express (or Python + FastAPI — pick whichever you're more reliable
  generating correct code in), SQLite via a simple ORM (Prisma or better-sqlite3 / SQLAlchemy).
- Frontend: React + Vite, Tailwind for styling, Recharts for charts, Leaflet (with OSM tiles)
  for the map.
- Excel parsing: `xlsx`/SheetJS (Node) or `openpyxl` (Python) with `read_only` mode.
- Single `npm run dev` (or equivalent) starts both frontend and backend for local use.

---

## 6. Workflow so I can tweak the beta without breaking it

- Initialize this as a git repo on the very first commit, before writing any app code.
- Commit after every working, tested increment — not one giant commit at the end. Each
  commit message should say what feature/fix it adds.
- After the MVP (§4 sections A–D working end to end) is verified working with my real data,
  create a git tag `beta-v1`. Do the same after every subsequent milestone (`beta-v2`, etc.)
  so I always have a known-good point to `git checkout` back to if a tweak I ask for breaks
  something.
- When I ask for a change, make it on top of the current state but tell me explicitly if
  it's a risky/structural change (e.g. touching the price parser or the dedup key) versus a
  safe/cosmetic one (e.g. UI tweak) — for risky changes, suggest committing the current
  working state first so we have a fallback point before you start.
- Never modify files under `/data/raw/` programmatically except to add new uploads.

---

## 7. Build order (so there's a working Beta fast)

1. Repo + git init, folder structure, empty SQLite schema (§3).
2. Excel importer for the 3 sample files with the price parser (§2) and dedup logic — no UI
   yet, just verify via console/logs that row counts and flags look sane against the 3 files
   I gave you.
3. Minimal API + Market Overview screen (§4B) — this alone should already be useful.
4. Upload UI (§4A) with the import summary.
5. Vendor Tracker (§4C) and Volume chart (§4D).
6. Review Queue (§4G) — needed before you fully trust the averages in §4B/F.
7. Off-Market Pricing Tool (§4F).
8. Cluster Map (§4E) last — it's the most polish-heavy and least load-bearing for pricing
   accuracy.

Tag `beta-v1` once steps 1–4 work end-to-end against all three sample files without crashing
or double-counting on re-upload.
