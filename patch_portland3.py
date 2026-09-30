#!/usr/bin/env python3
"""
Third pass: relabel the data source in user-facing copy.

Portland's trends series comes from the CoStar Annual Performance export, not
RealPage, so every rendered "RealPage" is now wrong. Internal identifiers
(RP_FORECAST, rpAvailable, trendSource 'rp') keep their names -- only display
text changes.
"""
import io
import re
import sys

PATH = "/home/claude/portland_index.html"


def main():
    s = io.open(PATH, encoding="utf-8").read()

    # The per-property coverage sentence is Denver-specific and sits in the
    # now-hidden RealPage property pane. Replace it rather than let the global
    # relabel turn it into "CoStar covers ... of the CoStar properties".
    stale = ("RealPage covers 1,241 of the 2,674 CoStar Existing properties "
             "(~46%) with monthly time-series data going back ")
    if stale in s:
        s = s.replace(
            stale,
            "Per-property monthly time-series is RealPage-sourced and has no "
            "Portland equivalent in this build, so this panel is hidden. "
            "Historical coverage began ",
            1)
        print("  coverage sentence      replaced")
    else:
        print("  !! coverage sentence not found")
        sys.exit(1)

    before = s.count("RealPage")
    # Word-boundary replace; no identifiers contain "RealPage".
    s = re.sub(r"(?<![A-Za-z0-9_])RealPage(?![A-Za-z0-9_])", "CoStar", s)
    after = s.count("RealPage")
    print(f"  RealPage -> CoStar     {before} -> {after} remaining")

    # Avoid the doubled phrase where the sentence already names CoStar.
    dup = s.count("CoStar Forecast Through 2030")
    s = s.replace("· CoStar Forecast Through 2030",
                  "· CoStar Forecast Through 2030")
    s = s.replace("CoStar covers", "CoStar covers")

    io.open(PATH, "w", encoding="utf-8").write(s)
    print(f"  written                {len(s)/1e6:.2f} MB")


if __name__ == "__main__":
    main()
