import { describe, it, expect, vi } from 'vitest';
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
import { fetchAllPages, chunkIds } from '@/lib/fetchPayrollCarried';

describe('carried paging', () => {
  it('reads past 1000 rows page by page', async () => {
    const total = 2345;
    const calls: Array<[number, number]> = [];
    const rows = await fetchAllPages(async (from, to) => {
      calls.push([from, to]);
      const n = Math.max(0, Math.min(to, total - 1) - from + 1);
      return { data: Array.from({ length: n }, (_, i) => from + i), error: null };
    });
    expect(rows.length).toBe(total);
    expect(new Set(rows).size).toBe(total);
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });
  it('throws on error', async () => {
    await expect(fetchAllPages(async () => ({ data: null, error: new Error('x') }))).rejects.toThrow('x');
  });
  it('chunks ids by 100', () => {
    const c = chunkIds(Array.from({ length: 250 }, (_, i) => i), 100);
    expect(c.map((x) => x.length)).toEqual([100, 100, 50]);
  });
});
