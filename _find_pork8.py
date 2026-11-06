import urllib.request, urllib.parse, json, base64

KEY   = 'J5v4ZF527NWTlOlFSErtwNYO/2+fa0m2ZLOtZqa3jXs='
CREDS = base64.b64encode(f'{KEY}:'.encode()).decode()

params = urllib.parse.urlencode({'format': 'JSON'})
url = f'https://marsapi.ams.usda.gov/services/v1.1/reports?{params}'
req = urllib.request.Request(url, headers={'Authorization': f'Basic {CREDS}'})
with urllib.request.urlopen(req, timeout=30) as r:
    data = json.load(r)

reports = data if isinstance(data, list) else data.get('results', [])

# All unique market_types
all_mts = set()
for r in reports:
    for mt in r.get('market_types', []):
        all_mts.add(mt)
print('All market types:')
for mt in sorted(all_mts):
    print(f'  {mt!r}')

print()
# Reports with "livestock" or "negotiated" in market type, but not auction or drop
print('=== Livestock negotiated/pork market types ===')
for rep in reports:
    mts = rep.get('market_types', [])
    for mt in mts:
        mt_lo = mt.lower()
        if ('livestock' in mt_lo or 'pork' in mt_lo or 'swine' in mt_lo) and 'drop' not in mt_lo and 'auction' not in mt_lo:
            print(f"  id={rep['slug_id']:6}  mt={mt:35}  slug={rep['slug_name']:20}  title={rep['report_title']}")
            break
