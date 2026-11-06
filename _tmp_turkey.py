import urllib.request, urllib.parse, json, base64

key = 'J5v4ZF527NWTlOlFSErtwNYO/2+fa0m2ZLOtZqa3jXs='
creds = base64.b64encode(f'{key}:'.encode()).decode()
params = urllib.parse.urlencode({'q': 'report_begin_date=04/20/2026:04/24/2026', 'reportSection': 'Report Detail', 'allSections': 'true'})
url = f'https://marsapi.ams.usda.gov/services/v1.1/reports/3647?{params}'
req = urllib.request.Request(url, headers={'Authorization': f'Basic {creds}'})
with urllib.request.urlopen(req, timeout=20) as r:
    data = json.load(r)

detail = next(s for s in data if s['reportSection'] == 'Report Detail')
rows = detail['results']
print(f"Total items: {len(rows)}")
for row in rows:
    print(f"item={row['item']!r:45} class={row['class']!r:10} size={row['size']!r:15} grade={row['grade']!r:12} condition={row['condition']!r}")
