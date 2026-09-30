# Willow Bridge · Portland MSA Market Dashboard

Single-page market intelligence dashboard for the Portland-Vancouver-Hillsboro multifamily market. Open `index.html` in a browser (or serve it with GitHub Pages). Everything the dashboard needs is embedded in that one file.

> **Contains licensed data.** `data/costar/` and `data/realpage/` are CoStar and RealPage exports licensed to Willow Bridge, and the same data is embedded in `index.html`. Keep this repository private.

## Repository layout

```
index.html                         The dashboard (data embedded)
data/
  costar/                          CoStar property exports: existing (4 vintage files) + pipeline
  realpage/                        RealPage Annual Performance (trends + forecast) and Monthly Property Performance
  willow_bridge/
    submarket_map.csv              CoStar submarket  ->  Willow Bridge submarket (217 rows -> 27 WB submarkets)
    realpage_submarket_map.json    Willow Bridge submarket  ->  RealPage submarket (for trend/forecast series)
  build/                           Generated JSON (what refresh.py writes into index.html)
scripts/
  refresh.py                       Rebuilds data/build/*.json from data/ and writes it into index.html
  history/                         One-off scripts used to create this build from the Denver dashboard
report/                            Source of the Market Report PDF generator (embedded in index.html)
supabase/migrations/               SQL applied to the shared Supabase project
```

## Two taxonomies, kept separate

Every property carries both classifications:

| Field | Source | Where it comes from |
|---|---|---|
| `submarket` | CoStar | CoStar's own submarket name, straight from the export (217 values) |
| `wbSubmarket` | Willow Bridge | `data/willow_bridge/submarket_map.csv` (27 values) |

The **Data Taxonomy** toggle in the sidebar switches the whole dashboard between the two. Product type works the same way: CoStar's style is kept, and the Willow Bridge product type is derived from stories (see `computeWbProductType` in `index.html`).

To regroup submarkets, edit `submarket_map.csv` and run `python scripts/refresh.py`. Individual properties can also be moved one at a time from the property modal; those edits sync to Supabase.

## Refreshing the data

1. Drop the new CoStar exports into `data/costar/` (file names must start with `Portland MF`) and the new RealPage Annual Performance file into `data/realpage/`. Remove the old files.
2. `pip install pandas openpyxl`
3. `python scripts/refresh.py` (or `--check` to rebuild the JSON without touching `index.html`)
4. The script lists any new CoStar submarkets missing from `submarket_map.csv`; add them and rerun.
5. Update `TODAY` near the top of the dashboard script in `index.html` to the export date so lease-up months are measured correctly.
6. Commit and push.

## Cloud sync (Supabase)

Team edits (property corrections, custom properties, comp sets, sale comps, opportunities, comp fees) sync through the shared Willow Bridge Supabase project (`wmydniiakotcliraajaa`). Every row is tagged `market = 'portland'`, so Portland edits never mix with Phoenix or Denver rows in the same tables. Browser-saved copies use `wb_pdx_*` keys for the same reason.

Access: the tables allow read/write with the publishable (anon) key embedded in `index.html`, the same as the Phoenix and Denver dashboards. Anyone with the page can edit shared data. Microsoft 365 sign-in is built (`REQUIRE_MICROSOFT_SIGNIN`) but not yet configured.

## Known open items

- Some trend-panel labels in the dashboard still read "CoStar" where the series is RealPage.
- `realpage_submarket_map.json` maps the Southwest Portland submarket (which includes South Waterfront) to RealPage "Southwest Portland/Tigard"; RealPage places South Waterfront in "Central Portland".
- Yield-on-cost costs are Denver placeholders and have not been repriced for Portland.
