#!/usr/bin/env python3
"""
Portland dashboard: turn cloud sync back on and restore the Willow Bridge /
CoStar submarket taxonomy toggle.

- Removes both `supabaseClient = null;` local-only overrides, so the dashboard
  syncs to the shared Willow Bridge Supabase project. Every row is written with
  market = 'portland' (ACTIVE_MARKET), so Portland data stays separate from
  Phoenix and Denver rows in the same tables.
- Re-shows the Data Taxonomy toggle (Willow Bridge 27-cluster submarkets vs
  CoStar's granular submarkets) and lets it honour the saved choice again.
  The saved choice moves to a Portland-specific key.
"""
import io
import sys

PATH = "/home/claude/portland_index.html"


def sub(s, old, new, label, count=1):
    n = s.count(old)
    if n != count:
        sys.exit(f"!! {label}: expected {count}, found {n}")
    print(f"  ok  {label}")
    return s.replace(old, new)


s = io.open(PATH, encoding="utf-8").read()

# 1. cloud sync on
s = sub(s,
        "// ---------------------------------------------------------------------------\n"
        "// LOCAL-ONLY MODE -- Portland build ships without a backend (Will, 2026-09-28).\n"
        "// Nulling the client makes syncState.enabled false, so syncOp() short-circuits\n"
        "// on every read and write. Everything runs off localStorage and nothing\n"
        "// contacts Supabase. Delete the line below to enable cloud sync.\n"
        "// ---------------------------------------------------------------------------\n"
        "supabaseClient = null;\n",
        "", "remove Portland local-only override")
s = sub(s,
        "// ---------------------------------------------------------------------------\n"
        "// LOCAL-ONLY MODE — enabled for external review (2026-09-25).\n"
        "// Nulling the client makes syncState.enabled false, so syncOp() short-circuits\n"
        "// on every read and write. The dashboard runs entirely off localStorage and\n"
        "// never contacts Supabase. Delete the line below to restore live cloud sync.\n"
        "// ---------------------------------------------------------------------------\n"
        "supabaseClient = null;\n",
        "", "remove external-review local-only override")
if "\nsupabaseClient = null;" in s:
    sys.exit("!! a supabaseClient = null override is still present")

# 2. taxonomy toggle back
s = sub(s, ".filter-group:has(#submarket-taxonomy-toggle) { display: none !important; }\n",
        "", "show taxonomy toggle")
s = sub(s,
        "    // Portland build: the taxonomy toggle is hidden, so the stored value is\n"
        "    // ignored and the taxonomy is pinned to 'wb'. Without this, a browser\n"
        "    // holding 'costar' would be stuck in that mode with no visible control.\n"
        "    if (raw === 'wb' || raw === 'costar') state.submarketTaxonomy = 'wb';",
        "    if (raw === 'wb' || raw === 'costar') state.submarketTaxonomy = raw;",
        "taxonomy honours saved choice")
s = sub(s, "'wb_dashboard_taxonomy_v1'", "'wb_pdx_dashboard_taxonomy_v1'", "taxonomy key -> Portland", count=2)

io.open(PATH, "w", encoding="utf-8").write(s)
print(f"\n  written {PATH} ({len(s)/1e6:.2f} MB)")
