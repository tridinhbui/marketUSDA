interface Page<T> {
  data: T[] | null;
  error: { message: string } | null;
  count: number | null;
}
export async function loadAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<Page<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  let total: number | null = null;

  while (true) {
    const page = await fetchPage(rows.length, rows.length + 499);

    if (page.error) {
      throw new Error(page.error.message);
    }

    if (total === null) {
      total = page.count;
    }

    const incoming = page.data ?? [];

    if (incoming.length === 0) {
      if (total !== null && rows.length < total) {
        throw new Error(
          `Incomplete Supabase data: loaded ${rows.length} of ${total} rows`,
        );
      }

      return rows;
    }

    rows.push(...incoming);

    if (total !== null && rows.length >= total) {
      return rows;
    }
  }
}
