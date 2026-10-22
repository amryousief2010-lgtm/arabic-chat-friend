import { describe, it, expect, vi } from 'vitest';
import { combineQueryStates } from './queryGuard';

describe('combineQueryStates', () => {
  it('pending query is never ready (no silent zeros)', () => {
    const s = combineQueryStates([{ isPending: true }, { data: {} }]);
    expect(s.isReady).toBe(false);
    expect(s.isPending).toBe(true);
  });
  it('failed query without data reports error and retries all', () => {
    const refetch = vi.fn();
    const s = combineQueryStates([{ isError: true, error: new Error('x'), refetch }, { data: 1, refetch }]);
    expect(s.isError).toBe(true);
    expect(s.isReady).toBe(false);
    s.retry();
    expect(refetch).toHaveBeenCalled();
  });
  it('stale data during refetch error stays ready; null entries ignored', () => {
    expect(combineQueryStates([{ isError: true, data: { a: 1 } }, null]).isReady).toBe(true);
    expect(combineQueryStates([{ isSuccess: true }]).isReady).toBe(true);
  });
});
