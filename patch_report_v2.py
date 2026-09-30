#!/usr/bin/env python3
"""
Portland dashboard: client-grade market report (v2) + storage isolation.

1. Namespaces the Portland build's browser-storage keys. Every Willow Bridge
   dashboard used the same keys (wb_dashboard_customprops_v1, ...), so on a
   shared origin (file:// or the same GitHub Pages domain) Denver and Phoenix
   custom properties, comps and edits appeared inside Portland. That is how a
   Littleton project ("Halden") and Littleton/Phoenix sale comps ended up in
   the Portland market report.
2. Injects exportMarketReportV2 (report_v2.js) with the brand logo + mark
   inlined, and points the report modal at it.
3. Keeps the modal's original section list (forecast relabeled RealPage)
   and points its Generate button at v2.

Input/output: /home/claude/portland_index.html (in place).
"""
import base64
import io
import re
import sys

from PIL import Image

PATH = "/home/claude/portland_index.html"
JS = "/home/claude/report_v2/report_v2.js"


def sub(s, old, new, label, count=1):
    n = s.count(old)
    if n != count:
        sys.exit(f"!! {label}: expected {count}, found {n}")
    print(f"  ok  {label}")
    return s.replace(old, new)


def png_b64(img, max_w):
    if img.width > max_w:
        img = img.resize((max_w, round(img.height * max_w / img.width)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def main():
    s = io.open(PATH, encoding="utf-8").read()

    if "function exportMarketReportV2" in s:
        sys.exit("!! v2 already injected")

    # ---- 1. storage isolation -------------------------------------------
    for key in ("edits", "customprops", "compfees", "comps", "compsets", "opportunities"):
        old = f"'wb_dashboard_{key}_v1'"
        new = f"'wb_pdx_dashboard_{key}_v1'"
        n = s.count(old)
        if n == 0:
            sys.exit(f"!! storage key {key} not found")
        s = s.replace(old, new)
        print(f"  ok  storage key {key} -> wb_pdx_ ({n} refs)")

    # ---- 2. inject v2 ----------------------------------------------------
    cover_b64 = re.search(r'<img class="cover-logo" src="data:image/png;base64,([A-Za-z0-9+/=]+)"', s).group(1)
    mark_b64 = re.search(r"\.report-section h2::before \{.*?url\('data:image/png;base64,([A-Za-z0-9+/=]+)'\)", s, re.S).group(1)
    logo = Image.open(io.BytesIO(base64.b64decode(cover_b64))).convert("RGBA")
    mark = Image.open(io.BytesIO(base64.b64decode(mark_b64))).convert("RGBA")
    js = io.open(JS, encoding="utf-8").read()
    js = js.replace("'__WB_LOGO_WHITE__'", f"'{png_b64(logo, 800)}'")
    js = js.replace("'__WB_MARK__'", f"'{png_b64(mark, 96)}'")
    if "__WB_" in js:
        sys.exit("!! logo placeholder not replaced")
    anchor = "async function exportMarketReportPdf(reportOptions) {"
    s = sub(s, anchor, js + "\n\n" + anchor, "inject exportMarketReportV2")

    # ---- 3. modal: same sections as before; relabel the forecast; call v2 ----
    s = sub(s,
            "${checkbox('CoStar · Forecast', 'report-section-rpForecast', true)}",
            "${checkbox('RealPage · Forecast', 'report-section-rpForecast', true)}",
            "modal forecast label -> RealPage")
    s = sub(s,
            "      exportMarketReportPdf({ sections, filterOverrides, yocOverrides, reportTitle, reportSubtitle });",
            "      // Redesigned report (same sections). The original exportMarketReportPdf is kept for reference.\n"
            "      exportMarketReportV2({ sections, filterOverrides, yocOverrides, reportTitle, reportSubtitle });",
            "modal calls v2")

    io.open(PATH, "w", encoding="utf-8").write(s)
    print(f"\n  written {PATH} ({len(s)/1e6:.2f} MB)")


if __name__ == "__main__":
    main()
