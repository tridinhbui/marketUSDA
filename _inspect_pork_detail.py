import urllib.request, urllib.parse, json, base64

KEY   = 'J5v4ZF527NWTlOlFSErtwNYO/2+fa0m2ZLOtZqa3jXs='
CREDS = base64.b64encode(f'{KEY}:'.encode()).decode()

for rid in [2833, 2838]:
    params = urllib.parse.urlencode({
        'q': 'report_begin_date=04/20/2026:04/29/2026',
        'reportSection': 'Report Detail',
        'allSections': 'true'
    })
    url = f'https://marsapi.ams.usda.gov/services/v1.1/reports/{rid}?{params}'
    req = urllib.request.Request(url, headers={'Authorization': f'Basic {CREDS}'})
    with urllib.request.urlopen(req, timeout=15) as r:
        data = json.load(r)
    
    sections = data if isinstance(data, list) else [data]
    detail = next((s for s in sections if s.get('reportSection') == 'Report Detail'), None)
    if not detail:
        print(f'Report {rid}: no Detail section')
        continue
    
    rows = detail['results']
    print(f'\n=== Report {rid} | {len(rows)} rows ===')
    # Show all unique item/category combinations
    seen = set()
    for r in rows:
        key = (r.get('commodity',''), r.get('item',''), r.get('class',''), r.get('primal',''))
        if key not in seen:
            seen.add(key)
            print(f"  commodity={r.get('commodity',''):15} item={r.get('item',''):30} class={r.get('class',''):10} primal={r.get('primal','')}")
    print('  All keys:', sorted(set(k for r in rows for k in r.keys())))
