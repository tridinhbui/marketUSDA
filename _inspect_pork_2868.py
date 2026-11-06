import urllib.request, urllib.parse, json, base64

KEY   = 'J5v4ZF527NWTlOlFSErtwNYO/2+fa0m2ZLOtZqa3jXs='
CREDS = base64.b64encode(f'{KEY}:'.encode()).decode()

# Explore Report 2868: Grocery Store Pork Feature Activity - Report Details
print('=== Report 2868 Report Details sample rows ===')
params = urllib.parse.urlencode({'q': 'report_begin_date=04/18/2026:04/24/2026', 'reportSection': 'Report Details', 'allSections': 'false'})
url = f'https://marsapi.ams.usda.gov/services/v1.1/reports/2868?{params}'
req = urllib.request.Request(url, headers={'Authorization': f'Basic {CREDS}'})
with urllib.request.urlopen(req, timeout=15) as r:
    data = json.load(r)

rows = data.get('results', [])
print(f'Total rows: {len(rows)}')

# Show unique commodities / types
from collections import Counter
by_type = Counter(r.get('type','') for r in rows)
by_commodity = Counter(r.get('commodity','') for r in rows)
by_region = Counter(r.get('region','') for r in rows)
by_section = Counter(r.get('section','') for r in rows)

print(f'\nCommodities: {dict(by_commodity.most_common(10))}')
print(f'\nTypes (cuts): {dict(by_type.most_common(20))}')
print(f'\nRegions: {dict(by_region.most_common(10))}')
print(f'\nSections: {dict(by_section.most_common(10))}')

# Show a few full rows
print('\n--- Sample rows ---')
for r in rows[:3]:
    print(json.dumps(r, indent=2))
    print()

# Explore Report 2833: Pork variety meats
print('\n=== Report 2833: Pork variety meats in Jan 2023 ===')
params = urllib.parse.urlencode({'q': 'report_begin_date=01/01/2023:01/31/2023', 'reportSection': 'Report Details', 'allSections': 'false'})
url = f'https://marsapi.ams.usda.gov/services/v1.1/reports/2833?{params}'
req = urllib.request.Request(url, headers={'Authorization': f'Basic {CREDS}'})
with urllib.request.urlopen(req, timeout=15) as r:
    data = json.load(r)
rows = data.get('results', [])
pork_rows = [r for r in rows if r.get('commodity') == 'Pork']
print(f'Total rows: {len(rows)}, Pork rows: {len(pork_rows)}')
if pork_rows:
    print(f'Keys: {sorted(pork_rows[0].keys())}')
    print(f'Unique items: {set(r.get("item","") for r in pork_rows)}')
    for r in pork_rows[:2]:
        print(json.dumps(r, indent=2))
