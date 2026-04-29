import urllib.request, urllib.parse, json, base64

KEY   = 'J5v4ZF527NWTlOlFSErtwNYO/2+fa0m2ZLOtZqa3jXs='
CREDS = base64.b64encode(f'{KEY}:'.encode()).decode()

params = urllib.parse.urlencode({'format': 'JSON'})
url = f'https://marsapi.ams.usda.gov/services/v1.1/reports?{params}'
req = urllib.request.Request(url, headers={'Authorization': f'Basic {CREDS}'})
with urllib.request.urlopen(req, timeout=30) as r:
    data = json.load(r)

reports = data if isinstance(data, list) else data.get('results', [])

# Filter LM_ pork/swine/hog reports specifically
keywords = ['pork', 'swine', 'hog', 'loin', 'belly', 'ham', 'bacon', 'rib', 'shoulder', 'butt', 'picnic', 'carcass', 'cut-out', 'cutout', 'primal']
for rep in reports:
    title = str(rep.get('report_title','')).lower()
    slug  = str(rep.get('slug_name','')).lower()
    if 'lm_' in slug and any(k in title for k in keywords):
        print(f"id={rep.get('slug_id'):6}  slug={rep.get('slug_name',''):20}  market={rep.get('market_type',''):30}  title={rep.get('report_title','')}")
