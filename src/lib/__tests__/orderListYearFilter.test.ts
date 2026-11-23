import { describe, expect, it } from "vitest";
import { cairoMonthStartUTC, cairoYearStartUTC } from "../cairoDate";
import {
  ALL_YEARS_VALUE,
  currentAppCalendarYear,
  currentCairoMonthLabel,
  hasOrderListOperationalFilters,
  implicitOperationalFilterUsesCurrentMonth,
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

  it("does not treat a product filter as a date-scoping operational filter", () => {
    expect(hasOrderListOperationalFilters({ product: "فخدة  بالعظم" })).toBe(false);
    expect(
      hasOrderListOperationalFilters({
        product: "فخدة  بالعظم",
        status: "all",
        warehouseChip: "all",
        month: "all",
      }),
    ).toBe(false);
    expect(
      hasOrderListOperationalFilters({
        product: "فخدة  بالعظم",
        warehouseChip: "agouza",
      }),
    ).toBe(true);
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

  it("does not use the default current-month prefetch when a product is selected", () => {
    expect(
      shouldRestrictOrdersToCurrentMonth({ ...base, product: "فخدة  بالعظم" }),
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

  it("queries the full current year when the year was chosen explicitly and no month is set", () => {
    const bounds = resolveOrderListDateBounds({
      effectiveYear: "2026",
      filterMonth: ALL_YEARS_VALUE,
      yearGroup: ALL_YEARS_VALUE,
      restrictToCurrentMonth: false,
      scopeImplicitYearToCurrentMonth: false,
      now: now2026,
    });
    expect(bounds.startDate).toBe(cairoYearStartUTC(2026).toISOString());
    expect(bounds.endDate).toBe(cairoYearStartUTC(2027).toISOString());
  });

  it("queries only the current Cairo month when a filter pins the year implicitly", () => {
    const bounds = resolveOrderListDateBounds({
      effectiveYear: "2026",
      filterMonth: ALL_YEARS_VALUE,
      yearGroup: ALL_YEARS_VALUE,
      restrictToCurrentMonth: false,
      scopeImplicitYearToCurrentMonth: true,
      now: now2026,
    });
    expect(bounds.startDate).toBe(cairoMonthStartUTC(2026, 8).toISOString());
    expect(bounds.endDate).toBe(cairoMonthStartUTC(2026, 9).toISOString());
    expect(currentCairoMonthLabel(now2026)).toBe("سبتمبر 2026");
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
    product?: string;
    yearPin?: "implicit" | "explicit";
    filterYear?: string;
  }) => {
    const filterMonth = filters.month ?? ALL_YEARS_VALUE;
    const product = filters.product ?? ALL_YEARS_VALUE;
    const operational = hasOrderListOperationalFilters({
      month: filterMonth,
      fulfillment: filters.fulfillment ?? ALL_YEARS_VALUE,
      warehouseChip: filters.warehouseChip ?? ALL_YEARS_VALUE,
      product,
    });
    const effectiveYear = resolveEffectiveOrderListYear({
      filterYear: filters.filterYear ?? ALL_YEARS_VALUE,
      yearPin: filters.yearPin ?? "implicit",
      operationalFiltersActive: operational,
      now: now2026,
    });
    const yearPin = filters.yearPin ?? "implicit";
    const bounds = resolveOrderListDateBounds({
      effectiveYear,
      filterMonth,
      yearGroup: ALL_YEARS_VALUE,
      restrictToCurrentMonth: shouldRestrictOrdersToCurrentMonth({
        hasSearch: false,
        hasPeriod: false,
        filterMonth,
        effectiveYear,
        yearPin,
        yearGroup: ALL_YEARS_VALUE,
        isShippingCompany: false,
        product,
      }),
      scopeImplicitYearToCurrentMonth: implicitOperationalFilterUsesCurrentMonth({
        operationalFiltersActive: operational,
        yearPin,
        filterMonth,
        product,
      }),
      now: now2026,
    });
    return { effectiveYear, bounds };
  };

  it("Agouza or the main warehouse without a chosen period → current month only", () => {
    for (const warehouseChip of ["agouza", "main"]) {
      const { effectiveYear, bounds } = resolve({ warehouseChip });
      expect(effectiveYear).toBe("2026");
      expect(bounds.startDate).toBe(cairoMonthStartUTC(2026, 8).toISOString());
      expect(bounds.endDate).toBe(cairoMonthStartUTC(2026, 9).toISOString());
    }
    const fulfillment = resolve({ fulfillment: "pickup_agouza" });
    expect(fulfillment.bounds.startDate).toBe(cairoMonthStartUTC(2026, 8).toISOString());
    expect(fulfillment.bounds.endDate).toBe(cairoMonthStartUTC(2026, 9).toISOString());
  });

  it("October while the current month is November stays October of that year", () => {
    const now = new Date("2026-11-06T15:00:00+02:00");
    const filterMonth = "10";
    const operational = hasOrderListOperationalFilters({ month: filterMonth });
    const effectiveYear = resolveEffectiveOrderListYear({
      filterYear: ALL_YEARS_VALUE,
      yearPin: "implicit",
      operationalFiltersActive: operational,
      now,
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
        yearPin: "implicit",
        yearGroup: ALL_YEARS_VALUE,
        isShippingCompany: false,
      }),
      now,
    });
    expect(effectiveYear).toBe("2026");
    expect(bounds.startDate).toBe(cairoMonthStartUTC(2026, 9).toISOString());
    expect(bounds.endDate).toBe(cairoMonthStartUTC(2026, 10).toISOString());
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

  it("product only, كل الشهور, no explicit year → every year, not the current month", () => {
    const { effectiveYear, bounds } = resolve({ product: "فخدة  بالعظم" });
    expect(effectiveYear).toBe(ALL_YEARS_VALUE);
    expect(bounds).toEqual({ startDate: null, endDate: null });
  });

  it("product plus an explicit year and كل الشهور → that whole year", () => {
    const { effectiveYear, bounds } = resolve({
      product: "نعامة صندوق بالعظم",
      yearPin: "explicit",
      filterYear: "2026",
    });
    expect(effectiveYear).toBe("2026");
    expect(bounds.startDate).toBe(cairoYearStartUTC(2026).toISOString());
    expect(bounds.endDate).toBe(cairoYearStartUTC(2027).toISOString());
  });

  it("product plus explicit كل السنوات stays unbounded", () => {
    const { effectiveYear, bounds } = resolve({
      product: "دبوس نعام بالعظم",
      yearPin: "explicit",
      filterYear: ALL_YEARS_VALUE,
    });
    expect(effectiveYear).toBe(ALL_YEARS_VALUE);
    expect(bounds).toEqual({ startDate: null, endDate: null });
  });

  it("product plus a chosen month still uses that month of the pinned year", () => {
    const { effectiveYear, bounds } = resolve({
      product: "فخدة  بالعظم",
      month: "5",
    });
    expect(effectiveYear).toBe("2026");
    expect(bounds.startDate).toBe(cairoMonthStartUTC(2026, 4).toISOString());
    expect(bounds.endDate).toBe(cairoMonthStartUTC(2026, 5).toISOString());
  });

  it("product plus a warehouse without a chosen period uses the whole pinned year, not the current month", () => {
    const { effectiveYear, bounds } = resolve({
      product: "فخدة  بالعظم",
      warehouseChip: "agouza",
    });
    expect(effectiveYear).toBe("2026");
    expect(bounds.startDate).toBe(cairoYearStartUTC(2026).toISOString());
    expect(bounds.endDate).toBe(cairoYearStartUTC(2027).toISOString());
  });
});
