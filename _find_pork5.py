import urllib.request, urllib.parse, json, base64

KEY   = 'J5v4ZF527NWTlOlFSErtwNYO/2+fa0m2ZLOtZqa3jXs='
CREDS = base64.b64encode(f'{KEY}:'.encode()).decode()

params = urllib.parse.urlencode({'format': 'JSON'})
url = f'https://marsapi.ams.usda.gov/services/v1.1/reports?{params}'
req = urllib.request.Request(url, headers={'Authorization': f'Basic {CREDS}'})
with urllib.request.urlopen(req, timeout=30) as r:
    data = json.load(r)

reports = data if isinstance(data, list) else data.get('results', [])

# Show field names of the report listing
print('Report listing keys:', list(reports[0].keys()) if reports else [])
print('Sample report:', json.dumps(reports[0], indent=2) if reports else '')
print()

# Search by title for pork primal/wholesale/cutout
keywords = ['pork', 'loin', 'belly', 'ham', 'rib', 'butt', 'picnic', 'cutout', 'primal', 'wholesale', 'swine']
print('=== Pork-related reports ===')
for rep in reports:
    title = str(rep.get('report_title', '') or rep.get('title', '')).lower()
    slug  = str(rep.get('slug_name', '')).lower()
    for k in keywords:
        if k in title or k in slug:
            print(f"  {json.dumps({kk:rep[kk] for kk in rep if rep[kk]})}")
            break
