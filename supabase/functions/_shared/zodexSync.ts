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

/** Locked rule: Zodex COD is often our order total plus this shipping fee. */
export const ZODEX_SHIPPING_FEE_EGP = 110;

/** Default COD vs order-total tolerance (EGP) when not using the +110 rule. */
export const ZODEX_AMOUNT_TOLERANCE_EGP = 5;

/** Normalize to 11-digit 01… form when possible. */
export function normalizeZodexPhone(s: string | null | undefined): string {
  if (!s) return "";
  const digits = String(s).replace(/[^\d]/g, "");
  return digits.replace(/^0020|^20/, "0").slice(-11);
}

/** True when the cell looks like an Egyptian mobile, not a random numeric column. */
export function looksLikeEgyptianMobile(s: string | null | undefined): boolean {
  const n = normalizeZodexPhone(s);
  return /^01\d{9}$/.test(n);
}

/** Pure phone cell (no Arabic name glued on) — used to rescan when layout shifts. */
export function isPurePhoneCell(s: string | null | undefined): boolean {
  const t = String(s || "").trim();
  if (!/^[\d\s+()\-]{10,20}$/.test(t)) return false;
  return looksLikeEgyptianMobile(t);
}

/**
 * Same customer phone even when one side is 01… and the other is 2 / +20.
 * Last-9 match is deterministic; do not treat 1-digit typos as equal here
 * (that belongs to review scoring, not unlink / auto-link).
 */
export function phonesMatchLoose(a?: string | null, b?: string | null): boolean {
  const x = normalizeZodexPhone(a);
  const y = normalizeZodexPhone(b);
  if (!x || !y) return false;
  if (x === y) return true;
  return x.slice(-9) === y.slice(-9) && x.length >= 9 && y.length >= 9;
}

export type ZodexAmountMatch = {
  ok: boolean;
  via: "exact" | "shipping_fee" | null;
  diff: number;
};

/**
 * Deterministic amount key: totals within ±5 EGP, or Zodex COD == order + 110
 * (locked shipping-fee rule). Broader 30–160 windows are review-only and must
 * not auto-link.
 */
export function amountMatchesZodex(
  orderTotal: number,
  zodexCod: number,
  tolerance = ZODEX_AMOUNT_TOLERANCE_EGP,
): ZodexAmountMatch {
  const total = Number(orderTotal || 0);
  const cod = Number(zodexCod || 0);
  if (!(total > 0 && cod > 0)) return { ok: false, via: null, diff: 0 };
  const raw = Math.abs(cod - total);
  if (raw <= tolerance) return { ok: true, via: "exact", diff: raw };
  const ship = Math.abs(cod - total - ZODEX_SHIPPING_FEE_EGP);
  if (ship < 0.5) return { ok: true, via: "shipping_fee", diff: ship };
  return { ok: false, via: null, diff: Math.min(raw, ship) };
}

export type BalanceCellSource = "positional" | "scanned" | "none";

export interface MappedBalanceRow {
  bill_no: string;
  customer_phone: string;
  raw_date_text: string;
  /** ISO Cairo timestamp, or null when the HTML date column could not be parsed. Never invent `now()`. */
  shipment_date: string | null;
  cod_amount: number;
  shipping_fee: number;
  operation_type: string;
  shipment_status: string;
  moderator_cell: string;
  region: string;
  zodex_receiver: string;
  scrape_warnings: string[];
  phone_source: BalanceCellSource;
  date_source: BalanceCellSource;
}

function parseMoneyCell(s: string): number {
  const n = parseFloat(String(s || "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Map a Zodex balance-page `<td>` row onto fields.
 *
 * Positional layout (waybill at index `billIdx`, historically 5):
 * receiver=3, operation=4, waybill=5, moderator=6, status=7, customer phone=8,
 * shipping fee=9, region=10, COD=11, date=14.
 *
 * If a layout shift makes the positional phone/date invalid, rescan *only*
 * pure-phone cells and parseable date cells. Do not invent a date or phone.
 */
export function mapBalanceCells(cells: string[], billIdx: number): MappedBalanceRow {
  const warnings: string[] = [];
  const base = billIdx - 5;
  const get = (i: number) => cells[base + i] ?? "";
  const bill_no = String(get(5) || cells[billIdx] || "").trim().toUpperCase().replace(/\s+/g, "");

  let customer_phone = get(8);
  let phone_source: BalanceCellSource = "positional";
  if (!looksLikeEgyptianMobile(customer_phone)) {
    warnings.push("phone_positional_invalid");
    const scanned = cells.find((c) => isPurePhoneCell(c));
    if (scanned) {
      customer_phone = scanned;
      phone_source = "scanned";
      warnings.push("phone_rescanned");
    } else {
      customer_phone = "";
      phone_source = "none";
    }
  }

  let raw_date_text = get(14);
  let shipment_date = parseZodexDate(raw_date_text);
  let date_source: BalanceCellSource = "positional";
  if (!shipment_date) {
    warnings.push("date_positional_unparsed");
    for (const c of cells) {
      const iso = parseZodexDate(c);
      if (iso) {
        raw_date_text = c;
        shipment_date = iso;
        date_source = "scanned";
        warnings.push("date_rescanned");
        break;
      }
    }
    if (!shipment_date) date_source = "none";
  }

  const cod_amount = parseMoneyCell(get(11));
  const shipping_fee = parseMoneyCell(get(9));
  if (!(cod_amount > 0)) warnings.push("cod_positional_empty");

  return {
    bill_no,
    customer_phone: normalizeZodexPhone(customer_phone),
    raw_date_text,
    shipment_date,
    cod_amount,
    shipping_fee,
    operation_type: get(4),
    shipment_status: get(7),
    moderator_cell: get(6),
    region: get(10),
    zodex_receiver: get(3),
    scrape_warnings: warnings,
    phone_source,
    date_source,
  };
}
