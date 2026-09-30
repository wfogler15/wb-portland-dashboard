#!/usr/bin/env python3
"""
Second pass: user-visible strings, map fallbacks and the remaining Phoenix
purge call that the first patch did not reach.

Also corrects two pre-existing bugs carried over from the Denver build, where
the two map fallback coordinates and their comments were mismatched:
  * "// Phoenix default"      sat on Denver coordinates  (39.74, -104.99)
  * "// Denver metro center"  returned Phoenix coordinates (33.45, -112.07)
Both now point at Portland with comments that match.
"""
import io
import sys

SRC = "/home/claude/portland_index.html"
DST = "/home/claude/portland_index.html"

PORTLAND_LAT, PORTLAND_LNG = 45.52, -122.68
changes = []


def sub(s, old, new, label, expect=None):
    n = s.count(old)
    if n == 0:
        print(f"  !! NOT FOUND: {label}\n     {old[:110]}")
        sys.exit(1)
    if expect is not None and n != expect:
        print(f"  !! {label}: expected {expect} occurrence(s), found {n}")
        sys.exit(1)
    changes.append(f"{label:<34} {n}")
    return s.replace(old, new)


def main():
    s = io.open(SRC, encoding="utf-8").read()

    # --- every remaining market label ---
    s = sub(s, "Denver MSA", "Portland MSA", "Denver MSA -> Portland MSA")

    # --- map fallback #1: sale-comp modal initial center ---
    s = sub(s,
            "  let center = [39.74, -104.99];   // Phoenix default",
            f"  let center = [{PORTLAND_LAT}, {PORTLAND_LNG}];   // Portland metro default",
            "modal map center", expect=1)

    # --- map fallback #2: last-resort geocode ---
    # Was returning Phoenix coords under a "Denver metro center" comment.
    s = sub(s,
            "  // Last fallback: Denver metro center\n"
            "  return { lat: 33.45, lng: -112.07, precise: false };",
            "  // Last fallback: Portland metro center.\n"
            "  // NOTE: the Denver build returned Phoenix coordinates (33.45, -112.07)\n"
            "  // here despite the comment saying Denver -- a latent bug, corrected here.\n"
            f"  return {{ lat: {PORTLAND_LAT}, lng: {PORTLAND_LNG}, precise: false }};",
            "geocode fallback center", expect=1)

    # --- remaining Phoenix purge invocation ---
    s = sub(s,
            "try { maybeOfferPhoenixPurge(); } catch (e) { console.error('[phx purge]', e); }",
            "// Phoenix purge disabled in the Portland build (no shared Phoenix lineage,\n"
            "// and this instance runs local-only so there is nothing to sync a delete to).\n"
            "// try { maybeOfferPhoenixPurge(); } catch (e) { console.error('[phx purge]', e); }",
            "maybeOfferPhoenixPurge call", expect=1)

    # --- stale instance comment ---
    s = sub(s,
            "   This dashboard is the Denver / Front Range instance, but opportunities",
            "   This dashboard is the Portland MSA instance. The purge below is retained\n"
            "   from the Denver build for reference but is disabled -- opportunities",
            "instance comment", expect=1)

    io.open(DST, "w", encoding="utf-8").write(s)
    print("CHANGES")
    for c in changes:
        print("  " + c)
    print(f"\nwritten: {DST}  ({len(s)/1e6:.2f} MB)")


if __name__ == "__main__":
    main()
