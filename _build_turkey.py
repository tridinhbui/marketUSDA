import base64
import json
import logging
import math
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

API_BASE = "https://marsapi.ams.usda.gov/services/v1.1/reports/3647"
START = date(2019, 1, 1)
END = date.today()
CHUNK_DAYS = 365
OUT_PATH = Path("public/data/turkey_hen_weekly.json")
MAX_ATTEMPTS = 3
MARS_API_KEY = "J5v4ZF527NWTlOlFSErtwNYO/2+fa0m2ZLOtZqa3jXs="

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")


def get_mars_api_key() -> str:
    return MARS_API_KEY


def _price_or_none(value):
    try:
        price = float(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None
    return price if price is None or math.isfinite(price) else None


def map_breast_row(row):
    if (
        row.get("item") != "Breasts,Boneless/Skinless"
        or row.get("class") != "Tom"
        or row.get("trade_status") != "Domestic"
        or row.get("condition") != "Fresh"
        or row.get("environment") != "Conventional"
        or row.get("freight") != "Delivered"
        or row.get("grade") != "N/A"
    ):
        return None

    week_start = row.get("report_begin_date")
    week_end = row.get("report_end_date")
    if not week_start or not week_end:
        return None
    return {
        "week_start": week_start,
        "week_end": week_end,
        "breast_wtd_avg": _price_or_none(row.get("wtd_avg_price")),
    }


def map_whole_turkey_row(row):
    if (
        row.get("item") != "Whole Young"
        or row.get("class") != "Hen"
        or row.get("size") != "8-16 lb"
        or row.get("grade") != "U.S. Grade A"
        or row.get("trade_status") != "Domestic"
        or row.get("condition") not in ("Fresh", "Frozen")
    ):
        return None

    week_start = row.get("report_begin_date")
    week_end = row.get("report_end_date")
    low = _price_or_none(row.get("low_price"))
    high = _price_or_none(row.get("high_price"))
    weighted_average = _price_or_none(row.get("wtd_avg_price"))
    if not week_start or not week_end or low is None or high is None or weighted_average is None:
        return None

    result = {
        "week_start": week_start,
        "week_end": week_end,
        "condition": row["condition"],
        "low_price": low,
        "high_price": high,
        "wtd_avg": weighted_average,
    }
    volume = row.get("volume")
    if volume not in (None, ""):
        result["volume_lbs"] = str(volume)
    return result


def deduplicate_weekly_rows(rows):
    by_week = {}
    conflicted = set()

    for row in rows:
        key = (row["week_start"], row["week_end"])
        if key in conflicted:
            continue
        existing = by_week.get(key)
        if existing is None:
            by_week[key] = row
            continue

        old_price = existing["breast_wtd_avg"]
        new_price = row["breast_wtd_avg"]
        if old_price is None and new_price is not None:
            by_week[key] = row
        elif old_price is not None and new_price is not None and old_price != new_price:
            logging.error(
                "Conflicting USDA breast prices for %s-%s: %s vs %s",
                key[0],
                key[1],
                old_price,
                new_price,
            )
            conflicted.add(key)
            del by_week[key]

    if conflicted:
        raise ValueError(f"USDA returned conflicting prices for {len(conflicted)} Turkey week(s).")

    return sorted(
        by_week.values(),
        key=lambda row: (
            datetime.strptime(row["week_start"], "%m/%d/%Y"),
            datetime.strptime(row["week_end"], "%m/%d/%Y"),
        ),
    )


def deduplicate_whole_turkey_rows(rows):
    by_identity = {}
    for row in rows:
        key = (row["week_start"], row["week_end"], row["condition"])
        existing = by_identity.get(key)
        if existing is not None and existing != row:
            raise ValueError(
                "Conflicting Whole Turkey USDA records for "
                f"{key[0]}-{key[1]} ({key[2]})."
            )
        by_identity[key] = row
    return sorted(
        by_identity.values(),
        key=lambda row: (
            datetime.strptime(row["week_start"], "%m/%d/%Y"),
            row["condition"],
        ),
    )


def fetch_report_sections(start, end):
    fmt = lambda value: value.strftime("%m/%d/%Y")
    params = urllib.parse.urlencode(
        {
            "q": f"report_begin_date={fmt(start)}:{fmt(end)}",
            "reportSection": "Report Detail",
            "allSections": "true",
        }
    )
    request = urllib.request.Request(
        f"{API_BASE}?{params}",
        headers={
            "Authorization": f"Basic {base64.b64encode(f'{get_mars_api_key()}:'.encode()).decode()}",
            "User-Agent": "marketUSDA/1.0 (USDA MARS 3647)",
            "Accept": "application/json",
        },
    )

    for attempt in range(MAX_ATTEMPTS):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = json.load(response)
            break
        except urllib.error.HTTPError as error:
            retryable = error.code == 429 or 500 <= error.code < 600
            if not retryable or attempt == MAX_ATTEMPTS - 1:
                raise RuntimeError(f"USDA MARS request failed with HTTP {error.code}.") from error
        except (urllib.error.URLError, TimeoutError, socket.timeout) as error:
            if attempt == MAX_ATTEMPTS - 1:
                raise RuntimeError("USDA MARS request failed after retries.") from error
        time.sleep(2**attempt)

    if isinstance(payload, dict):
        sections = [payload]
    elif isinstance(payload, list) and all(isinstance(item, dict) for item in payload):
        sections = payload
    else:
        raise ValueError("USDA MARS returned an invalid report response.")

    by_name = {section.get("reportSection"): section for section in sections}
    header_section = by_name.get("Report Header")
    detail_section = by_name.get("Report Detail")
    headers = header_section.get("results") if header_section else []
    details = detail_section.get("results") if detail_section else []
    if not isinstance(headers, list) or not isinstance(details, list):
        raise ValueError("USDA MARS returned incomplete report sections.")
    if not all(isinstance(item, dict) for item in headers + details):
        raise ValueError("USDA MARS returned malformed report rows.")
    return headers, details


def fetch_chunk(start, end):
    _, raw_rows = fetch_report_sections(start, end)
    return [
        breast
        for raw in raw_rows
        if (breast := map_breast_row(raw)) is not None
    ]


def main():
    rows = []
    cursor = START
    while cursor <= END:
        chunk_end = min(cursor + timedelta(days=CHUNK_DAYS - 1), END)
        logging.info("Fetching Turkey breast history %s -> %s", cursor, chunk_end)
        rows.extend(fetch_chunk(cursor, chunk_end))
        cursor = chunk_end + timedelta(days=1)

    rows = deduplicate_weekly_rows(rows)
    output = {
        "source": "USDA MARS API v1.1",
        "report": "AMS_3647 - Weekly National Turkey Report",
        "section": "Turkey, Part",
        "category": "Domestic - Fresh - Conventional - Delivered",
        "product": "Breasts,Boneless/Skinless, Tom",
        "value": "Current Weeks Trading → Wtd Avg",
        "priceUnit": "Cents Per Lb",
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "rows": rows,
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(output, indent=2), encoding="utf-8")
    logging.info("Wrote %d unique Turkey breast weeks to %s", len(rows), OUT_PATH)


if __name__ == "__main__":
    main()
