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
