#!/usr/bin/env python3
"""
Convert the Denver market-intelligence dashboard into the Portland MSA build.

Replaces the embedded datasets, strips Denver/Phoenix-specific remnants, and
retargets UI copy and defaults. The consuming chart/table/KPI code is left
untouched -- the Portland data is emitted in exactly Denver's shapes.

Decisions taken (Will, 2026-09-28):
  submarkets : CoStar's 27 "Submarket Cluster" values
  trends     : CoStar Annual Performance (1998-2030) in place of RealPage
  backend    : local-only, Supabase client nulled
  YOC costs  : Denver figures carried forward, labeled as placeholder
"""
import io
import json
import sys

SRC = "/home/claude/index.html"
DST = "/home/claude/portland_index.html"

changes = []


def scan_literal(s, start):
    """Return the end index (exclusive) of the JS literal beginning at `start`,
    respecting string quoting and escapes so braces inside strings don't
    unbalance the count."""
    opener = s[start]
    closer = {"[": "]", "{": "}"}[opener]
    depth, i, n = 0, start, len(s)
    quote = None
    while i < n:
        c = s[i]
        if quote:
            if c == "\\":
                i += 2
                continue
            if c == quote:
                quote = None
        elif c in ("'", '"', "`"):
            quote = c
        elif c == opener:
            depth += 1
        elif c == closer:
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    raise ValueError(f"unbalanced literal starting at {start}")


def replace_literal(s, decl, payload, label):
    """Replace the literal assigned in `decl` (e.g. 'const RAW_DATA = ')."""
    i = s.index(decl)
    start = i + len(decl)
    while s[start] in " \t\r\n":
        start += 1
    end = scan_literal(s, start)
    before = end - start
    out = s[:start] + payload + s[end:]
    changes.append(f"{label:<26} {before:>10,} -> {len(payload):>10,} chars")
    return out


def sub_once(s, old, new, label, first_only=False):
    if old not in s:
        print(f"  !! NOT FOUND: {label}\n     {old[:100]}")
        sys.exit(1)
    n = s.count(old)
    if first_only:
        s = s.replace(old, new, 1)
        changes.append(f"{label:<26} 1 of {n} (first only)")
    else:
        s = s.replace(old, new)
        changes.append(f"{label:<26} {n} occurrence(s)")
    return s


