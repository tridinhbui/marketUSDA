import urllib.request, urllib.parse, json, base64
from collections import Counter

KEY   = 'J5v4ZF527NWTlOlFSErtwNYO/2+fa0m2ZLOtZqa3jXs='
CREDS = base64.b64encode(f'{KEY}:'.encode()).decode()

params = urllib.parse.urlencode({'q': 'report_begin_date=01/01/2023:03/31/2023', 'allSections': 'true'})
url = f'https://marsapi.ams.usda.gov/services/v1.1/reports/2868?{params}'
req = urllib.request.Request(url, headers={'Authorization': f'Basic {CREDS}'})
with urllib.request.urlopen(req, timeout=20) as r:
    data = json.load(r)
sections = data if isinstance(data, list) else [data]
for sec in sections:
    if sec.get('reportSection') == 'Report Details':
        rows = sec.get('results', [])
        regions = Counter(r.get('region','') for r in rows)
        print(f'Regions: {dict(regions.most_common(15))}')
        dates = sorted(set(r.get('report_begin_date','') for r in rows))
        print(f'Date range: {dates[0]} to {dates[-1]}, {len(dates)} weeks')
        # Show sample by bacon
        bacon = [r for r in rows if 'Bacon' in r.get('type','')]
        print(f'\nBacon rows: {len(bacon)}')
        regions_bacon = Counter(r.get('region') for r in bacon)
        print(f'Bacon regions: {dict(regions_bacon)}')
        for r in bacon[:2]:
            print(json.dumps(r, indent=2))
