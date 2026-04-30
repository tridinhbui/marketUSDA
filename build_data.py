from __future__ import annotations

import json
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

API_BASE = "https://mpr.datamart.ams.usda.gov/ws/report/v1/hogs/LM_HG217"
START_DATE = date(2023, 1, 1)
END_DATE = date.today()
CHUNK_DAYS = 170

OUT_PATH = Path("public/data/lm_hg217_daily_prices.json")


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
    return f"{API_BASE}?filter={urllib.parse.quote(json.dumps(filter_obj))}"


def to_iso(us_date: str) -> str:
    month, day, year = [int(x) for x in us_date.split("/")]
    return f"{year:04d}-{month:02d}-{day:02d}"


def to_float_or_none(value: str | None):
    if value in (None, "", "null"):
        return None
    try:
        return float(value)
    except ValueError:
        return None


def parse_chunk(xml_text: str):
    root = ET.fromstring(xml_text)
    rows = []

    top_report = root.find("./report")
    if top_report is None:
        return rows

    for day_record in top_report.findall("./record"):
        us_date = day_record.attrib.get("report_date")
        if not us_date:
            continue

        national = None
        iowa_mn = None
        western = None

        for section in day_record.findall("./report"):
            label = section.attrib.get("label")
            if label not in (
                "National Volume and Price Data",
                "Iowa/Minnesota Volume and Price Data",
                "Western Cornbelt Volume and Price Data",
            ):
                continue

            for row in section.findall("./record"):
                if row.attrib.get("purchase_type") == "Negotiated (carcass basis)":
                    value = to_float_or_none(row.attrib.get("wtd_avg"))
                    if label == "National Volume and Price Data":
                        national = value
                    elif label == "Iowa/Minnesota Volume and Price Data":
                        iowa_mn = value
                    else:
                        western = value

        rows.append(
            {
                "date": to_iso(us_date),
                "national": national,
                "iowaMn": iowa_mn,
                "western": western,
            }
        )

    return rows


def fetch_xml(url: str) -> str:
    with urllib.request.urlopen(url, timeout=60) as response:
        return response.read().decode("utf-8", "ignore")


def main():
    by_date = {}

    for chunk_start, chunk_end in daterange_chunks(START_DATE, END_DATE, CHUNK_DAYS):
        url = build_url(chunk_start, chunk_end)
        print(f"Fetching {chunk_start} -> {chunk_end}")
        chunk_rows = parse_chunk(fetch_xml(url))
        for row in chunk_rows:
            by_date[row["date"]] = row

    rows = [by_date[d] for d in sorted(by_date.keys())]
    payload = {
        "source": API_BASE,
        "report": "LM_HG217",
        "purchaseType": "Negotiated (carcass basis)",
        "series": ["national", "iowaMn", "western"],
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
