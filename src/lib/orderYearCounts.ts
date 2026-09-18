export type YearGroupCounts = { all: number; "2026": number; pre2026: number };

export const EMPTY_YEAR_COUNTS: YearGroupCounts = { all: 0, "2026": 0, pre2026: 0 };

export function yearCountsFromOrders(
  orders: { created_at: string }[],
  yearOf: (createdAt: string) => number,
): YearGroupCounts {
  const result: YearGroupCounts = { all: orders.length, "2026": 0, pre2026: 0 };
  for (const order of orders) {
    if (yearOf(order.created_at) >= 2026) result["2026"]++;
    else result.pre2026++;
  }
  return result;
}

export type CountResult = { count: number | null; error: { message?: string } | null };

/**
 * HEAD `count=exact` over the full orders table is a different query than the
 * month-scoped list. When it times out or RLS returns a null count, the UI
 * used `count || 0` and the year tabs stayed at (0) while the heading showed
 * the loaded list length.
 */
export function resolveYearGroupCounts(args: {
  remote: { all: CountResult; y2026: CountResult; pre2026: CountResult } | null;
  loaded: YearGroupCounts;
}): { counts: YearGroupCounts; usedRemote: boolean } {
  const remote = args.remote;
  if (
    remote &&
    !remote.all.error &&
    !remote.y2026.error &&
    !remote.pre2026.error &&
    remote.all.count != null &&
    remote.y2026.count != null &&
    remote.pre2026.count != null
  ) {
    return {
      counts: {
        all: remote.all.count,
        "2026": remote.y2026.count,
        pre2026: remote.pre2026.count,
      },
      usedRemote: true,
    };
  }
  return { counts: args.loaded, usedRemote: false };
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
