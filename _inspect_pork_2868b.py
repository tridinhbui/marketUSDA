import urllib.request, urllib.parse, json, base64
from collections import Counter

KEY   = 'J5v4ZF527NWTlOlFSErtwNYO/2+fa0m2ZLOtZqa3jXs='
CREDS = base64.b64encode(f'{KEY}:'.encode()).decode()

# Use allSections=true to get everything
params = urllib.parse.urlencode({'q': 'report_begin_date=04/18/2026:04/24/2026', 'allSections': 'true'})
url = f'https://marsapi.ams.usda.gov/services/v1.1/reports/2868?{params}'
req = urllib.request.Request(url, headers={'Authorization': f'Basic {CREDS}'})
with urllib.request.urlopen(req, timeout=15) as r:
    data = json.load(r)

sections = data if isinstance(data, list) else [data]
for sec in sections:
    name = sec.get('reportSection')
    rows = sec.get('results', [])
    print(f'\n=== Section: {name!r} | {len(rows)} rows ===')
    if rows and name == 'Report Details':
        # Show breakdown
        by_section = Counter(r.get('section','') for r in rows)
        by_type = Counter(r.get('type','') for r in rows)
        by_region = Counter(r.get('region','') for r in rows)
        print(f'  sections (cuts): {dict(by_section.most_common(20))}')
        print(f'  types: {dict(by_type.most_common(10))}')
        print(f'  regions: {dict(by_region.most_common(10))}')
        # Show national rows
        national = [r for r in rows if 'national' in r.get('region','').lower()]
        print(f'\n  National rows: {len(national)}')
        for r in national[:3]:
            print(f"    section={r.get('section')} type={r.get('type')} price_avg={r.get('price_avg')} price_unit={r.get('price_unit')} store_count={r.get('store_count')} condition={r.get('condition')}")
        print('\n  Sample full row:')
        print(json.dumps(rows[0], indent=2))
