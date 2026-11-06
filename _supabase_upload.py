"""Shared Supabase uploader for all build scripts."""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://rtfvkquthwtgegcjxeoz.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")


def upsert_rows(table: str, rows: list[dict], on_conflict: str = "date"):
    """Upsert rows into Supabase using the REST API."""
    if not SUPABASE_KEY:
        print(f"  [supabase] SUPABASE_SERVICE_KEY not set — skipping {table} upload.")
        return

    url = f"{SUPABASE_URL}/rest/v1/{table}?on_conflict={on_conflict}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
    }

    batch_size = 500
    total = 0
    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        body = json.dumps(batch).encode("utf-8")
        req = urllib.request.Request(url, data=body, headers=headers, method="POST")
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    resp.read()
                total += len(batch)
                break
            except urllib.error.HTTPError as e:
                retryable = e.code == 429 or 500 <= e.code < 600
                if retryable and attempt < 2:
                    time.sleep(2**attempt)
                    continue
                print(f"  [supabase] Error uploading batch to {table}: HTTP {e.code}")
                raise
            except urllib.error.URLError:
                if attempt == 2:
                    raise
                time.sleep(2**attempt)

    print(f"  [supabase] Upserted {total} rows into {table}.")
