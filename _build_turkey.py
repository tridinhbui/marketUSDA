import os
import urllib.request, urllib.parse, json, base64
from datetime import date, datetime, timedelta, timezone

# GitHub may pass a literal "null" for unset secrets; treat as missing.
_MARS_DEFAULT = "J5v4ZF527NWTlOlFSErtwNYO/2+fa0m2ZLOtZqa3jXs="
_raw = (os.environ.get("USDA_MARS_API_KEY") or "").strip()
KEY = (
    _MARS_DEFAULT
    if (not _raw or _raw.lower() in ("null", "undefined", "none", ""))
    else _raw
)
CREDS = base64.b64encode(f'{KEY}:'.encode()).decode()
START = date(2023, 1, 1)
END   = date.today()
CHUNK = 365

def fetch_chunk(d_from, d_to):
    fmt = lambda d: d.strftime('%m/%d/%Y')
    params = urllib.parse.urlencode({
        'q': f'report_begin_date={fmt(d_from)}:{fmt(d_to)}',
        'reportSection': 'Report Detail',
        'allSections': 'true'
    })
    url = f'https://marsapi.ams.usda.gov/services/v1.1/reports/3647?{params}'
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
        detail = next((s for s in data if s['reportSection'] == 'Report Detail'), None)
        return detail['results'] if detail else []
    return []

all_rows = []
cur = START
while cur <= END:
    chunk_end = min(cur + timedelta(days=CHUNK - 1), END)
    print(f'Fetching {cur} -> {chunk_end}...', end=' ', flush=True)
    rows = fetch_chunk(cur, chunk_end)
    filtered = [
        r for r in rows
        if r.get('item') == 'Whole Young'
        and r.get('class') == 'Hen'
        and r.get('size') == '8-16 lb'
        and r.get('grade') == 'U.S. Grade A'
    ]
    print(f'{len(filtered)} rows')
    all_rows.extend(filtered)
    cur = chunk_end + timedelta(days=1)

all_rows.sort(key=lambda r: datetime.strptime(r['report_begin_date'], '%m/%d/%Y'))
print(f'Total: {len(all_rows)} records')

# Write to JSON
import os
os.makedirs('public/data', exist_ok=True)
output = {
    'source': 'USDA MARS API v1.1',
    'report': 'AMS_3647 - Weekly National Turkey Report',
    'item': 'Whole Young Hen, 8-16 lb, U.S. Grade A',
    'priceUnit': 'Cents Per Lb',
    'generatedAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    'rows': [
        {
            'week_start': r['report_begin_date'],
            'week_end':   r['report_end_date'],
            'condition':  r['condition'],
            'low_price':  float(r['low_price']),
            'high_price': float(r['high_price']),
            'wtd_avg':    r['wtd_avg_price'],
            'volume_lbs': r.get('volume', None),
        }
        for r in all_rows
    ]
}
with open('public/data/turkey_hen_weekly.json', 'w') as f:
    json.dump(output, f, indent=2)
print('Wrote public/data/turkey_hen_weekly.json')
