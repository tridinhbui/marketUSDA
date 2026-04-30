"""
Fetch USDA MPR Datamart - National Daily Pork Report (LM_PK602)
Extracts daily Cutout and Primal Values (carcass, loin, butt, picnic, rib, ham, belly)
Saves to data/pork_cutout_daily.json
"""
import urllib.request, urllib.parse, json, xml.etree.ElementTree as ET, os
from datetime import date, timedelta

BASE       = 'https://mpr.datamart.ams.usda.gov/ws/report/v1/pork/LM_PK602'
CHUNK_DAYS = 180
START      = date(2020, 1, 1)
END        = date.today()
OUT        = 'data/pork_cutout_daily.json'

FIELDS = ['pork_carcass', 'pork_loin', 'pork_butt', 'pork_picnic', 'pork_rib', 'pork_ham', 'pork_belly']

def fetch_chunk(start: date, end: date) -> dict:
    """Returns {date_str: {field: float}} from both current-day and history records."""
    s = start.strftime('%-m/%-d/%Y') if os.name != 'nt' else start.strftime('%#m/%#d/%Y')
    e = end.strftime('%-m/%-d/%Y') if os.name != 'nt' else end.strftime('%#m/%#d/%Y')
    filt = json.dumps({'filters': [{'fieldName': 'Report date', 'operatorType': 'BETWEEN', 'values': [s, e]}]})
    url = f'{BASE}?filter={urllib.parse.quote(filt)}'
    with urllib.request.urlopen(url, timeout=60) as r:
        raw = r.read()
    root = ET.fromstring(raw)

    rows = {}

    def to_iso(date_str):
        try:
            m, d, y = date_str.split('/')
            return f'{y}-{m.zfill(2)}-{d.zfill(2)}'
        except Exception:
            return None

    def parse_record(date_str, attrib):
        iso = to_iso(date_str)
        if not iso or iso in rows:
            return
        vals = {}
        for f in FIELDS:
            v = attrib.get(f)
            if v and v != 'null':
                try:
                    vals[f] = float(v)
                except ValueError:
                    pass
        if vals:
            rows[iso] = vals

    # Top-level report node has slug="LM_PK602"
    # Each child <record report_date="MM/DD/YYYY"> is one day
    for report_node in root:
        if report_node.tag != 'report':
            continue
        for day_rec in report_node:
            report_date = day_rec.get('report_date', '')
            for sub in day_rec:
                lbl = sub.get('label', '')
                if lbl == 'Cutout and Primal Values':
                    for rec in sub:
                        parse_record(report_date, rec.attrib)
                elif lbl == 'Cutout and Primal History':
                    for rec in sub:
                        parse_record(rec.get('prior_date', ''), rec.attrib)

    return rows


def main():
    all_data = {}
    cur = START
    while cur <= END:
        chunk_end = min(cur + timedelta(days=CHUNK_DAYS - 1), END)
        print(f'  Fetching {cur} → {chunk_end}...', end=' ', flush=True)
        try:
            chunk = fetch_chunk(cur, chunk_end)
            print(f'{len(chunk)} days')
            all_data.update(chunk)
        except Exception as e:
            print(f'ERROR: {e}')
        cur = chunk_end + timedelta(days=1)

    out_rows = []
    for iso_date in sorted(all_data):
        row = {'date': iso_date}
        row.update({k: all_data[iso_date].get(k) for k in FIELDS})
        out_rows.append(row)

    payload = {
        'source': 'USDA MPR Datamart - National Daily Pork Report (LM_PK602)',
        'report': 'LM_PK602',
        'description': 'Daily national pork cutout and primal values ($/cwt)',
        'priceUnit': '$/cwt',
        'fields': FIELDS,
        'generatedAt': date.today().isoformat(),
        'rows': out_rows,
    }

    os.makedirs('data', exist_ok=True)
    with open(OUT, 'w') as f:
        json.dump(payload, f, indent=2)

    print(f'\nWrote {len(out_rows)} rows to {OUT}')
    if out_rows:
        print(f'Date range: {out_rows[0]["date"]} to {out_rows[-1]["date"]}')

if __name__ == '__main__':
    main()
