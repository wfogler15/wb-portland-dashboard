#!/usr/bin/env python3
"""
Rebuild the dashboard's embedded data from the source files in data/ and
write it into index.html.

    python scripts/refresh.py            # rebuild everything
    python scripts/refresh.py --check    # rebuild into data/build only, leave index.html alone

Inputs
  data/costar/Portland MF*.xlsx                  CoStar property exports (existing + pipeline)
  data/realpage/Annual Performance*.xlsx          RealPage annual performance + forecast
  data/willow_bridge/submarket_map.csv            CoStar submarket -> Willow Bridge submarket
  data/willow_bridge/realpage_submarket_map.json  Willow Bridge submarket -> RealPage submarket

Outputs
  data/build/raw_data.json     -> RAW_DATA in index.html
  data/build/rp_forecast.json  -> RP_FORECAST in index.html
  data/build/rp_mapping.json   -> WB_RP_MAPPING in index.html

CoStar data and the Willow Bridge taxonomy stay separate: every property keeps
CoStar's own submarket (`submarket`) and gets the Willow Bridge submarket
(`wbSubmarket`) from submarket_map.csv. The dashboard's Data Taxonomy toggle
switches between the two. To regroup submarkets, edit the CSV and rerun this.

Requires: pandas, openpyxl.
"""
import csv
import glob
import json
import math
import os
import sys

import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = lambda *p: os.path.join(ROOT, "data", *p)
INDEX = os.path.join(ROOT, "index.html")

# ---------------------------------------------------------------------------
# Properties (CoStar)
# ---------------------------------------------------------------------------
KEY_ORDER = [
    "id", "address", "name", "units", "starRating", "class", "affordable",
    "status", "market", "submarket", "city", "state", "zip", "avgUnitSF",
    "avgAskingSF", "avgAskingUnit", "avgEffectiveSF", "avgEffectiveUnit",
    "concessions", "vacancy", "monthBuilt", "yearBuilt", "yearRenovated",
    "stories", "architect", "constructionBegin", "developer", "lastSaleDate",
    "lastSalePrice", "lat", "lng", "owner", "propertyManager", "percentLeased",
    "preLeasing", "style", "unitsStudio", "units1Bed", "units2Bed", "units3Bed",
    "units4Bed", "studioRent", "studioRentSF", "studioSF", "studioEffUnit",
    "studioEffSF", "oneRent", "oneRentSF", "oneSF", "oneEffUnit", "oneEffSF",
    "twoRent", "twoRentSF", "twoSF", "twoEffUnit", "twoEffSF", "threeRent",
    "threeRentSF", "threeSF", "threeEffUnit", "threeEffSF", "wbSubmarket",
]
COLMAP = {
    "id": "PropertyID",
    "address": "Property Address",
    "name": "Property Name",
    "units": "Number of Units",
    "starRating": "Star Rating",
    "class": "Building Class",
    "affordable": "Affordable Type",
    "status": "Building Status",
    "market": "Market Name",
    "submarket": "Submarket Name",
    "city": "City",
    "state": "State",
    "zip": "Zip",
    "avgUnitSF": "Avg Unit SF",
    "avgAskingSF": "Avg Asking/SF",
    "avgAskingUnit": "Avg Asking/Unit",
    "avgEffectiveSF": "Avg Effective/SF",
    "avgEffectiveUnit": "Avg Effective/Unit",
    "concessions": "Avg Concessions %",
    "vacancy": "Vacancy %",
    "monthBuilt": "Month Built",
    "yearBuilt": "Year Built",
    "yearRenovated": "Year Renovated",
    "stories": "Number of Stories",
    "architect": "Architect Name",
    "constructionBegin": "Construction Begin",
    "developer": "Developer Name",
    "lastSaleDate": "Last Sale Date",
    "lastSalePrice": "Last Sale Price",
    "lat": "Latitude",
    "lng": "Longitude",
    "owner": "Owner Name",
    "propertyManager": "Property Manager Name",
    "percentLeased": "Percent Leased",
    "preLeasing": "Pre-Leasing",
    "style": "Style",
    "unitsStudio": "Number of Studio Units",
    "units1Bed": "Number of 1 Bedroom Units",
    "units2Bed": "Number of 2 Bedroom Units",
    "units3Bed": "Number of 3 Bedroom Units",
    "units4Bed": "Number of 4 Bedroom Units",
    "studioRent": "Studio Asking Rent/Unit",
    "studioRentSF": "Studio Asking Rent/SF",
    "studioSF": "Studio Avg SF",
    "studioEffUnit": "Studio Effective Rent/Unit",
    "studioEffSF": "Studio Effective Rent/SF",
    "oneRent": "One Bedroom Asking Rent/Unit",
    "oneRentSF": "One Bedroom Asking Rent/SF",
    "oneSF": "One Bedroom Avg SF",
    "oneEffUnit": "One Bedroom Effective Rent/Unit",
    "oneEffSF": "One Bedroom Effective Rent/SF",
    "twoRent": "Two Bedroom Asking Rent/Unit",
    "twoRentSF": "Two Bedroom Asking Rent/SF",
    "twoSF": "Two Bedroom Avg SF",
    "twoEffUnit": "Two Bedroom Effective Rent/Unit",
    "twoEffSF": "Two Bedroom Effective Rent/SF",
    "threeRent": "Three Bedroom Asking Rent/Unit",
    "threeRentSF": "Three Bedroom Asking Rent/SF",
    "threeSF": "Three Bedroom Avg SF",
    "threeEffUnit": "Three Bedroom Effective Rent/Unit",
    "threeEffSF": "Three Bedroom Effective Rent/SF",
    "wbSubmarket": "Submarket Cluster",
}
EMPTY_STRING_FIELDS = {"name", "affordable", "class", "style", "owner", "propertyManager",
                       "market", "submarket", "city", "state", "zip", "address", "status"}
