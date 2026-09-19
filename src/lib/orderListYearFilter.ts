/**
 * Orders-list year pinning.
 *
 * Operational filters (month, warehouse/fulfillment, status, …) must query the
 * current Africa/Cairo calendar year unless the user explicitly picks
 * «كل السنوات» or a specific historical year.
 *
 * Default unfiltered view keeps year = "all" so the existing current-month
 * prefetch can stay fast. Period presets and year-group tabs keep owning their
 * own date window.
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
