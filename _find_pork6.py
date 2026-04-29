import urllib.request, xml.etree.ElementTree as ET, urllib.parse, json, base64

# Test MPR Datamart with various pork/cutout slugs and categories
base = 'https://mpr.datamart.ams.usda.gov/ws/report/v1'
q = urllib.parse.quote('BETWEEN 04/01/2026 AND 04/29/2026')

# Common pork cutout / primal reports
test_cases = [
    ('retail', 'LM_PK602'),
    ('retail', 'LM_PK610'),
    ('retail', 'LM_PK620'),
    ('livestock', 'LM_PK602'),
    ('livestock', 'LM_PK620'),
    ('pork', 'NW_LS796'),   # National Weekly Pork - Comprehensive
    ('hogs', 'NW_LS796'),
    ('pork', 'LM_PK602'),
    ('pork', 'LM_PK620'),
    ('pork', 'LM_PK001'),
    ('pork', 'LM_PK002'),
    ('pork', 'LM_PK010'),
    ('pork', 'LM_PK100'),
]

for cat, slug in test_cases:
    url = f'{base}/{cat}/{slug}?q=report_date={q}'
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=8) as r:
            raw = r.read()
        if not raw.strip():
            print(f'EMPTY  {cat}/{slug}')
            continue
        root = ET.fromstring(raw)
        records = list(root.iter('record'))
        print(f'OK {len(records):4} recs  {cat}/{slug}')
        if records:
            attrs = sorted(records[0].attrib.keys())
            print(f'           attrs: {attrs}')
    except Exception as e:
        code = str(e)[:50]
        print(f'ERR    {cat}/{slug}  -> {code}')

# Also check report 2868 detail sections
print('\n--- MARS API report 2868 (Grocery Store Pork Feature) ---')
KEY   = 'J5v4ZF527NWTlOlFSErtwNYO/2+fa0m2ZLOtZqa3jXs='
CREDS = base64.b64encode(f'{KEY}:'.encode()).decode()
params = urllib.parse.urlencode({'q': 'report_begin_date=04/20/2026:04/29/2026', 'allSections': 'true'})
url = f'https://marsapi.ams.usda.gov/services/v1.1/reports/2868?{params}'
req = urllib.request.Request(url, headers={'Authorization': f'Basic {CREDS}'})
with urllib.request.urlopen(req, timeout=15) as r:
    data = json.load(r)
sections = data if isinstance(data, list) else [data]
for sec in sections:
    rows = sec.get('results', [])
    print(f"  Section: {sec.get('reportSection')} | {len(rows)} rows")
    if rows:
        print(f"    keys: {sorted(rows[0].keys())}")
        print(f"    sample: {json.dumps(rows[0], indent=6)[:500]}")
