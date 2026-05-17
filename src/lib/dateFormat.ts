/**
 * Unified date utilities for the entire app.
 *
 * Display rule: ALWAYS day/month/year (DD/MM/YYYY).
 * Storage rule: ALWAYS ISO YYYY-MM-DD (what Postgres `date` and <input type="date"> expect).
 *
 * These helpers exist to guarantee no silent day/month swap between
 * the UI, the database, exports, and reports.
 */

type DateLike = Date | string | number | null | undefined;

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Coerce any accepted input into a valid Date or null. */
export function toDate(value: DateLike): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  // Numeric epoch
  if (typeof value === "number") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  // String: accept ISO (YYYY-MM-DD[ T...]) or DD/MM/YYYY[ HH:mm]
  const s = String(value).trim();
  // DD/MM/YYYY or DD-MM-YYYY (optionally with time)
  const dmy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (dmy) {
    const [, dd, mm, yyyy, hh, mi, ss] = dmy;
    const day = Number(dd);
    const month = Number(mm);
    const year = Number(yyyy);
    // Reject out-of-range components so we never silently roll over
    // (e.g. day=32 → next month, month=13 → next year).
    if (day < 1 || day > 31 || month < 1 || month > 12) return null;
    const d = new Date(year, month - 1, day, Number(hh ?? 0), Number(mi ?? 0), Number(ss ?? 0));
    if (isNaN(d.getTime())) return null;
    // Final sanity: components must round-trip (catches 31/02/...).
    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
    return d;
  }
  // Otherwise fall back to native parser (handles ISO and RFC strings)
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** Format any date input as DD/MM/YYYY. Returns `fallback` if invalid. */
export function formatDate(value: DateLike, fallback = "—"): string {
  const d = toDate(value);
  if (!d) return fallback;
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Format as DD/MM/YYYY HH:mm. */
export function formatDateTime(value: DateLike, fallback = "—"): string {
  const d = toDate(value);
  if (!d) return fallback;
  return `${formatDate(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Format as HH:mm (24h). */
export function formatTime(value: DateLike, fallback = "—"): string {
  const d = toDate(value);
  if (!d) return fallback;
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * Convert any input to YYYY-MM-DD (the format Postgres `date` columns and
 * <input type="date"> use). Use this whenever writing a date to the DB.
 */
export function toISODate(value: DateLike): string {
  const d = toDate(value);
  if (!d) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Today as YYYY-MM-DD (local time). */
export function todayISO(): string {
  return toISODate(new Date());
}

/**
 * Parse a user-entered DD/MM/YYYY string into an ISO YYYY-MM-DD string.
 * Returns "" if not parseable. Use this if you ever accept a free-text
 * date input (not needed for <input type="date">, which already returns ISO).
 */
export function dmyToISO(input: string): string {
  return toISODate(input);
}