def main():
    s = io.open(SRC, encoding="utf-8").read()
    orig_len = len(s)

    raw = io.open("/home/claude/portland_raw_data.json", encoding="utf-8").read()
    fc = io.open("/home/claude/portland_forecast.json", encoding="utf-8").read()
    mp = io.open("/home/claude/portland_rp_mapping.json", encoding="utf-8").read()

    clusters = sorted({r["wbSubmarket"] for r in json.loads(raw) if r["wbSubmarket"]})
    submarkets_js = json.dumps(clusters, ensure_ascii=False)

    # ---------------- datasets ----------------
    s = replace_literal(s, "const RAW_DATA = ", raw, "RAW_DATA")
    s = replace_literal(s, "const RP_FORECAST = ", fc, "RP_FORECAST")
    s = replace_literal(s, "const WB_RP_MAPPING = ", mp, "WB_RP_MAPPING")
    s = replace_literal(s, "const RP_PROPERTIES = ", "{}", "RP_PROPERTIES (cleared)")
    s = replace_literal(s, "const WB_SUBMARKETS = ", submarkets_js, "WB_SUBMARKETS")
    s = replace_literal(s, "const WB_OVERRIDES = ",
                        '{"submarket":{},"productType":{}}', "WB_OVERRIDES (cleared)")
    s = replace_literal(s, "const PHX_SUBMARKET_MAP = ", "{}", "PHX_SUBMARKET_MAP")
    s = replace_literal(s, "const SCOTTSDALE_SUBMARKET_MAP = ", "{}", "SCOTTSDALE_MAP")
    s = replace_literal(s, "const SIMPLE_CITY_MAP = ", "{}", "SIMPLE_CITY_MAP")

    # ---------------- market identity ----------------
    s = sub_once(s, "const ACTIVE_MARKET = 'denver';",
                 "const ACTIVE_MARKET = 'portland';", "ACTIVE_MARKET")
    s = sub_once(s, "center: [39.74, -104.99],   // Denver metro center",
                 "center: [45.52, -122.68],   // Portland metro center", "map center")
    s = sub_once(s, "name: '', address: '', city: '', state: 'CO', zip: '',",
                 "name: '', address: '', city: '', state: 'OR', zip: '',", "default state")

    # ---------------- UI copy ----------------
    s = sub_once(s, '<div class="page-eyebrow">Greater Denver · Colorado</div>',
                 '<div class="page-eyebrow">Greater Portland · Oregon &amp; SW Washington</div>',
                 "page eyebrow")
    s = sub_once(s,
                 '<div class="page-title">Denver MSA <span class="page-title-tag">Multifamily Market Intelligence</span></div>',
                 '<div class="page-title">Portland MSA <span class="page-title-tag">Multifamily Market Intelligence</span></div>',
                 "page title")
    # Global -- covers both the masthead div and the blendLabel assignment.
    s = sub_once(s, "Denver-Aurora-Centennial MSA · Aggregate (RealPage)",
                 "Portland-Vancouver-Hillsboro MSA · Aggregate (CoStar)",
                 "MSA aggregate label")
    s = sub_once(s, 'Effective Rent · Denver MSA', 'Effective Rent · Portland MSA',
                 "chart caption")
    s = sub_once(s, "Closed Deals · Denver MSA · Sort by clicking any c",
                 "Closed Deals · Portland MSA · Sort by clicking any c", "sale comp subline")
    s = sub_once(s, "opts.push('<option value=\"__MARKET__\">Denver MSA (Market-Wide)</option>');",
                 "opts.push('<option value=\"__MARKET__\">Portland MSA (Market-Wide)</option>');",
                 "market-wide option")
    s = sub_once(s, ": 'Denver MSA';", ": 'Portland MSA';", "MSA fallback label")
    s = sub_once(s, "YoY Effective Rent Change · 23 RealPage Submarkets · Click cell to load that submarket",
                 "YoY Effective Rent Change · 11 CoStar Submarkets · Click cell to load that submarket",
                 "heatmap subtitle")
    s = sub_once(s, 'title="Pull annual growth from RealPage\'s submarket-specific forecast">RealPage F',
                 'title="Pull annual growth from CoStar\'s submarket-specific forecast">CoStar F',
                 "growth source toggle")

    # ---------------- disable Phoenix purge ----------------
    s = sub_once(s, "setTimeout(() => { purgePhoenixRecords(true); }, 1200);",
                 "/* Phoenix purge disabled in the Portland build -- this instance has no\n"
                 "   shared Phoenix lineage and runs local-only, so there is nothing to purge. */\n"
                 "  // setTimeout(() => { purgePhoenixRecords(true); }, 1200);",
                 "Phoenix purge disabled")

    # ---------------- local-only mode ----------------
    s = sub_once(s, "} catch (e) {\n  console.warn('Supabase client init failed:', e);\n}\n",
                 "} catch (e) {\n  console.warn('Supabase client init failed:', e);\n}\n"
                 "\n// ---------------------------------------------------------------------------\n"
                 "// LOCAL-ONLY MODE -- Portland build ships without a backend (Will, 2026-09-28).\n"
                 "// Nulling the client makes syncState.enabled false, so syncOp() short-circuits\n"
                 "// on every read and write. Everything runs off localStorage and nothing\n"
                 "// contacts Supabase. Delete the line below to enable cloud sync.\n"
                 "// ---------------------------------------------------------------------------\n"
                 "supabaseClient = null;\n",
                 "local-only mode")

    # ---------------- hide the property time-series sub-tab ----------------
    s = sub_once(s, "</head>",
                 "<style>\n"
                 "/* Portland build: the per-property monthly time-series is RealPage-sourced and\n"
                 "   has no Portland equivalent, so RP_PROPERTIES is empty. Hide the sub-tab\n"
                 "   rather than render a blank panel. Delete this block to restore it. */\n"
                 ".trends-subtab-toggle .toggle-btn[data-subtab=\"property\"] { display: none !important; }\n"
                 "#trends-property-pane { display: none !important; }\n"
                 "</style>\n</head>",
                 "hide property sub-tab", first_only=True)

    # ---------------- YOC placeholder note ----------------
    s = sub_once(s, "<td><strong>${prod}</strong></td>",
                 "<td><strong>${prod}</strong></td>", "yoc row (anchor check)")
    s = sub_once(s,
                 '<div style="font-family:\'Inter Tight\',sans-serif;font-size:12px;letter-spacing:0.11em;text-transform:uppercase;color:#432890;font-weight:600;margin-bottom:8px;">YOC Assumptions</div>',
                 '<div style="font-family:\'Inter Tight\',sans-serif;font-size:12px;letter-spacing:0.11em;text-transform:uppercase;color:#432890;font-weight:600;margin-bottom:8px;">YOC Assumptions '
                 '<span style="color:#b4462a;font-weight:700;">· DENVER BASIS — PLACEHOLDER</span></div>'
                 '<div style="font-size:11.5px;color:#b4462a;line-height:1.5;margin:-4px 0 8px 0;">'
                 'Cost figures below are carried over from the Denver build and have NOT been '
                 'repriced for Portland. Replace before using the yield-on-cost output for any '
                 'underwriting decision.</div>',
                 "YOC placeholder note")

    io.open(DST, "w", encoding="utf-8").write(s)

    print("CHANGES")
    for c in changes:
        print("  " + c)
    print(f"\nWB_SUBMARKETS: {len(clusters)} Portland clusters")
    print(f"size: {orig_len/1e6:.2f} MB -> {len(s)/1e6:.2f} MB")
    print(f"written: {DST}")


if __name__ == "__main__":
    main()
