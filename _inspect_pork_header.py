import urllib.request, urllib.parse, json, base64

KEY   = 'J5v4ZF527NWTlOlFSErtwNYO/2+fa0m2ZLOtZqa3jXs='
CREDS = base64.b64encode(f'{KEY}:'.encode()).decode()

for rid in [2833, 2838]:
    # First get the available sections
    params = urllib.parse.urlencode({'q': 'report_begin_date=04/20/2026:04/29/2026'})
    url = f'https://marsapi.ams.usda.gov/services/v1.1/reports/{rid}?{params}'
    req = urllib.request.Request(url, headers={'Authorization': f'Basic {CREDS}'})
    with urllib.request.urlopen(req, timeout=15) as r:
        data = json.load(r)
    sections_avail = data.get('reportSections', []) if isinstance(data, dict) else []
    print(f'\nReport {rid}: sections={sections_avail}')
    print('  results count:', len(data.get('results', data if isinstance(data, list) else [])))
    rows = data.get('results', [])
    if rows:
        print('  keys:', sorted(rows[0].keys()))
        print('  sample:', json.dumps(rows[0], indent=4))
