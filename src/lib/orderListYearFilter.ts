/**
 * Orders-list year pinning.
 *
 * Operational filters (warehouse, status, fulfillment, …) query the current
 * Africa/Cairo month unless the user set a period, a month, a year, or a
 * year-group tab. An explicit year without a month still spans that year.
 *
 * Default unfiltered view keeps year = "all" so the existing current-month
 * prefetch can stay fast. Period presets and year-group tabs keep owning their
 * own date window. Cairo and Asia/Riyadh share the same civil month.
 */

import {
  cairoMonthStartUTC,
  cairoWallClockToUTC,
  cairoYearStartUTC,
  currentCairoYearMonth,
} from "@/lib/cairoDate";

export const ALL_YEARS_VALUE = "all";

export type OrderListYearPin = "implicit" | "explicit";

export type OrderListOperationalFilterInputs = {
  status?: string;
  warehouseChip?: string;
  month?: string;
  fulfillment?: string;
  route?: string;
  governorate?: string;
  product?: string;
  collectionMethod?: string;
  moderator?: string;
};

function isActiveFilter(value?: string): boolean {
  return !!value && value !== ALL_YEARS_VALUE;
}

/** Current calendar year in the app timezone (Africa/Cairo; same civil year as Asia/Riyadh). */
export function currentAppCalendarYear(now: Date = new Date()): number {
  return currentCairoYearMonth(now).year;
}

export function hasOrderListOperationalFilters(
  filters: OrderListOperationalFilterInputs,
): boolean {
  return (
    isActiveFilter(filters.status) ||
    isActiveFilter(filters.warehouseChip) ||
    isActiveFilter(filters.month) ||
    isActiveFilter(filters.fulfillment) ||
    isActiveFilter(filters.route) ||
    isActiveFilter(filters.governorate) ||
    isActiveFilter(filters.product) ||
    isActiveFilter(filters.collectionMethod) ||
    isActiveFilter(filters.moderator)
  );
}

export function resolveEffectiveOrderListYear(args: {
  filterYear: string;
  yearPin: OrderListYearPin;
  operationalFiltersActive: boolean;
  yearGroup?: string;
  hasExplicitPeriod?: boolean;
  now?: Date;
}): string {
  if (args.yearPin === "explicit") return args.filterYear;
  if (args.hasExplicitPeriod) return ALL_YEARS_VALUE;
  if (args.yearGroup && args.yearGroup !== ALL_YEARS_VALUE) return ALL_YEARS_VALUE;
  if (args.operationalFiltersActive) {
    return String(currentAppCalendarYear(args.now));
  }
  return args.filterYear || ALL_YEARS_VALUE;
}

const MONTHS_AR = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

/** Warehouse, status, and the other list filters with no date choice of their own. */
export function implicitOperationalFilterUsesCurrentMonth(args: {
  operationalFiltersActive: boolean;
  yearPin: OrderListYearPin;
  hasExplicitPeriod?: boolean;
  hasSearch?: boolean;
  filterMonth: string;
  yearGroup?: string;
}): boolean {
  return (
    args.operationalFiltersActive &&
    args.yearPin !== "explicit" &&
    !args.hasExplicitPeriod &&
    !args.hasSearch &&
    args.filterMonth === ALL_YEARS_VALUE &&
    (!args.yearGroup || args.yearGroup === ALL_YEARS_VALUE)
  );
}

export function currentCairoMonthLabel(now: Date = new Date()): string {
  const { year, monthIndex0 } = currentCairoYearMonth(now);
  return `${MONTHS_AR[monthIndex0]} ${year}`;
}

export function shouldRestrictOrdersToCurrentMonth(args: {
  hasSearch: boolean;
  hasPeriod: boolean;
  filterMonth: string;
  effectiveYear: string;
  yearPin: OrderListYearPin;
  yearGroup: string;
  isShippingCompany: boolean;
}): boolean {
  return (
    !args.hasSearch &&
    !args.hasPeriod &&
    args.filterMonth === ALL_YEARS_VALUE &&
    args.effectiveYear === ALL_YEARS_VALUE &&
    args.yearPin !== "explicit" &&
    args.yearGroup === ALL_YEARS_VALUE &&
    !args.isShippingCompany
  );
}

export function resolveOrderListDateBounds(args: {
  activePeriod?: { fromYMD: string; toYMD: string } | null;
  effectiveYear: string;
  filterMonth: string;
  yearGroup: string;
  restrictToCurrentMonth: boolean;
  /** Warehouse/status/… with no explicit month, year, or period. */
  scopeImplicitYearToCurrentMonth?: boolean;
  now?: Date;
}): { startDate: string | null; endDate: string | null } {
  const now = args.now ?? new Date();
  let startDate: string | null = null;
  let endDate: string | null = null;

  if (args.activePeriod) {
    const [fy, fm, fd] = args.activePeriod.fromYMD.split("-").map(Number);
    const [ty, tm, td] = args.activePeriod.toYMD.split("-").map(Number);
    startDate = cairoWallClockToUTC(fy, fm - 1, fd, 0, 0, 0).toISOString();
    endDate = new Date(
      cairoWallClockToUTC(ty, tm - 1, td, 0, 0, 0).getTime() + 26 * 60 * 60 * 1000,
    ).toISOString();
    return { startDate, endDate };
  }

  if (args.effectiveYear !== ALL_YEARS_VALUE) {
    const y = Number(args.effectiveYear);
    if (args.filterMonth !== ALL_YEARS_VALUE) {
      const m = Number(args.filterMonth);
      startDate = cairoMonthStartUTC(y, m - 1).toISOString();
      endDate = cairoMonthStartUTC(y, m).toISOString();
    } else if (args.scopeImplicitYearToCurrentMonth) {
      const { year, monthIndex0 } = currentCairoYearMonth(now);
      startDate = cairoMonthStartUTC(year, monthIndex0).toISOString();
      endDate = cairoMonthStartUTC(year, monthIndex0 + 1).toISOString();
    } else {
      startDate = cairoYearStartUTC(y).toISOString();
      endDate = cairoYearStartUTC(y + 1).toISOString();
    }
    return { startDate, endDate };
  }

  if (args.yearGroup === "2026") {
    return { startDate: cairoYearStartUTC(2026).toISOString(), endDate: null };
  }
  if (args.yearGroup === "pre2026") {
    return { startDate: null, endDate: cairoYearStartUTC(2026).toISOString() };
  }
  if (args.restrictToCurrentMonth) {
    const { year, monthIndex0 } = currentCairoYearMonth(now);
    return {
      startDate: cairoMonthStartUTC(year, monthIndex0).toISOString(),
      endDate: cairoMonthStartUTC(year, monthIndex0 + 1).toISOString(),
    };
  }

  return { startDate, endDate };
}
