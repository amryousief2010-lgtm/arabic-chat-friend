import { describe, expect, it } from "vitest";
import { cairoMonthStartUTC, cairoYearStartUTC } from "../cairoDate";
import {
  ALL_YEARS_VALUE,
  currentAppCalendarYear,
  hasOrderListOperationalFilters,
  resolveEffectiveOrderListYear,
  resolveOrderListDateBounds,
  shouldRestrictOrdersToCurrentMonth,
} from "../orderListYearFilter";

const now2026 = new Date("2026-09-19T12:00:00+03:00");

describe("currentAppCalendarYear", () => {
  it("uses Africa/Cairo so late-evening UTC still belongs to the Cairo year", () => {
    // Winter Cairo is UTC+2: 22:30Z on 31 Dec is already 1 Jan.
    expect(currentAppCalendarYear(new Date("2026-12-31T22:30:00Z"))).toBe(2027);
    expect(currentAppCalendarYear(new Date("2026-01-01T00:30:00+02:00"))).toBe(2026);
  });
});

describe("hasOrderListOperationalFilters", () => {
  it("is false when every filter is all/empty", () => {
    expect(
      hasOrderListOperationalFilters({
        status: "all",
        warehouseChip: "all",
        month: "all",
        fulfillment: "all",
      }),
    ).toBe(false);
  });

  it("treats Agouza warehouse / pickup and month as operational", () => {
    expect(hasOrderListOperationalFilters({ warehouseChip: "agouza" })).toBe(true);
    expect(hasOrderListOperationalFilters({ fulfillment: "pickup_agouza" })).toBe(true);
    expect(hasOrderListOperationalFilters({ month: "11" })).toBe(true);
    expect(hasOrderListOperationalFilters({ status: "pending" })).toBe(true);
  });
});

describe("resolveEffectiveOrderListYear", () => {
  it("stays all years when no operational filter is applied", () => {
    expect(
      resolveEffectiveOrderListYear({
        filterYear: ALL_YEARS_VALUE,
        yearPin: "implicit",
        operationalFiltersActive: false,
        now: now2026,
      }),
    ).toBe(ALL_YEARS_VALUE);
  });

  it("pins to the current year when month / warehouse / status is applied without an explicit year", () => {
    expect(
      resolveEffectiveOrderListYear({
        filterYear: ALL_YEARS_VALUE,
        yearPin: "implicit",
        operationalFiltersActive: true,
        now: now2026,
      }),
    ).toBe("2026");
  });

  it("keeps كل السنوات when the user explicitly chose all years", () => {
    expect(
      resolveEffectiveOrderListYear({
        filterYear: ALL_YEARS_VALUE,
        yearPin: "explicit",
        operationalFiltersActive: true,
        now: now2026,
      }),
    ).toBe(ALL_YEARS_VALUE);
  });

  it("does not override an explicit historical year", () => {
    expect(
      resolveEffectiveOrderListYear({
        filterYear: "2025",
        yearPin: "explicit",
        operationalFiltersActive: true,
        now: now2026,
      }),
    ).toBe("2025");
  });

  it("does not pin over an explicit period or year-group tab", () => {
    expect(
      resolveEffectiveOrderListYear({
        filterYear: ALL_YEARS_VALUE,
        yearPin: "implicit",
        operationalFiltersActive: true,
        hasExplicitPeriod: true,
        now: now2026,
      }),
    ).toBe(ALL_YEARS_VALUE);
    expect(
      resolveEffectiveOrderListYear({
        filterYear: ALL_YEARS_VALUE,
        yearPin: "implicit",
        operationalFiltersActive: true,
        yearGroup: "pre2026",
        now: now2026,
      }),
    ).toBe(ALL_YEARS_VALUE);
  });
});

describe("shouldRestrictOrdersToCurrentMonth", () => {
  const base = {
    hasSearch: false,
    hasPeriod: false,
    filterMonth: ALL_YEARS_VALUE,
    effectiveYear: ALL_YEARS_VALUE,
    yearPin: "implicit" as const,
    yearGroup: ALL_YEARS_VALUE,
    isShippingCompany: false,
  };

  it("keeps the default current-month prefetch when nothing is filtered", () => {
    expect(shouldRestrictOrdersToCurrentMonth(base)).toBe(true);
  });

  it("does not clamp to the current month after year is pinned or explicitly set to all years", () => {
    expect(
      shouldRestrictOrdersToCurrentMonth({ ...base, effectiveYear: "2026" }),
    ).toBe(false);
    expect(
      shouldRestrictOrdersToCurrentMonth({ ...base, yearPin: "explicit" }),
    ).toBe(false);
  });
});

