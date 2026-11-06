import urllib.request, xml.etree.ElementTree as ET, urllib.parse

# Check MPR datamart for pork using the correct category
# Also try the NW_ prefix reports via MARS API
base = 'https://mpr.datamart.ams.usda.gov/ws/report/v1'
q = urllib.parse.quote('BETWEEN 04/01/2026 AND 04/29/2026')

candidates = [
    f'{base}/pork/LM_PK602?q=report_date={q}',
    f'{base}/retail/LM_PK602?q=report_date={q}',
    f'{base}/pork/LM_PK620?q=report_date={q}',
    # Try the NW (National Weekly) cutout report
    f'{base}/pork/LM_PK001?q=report_date={q}',
    # slaughter pork
    f'{base}/hogs/LM_PK001?q=report_date={q}',
]

for url in candidates:
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=15) as r:
            raw = r.read()
        if not raw.strip():
            print(f'EMPTY: {url.split("/v1/")[1][:40]}')
            continue
        root = ET.fromstring(raw)
        records = list(root.iter('record'))
        print(f'OK ({len(records)} rec): {url.split("/v1/")[1][:50]}')
        if records:
            print('   attrs:', sorted(records[0].attrib.keys()))
    except Exception as e:
        code = str(e)[:60]
        print(f'ERR: {url.split("/v1/")[1][:40]} -> {code}')

# Also try MARS API NW_ reports
import base64, json
KEY   = 'J5v4ZF527NWTlOlFSErtwNYO/2+fa0m2ZLOtZqa3jXs='
CREDS = base64.b64encode(f'{KEY}:'.encode()).decode()
print('\n--- MARS API NW_ pork reports ---')
for rid in [2833, 2835, 2838, 2868]:
    params = urllib.parse.urlencode({'q': 'report_begin_date=04/20/2026:04/29/2026', 'allSections': 'true'})
    url = f'https://marsapi.ams.usda.gov/services/v1.1/reports/{rid}?{params}'
    req = urllib.request.Request(url, headers={'Authorization': f'Basic {CREDS}'})
    with urllib.request.urlopen(req, timeout=15) as r:
        data = json.load(r)
    sections = data if isinstance(data, list) else [data]
    for sec in sections:
        rows = sec.get('results', [])
        if rows:
            allkeys = set(k for row in rows for k in row)
            print(f'  Report {rid} sec={sec.get("reportSection","")} rows={len(rows)} keys_sample={sorted(allkeys)[:8]}')
            break
    else:
        print(f'  Report {rid}: no results')
