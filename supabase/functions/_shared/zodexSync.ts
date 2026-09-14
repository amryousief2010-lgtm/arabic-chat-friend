// Shared helpers for Zodex incremental sync.
// Pure functions only (no Deno/Supabase imports) so they can be unit-tested.

export type SyncMode = "quick" | "full";

/** Overlap window applied to quick syncs, in hours. */
export const OVERLAP_HOURS = 48;
/** Default lookback (days) for a full review when the user gives none. */
export const DEFAULT_FULL_DAYS = 30;
/** Automatic full review cadence, in days. */
export const FULL_REVIEW_INTERVAL_DAYS = 7;

export interface SyncWindow {
  mode: SyncMode;
  /** ISO string — start of the period we review. */
  from: string;
  /** ISO string — end of the period (cycle start time). */
  to: string;
  /** True when no previous successful sync existed. */
  first_run: boolean;
}

/**
 * Resolve the period to review.
 * - quick: last successful sync minus the 48h overlap → cycle start.
 * - full (or first run / no stored timestamp): requested number of days → cycle start.
 */
export function resolveWindow(opts: {
  mode: SyncMode;
  lastSuccessAt: string | null | undefined;
  cycleStart: string;
  fullDays?: number;
}): SyncWindow {
  const to = opts.cycleStart;
  const toMs = new Date(to).getTime();
  const fullDays = Math.min(180, Math.max(1, opts.fullDays || DEFAULT_FULL_DAYS));

  if (opts.mode === "quick" && opts.lastSuccessAt) {
    const from = new Date(
      new Date(opts.lastSuccessAt).getTime() - OVERLAP_HOURS * 3600_000,
    ).toISOString();
    return { mode: "quick", from, to, first_run: false };
  }

  return {
    mode: "full",
    from: new Date(toMs - fullDays * 86400_000).toISOString(),
    to,
    first_run: !opts.lastSuccessAt,
  };
}

/** Should the weekly automatic full review run now? */
export function shouldRunWeeklyFullReview(
  lastFullReviewAt: string | null | undefined,
  now: string,
): boolean {
  if (!lastFullReviewAt) return true;
  const age = new Date(now).getTime() - new Date(lastFullReviewAt).getTime();
  return age >= FULL_REVIEW_INTERVAL_DAYS * 86400_000;
}

/** "2026-07-04 04:42 PM" / "2026-07-04" → ISO (Cairo +02:00). */
export function parseZodexDate(s: string | null | undefined): string | null {
  const t = String(s || "");
  const m = t.match(/(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM)?)?/i);
  if (!m) return null;
  let hh = m[4] ? parseInt(m[4], 10) : 0;
  const mm = m[5] ? parseInt(m[5], 10) : 0;
  const ap = (m[6] || "").toUpperCase();
  if (ap === "PM" && hh < 12) hh += 12;
  if (ap === "AM" && hh === 12) hh = 0;
  return `${m[1]}-${m[2]}-${m[3]}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+02:00`;
}

export interface DatedRow {
  /** Creation date of the bill (column «التاريخ»). */
  created_at: string | null;
  /** Last status change (column «اخر تغيير بالحالة»), acts as updated_at. */
  updated_at: string | null;
}

/** updated_at first, created_at as fallback. */
export function rowEffectiveDate(row: DatedRow): string | null {
  return row.updated_at || row.created_at || null;
}

/** Is this Zodex row inside the reviewed period? */
export function rowInWindow(row: DatedRow, win: SyncWindow): boolean {
  const d = rowEffectiveDate(row);
  if (!d) return true; // unknown date → never silently skipped
  const ms = new Date(d).getTime();
  return ms >= new Date(win.from).getTime();
}

/**
 * Zodex lists newest first and ignores its own from/to filter on the shipments
 * page, so we paginate until rows fall before the window start. `graceOages`
 * pages of older rows are tolerated before stopping (out-of-order rows).
 */
export function shouldStopPaging(
  pageRows: DatedRow[],
  win: SyncWindow,
  gracePagesLeft: number,
): { stop: boolean; gracePagesLeft: number } {
  if (!pageRows.length) return { stop: true, gracePagesLeft };
  const anyInWindow = pageRows.some((r) => rowInWindow(r, win));
  if (anyInWindow) return { stop: false, gracePagesLeft: 2 };
  const left = gracePagesLeft - 1;
  return { stop: left <= 0, gracePagesLeft: left };
}

/** Deduplicate bills by waybill number, keeping the freshest row. */
export function dedupeByBill<T extends DatedRow & { bill_no: string }>(rows: T[]): T[] {
  const map = new Map<string, T>();
  for (const r of rows) {
    const key = String(r.bill_no || "").trim().toUpperCase();
    if (!key) continue;
    const prev = map.get(key);
    if (!prev) { map.set(key, r); continue; }
    const a = rowEffectiveDate(prev);
    const b = rowEffectiveDate(r);
    if (b && (!a || new Date(b).getTime() > new Date(a).getTime())) map.set(key, r);
  }
  return [...map.values()];
}
