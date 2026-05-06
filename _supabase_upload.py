"""Shared Supabase uploader for all build scripts."""
from __future__ import annotations

import json
import urllib.request
import os

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://rtfvkquthwtgegcjxeoz.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")


def upsert_rows(table: str, rows: list[dict], on_conflict: str = "date"):
    """Upsert rows into a Supabase table using the REST API.
    
    on_conflict: comma-separated column names for the unique constraint.
    """
    if not SUPABASE_KEY:
        print(f"  [supabase] SUPABASE_SERVICE_KEY not set — skipping {table} upload.")
        return

    url = f"{SUPABASE_URL}/rest/v1/{table}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": f"resolution=merge-duplicates",
    }

    # Supabase REST API handles upsert in batches
    BATCH = 500
    total = 0
    for i in range(0, len(rows), BATCH):
        batch = rows[i : i + BATCH]
        body = json.dumps(batch).encode("utf-8")
        req = urllib.request.Request(url, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                resp.read()
            total += len(batch)
        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8", "ignore")
            print(f"  [supabase] Error uploading batch to {table}: {e.code} {error_body}")
            raise

    print(f"  [supabase] Upserted {total} rows into {table}.")
