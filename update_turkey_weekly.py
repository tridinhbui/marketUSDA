#!/usr/bin/env python3
"""Incrementally refresh Breast JSON and Whole Turkey Supabase rows."""
from __future__ import annotations

import json
import logging
import os
import tempfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

from _build_turkey import (
    fetch_report_sections,
    map_breast_row,
    map_whole_turkey_row,
    deduplicate_weekly_rows,
    deduplicate_whole_turkey_rows,
)

ROOT = Path(__file__).resolve().parent
BREAST_JSON_PATHS = (
    ROOT / "data" / "turkey_hen_weekly.json",
    ROOT / "public" / "data" / "turkey_hen_weekly.json",
)
LOOKBACK_DAYS = 45
MAX_REPORT_AGE_DAYS = 5
LOG = logging.getLogger("turkey-weekly")


def parse_us_date(value: str) -> date:
    return datetime.strptime(value, "%m/%d/%Y").date()


def latest_report(headers: list[dict], today: date) -> dict | None:
    turkey_reports = [
        row
        for row in headers
        if row.get("report_title") == "Weekly National Turkey Report"
        and row.get("report_begin_date")
        and row.get("report_end_date")
    ]
    if not turkey_reports:
        return None

    report = max(turkey_reports, key=lambda row: parse_us_date(row["report_end_date"]))
    report_end = parse_us_date(report["report_end_date"])
    if report_end > today:
        raise ValueError("USDA returned a Turkey report dated in the future.")
    if today - report_end > timedelta(days=MAX_REPORT_AGE_DAYS):
        return None
    return report


def _read_breast_payload(path: Path) -> dict:
    with path.open(encoding="utf-8") as data_file:
        payload = json.load(data_file)
    if not isinstance(payload, dict) or not isinstance(payload.get("rows"), list):
        raise ValueError(f"Invalid Turkey Breast JSON dataset: {path}")
    return payload


def merge_breast_json(
    updates: list[dict],
    generated_at: str,
    paths: tuple[Path, ...] = BREAST_JSON_PATHS,
) -> list[tuple[Path, bytes]]:
    payloads = [(path, _read_breast_payload(path)) for path in paths]
    all_existing = []
    for _, payload in payloads:
        for row in payload["rows"]:
            if not isinstance(row, dict):
                raise ValueError("Turkey Breast JSON contains a malformed row.")
            if not row.get("week_start") or not row.get("week_end"):
                raise ValueError("Turkey Breast JSON contains a row without week dates.")
            price = row.get("breast_wtd_avg")
            all_existing.append(
                {
                    "week_start": row["week_start"],
                    "week_end": row["week_end"],
                    "breast_wtd_avg": price,
                }
            )

    existing_rows = deduplicate_weekly_rows(all_existing)
    update_rows = deduplicate_weekly_rows(updates)
    by_week = {(row["week_start"], row["week_end"]): row for row in existing_rows}

    for row in update_rows:
        key = (row["week_start"], row["week_end"])
        previous = by_week.get(key)
        if previous is not None and previous["breast_wtd_avg"] != row["breast_wtd_avg"]:
            LOG.info(
                "Updating USDA Breast price for %s-%s",
                row["week_start"],
                row["week_end"],
            )
        by_week[key] = row

    merged = deduplicate_weekly_rows(list(by_week.values()))
    source_payload = payloads[-1][1]
    data_changed = merged != existing_rows
    output_payload = {
        **source_payload,
        "generatedAt": generated_at if data_changed else source_payload.get("generatedAt"),
        "rows": merged,
    }
    encoded = (json.dumps(output_payload, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    return [(path, encoded) for path, _ in payloads]


def _atomic_write(path: Path, contents: bytes) -> bool:
    if path.exists() and path.read_bytes() == contents:
        return False

    path.parent.mkdir(parents=True, exist_ok=True)
    temp_name = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as temp_file:
            temp_name = temp_file.name
            temp_file.write(contents)
            temp_file.flush()
            os.fsync(temp_file.fileno())
        os.replace(temp_name, path)
    finally:
        if temp_name and os.path.exists(temp_name):
            os.unlink(temp_name)
    return True


def process_report(
    headers: list[dict],
    raw_rows: list[dict],
    today: date,
    whole_turkey_upsert: Callable[[list[dict]], None],
    breast_json_paths: tuple[Path, ...] = BREAST_JSON_PATHS,
) -> bool:
    report = latest_report(headers, today)
    if report is None or not raw_rows:
        LOG.info("No recent USDA Turkey report is available; leaving datasets unchanged.")
        return False

    breast_rows = []
    for raw in raw_rows:
        row = map_breast_row(raw)
        if row is not None and row["breast_wtd_avg"] is not None:
            breast_rows.append(row)
    breast_rows = deduplicate_weekly_rows(breast_rows)

    whole_rows = [
        row
        for raw in raw_rows
        if (row := map_whole_turkey_row(raw)) is not None
    ]
    whole_rows = deduplicate_whole_turkey_rows(whole_rows)

    if not breast_rows and not whole_rows:
        LOG.info("Recent report has no usable Breast or Whole Turkey records; no changes made.")
        return False

    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    breast_outputs = (
        merge_breast_json(breast_rows, generated_at, breast_json_paths)
        if breast_rows
        else []
    )

    if whole_rows:
        whole_turkey_upsert(whole_rows)

    breast_changed = False
    for path, contents in breast_outputs:
        breast_changed = _atomic_write(path, contents) or breast_changed

    LOG.info(
        "Recent report %s-%s: %d Breast week(s) processed, %d Whole Turkey condition row(s) upserted; Breast JSON changed=%s.",
        report["report_begin_date"],
        report["report_end_date"],
        len(breast_rows),
        len(whole_rows),
        breast_changed,
    )
    return bool(breast_changed or whole_rows)


def upsert_whole_turkey_rows(rows: list[dict]) -> None:
    if not (os.environ.get("SUPABASE_URL") or "").strip():
        raise RuntimeError("SUPABASE_URL is required to upsert Whole Turkey records.")
    if not (os.environ.get("SUPABASE_SERVICE_KEY") or "").strip():
        raise RuntimeError("SUPABASE_SERVICE_KEY is required to upsert Whole Turkey records.")

    from _supabase_upload import upsert_rows

    upsert_rows(
        "turkey_weekly",
        rows,
        on_conflict="week_start,week_end,condition",
    )


def main() -> None:
    today = date.today()
    start = today - timedelta(days=LOOKBACK_DAYS)
    headers, rows = fetch_report_sections(start, today)
    process_report(headers, rows, today, upsert_whole_turkey_rows)


if __name__ == "__main__":
    main()
