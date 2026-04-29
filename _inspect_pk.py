import urllib.request, xml.etree.ElementTree as ET

base = 'https://mpr.datamart.ams.usda.gov/ws/report/v1/hogs'

for slug in ['LM_PK602', 'LM_PK610', 'LM_PK620']:
    url = f'{base}/{slug}?q=report_date=04/28/2026'
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=15) as r:
            raw = r.read()
        root = ET.fromstring(raw)
        print(f'\n=== {slug} ===')
        # Find all record tags and print unique attributes
        attrs = set()
        for rec in root.iter('record'):
            attrs.update(rec.attrib.keys())
        print('Record attrs:', sorted(attrs))
        # print first 2 records
        for i, rec in enumerate(root.iter('record')):
            if i >= 2:
                break
            print(dict(rec.attrib))
    except Exception as e:
        print(f'{slug}: ERR {e}')
