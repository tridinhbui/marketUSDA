import urllib.request, urllib.parse, json, base64

KEY   = 'J5v4ZF527NWTlOlFSErtwNYO/2+fa0m2ZLOtZqa3jXs='
CREDS = base64.b64encode(f'{KEY}:'.encode()).decode()

params = urllib.parse.urlencode({'format': 'JSON'})
url = f'https://marsapi.ams.usda.gov/services/v1.1/reports?{params}'
req = urllib.request.Request(url, headers={'Authorization': f'Basic {CREDS}'})
with urllib.request.urlopen(req, timeout=30) as r:
    data = json.load(r)

reports = data if isinstance(data, list) else data.get('results', [])

# Focus on "Livestock - Pork" market type
print('=== By market_type containing Pork/Swine/Hog ===')
for rep in reports:
    mt = str(rep.get('market_type', '')).lower()
    title = str(rep.get('report_title', '')).lower()
    if 'pork' in mt or 'swine' in mt or ('hog' in mt and 'slaughter' not in title):
        print(f"  id={rep.get('slug_id'):6}  mt={rep.get('market_type',''):35}  slug={rep.get('slug_name',''):20}  title={rep.get('report_title','')}")

print()
# Also list all unique market_types
mts = sorted(set(r.get('market_type','') for r in reports))
print('All market types:', mts[:30])
