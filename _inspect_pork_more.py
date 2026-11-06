import urllib.request, urllib.parse, json, base64

KEY   = 'J5v4ZF527NWTlOlFSErtwNYO/2+fa0m2ZLOtZqa3jXs='
CREDS = base64.b64encode(f'{KEY}:'.encode()).decode()

# Check report 2810 - National Direct Feeder Pig Report
print('=== Report 2810: National Direct Feeder Pig ===')
params = urllib.parse.urlencode({'q': 'report_begin_date=04/01/2026:04/29/2026', 'allSections': 'true'})
url = f'https://marsapi.ams.usda.gov/services/v1.1/reports/2810?{params}'
req = urllib.request.Request(url, headers={'Authorization': f'Basic {CREDS}'})
with urllib.request.urlopen(req, timeout=15) as r:
    data = json.load(r)
sections = data if isinstance(data, list) else [data]
for sec in sections:
    rows = sec.get('results', [])
    if rows:
        print(f"  Section: {sec.get('reportSection')} | {len(rows)} rows")
        print(f"  Keys: {sorted(rows[0].keys())}")
        print(f"  Sample: {json.dumps(rows[0], indent=4)[:600]}")

# Check report 2833 for pork data (broader range)
print('\n=== Report 2833: Beef & Pork Variety Meats ===')
params = urllib.parse.urlencode({'q': 'report_begin_date=01/01/2023:01/31/2023', 'allSections': 'true'})
url = f'https://marsapi.ams.usda.gov/services/v1.1/reports/2833?{params}'
req = urllib.request.Request(url, headers={'Authorization': f'Basic {CREDS}'})
with urllib.request.urlopen(req, timeout=15) as r:
    data = json.load(r)
sections = data if isinstance(data, list) else [data]
for sec in sections:
    rows = sec.get('results', [])
    if rows:
        commodities = set(r.get('commodity','') for r in rows)
        print(f"  Section: {sec.get('reportSection')} | {len(rows)} rows | commodities: {commodities}")

# Check report 2868 - Grocery Store Pork Feature Activity (broader range)
print('\n=== Report 2868: Grocery Store Pork Feature ===')
params = urllib.parse.urlencode({'q': 'report_begin_date=03/01/2026:04/29/2026', 'allSections': 'true'})
url = f'https://marsapi.ams.usda.gov/services/v1.1/reports/2868?{params}'
req = urllib.request.Request(url, headers={'Authorization': f'Basic {CREDS}'})
with urllib.request.urlopen(req, timeout=15) as r:
    data = json.load(r)
sections = data if isinstance(data, list) else [data]
for sec in sections:
    rows = sec.get('results', [])
    print(f"  Section: {sec.get('reportSection')} | {len(rows)} rows")
    if rows:
        print(f"  Keys: {sorted(rows[0].keys())}")
        print(f"  Sample: {json.dumps(rows[0], indent=4)[:400]}")
