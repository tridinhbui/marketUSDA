import urllib.request, json

# Try MPR datamart pork reports - known slugs
slugs = [
    'LM_PK602',   # National Daily Pork Report - Negotiated
    'LM_PK610',   # National Daily Direct Hog Prior Day Report
    'LM_PK620',   # National Weekly Direct Hog - Prior Week Report
    'LM_PK001',
    'LM_PK002', 
    'LM_PK006',
    'LM_PK012',
    'LM_PK100',
    'LM_PK110',
    'LM_PK200',
]

base = 'https://mpr.datamart.ams.usda.gov/ws/report/v1/hogs'

for slug in slugs:
    url = f'{base}/{slug}?q=report_date=04/28/2026'
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as r:
            content = r.read(500).decode('utf-8', errors='replace')
        print(f'{slug}: OK -> {content[:120]}')
    except Exception as e:
        print(f'{slug}: ERR {e}')
