import urllib.request, ssl

# Try USDA AMS text/legacy reports for pork cutout
# These are older format but sometimes still work
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

urls = [
    'https://www.ams.usda.gov/mnreports/lm_pk602.txt',
    'https://www.ams.usda.gov/mnreports/LM_PK602.txt',
    'https://www.ams.usda.gov/mnreports/lm_pk620.txt',
    'https://www.ams.usda.gov/mnreports/nw_ls796.txt',
    'https://www.ams.usda.gov/mnreports/NW_LS796.txt',
    # Try MyMarketNews
    'https://mymarketnews.ams.usda.gov/viewReport/2454',  # pork cutout
]

for url in urls:
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10, context=ctx) as r:
            content = r.read(1000).decode('utf-8', errors='replace')
        print(f'OK {url}')
        print(f'  {content[:200]}')
        print()
    except Exception as e:
        print(f'ERR {url}: {str(e)[:60]}')

# Also try MPR datamart with 'swine' category
import xml.etree.ElementTree as ET
print('\n--- MPR with swine category ---')
for slug in ['LM_PK001', 'LM_PK110', 'LM_PK200', 'LM_PK602']:
    url = f'https://mpr.datamart.ams.usda.gov/ws/report/v1/swine/{slug}'
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=8) as r:
            raw = r.read()
        print(f'swine/{slug}: len={len(raw)}  first={raw[:100]}')
    except Exception as e:
        print(f'swine/{slug}: {str(e)[:60]}')
