import { describe, expect, it } from "vitest";
import {
  formatSalesCompact,
  formatSalesExact,
  lifetimeOrdersCardChange,
  lifetimeSalesCardChange,
  mapDashboardOverview,
} from "../dashboardSalesKpis";

const overview = {
  today: { sales: 12_500.4, orders: 8 },
  month: { sales: 838_335.2, orders: 494 },
  year: { sales: 8_120_000.9, orders: 4200 },
  total: { sales: 39_950_000.6, orders: 24_010 },
  avg_order_value: 1664,
  customers: 9000,
  low_stock: 3,
  monthly: [{ month: "2026-09", sales: 838_335.2, orders: 494 }],
  daily: [{ date: "2026-09-18", sales: 12_500.4, orders: 8 }],
};

describe("mapDashboardOverview — sales KPI windows", () => {
  it("maps RPC total to lifetime net, not month or year", () => {
    const stats = mapDashboardOverview(overview);

    expect(stats.totalSales).toBeCloseTo(39_950_000.6, 1);
    expect(stats.salesMonth).toBeCloseTo(838_335.2, 1);
    expect(stats.salesYear).toBeCloseTo(8_120_000.9, 1);
    expect(stats.salesToday).toBeCloseTo(12_500.4, 1);

    expect(stats.totalSales).not.toBe(stats.salesMonth);
    expect(stats.totalSales).not.toBe(stats.salesYear);
    expect(stats.totalSales).toBeGreaterThan(stats.salesYear);
    expect(stats.salesYear).toBeGreaterThan(stats.salesMonth);
  });

  it("does not treat missing buckets as NaN", () => {
    const stats = mapDashboardOverview({
      today: { sales: 0, orders: 0 },
      month: { sales: 0, orders: 0 },
      year: { sales: 0, orders: 0 },
      total: { sales: 0, orders: 0 },
      avg_order_value: 0,
      customers: 0,
      low_stock: 0,
    });
    expect(stats.totalSales).toBe(0);
    expect(stats.monthlySeries).toEqual([]);
    expect(stats.dailySeries).toEqual([]);
  });
});

describe("dashboard sales formatting", () => {
  it("shows the lifetime card as a full EGP amount, not 40.0M compact", () => {
    expect(formatSalesExact(39_950_000.6)).toBe((39_950_001).toLocaleString());
    expect(formatSalesExact(838_335.2)).toBe((838_335).toLocaleString());
    expect(formatSalesCompact(39_950_000.6)).toBe("40.0M");
    expect(formatSalesCompact(838_335.2)).toBe("838K");
  });

  it("lifetime subtitle includes year and month so GM can compare nested windows", () => {
    const stats = mapDashboardOverview(overview);
    const change = lifetimeSalesCardChange(stats);
    expect(change).toContain("الصافي بدون الملغي");
    expect(change).toContain("السنة:");
    expect(change).toContain("الشهر:");
    expect(change).toContain("8.1M");
    expect(change).toContain("838K");
    expect(lifetimeOrdersCardChange(stats)).toContain("منذ البداية");
  });
});
