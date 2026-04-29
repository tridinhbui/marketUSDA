import urllib.request, xml.etree.ElementTree as ET

# Try different category paths and date filter formats
tests = [
    ('hogs',    'LM_PK602', 'BETWEEN 04/01/2026 AND 04/29/2026'),
    ('hogs',    'LM_PK610', 'BETWEEN 04/01/2026 AND 04/29/2026'),
    ('hogs',    'LM_PK620', 'BETWEEN 04/01/2026 AND 04/29/2026'),
    ('pork',    'LM_PK602', 'BETWEEN 04/01/2026 AND 04/29/2026'),
    ('swine',   'LM_PK602', 'BETWEEN 04/01/2026 AND 04/29/2026'),
]

import urllib.parse
for cat, slug, q in tests:
    url = f'https://mpr.datamart.ams.usda.gov/ws/report/v1/{cat}/{slug}?q=report_date={urllib.parse.quote(q)}'
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=15) as r:
            raw = r.read()
        if not raw.strip():
            print(f'{cat}/{slug}: empty')
            continue
        root = ET.fromstring(raw)
        records = list(root.iter('record'))
        print(f'{cat}/{slug}: {len(records)} records')
        if records:
            print('  attrs:', sorted(records[0].attrib.keys())[:10])
            print('  sample:', {k:v for k,v in list(records[0].attrib.items())[:5]})
    except Exception as e:
        print(f'{cat}/{slug}: ERR {e}')
