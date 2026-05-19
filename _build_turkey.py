import base64
import json
import os
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

# GitHub may pass a literal "null" for unset secrets; treat as missing.
_MARS_DEFAULT = "J5v4ZF527NWTlOlFSErtwNYO/2+fa0m2ZLOtZqa3jXs="
_raw = (os.environ.get("USDA_MARS_API_KEY") or "").strip()
KEY = (
    _MARS_DEFAULT
    if (not _raw or _raw.lower() in ("null", "undefined", "none", ""))
    else _raw
)
CREDS = base64.b64encode(f"{KEY}:".encode()).decode()
START = date(2023, 1, 1)
END = date.today()
CHUNK = 365


def as_float_or_none(value):
    if value in (None, "", "null"):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def fetch_chunk(d_from, d_to):
    fmt = lambda d: d.strftime("%m/%d/%Y")
    params = urllib.parse.urlencode(
        {
            "q": f"report_begin_date={fmt(d_from)}:{fmt(d_to)}",
            "reportSection": "Report Detail",
            "allSections": "true",
        }
    )
    url = f"https://marsapi.ams.usda.gov/services/v1.1/reports/3647?{params}"
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Basic {CREDS}",
            "User-Agent": "marketUSDA/1.0 (USDA public data; +https://github.com/tridinhbui/marketUSDA)",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.load(r)
    if isinstance(data, list):
        detail = next((s for s in data if s["reportSection"] == "Report Detail"), None)
        return detail["results"] if detail else []
    return []


def map_row(row):
    week_start = (row.get("report_begin_date") or "").strip()
    wtd_avg = as_float_or_none(row.get("wtd_avg_price") or row.get("wtd_avg"))
    if not week_start or wtd_avg is None:
        return None
    return {
        "week_start": week_start,
        "week_end": row.get("report_end_date", ""),
        "condition": row.get("condition", ""),
        "low_price": as_float_or_none(row.get("low_price")),
        "high_price": as_float_or_none(row.get("high_price")),
        "wtd_avg": wtd_avg,
        "volume_1000_lbs": as_float_or_none(row.get("volume")),
    }


def row_key(row):
    return (
        row["week_start"],
        row["week_end"],
        row["condition"],
        row["low_price"],
        row["high_price"],
        row["wtd_avg"],
        row["volume_1000_lbs"],
    )


def dedupe_rows(rows):
    seen = set()
    out = []
    for row in rows:
        key = row_key(row)
        if key in seen:
            continue
        seen.add(key)
        out.append(row)
    return out


def sort_rows(rows):
    def key(row):
        week_start = datetime.strptime(row["week_start"], "%m/%d/%Y")
        return (
            week_start,
            row["condition"],
            row["low_price"] if row["low_price"] is not None else float("inf"),
            row["high_price"] if row["high_price"] is not None else float("inf"),
            row["wtd_avg"] if row["wtd_avg"] is not None else float("inf"),
            row["volume_1000_lbs"] if row["volume_1000_lbs"] is not None else float("inf"),
        )

    rows.sort(key=key)
    return rows


all_whole_hen_rows = []
all_breast_rows = []
cur = START
while cur <= END:
    chunk_end = min(cur + timedelta(days=CHUNK - 1), END)
    print(f"Fetching {cur} -> {chunk_end}...", end=" ", flush=True)
    rows = fetch_chunk(cur, chunk_end)
    whole_hen = [
        map_row(r)
        for r in rows
        if r.get("item") == "Whole Young"
        and r.get("class") == "Hen"
        and r.get("size") == "8-16 lb"
        and r.get("grade") == "U.S. Grade A"
    ]
    breast = [
        map_row(r)
        for r in rows
        if r.get("item") == "Breasts,Boneless/Skinless"
        and r.get("class") == "Tom"
    ]
    whole_hen = [row for row in whole_hen if row is not None]
    breast = [row for row in breast if row is not None]
    print(f"{len(whole_hen)} whole hen rows, {len(breast)} breast rows")
    all_whole_hen_rows.extend(whole_hen)
    all_breast_rows.extend(breast)
    cur = chunk_end + timedelta(days=1)

all_whole_hen_rows = sort_rows(dedupe_rows(all_whole_hen_rows))
all_breast_rows = sort_rows(dedupe_rows(all_breast_rows))

print(
    f"Total: {len(all_whole_hen_rows)} whole hen records, {len(all_breast_rows)} breast records"
)

os.makedirs("public/data", exist_ok=True)
output = {
    "source": "USDA MARS API v1.1",
    "report": "AMS_3647 - Weekly National Turkey Report",
    "schemaVersion": 2,
    "priceUnit": "Cents Per Lb",
    "volumeUnit": "1,000 lbs",
    "wholeHen": {
        "item": "Whole Young",
        "class": "Hen",
        "size": "8-16 lb",
        "grade": "U.S. Grade A",
    },
    "breast": {
        "item": "Breasts,Boneless/Skinless",
        "class": "Tom",
    },
    "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "wholeHenRows": all_whole_hen_rows,
    "breastRows": all_breast_rows,
}
with open("public/data/turkey_hen_weekly.json", "w", encoding="utf-8") as f:
    json.dump(output, f, indent=2)
print("Wrote public/data/turkey_hen_weekly.json")
