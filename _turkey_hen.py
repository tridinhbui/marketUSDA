from datetime import timedelta

from _build_turkey import CHUNK_DAYS, END, START, deduplicate_weekly_rows, fetch_chunk


def main():
    rows = []
    cursor = START
    while cursor <= END:
        chunk_end = min(cursor + timedelta(days=CHUNK_DAYS - 1), END)
        print(f"Fetching {cursor} → {chunk_end}...", end=" ", flush=True)
        chunk_rows = fetch_chunk(cursor, chunk_end)
        print(f"{len(chunk_rows)} Turkey breast rows")
        rows.extend(chunk_rows)
        cursor = chunk_end + timedelta(days=1)

    rows = deduplicate_weekly_rows(rows)
    print(f'\n{"Week Starting":15} {"Week Ending":15} {"Breast Wtd Avg":16}')
    print("-" * 48)
    for row in rows:
        print(
            f"{row['week_start']:15} {row['week_end']:15} "
            f"{str(row['breast_wtd_avg']):16}"
        )
    print(f"\nTotal: {len(rows)} unique weeks")


if __name__ == "__main__":
    main()
