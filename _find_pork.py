import urllib.request, urllib.parse, json, base64

KEY   = 'J5v4ZF527NWTlOlFSErtwNYO/2+fa0m2ZLOtZqa3jXs='
CREDS = base64.b64encode(f'{KEY}:'.encode()).decode()

# List all published reports, filter for pork
params = urllib.parse.urlencode({'format': 'JSON'})
url = f'https://marsapi.ams.usda.gov/services/v1.1/reports?{params}'
req = urllib.request.Request(url, headers={'Authorization': f'Basic {CREDS}'})
with urllib.request.urlopen(req, timeout=30) as r:
    data = json.load(r)

reports = data if isinstance(data, list) else data.get('results', [])
print(f'Total reports: {len(reports)}')
print()

# Filter pork-related
keywords = ['pork', 'swine', 'hog', 'loin', 'belly', 'ham', 'bacon', 'cut', 'wholesale']
for rep in reports:
    title = str(rep.get('report_title','')).lower()
    slug  = str(rep.get('slug_name','')).lower()
    if any(k in title or k in slug for k in keywords):
        print(f"id={rep.get('slug_id'):6}  slug={rep.get('slug_name',''):15}  title={rep.get('report_title','')}")
