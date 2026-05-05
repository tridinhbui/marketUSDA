"""
Fetch LM_PK680 weekly comprehensive pork cutout + primal data from MPR Datamart.
Outputs: public/data/pork_comprehensive_weekly.json
"""
from __future__ import annotations

import json
import re
import ssl
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

BASE = "https://mpr.datamart.ams.usda.gov/ws/report/v1/pork/LM_PK680"
START_DATE = date(2019, 1, 1)
END_DATE = date.today()
CHUNK_DAYS = 365

OUT_PATH = Path("public/data/pork_comprehensive_weekly.json")

FIELDS = {
    "carcass": "avg_cutout_carcass",
    "loin": "avg_cutout_loin",
    "butt": "avg_cutout_butt",
    "picnic": "avg_cutout_picnic",
    "rib": "avg_cutout_rib",
    "ham": "avg_cutout_ham",
    "belly": "avg_cutout_belly",
}


def daterange_chunks(start: date, end: date, chunk_days: int):
    cursor = start
    while cursor <= end:
        chunk_end = min(cursor + timedelta(days=chunk_days - 1), end)
        yield cursor, chunk_end
        cursor = chunk_end + timedelta(days=1)


def build_url(start: date, end: date) -> str:
    filter_obj = {
        "filters": [
            {
                "fieldName": "Report date",
                "operatorType": "BETWEEN",
                "values": [
                    f"{start.month}/{start.day}/{start.year}",
                    f"{end.month}/{end.day}/{end.year}",
                ],
            }
        ]
    }
    return f"{BASE}?filter={urllib.parse.quote(json.dumps(filter_obj))}"


def to_iso(us_date: str) -> str | None:
    parts = us_date.split("/")
    if len(parts) != 3:
        return None
    month, day, year = [int(x) for x in parts]
    return f"{year:04d}-{month:02d}-{day:02d}"


def to_float_or_none(value: str | None):
    if value in (None, "", "null"):
        return None
    try:
        return float(value.replace(",", ""))
    except ValueError:
        return None


def parse_attrs(text: str) -> dict[str, str]:
    return dict(re.findall(r'(\w+)="([^"]*)"', text))


def row_has_any_value(row: dict[str, object]) -> bool:
    return any(row.get(field) is not None for field in FIELDS)


def better_row(current: dict[str, object], incoming: dict[str, object]) -> dict[str, object]:
    return incoming if str(incoming["report_date"]) > str(current["report_date"]) else current


def parse_chunk(xml_text: str):
    rows_by_week = {}

    day_re = re.compile(
        r'<record\s+report_date="([^"]+)"\s+report_for_date="([^"]+)"[^>]*>([\s\S]*?)</record>'
    )
    sub_re = re.compile(r'<report\s+label="([^"]+)"[^>]*>([\s\S]*?)</report>')
    rec_re = re.compile(r'<record\s+([^/]*)/?>')

    for day_match in day_re.finditer(xml_text):
        report_date = to_iso(day_match.group(1))
        report_for_date = to_iso(day_match.group(2))
        if not report_date or not report_for_date:
            continue

        attrs = None
        for sub_match in sub_re.finditer(day_match.group(3)):
            if sub_match.group(1) != "Weekly Average Cutout and Primal Values":
                continue
            record_match = rec_re.search(sub_match.group(2))
            if record_match:
                attrs = parse_attrs(record_match.group(1))
            break

        if not attrs:
            continue

        row = {
            "date": report_for_date,
            "report_date": report_date,
        }
        for out_key, attr_key in FIELDS.items():
            row[out_key] = to_float_or_none(attrs.get(attr_key))

        if not row_has_any_value(row):
            continue

        current = rows_by_week.get(report_for_date)
        rows_by_week[report_for_date] = better_row(current, row) if current else row

    return rows_by_week


def fetch_xml(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "marketUSDA/1.0"})
    try:
        ctx = ssl.create_default_context()
        with urllib.request.urlopen(req, timeout=60, context=ctx) as response:
            return response.read().decode("utf-8", "ignore")
    except ssl.SSLError:
        unverified = ssl._create_unverified_context()
        with urllib.request.urlopen(req, timeout=60, context=unverified) as response:
            return response.read().decode("utf-8", "ignore")


def main():
    by_week = {}

    for chunk_start, chunk_end in daterange_chunks(START_DATE, END_DATE, CHUNK_DAYS):
        url = build_url(chunk_start, chunk_end)
        print(f"Fetching {chunk_start} -> {chunk_end}")
        chunk_rows = parse_chunk(fetch_xml(url))
        for week_ending, row in chunk_rows.items():
            current = by_week.get(week_ending)
            by_week[week_ending] = better_row(current, row) if current else row

    rows = []
    for d in sorted(by_week.keys()):
        row = dict(by_week[d])
        row.pop("report_date", None)
        rows.append(row)
    payload = {
        "source": BASE,
        "report": "LM_PK680",
        "description": "National weekly comprehensive pork prices ($/cwt)",
        "priceUnit": "$/cwt",
        "startDate": START_DATE.isoformat(),
        "endDate": END_DATE.isoformat(),
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "rows": rows,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"Wrote {len(rows)} rows to {OUT_PATH}")


if __name__ == "__main__":
    main()
