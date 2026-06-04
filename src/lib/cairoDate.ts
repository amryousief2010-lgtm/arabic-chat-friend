/**
 * Cairo-timezone date helpers.
 *
 * The DB function `get_dashboard_overview` classifies orders into
 * today/month/year buckets using `(created_at AT TIME ZONE 'Africa/Cairo')::date`.
 * These helpers mirror that logic in JS so we can unit-test boundary
 * scenarios around Cairo midnight (UTC+2 standard / UTC+3 DST).
 */

/** Returns YYYY-MM-DD for the given instant rendered in Africa/Cairo. */
export function toCairoDateString(value: Date | string | number): string {
  const d = value instanceof Date ? value : new Date(value);
  // en-CA gives ISO-style YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** True if `created_at` falls on the same Cairo calendar day as `now`. */
export function isCairoSameDay(
  createdAt: Date | string | number,
  now: Date | string | number,
): boolean {
  return toCairoDateString(createdAt) === toCairoDateString(now);
}

/**
 * Returns the UTC instant corresponding to Cairo wall-clock time
 * Y-M-D HH:mm:ss. Accounts for Egypt DST automatically by trying
 * the two possible UTC offsets (+2 standard, +3 DST) and picking the
 * one whose Cairo-rendered wall-clock matches the requested fields.
 */
export function cairoWallClockToUTC(
  year: number,
  monthIndex0: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  for (const offsetHours of [2, 3]) {
    const candidate = new Date(
      Date.UTC(year, monthIndex0, day, hour - offsetHours, minute, second),
    );
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Cairo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(candidate);
    const get = (t: string) => parts.find((p) => p.type === t)?.value;
    if (
      Number(get("year")) === year &&
      Number(get("month")) === monthIndex0 + 1 &&
      Number(get("day")) === day &&
      Number(get("hour")) % 24 === hour &&
      Number(get("minute")) === minute
    ) {
      return candidate;
    }
  }
  return new Date(Date.UTC(year, monthIndex0, day, hour - 2, minute, second));
}

/** UTC instant for Cairo midnight at the start of the given month. */
export function cairoMonthStartUTC(year: number, monthIndex0: number): Date {
  return cairoWallClockToUTC(year, monthIndex0, 1, 0, 0, 0);
}

/** UTC instant for Cairo midnight at the start of the given year. */
export function cairoYearStartUTC(year: number): Date {
  return cairoMonthStartUTC(year, 0);
}

/** UTC instant for Cairo midnight at the start of "today" in Cairo. */
export function cairoTodayStartUTC(now: Date = new Date()): Date {
  const [y, m, d] = toCairoDateString(now).split("-").map(Number);
  return cairoWallClockToUTC(y, m - 1, d, 0, 0, 0);
}

/** {year, monthIndex0} of the current Cairo month. */
export function currentCairoYearMonth(now: Date = new Date()): {
  year: number;
  monthIndex0: number;
} {
  const [y, m] = toCairoDateString(now).split("-").map(Number);
  return { year: y, monthIndex0: m - 1 };
}

