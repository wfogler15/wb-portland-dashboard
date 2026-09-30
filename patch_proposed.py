#!/usr/bin/env python3
"""
Fix Proposed / Final Planning visibility.

Two pre-existing bugs (present in the Denver build too):

1. isPlannedProposed() tests p.pipelineStage, a field no current CoStar-derived
   record carries -- 0 of 2,878 Denver records and 0 of 1,760 Portland records
   have it. The test is therefore always falsy, so the Property Index
   "Proposed" toggle returns nothing and planned/proposed records are never
   excluded from the core market read.

2. The Pipeline tab filter starts with `p.status !== 'Under Construction'`, so
   records with status 'Proposed' or 'Final Planning' can never reach its
   stage toggle regardless of what that toggle is set to.

Both fixes fall back to the CoStar status field while still honouring an
explicit pipelineStage when one has been set by hand in the property modal.

Net effect, which is the requested behaviour: proposed/planned stay out of the
default market read and appear only when explicitly toggled on.
"""
import io
import sys

PATH = "/home/claude/portland_index.html"


def sub(s, old, new, label):
    if s.count(old) != 1:
        print(f"  !! {label}: expected 1 occurrence, found {s.count(old)}")
        sys.exit(1)
    print(f"  {label}")
    return s.replace(old, new)


def main():
    s = io.open(PATH, encoding="utf-8").read()

    # --- 1. detector falls back to CoStar status ---
    s = sub(s,
            "function isPlannedProposed(p) {\n"
            "  return p.pipelineStage && p.pipelineStage !== 'UC';\n"
            "}",
            "function isPlannedProposed(p) {\n"
            "  // An explicit pipelineStage (set by hand in the property modal) always wins.\n"
            "  if (p.pipelineStage) return p.pipelineStage !== 'UC';\n"
            "  // Fall back to the CoStar status field. Current CoStar exports carry no\n"
            "  // pipelineStage at all, so without this fallback every record reads as\n"
            "  // not-proposed and the Proposed toggles return nothing.\n"
            "  return p.status === 'Proposed' || p.status === 'Final Planning';\n"
            "}",
            "isPlannedProposed -> status fallback")

    # --- 2. pipeline tab admits Proposed / Final Planning ---
    s = sub(s,
            "    if (p.status !== 'Under Construction') return false;\n"
            "    // Pipeline stage toggle — the two stages are shown SEPARATELY, never combined:\n"
            "    //   'UC'      → only true under-construction projects (default)\n"
            "    //   'planned' → only planned / proposed projects (often stalled, viewed apart)\n"
            "    // Legacy records without a pipelineStage tag are treated as UC.\n"
            "    const stage = p.pipelineStage || 'UC';",
            "    // Pipeline covers true UC plus planned/proposed. The old test admitted\n"
            "    // only status 'Under Construction', which meant CoStar records tagged\n"
            "    // 'Proposed' or 'Final Planning' could never reach the stage toggle below.\n"
            "    if (p.status !== 'Under Construction'\n"
            "        && p.status !== 'Proposed'\n"
            "        && p.status !== 'Final Planning') return false;\n"
            "    // Pipeline stage toggle — the two stages are shown SEPARATELY, never combined:\n"
            "    //   'UC'      → only true under-construction projects (default)\n"
            "    //   'planned' → only planned / proposed projects (often stalled, viewed apart)\n"
            "    // Records with no explicit pipelineStage derive it from CoStar status.\n"
            "    const stage = p.pipelineStage\n"
            "      || (p.status === 'Under Construction' ? 'UC' : 'Planned');",
            "pipeline tab admits Proposed / Final Planning")

    io.open(PATH, "w", encoding="utf-8").write(s)
    print(f"\n  written: {len(s)/1e6:.2f} MB")


if __name__ == "__main__":
    main()
