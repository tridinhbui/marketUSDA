import urllib.request, urllib.parse, json, base64

KEY   = 'J5v4ZF527NWTlOlFSErtwNYO/2+fa0m2ZLOtZqa3jXs='
CREDS = base64.b64encode(f'{KEY}:'.encode()).decode()

# Get ALL reports (there might be more pages)
all_reports = []
for page in range(1, 5):
    params = urllib.parse.urlencode({'format': 'JSON', 'page': page, 'pagesize': 500})
    url = f'https://marsapi.ams.usda.gov/services/v1.1/reports?{params}'
    req = urllib.request.Request(url, headers={'Authorization': f'Basic {CREDS}'})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.load(r)
    batch = data if isinstance(data, list) else data.get('results', [])
    if not batch:
        break
    all_reports.extend(batch)
    print(f'Page {page}: {len(batch)} reports (total so far: {len(all_reports)})')

print(f'\nTotal reports: {len(all_reports)}')

# Now search specifically for pork/swine/ham/loin/belly in titles
pork_keywords = ['pork', 'swine', ' ham ', 'belly', 'loin', 'cutout', 'primal', 'shoulder', 'rib', 'butt', 'picnic']
print('\n=== All reports with pork keywords in title ===')
for rep in all_reports:
    title = str(rep.get('report_title', '')).lower()
    if any(k in title for k in pork_keywords):
        print(f"  id={rep['slug_id']:6}  slug={rep['slug_name']:20}  title={rep['report_title']}")
