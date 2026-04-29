import urllib.request, urllib.parse, json, base64
from datetime import date, timedelta

KEY   = 'J5v4ZF527NWTlOlFSErtwNYO/2+fa0m2ZLOtZqa3jXs='
CREDS = base64.b64encode(f'{KEY}:'.encode()).decode()
START = date(2023, 1, 1)
END   = date.today()
CHUNK = 365  # days per request (weekly report, so fewer records)

def fetch_chunk(d_from, d_to):
    fmt = lambda d: d.strftime('%m/%d/%Y')
    params = urllib.parse.urlencode({
        'q': f'report_begin_date={fmt(d_from)}:{fmt(d_to)}',
        'reportSection': 'Report Detail',
        'allSections': 'true'
    })
    url = f'https://marsapi.ams.usda.gov/services/v1.1/reports/3647?{params}'
    req = urllib.request.Request(url, headers={'Authorization': f'Basic {CREDS}'})
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
    print(f'Fetching {cur} → {chunk_end}...', end=' ', flush=True)
    rows = fetch_chunk(cur, chunk_end)
    # Filter: Whole Young Hen 8-16 lb U.S. Grade A
    filtered = [
        r for r in rows
        if r.get('item') == 'Whole Young'
        and r.get('class') == 'Hen'
        and r.get('size') == '8-16 lb'
        and r.get('grade') == 'U.S. Grade A'
    ]
    print(f'{len(filtered)} Hen 8-16 lb rows')
    all_rows.extend(filtered)
    cur = chunk_end + timedelta(days=1)

# Sort by report_begin_date
from datetime import datetime
all_rows.sort(key=lambda r: datetime.strptime(r['report_begin_date'], '%m/%d/%Y'))

# Print summary table
print(f'\n{"Week Starting":15} {"Condition":8} {"Low":8} {"High":8} {"Wtd Avg":8} {"Vol (lbs)":10}')
print('-' * 65)
for r in all_rows:
    print(f"{r['report_begin_date']:15} {r['condition']:8} {r['low_price']:>8} {r['high_price']:>8} {str(r['wtd_avg_price']):>8} {r.get('volume','N/A'):>10}")

print(f'\nTotal: {len(all_rows)} weeks')