describe("resolveOrderListDateBounds", () => {
  it("queries November of the current year when month is set and year is pinned", () => {
    const bounds = resolveOrderListDateBounds({
      effectiveYear: "2026",
      filterMonth: "11",
      yearGroup: ALL_YEARS_VALUE,
      restrictToCurrentMonth: false,
      now: now2026,
    });
    expect(bounds.startDate).toBe(cairoMonthStartUTC(2026, 10).toISOString());
    expect(bounds.endDate).toBe(cairoMonthStartUTC(2026, 11).toISOString());
  });

  it("queries the full current year when an operational filter pins year without a month", () => {
    const bounds = resolveOrderListDateBounds({
      effectiveYear: "2026",
      filterMonth: ALL_YEARS_VALUE,
      yearGroup: ALL_YEARS_VALUE,
      restrictToCurrentMonth: false,
      now: now2026,
    });
    expect(bounds.startDate).toBe(cairoYearStartUTC(2026).toISOString());
    expect(bounds.endDate).toBe(cairoYearStartUTC(2027).toISOString());
  });

  it("does not add a year window when the user explicitly chose all years (month-only spans years)", () => {
    const bounds = resolveOrderListDateBounds({
      effectiveYear: ALL_YEARS_VALUE,
      filterMonth: "9",
      yearGroup: ALL_YEARS_VALUE,
      restrictToCurrentMonth: false,
      now: now2026,
    });
    expect(bounds).toEqual({ startDate: null, endDate: null });
  });

  it("still restricts the unfiltered default view to the current Cairo month", () => {
    const bounds = resolveOrderListDateBounds({
      effectiveYear: ALL_YEARS_VALUE,
      filterMonth: ALL_YEARS_VALUE,
      yearGroup: ALL_YEARS_VALUE,
      restrictToCurrentMonth: true,
      now: now2026,
    });
    expect(bounds.startDate).toBe(cairoMonthStartUTC(2026, 8).toISOString());
    expect(bounds.endDate).toBe(cairoMonthStartUTC(2026, 9).toISOString());
  });
});

describe("Orders list product-owner scenarios", () => {
  const resolve = (filters: {
    month?: string;
    fulfillment?: string;
    warehouseChip?: string;
    yearPin?: "implicit" | "explicit";
    filterYear?: string;
  }) => {
    const filterMonth = filters.month ?? ALL_YEARS_VALUE;
    const operational = hasOrderListOperationalFilters({
      month: filterMonth,
      fulfillment: filters.fulfillment ?? ALL_YEARS_VALUE,
      warehouseChip: filters.warehouseChip ?? ALL_YEARS_VALUE,
    });
    const effectiveYear = resolveEffectiveOrderListYear({
      filterYear: filters.filterYear ?? ALL_YEARS_VALUE,
      yearPin: filters.yearPin ?? "implicit",
      operationalFiltersActive: operational,
      now: now2026,
    });
    const bounds = resolveOrderListDateBounds({
      effectiveYear,
      filterMonth,
      yearGroup: ALL_YEARS_VALUE,
      restrictToCurrentMonth: shouldRestrictOrdersToCurrentMonth({
        hasSearch: false,
        hasPeriod: false,
        filterMonth,
        effectiveYear,
        yearPin: filters.yearPin ?? "implicit",
        yearGroup: ALL_YEARS_VALUE,
        isShippingCompany: false,
      }),
      now: now2026,
    });
    return { effectiveYear, bounds };
  };

  it("Agouza fulfillment without choosing year → current year only", () => {
    const { effectiveYear, bounds } = resolve({ fulfillment: "pickup_agouza" });
    expect(effectiveYear).toBe("2026");
    expect(bounds.startDate).toBe(cairoYearStartUTC(2026).toISOString());
    expect(bounds.endDate).toBe(cairoYearStartUTC(2027).toISOString());
  });

  it("November without choosing year → November of the current year only", () => {
    const { effectiveYear, bounds } = resolve({ month: "11" });
    expect(effectiveYear).toBe("2026");
    expect(bounds.startDate).toBe(cairoMonthStartUTC(2026, 10).toISOString());
    expect(bounds.endDate).toBe(cairoMonthStartUTC(2026, 11).toISOString());
  });

  it("explicit كل السنوات still spans years even with Agouza or a month", () => {
    const agouza = resolve({
      fulfillment: "pickup_agouza",
      yearPin: "explicit",
      filterYear: ALL_YEARS_VALUE,
    });
    expect(agouza.effectiveYear).toBe(ALL_YEARS_VALUE);
    expect(agouza.bounds).toEqual({ startDate: null, endDate: null });

    const november = resolve({
      month: "11",
      yearPin: "explicit",
      filterYear: ALL_YEARS_VALUE,
    });
    expect(november.effectiveYear).toBe(ALL_YEARS_VALUE);
    expect(november.bounds).toEqual({ startDate: null, endDate: null });
  });
});
