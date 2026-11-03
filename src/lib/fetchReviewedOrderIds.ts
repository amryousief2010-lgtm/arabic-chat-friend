import { supabase } from "@/integrations/supabase/client";
import { chunkIds } from "@/lib/paginateQuery";

/**
 * PostgREST returns at most 1,000 rows per request. A single
 * `order_review_status` query filtered only by user id silently drops marks
 * past that cap. Ask only about the orders currently loaded, in batches small
 * enough that one response cannot be truncated.
 */
export const REVIEWED_ORDER_ID_BATCH_SIZE = 200;
export const REVIEWED_ORDER_ID_CONCURRENCY = 4;
const POSTGREST_ROW_CAP = 1000;

export type ReviewedOrderBatchResponse = {
  data: Array<{ order_id: string | null }> | null;
  error: { message?: string } | null;
};

export type FetchReviewedOrderBatch = (
  batch: readonly string[],
) => Promise<ReviewedOrderBatchResponse>;

export type MergeFetchedReviewMarksOptions = {
  /** Latest local toggle generation per order. A generation newer than the fetch wins. */
  localWriteSeq?: ReadonlyMap<string, number>;
  /** `reviewOpSeq` captured when this fetch started. */
  fetchStartSeq?: number;
  /** Toggles whose upsert has not settled yet. Their optimistic value is kept. */
  pendingIds?: ReadonlySet<string>;
};

function clampBatchSize(size: number | undefined): number {
  if (size == null || !Number.isFinite(size)) return REVIEWED_ORDER_ID_BATCH_SIZE;
  const whole = Math.floor(size);
  if (whole < 1) return REVIEWED_ORDER_ID_BATCH_SIZE;
  // One row per order per user, so a batch under the cap cannot be truncated.
  return Math.min(whole, POSTGREST_ROW_CAP - 1);
}

function clampConcurrency(concurrency: number | undefined): number {
  if (concurrency == null || !Number.isFinite(concurrency)) return REVIEWED_ORDER_ID_CONCURRENCY;
  const whole = Math.floor(concurrency);
  if (whole < 1) return REVIEWED_ORDER_ID_CONCURRENCY;
  return Math.min(whole, 8);
}

function uniqueOrderIds(orderIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const id of orderIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  return unique;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  if (items.length === 0) return results;
  let cursor = 0;
  let failure: unknown = null;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (failure === null) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        results[index] = await fn(items[index]);
      } catch (err) {
        if (failure === null) failure = err;
        return;
      }
    }
  });
  await Promise.all(workers);
  if (failure) throw failure;
  return results;
}

/**
 * Reviewed order ids among `orderIds`.
 *
 * Resolves to the ids whose row has `is_reviewed = true`. An id that comes
 * back missing was checked and is not reviewed. A failed batch rejects the
 * whole call so the caller does not treat that failure as "not reviewed".
 */
export async function fetchReviewedOrderIds(
  orderIds: readonly string[],
  fetchBatch: FetchReviewedOrderBatch,
  options?: { batchSize?: number; concurrency?: number },
): Promise<Set<string>> {
  const unique = uniqueOrderIds(orderIds);
  if (unique.length === 0) return new Set();

  const batches = chunkIds(unique, clampBatchSize(options?.batchSize));
  const responses = await mapWithConcurrency(
    batches,
    clampConcurrency(options?.concurrency),
    async (batch) => {
      const { data, error } = await fetchBatch(batch);
      if (error) {
        throw new Error(error.message || "Failed to load review marks");
      }
      return { batch, data };
    },
  );

  const reviewed = new Set<string>();
  for (const { batch, data } of responses) {
    const allowed = new Set(batch);
    for (const row of data ?? []) {
      if (row?.order_id && allowed.has(row.order_id)) reviewed.add(row.order_id);
    }
  }
  return reviewed;
}

export async function fetchReviewedOrderIdsForUser(
  userId: string,
  orderIds: readonly string[],
): Promise<Set<string>> {
  return fetchReviewedOrderIds(orderIds, async (batch) => {
    const { data, error } = await supabase
      .from("order_review_status")
      .select("order_id")
      .in("order_id", [...batch])
      .eq("user_id", userId)
      .eq("is_reviewed", true);
    return { data, error };
  });
}

/**
 * Merge one fetch into the mark set.
 *
 * Only ids this fetch actually checked are updated. A toggle that is still
 * in flight, or that settled after the fetch started, keeps its optimistic
 * value so a stale response cannot flip the circle back.
 */
export function mergeFetchedReviewMarks(
  prev: ReadonlySet<string>,
  requestedIds: readonly string[],
  reviewedIds: ReadonlySet<string>,
  options?: MergeFetchedReviewMarksOptions,
): Set<string> {
  const localWriteSeq = options?.localWriteSeq;
  const fetchStartSeq = options?.fetchStartSeq ?? 0;
  const pendingIds = options?.pendingIds;
  let changed = false;
  const next = new Set(prev);

  for (const id of requestedIds) {
    if (!id) continue;
    if (pendingIds?.has(id)) continue;
    const writeSeq = localWriteSeq?.get(id) ?? 0;
    if (writeSeq > fetchStartSeq) continue;

    const shouldBeReviewed = reviewedIds.has(id);
    if (shouldBeReviewed) {
      if (!next.has(id)) {
        next.add(id);
        changed = true;
      }
    } else if (next.has(id)) {
      next.delete(id);
      changed = true;
    }
  }

  return changed ? next : (prev as Set<string>);
}
