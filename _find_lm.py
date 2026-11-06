import urllib.request, urllib.parse, json, base64

KEY   = 'J5v4ZF527NWTlOlFSErtwNYO/2+fa0m2ZLOtZqa3jXs='
CREDS = base64.b64encode(f'{KEY}:'.encode()).decode()

params = urllib.parse.urlencode({'format': 'JSON'})
url = f'https://marsapi.ams.usda.gov/services/v1.1/reports?{params}'
req = urllib.request.Request(url, headers={'Authorization': f'Basic {CREDS}'})
with urllib.request.urlopen(req, timeout=30) as r:
    data = json.load(r)

reports = data if isinstance(data, list) else data.get('results', [])

# All LM_ slug reports
lm_reports = [r for r in reports if str(r.get('slug_name','')).upper().startswith('LM_')]
print(f'LM_ reports: {len(lm_reports)}')
for rep in lm_reports:
    print(f"id={rep.get('slug_id'):6}  slug={rep.get('slug_name',''):20}  market={rep.get('market_type',''):35}  title={rep.get('report_title','')}")
