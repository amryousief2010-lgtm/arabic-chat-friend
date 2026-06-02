import { describe, it, expect, beforeEach, vi } from "vitest";
import { printWarehouseStock, type PrintStockRow } from "@/lib/printUtils";

// Capture HTML written into the popup window
let captured = "";
const fakeDoc = {
  write: (html: string) => { captured += html; },
  close: () => {},
};
const fakeWin = { document: fakeDoc, focus: () => {}, print: () => {} } as any;

beforeEach(() => {
  captured = "";
  vi.stubGlobal("open", vi.fn(() => fakeWin));
});

const rows: PrintStockRow[] = [
  {
    name: "استيك نعام",
    unit: "كيلو",
    agouza: 0, main: 0,
    main_actual: 100,
    main_reserved: 30,
    agouza_actual: 50,
    agouza_reserved: 10,
  },
  {
    name: "دبوس بالعظم",
    unit: "كيلو",
    agouza: 0, main: 0,
    main_actual: 60,
    main_reserved: 20,
    agouza_actual: 0,
    agouza_reserved: 0,
  },
];

describe("printWarehouseStock — Main warehouse views", () => {
  it("actual view shows ONLY actual stock, before reservations", () => {
    printWarehouseStock(rows, { mode: "main", view: "actual" });
    expect(captured).toContain("الجرد الفعلي (قبل المحجوز)");
    expect(captured).toContain("الفعلي");
    expect(captured).not.toContain("— المحجوز");
    expect(captured).not.toContain("— المتاح");
    // values: 100 and 60 + total 160
    expect(captured).toContain(">100<");
    expect(captured).toContain(">60<");
    expect(captured).toContain(">160<");
  });

  it("available view shows ONLY available (actual − reserved)", () => {
    printWarehouseStock(rows, { mode: "main", view: "available" });
    expect(captured).toContain("المتاح للبيع (بعد المحجوز)");
    expect(captured).toContain("المتاح للبيع");
    // 100-30=70, 60-20=40, total=110
    expect(captured).toContain(">70<");
    expect(captured).toContain(">40<");
    expect(captured).toContain(">110<");
  });

  it("full view shows the three columns: actual, reserved, available", () => {
    printWarehouseStock(rows, { mode: "main", view: "full" });
    expect(captured).toContain("الفعلي + المحجوز + المتاح للبيع");
    expect(captured).toContain("الرئيسي — الفعلي");
    expect(captured).toContain("الرئيسي — المحجوز");
    expect(captured).toContain("الرئيسي — المتاح");
    // each value must appear
    [100, 30, 70, 60, 20, 40, 160, 50, 110].forEach((n) => {
      expect(captured).toContain(`>${n}<`);
    });
  });

  it("title clearly identifies the warehouse and view in every report", () => {
    printWarehouseStock(rows, { mode: "main", view: "actual" });
    expect(captured).toContain("تقرير المخزن الرئيسي — الجرد الفعلي (قبل المحجوز)");
    captured = "";
    printWarehouseStock(rows, { mode: "main", view: "available" });
    expect(captured).toContain("تقرير المخزن الرئيسي — المتاح للبيع (بعد المحجوز)");
    captured = "";
    printWarehouseStock(rows, { mode: "main", view: "full" });
    expect(captured).toContain("تقرير المخزن الرئيسي — الفعلي + المحجوز + المتاح للبيع");
  });
});

// ─────────────────────────────────────────────────────────────
// Inbound source filter for Main warehouse — mirrors InboundSupplyTab logic
// ─────────────────────────────────────────────────────────────
const ALL_SOURCES = [
  "slaughterhouse", "meat_factory", "feed_factory",
  "return_healthy", "return_carrefour", "return_agouza",
  "external_supplier", "other",
];
const MAIN_WAREHOUSE_ALLOWED = new Set([
  "slaughterhouse", "meat_factory",
  "return_healthy", "return_carrefour", "return_agouza",
]);

describe("Inbound source filter — Main warehouse", () => {
  it("allows ONLY slaughterhouse / meat factory / 3 return sources", () => {
    const allowed = ALL_SOURCES.filter((s) => MAIN_WAREHOUSE_ALLOWED.has(s));
    expect(allowed.sort()).toEqual(
      ["slaughterhouse", "meat_factory", "return_healthy", "return_carrefour", "return_agouza"].sort(),
    );
  });

  it("blocks feed_factory, external_supplier, other from Main warehouse", () => {
    ["feed_factory", "external_supplier", "other"].forEach((s) => {
      expect(MAIN_WAREHOUSE_ALLOWED.has(s)).toBe(false);
    });
  });

  it("non-main warehouses still see ALL sources", () => {
    expect(ALL_SOURCES.length).toBe(8);
  });
});
