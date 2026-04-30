"""
Fetch LM_PK602 pork cutout + primal data from MPR Datamart.
Outputs: public/data/pork_cutout_daily.json
"""
import json, re, ssl, urllib.request, urllib.parse
from datetime import date, timedelta
from pathlib import Path

BASE = "https://mpr.datamart.ams.usda.gov/ws/report/v1/pork/LM_PK602"
FIELDS = ["pork_carcass","pork_loin","pork_butt","pork_picnic","pork_rib","pork_ham","pork_belly"]
OUT = Path(__file__).parent / "public" / "data" / "pork_cutout_daily.json"

def to_iso(mmddyyyy: str):
    parts = mmddyyyy.split("/")
    if len(parts) != 3: return None
    m, d, y = parts
    return f"{y}-{m.zfill(2)}-{d.zfill(2)}"

def parse_float(v):
    try: return float(v)
    except: return None

def parse_attrs(s):
    return dict(re.findall(r'(\w+)="([^"]*)"', s))

def parse_xml(xml_text: str, rows: dict):
    # Match day-level records
    for day_m in re.finditer(r'<record\s+report_date="([^"]+)"[^>]*>([\s\S]*?)</record>', xml_text):
        report_date = day_m.group(1)
        report_iso = to_iso(report_date)
        body = day_m.group(2)

        for sub_m in re.finditer(r'<report\s+label="([^"]+)"[^>]*>([\s\S]*?)</report>', body):
            label = sub_m.group(1)
            sub_body = sub_m.group(2)

            if label == "Cutout and Primal Values" and report_iso:
                rec = re.search(r'<record\s+([^/]*)/?>', sub_body)
                if rec:
                    attrs = parse_attrs(rec.group(1))
                    if report_iso not in rows:
                        row = {"date": report_iso}
                        for f in FIELDS:
                            row[f] = parse_float(attrs.get(f))
                        if any(row[f] is not None for f in FIELDS):
                            rows[report_iso] = row

            elif label == "Cutout and Primal History":
                for prior_m in re.finditer(r'<record\s+([^/]*)/>', sub_body):
                    attrs = parse_attrs(prior_m.group(1))
                    prior_iso = to_iso(attrs.get("prior_date", ""))
                    if prior_iso and prior_iso not in rows:
                        row = {"date": prior_iso}
                        for f in FIELDS:
                            row[f] = parse_float(attrs.get(f))
                        if any(row[f] is not None for f in FIELDS):
                            rows[prior_iso] = row

def fetch_chunk(start: date, end: date, rows: dict):
    sd = f"{start.month}/{start.day}/{start.year}"
    ed = f"{end.month}/{end.day}/{end.year}"
    filt = json.dumps({"filters":[{"fieldName":"Report date","operatorType":"BETWEEN","values":[sd,ed]}]})
    url = f"{BASE}?filter={urllib.parse.quote(filt)}"
    print(f"  fetching {sd} → {ed} ...")
    req = urllib.request.Request(url, headers={"User-Agent":"marketUSDA/1.0"})
    for attempt in range(3):
        try:
            ctx = ssl.create_default_context()
            with urllib.request.urlopen(req, timeout=60, context=ctx) as resp:
                xml = resp.read().decode("utf-8", errors="replace")
            parse_xml(xml, rows)
            return
        except Exception as e:
            if attempt == 2:
                print(f"  WARNING: skipping chunk {sd}→{ed} after 3 failures: {e}")
            else:
                import time; time.sleep(3)

def main():
    start = date(2019, 1, 1)
    end = date.today()
    rows = {}
    chunk_start = start
    chunk_days = 180
    while chunk_start <= end:
        chunk_end = min(chunk_start + timedelta(days=chunk_days - 1), end)
        fetch_chunk(chunk_start, chunk_end, rows)
        chunk_start = chunk_end + timedelta(days=1)

    sorted_rows = sorted(rows.values(), key=lambda r: r["date"])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(sorted_rows, f, separators=(",", ":"))
    print(f"\nSaved {len(sorted_rows)} rows → {OUT}")

if __name__ == "__main__":
    main()
