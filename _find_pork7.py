import urllib.request, xml.etree.ElementTree as ET

# Try without date filter - maybe pork uses different date handling
base = 'https://mpr.datamart.ams.usda.gov/ws/report/v1'

for slug in ['LM_PK602', 'LM_PK620', 'LM_PK610']:
    for cat in ['pork', 'hogs', 'retail', 'livestock']:
        # Try with no filter at all
        url = f'{base}/{cat}/{slug}'
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=8) as r:
                raw = r.read()
            if not raw.strip():
                print(f'EMPTY  {cat}/{slug} (no filter)')
            else:
                root = ET.fromstring(raw)
                records = list(root.iter('record'))
                print(f'OK {len(records):4} recs  {cat}/{slug} (no filter)')
                if records:
                    print(f'  attrs: {sorted(records[0].attrib.keys())}')
                    print(f'  sample: {dict(list(records[0].attrib.items())[:5])}')
                break
        except Exception as e:
            pass

# Try the USDA public v3.1 API for pork
print('\n--- USDA public v3.1 search ---')
import urllib.parse, json
params = urllib.parse.urlencode({'q': 'pork', 'format': 'JSON'})
url = f'https://marsapi.ams.usda.gov/services/v3.1/public/listPublishedReports?{params}'
req = urllib.request.Request(url)
with urllib.request.urlopen(req, timeout=15) as r:
    data = json.load(r)
reports = data if isinstance(data, list) else data.get('results', data.get('data', []))
print(f'Found {len(reports)} reports')
for rep in reports[:20]:
    print(f"  {rep}")
