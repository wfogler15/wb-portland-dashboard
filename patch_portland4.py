#!/usr/bin/env python3
"""
Fourth pass, per Will 2026-09-28:
  1. Hide the Sale Comps and Opportunities tabs (no Portland comp data).
  2. Default the Building Class filter to All (was A + B).
  3. Hide the Data Taxonomy toggle and lock the taxonomy to 'wb'.

All three are done by hiding/defaulting rather than deleting markup, so each
reverts cleanly if Portland comp data arrives or the toggle is wanted back.

Note on (3): the taxonomy toggle is not Supabase-related -- it switches
_wbSubmarket (27 clusters) against _costarSubmarket (217 granular CoStar
submarkets) and persists to localStorage only. Hiding it therefore removes the
217-submarket view. The lock below also overrides any 'costar' value already
stored in a user's browser, which would otherwise strand them in a mode with
no visible control.
"""
import io
import sys

PATH = "/home/claude/portland_index.html"
changes = []


def sub(s, old, new, label, expect=1, first_only=False):
    n = s.count(old)
    if not first_only and n != expect:
        print(f"  !! {label}: expected {expect}, found {n}")
        print(f"     {old[:120]}")
        sys.exit(1)
    if n == 0:
        print(f"  !! {label}: not found\n     {old[:120]}")
        sys.exit(1)
    changes.append(f"{label}" + (f" (first of {n})" if first_only else ""))
    return s.replace(old, new, 1 if first_only else -1)


def main():
    s = io.open(PATH, encoding="utf-8").read()

    # ---- 2. default Building Class filter to All ----
    s = sub(s,
            "  // Multi-select building class. Default to A + B (Willow Bridge builds luxury,\n"
            "  // so C/F is off by default but available). Empty Set = include all classes.\n"
            "  classes: new Set(['A', 'B']),",
            "  // Multi-select building class. Portland build defaults to All classes\n"
            "  // (Will, 2026-09-28). Empty Set = include all classes.\n"
            "  classes: new Set(),",
            "class filter default -> All")

    # ---- 3. lock taxonomy to 'wb', ignoring any stored value ----
    s = sub(s,
            "    if (raw === 'wb' || raw === 'costar') state.submarketTaxonomy = raw;",
            "    // Portland build: the taxonomy toggle is hidden, so the stored value is\n"
            "    // ignored and the taxonomy is pinned to 'wb'. Without this, a browser\n"
            "    // holding 'costar' would be stuck in that mode with no visible control.\n"
            "    if (raw === 'wb' || raw === 'costar') state.submarketTaxonomy = 'wb';",
            "taxonomy locked to wb")

    # ---- 1 + 3. hide tabs, toggle, and the report's Sale Comps section ----
    s = sub(s, "</head>",
            "<style>\n"
            "/* Portland build (Will, 2026-09-28) -- hidden, not removed. Delete a rule to\n"
            "   restore the corresponding control.\n"
            "   - Sale Comps / Opportunities: no Portland comp data in this build.\n"
            "   - Data Taxonomy: toggle hidden and taxonomy pinned to 'wb' in loadTaxonomy.\n"
            "     NOTE this also removes access to the 217-submarket CoStar view. */\n"
            '.tab[data-view="salecomps"], .tab[data-view="opportunities"] { display: none !important; }\n'
            "/* Hide the whole filter-group so the label and caption go with the toggle. */\n"
            ".filter-group:has(#submarket-taxonomy-toggle) { display: none !important; }\n"
            "</style>\n</head>",
            "hide tabs + taxonomy group", first_only=True)

    io.open(PATH, "w", encoding="utf-8").write(s)
    print("CHANGES")
    for c in changes:
        print("  " + c)
    print(f"\nwritten: {PATH}  ({len(s)/1e6:.2f} MB)")


if __name__ == "__main__":
    main()
