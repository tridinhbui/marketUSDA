import urllib.request, urllib.parse, json, base64
from collections import Counter

KEY   = 'J5v4ZF527NWTlOlFSErtwNYO/2+fa0m2ZLOtZqa3jXs='
CREDS = base64.b64encode(f'{KEY}:'.encode()).decode()

params = urllib.parse.urlencode({'q': 'report_begin_date=04/18/2026:04/24/2026', 'allSections': 'true'})
url = f'https://marsapi.ams.usda.gov/services/v1.1/reports/2868?{params}'
req = urllib.request.Request(url, headers={'Authorization': f'Basic {CREDS}'})
with urllib.request.urlopen(req, timeout=15) as r:
    data = json.load(r)
sections = data if isinstance(data, list) else [data]
for sec in sections:
    if sec.get('reportSection') == 'Report Details':
        rows = sec.get('results', [])
        national = [r for r in rows if r.get('region','').lower() == 'national']
        print(f'National rows: {len(national)}')
        by_type = Counter(r.get('type','') for r in national)
        print('\nTop types (national):')
        for typ, cnt in by_type.most_common(30):
            sample = next((r for r in national if r.get('type')==typ), {})
            print(f'  {typ!r:50} | n={cnt} | avg=${sample.get("price_avg")} | section={sample.get("section")}')
