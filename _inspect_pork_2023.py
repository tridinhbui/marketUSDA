import urllib.request, urllib.parse, json, base64

KEY   = 'J5v4ZF527NWTlOlFSErtwNYO/2+fa0m2ZLOtZqa3jXs='
CREDS = base64.b64encode(f'{KEY}:'.encode()).decode()

def fetch_details(start, end):
    params = urllib.parse.urlencode({'q': f'report_begin_date={start}:{end}', 'allSections': 'true'})
    url = f'https://marsapi.ams.usda.gov/services/v1.1/reports/2868?{params}'
    req = urllib.request.Request(url, headers={'Authorization': f'Basic {CREDS}'})
    with urllib.request.urlopen(req, timeout=20) as r:
        data = json.load(r)
    sections = data if isinstance(data, list) else [data]
    for sec in sections:
        if sec.get('reportSection') == 'Report Details':
            return sec.get('results', [])
    return []

# Check Q1 2023
rows = fetch_details('01/01/2023', '03/31/2023')
print(f'Jan-Mar 2023: {len(rows)} rows')
national = [r for r in rows if r.get('region') == 'NATIONAL']
print(f'  National rows: {len(national)}')
if national:
    dates = sorted(set(r.get('report_begin_date') for r in national))
    print(f'  Weeks: {dates[:5]} ... {dates[-3:]}')

# Check a specific week - show national cuts
print('\nNational cuts sample week:')
cuts = [(r.get('section'), r.get('type'), r.get('price_avg'), r.get('report_begin_date'))
        for r in national if r.get('condition') == 'Fresh']
for c in sorted(cuts[:15]):
    print(f'  {c}')
