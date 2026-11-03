#!/usr/bin/env python3
"""Refresh USDA JSON files and sync dashboard datasets."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent

SCRIPTS = [
    "build_data.py",
    "_build_turkey.py",
    "_build_pork.py",
    "_build_pork_cutout.py",
]


def main() -> None:
    failed = []

    for name in SCRIPTS:
        script = ROOT / name

        if not script.is_file():
            print(
                f"skip (missing): {name}",
                file=sys.stderr,
            )
            continue

        print(f"\n=== {name} ===\n", flush=True)

        result = subprocess.run(
            [sys.executable, str(script)],
            cwd=ROOT,
        )

        if result.returncode != 0:
            failed.append(name)

    if failed:
        print(
            "Failed datasets: " + ", ".join(failed),
            file=sys.stderr,
        )
        sys.exit(1)

    print("\nAll data scripts finished OK.")


if __name__ == "__main__":
    main()
