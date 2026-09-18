/**
 * Safe PostgREST-style pagination.
 *
 * `.range()` without `.order()` (or with an embed filter) can return the same
 * first page forever. A `while (data.length === pageSize)` loop then never
 * settles — which is what kept `/reports` on skeletons.
 */

export type PaginatePage<T> = {
  rows: T[];
};

export async function paginateUntilDone<T>(opts: {
  pageSize: number;
  maxPages: number;
  fetchPage: (from: number, to: number) => Promise<T[]>;
  idOf?: (row: T) => string | null | undefined;
}): Promise<T[]> {
  const pageSize = Math.max(1, opts.pageSize);
  const maxPages = Math.max(1, opts.maxPages);
  const all: T[] = [];
  let previousFirstId: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const rows = await opts.fetchPage(from, to);
    if (!rows.length) break;

    const firstId = opts.idOf ? String(opts.idOf(rows[0]) ?? "") : null;
    if (firstId && previousFirstId && firstId === previousFirstId) {
      // Range did not advance — stop instead of looping forever.
      break;
    }
    previousFirstId = firstId;

    all.push(...rows);
    if (rows.length < pageSize) break;
  }

  return all;
}

export function chunkIds<T>(ids: T[], size: number): T[][] {
  const chunkSize = Math.max(1, size);
  const chunks: T[][] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    chunks.push(ids.slice(i, i + chunkSize));
  }
  return chunks;
}