INT_FIELDS = {"units", "starRating", "monthBuilt", "yearBuilt", "yearRenovated", "stories",
              "unitsStudio", "units1Bed", "units2Bed", "units3Bed", "units4Bed", "lastSalePrice",
              "avgAskingUnit", "avgEffectiveUnit", "avgUnitSF", "studioRent", "studioSF",
              "studioEffUnit", "oneRent", "oneSF", "oneEffUnit", "twoRent", "twoSF", "twoEffUnit",
              "threeRent", "threeSF", "threeEffUnit"}


def clean(field, val):
    if val is None or (isinstance(val, float) and math.isnan(val)):
        return "" if field in EMPTY_STRING_FIELDS else None
    if isinstance(val, pd.Timestamp):
        return val.strftime("%Y-%m-%d 00:00:00")
    if field in EMPTY_STRING_FIELDS:
        s = str(val).strip()
        return "" if s.lower() in ("nan", "none") else s
    if field in INT_FIELDS:
        try:
            return int(round(float(val)))
        except (TypeError, ValueError):
            return None
    if isinstance(val, (int, float)):
        return round(float(val), 6)
    s = str(val).strip()
    return None if s.lower() in ("nan", "none", "") else s


def build_properties():
    wb_map = {}
    with open(D("willow_bridge", "submarket_map.csv"), newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            wb_map[row["costar_submarket"].strip()] = row["wb_submarket"].strip()

    files = sorted(glob.glob(D("costar", "Portland MF*.xlsx")))
    if not files:
        sys.exit("no CoStar exports found in data/costar/")
    records, seen, unmapped = [], set(), {}
    for path in files:
        df = pd.read_excel(path, sheet_name=0, header=0)
        missing = [c for c in COLMAP.values() if c not in df.columns]
        if missing:
            sys.exit(f"{os.path.basename(path)} is missing CoStar columns: {missing}")
        df = df.astype(object).where(pd.notna(df), None)
        for _, row in df.iterrows():
            rec = {f: clean(f, row.get(COLMAP[f])) for f in KEY_ORDER}
            if rec["id"] is None:
                continue
            rec["id"] = str(rec["id"])
            if rec["id"] in seen:
                continue
            seen.add(rec["id"])
            sm = rec["submarket"]
            if sm in wb_map:
                rec["wbSubmarket"] = wb_map[sm]
            elif sm:
                unmapped[sm] = unmapped.get(sm, 0) + 1   # keeps CoStar's cluster
            records.append(rec)
        print(f"  {os.path.basename(path):<55} {len(df):>5} rows")
    json.dump(records, open(D("build", "raw_data.json"), "w", encoding="utf-8"),
              separators=(",", ":"), ensure_ascii=False)
    print(f"  properties: {len(records)}")
    if unmapped:
        print("  CoStar submarkets not in submarket_map.csv (kept CoStar's cluster; add them to the CSV):")
        for k, v in sorted(unmapped.items()):
            print(f"    {k} ({v})")
    return records


# ---------------------------------------------------------------------------
# Trends (RealPage)
# ---------------------------------------------------------------------------
MARKET_KEY = "Portland-Vancouver-Hillsboro, OR-WA"
METRICS = {
    "eu": "Existing Units", "sp": "Annual Supply", "dm": "Annual Demand",
    "eR": "Annual Effective Rent", "yR": "YOY Effective Rent Change",
    "eS": "Effective  RPSF", "aR": "Asking Rent", "aS": "Asking RPSF",
    "cP": "Percent of Units Offering Concessions", "cD": "Concession ($)",
    "cR": "Concession (% of Asking Rent)", "oc": "Occupancy",
    "yO": "YOY Occupancy Change", "yV": "YOY Revenue Change",
    "em": "Total Employment", "eN": "YOY Employment Change (#)",
    "eP": "YOY Employment Change (%)",
}


def num(v):
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return int(f) if f == int(f) and abs(f) >= 1 else round(f, 6)


def build_trends():
    files = glob.glob(D("realpage", "Annual Performance*.xlsx"))
    if not files:
        sys.exit("no RealPage Annual Performance file in data/realpage/")
    df = pd.read_excel(files[0], sheet_name="Annual-Market Performance", header=2)
    df = df[df["Period"].notna()]
    missing = [c for c in METRICS.values() if c not in df.columns]
    if missing:
        sys.exit(f"RealPage file is missing columns: {missing}")
    forecast = {}
    for _, row in df.iterrows():
        sub = str(row["Submarket"]).strip()
        year = str(int(row["Period"]))
        m = {k: num(row[c]) for k, c in METRICS.items()}
        if sub == "Market":
            # The dashboard reads the metro series under both keys.
            forecast.setdefault(MARKET_KEY, {})[year] = m
            forecast.setdefault("Market", {})[year] = dict(m)
        else:
            forecast.setdefault(sub, {})[year] = m
    rp_map = json.load(open(D("willow_bridge", "realpage_submarket_map.json")))["mapping"]
    bad = sorted({b for b in rp_map.values() if b not in forecast})
    if bad:
        sys.exit(f"realpage_submarket_map.json points at RealPage submarkets not in the file: {bad}")
    mapping = {wb: [{"rp": rp, "weight": 1.0}] for wb, rp in rp_map.items()}
    json.dump(forecast, open(D("build", "rp_forecast.json"), "w"), separators=(",", ":"))
    json.dump(mapping, open(D("build", "rp_mapping.json"), "w"), separators=(",", ":"))
    print(f"  RealPage buckets: {len(forecast)}; submarket mappings: {len(mapping)}")
    return forecast, mapping


# ---------------------------------------------------------------------------
# Inject into index.html
# ---------------------------------------------------------------------------
def literal_end(s, start):
    closer = {"[": "]", "{": "}"}[s[start]]
    opener = s[start]
    depth, i, quote = 0, start, None
    while i < len(s):
        c = s[i]
        if quote:
            if c == "\\":
                i += 2
                continue
            if c == quote:
                quote = None
        elif c in "\"'`":
            quote = c
        elif c == opener:
            depth += 1
        elif c == closer:
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    sys.exit("unbalanced literal")


def replace_literal(s, decl, payload):
    i = s.find(decl)
    if i < 0 or s.find(decl, i + 1) >= 0:
        sys.exit(f"expected exactly one '{decl}' in index.html")
    start = i + len(decl)
    return s[:start] + payload + s[literal_end(s, start):]


def inject(records, forecast, mapping):
    s = open(INDEX, encoding="utf-8").read()
    s = replace_literal(s, "const RAW_DATA = ", json.dumps(records, separators=(",", ":"), ensure_ascii=False))
    s = replace_literal(s, "const RP_FORECAST = ", json.dumps(forecast, separators=(",", ":")))
    s = replace_literal(s, "const WB_RP_MAPPING = ", json.dumps(mapping, separators=(",", ":")))
    open(INDEX, "w", encoding="utf-8").write(s)
    print(f"  index.html updated ({len(s)/1e6:.2f} MB)")


if __name__ == "__main__":
    print("CoStar properties")
    recs = build_properties()
    print("RealPage trends")
    fc, mp = build_trends()
    if "--check" in sys.argv:
        print("--check: index.html left unchanged")
    else:
        inject(recs, fc, mp)
