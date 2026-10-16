"""Shared Supabase uploader for all build scripts."""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

SUPABASE_URL = (
    os.environ.get("SUPABASE_URL")
    or "https://rtfvkquthwtgegcjxeoz.supabase.co"
).strip().rstrip("/")

SUPABASE_KEY = (
    os.environ.get("SUPABASE_SERVICE_KEY") or ""
).strip()


def upsert_rows(
    table: str,
    rows: list[dict],
    on_conflict: str = "date",
):
    if os.environ.get("SUPABASE_SKIP_UPLOAD") == "1":
        print(
            f"[supabase] Explicit JSON-only mode: "
            f"skipping {table} upload."
        )
        return

    if (
        not SUPABASE_KEY
        or SUPABASE_KEY.lower() in ("null", "none", "undefined")
    ):
        raise RuntimeError(
            "SUPABASE_SERVICE_KEY is missing; "
            "JSON was generated but Supabase was NOT synced."
        )

    if not rows:
        raise RuntimeError(
            f"Refusing to sync empty dataset: {table}"
        )

    url = (
        f"{SUPABASE_URL}/rest/v1/{table}"
        f"?on_conflict={on_conflict}"
    )

    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
    }

    batch_size = 500
    total = 0

    for i in range(0, len(rows), batch_size):
        batch = rows[i:i + batch_size]
        body = json.dumps(batch).encode("utf-8")

        request = urllib.request.Request(
            url,
            data=body,
            headers=headers,
            method="POST",
        )

        try:
            with urllib.request.urlopen(
                request,
                timeout=30,
            ) as response:
                response.read()

            total += len(batch)

        except urllib.error.HTTPError as error:
            error_body = error.read().decode(
                "utf-8",
                errors="ignore",
            )

            print(
                f"[supabase] Error uploading {table}: "
                f"{error.code} {error_body}"
            )

            raise

    print(f"[supabase] Upserted {total} rows into {table}.")
