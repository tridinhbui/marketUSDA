#!/usr/bin/env python3
"""Refresh all JSON under data/ by running each fetch script in order."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent

SCRIPTS = [
    "build_data.py",         # LM_HG217 hogs — public Datamart API
    "_build_turkey.py",      # turkey — MARS API (USDA_MARS_API_KEY optional)
    "_build_pork.py",        # retail pork — MARS API
    "_build_pork_cutout.py", # LM_PK602 pork cutout + primals — MPR Datamart
    "_build_pork_comprehensive.py", # LM_PK680 weekly comprehensive pork — MPR Datamart
]


def main() -> None:
    for name in SCRIPTS:
        script = ROOT / name
        if not script.is_file():
            print(f"skip (missing): {name}", file=sys.stderr)
            continue
        print(f"\n=== {name} ===\n")
        r = subprocess.run([sys.executable, str(script)], cwd=ROOT)
        if r.returncode != 0:
            sys.exit(r.returncode)
    print("\nAll data scripts finished OK.")


if __name__ == "__main__":
    main()
