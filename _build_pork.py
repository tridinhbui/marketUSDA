"""
Fetch USDA AMS Weekly Grocery Store Pork Feature Activity (AMS_2868)
- National-level rows only
- Key cuts: Sliced Bacon, Backribs, Spareribs, CC Loin Chops Boneless,
            Butt Roast Bone-In, Breakfast Sausage
- Saves data/pork_retail_weekly.json
"""
import os
import urllib.request, urllib.parse, json, base64
from datetime import date, timedelta

KEY        = os.environ.get(
    "USDA_MARS_API_KEY",
    "J5v4ZF527NWTlOlFSErtwNYO/2+fa0m2ZLOtZqa3jXs=",
)
CREDS      = base64.b64encode(f'{KEY}:'.encode()).decode()
BASE       = 'https://marsapi.ams.usda.gov/services/v1.1/reports/2868'
CHUNK_DAYS = 90  # keep requests small enough
START      = date(2023, 1, 1)
END        = date.today()
OUT        = 'data/pork_retail_weekly.json'

# Cuts we care about (type name → label used in JSON)
KEY_CUTS = {
    'Sliced Bacon':            'Sliced Bacon',
    'Backribs':                'Backribs',
    'Spareribs':               'Spareribs',
    'St. Louis Style Spareribs': 'St. Louis Spareribs',
    'CC Loin Chops, Boneless': 'Loin Chops (Boneless)',
    'CC Loin Chops, Bone-In':  'Loin Chops (Bone-In)',
    'Butt Roast, Bone-In':     'Butt Roast',
    'Breakfast Sausage, Link/Patty': 'Breakfast Sausage',
    'Pork Belly':              'Pork Belly',
    'Ground Pork':             'Ground Pork',
}

def fetch_chunk(start: date, end: date) -> list:
    s = start.strftime('%m/%d/%Y')
    e = end.strftime('%m/%d/%Y')
    params = urllib.parse.urlencode({'q': f'report_begin_date={s}:{e}', 'allSections': 'true'})
    url = f'{BASE}?{params}'
    req = urllib.request.Request(url, headers={'Authorization': f'Basic {CREDS}'})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.load(r)
    sections = data if isinstance(data, list) else [data]
    for sec in sections:
        if sec.get('reportSection') == 'Report Details':
            return sec.get('results', [])
    return []

def iso(mmddyyyy: str) -> str:
    m, d, y = mmddyyyy.split('/')
    return f'{y}-{m}-{d}'

def main():
    all_rows = []
    cur = START
    while cur <= END:
        chunk_end = min(cur + timedelta(days=CHUNK_DAYS - 1), END)
        print(f'  Fetching {cur} → {chunk_end}...', end=' ', flush=True)
        rows = fetch_chunk(cur, chunk_end)
        # Filter: national + key cuts only
        national = [r for r in rows
                    if r.get('region', '').lower() == 'national'
                    and r.get('type', '') in KEY_CUTS]
        print(f'{len(rows)} rows → {len(national)} national key-cut rows')
        all_rows.extend(national)
        cur = chunk_end + timedelta(days=1)

    # Deduplicate (same week_start + type can appear multiple times with diff conditions)
    # Aggregate: weighted avg price by store_count per (week_start, type, condition)
    from collections import defaultdict
    buckets = defaultdict(lambda: {'price_sum': 0.0, 'store_sum': 0, 'section': '', 'week_end': ''})
    for r in all_rows:
        key = (iso(r['report_begin_date']), r['type'], r.get('condition', ''))
        b = buckets[key]
        price = float(r['price_avg']) if r.get('price_avg') is not None else None
        stores = int(r['store_count']) if r.get('store_count') is not None else 0
        if price is not None:
            b['price_sum'] += price * max(stores, 1)
            b['store_sum'] += max(stores, 1)
        b['section'] = r.get('section', '')
        b['week_end'] = iso(r['report_end_date'])

    out_rows = []
    for (week_start, typ, condition), b in sorted(buckets.items()):
        if b['store_sum'] > 0:
            out_rows.append({
                'week_start': week_start,
                'week_end': b['week_end'],
                'section': b['section'],
                'type': KEY_CUTS[typ],
                'condition': condition,
                'price_avg': round(b['price_sum'] / b['store_sum'], 4),
            })

    out_rows.sort(key=lambda r: (r['week_start'], r['type'], r['condition']))

    payload = {
        'source': 'USDA AMS Weekly Grocery Store Pork Feature Activity (AMS_2868)',
        'report': 'AMS_2868',
        'description': 'National avg retail feature price ($/lb) for key pork cuts',
        'priceUnit': '$/lb',
        'generatedAt': date.today().isoformat(),
        'rows': out_rows,
    }

    import os
    os.makedirs('data', exist_ok=True)
    with open(OUT, 'w') as f:
        json.dump(payload, f, indent=2)

    print(f'\nWrote {len(out_rows)} rows to {OUT}')
    # Summary
    types_seen = sorted(set(r['type'] for r in out_rows))
    print(f'Cut types: {types_seen}')
    if out_rows:
        print(f'Date range: {out_rows[0]["week_start"]} to {out_rows[-1]["week_start"]}')

if __name__ == '__main__':
    main()
