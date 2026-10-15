import { describe, expect, it } from "vitest";
import { buildFactoryProfitReport, factoryProductKey, type ManufacturingInvoiceRow, type SaleLine } from "../factoryProfitReport";

const invoice = (overrides: Partial<ManufacturingInvoiceRow>): ManufacturingInvoiceRow => ({
  id: "i1",
  invoiceNo: "MF-1",
  productName: "برجر نعام",
  status: "approved",
  createdAt: "2026-09-15T10:00:00.000Z",
  finishedQty: 1000,
  unit: "كجم",
  rawCost: 100000,
  spiceCost: 10000,
  packagingCost: 8000,
  extraCost: 20000,
  totalCost: 138000,
  ...overrides,
});

const sale = (overrides: Partial<SaleLine>): SaleLine => ({
  productName: "برجر",
  productId: "p1",
  offerName: "بوكس العيلة",
  quantity: 10,
  unitPrice: 250,
  totalPrice: 2500,
  isGift: false,
  orderStatus: "delivered",
  createdAt: "2026-09-20T10:00:00.000Z",
  ...overrides,
});

describe("factoryProductKey", () => {
  it("keeps rice kofta apart from kofta and leaves the retail kebab cut out", () => {
    expect(factoryProductKey("كفته رز نعام")).toBe("rice_kofta");
    expect(factoryProductKey("كفتة")).toBe("kofta");
    expect(factoryProductKey("قطع كباب")).toBeNull();
    expect(factoryProductKey("كباب")).toBe("kebab");
  });
});

describe("buildFactoryProfitReport", () => {
  it("prices offer lines from the frozen line total and drops shipping, gifts, and cancels", () => {
    const report = buildFactoryProfitReport({
      fromDate: "2026-09-01",
      toDate: "2026-10-31",
      invoices: [
        invoice({}),
        invoice({
          id: "cancelled",
          invoiceNo: "MF-X",
          status: "cancelled",
          finishedQty: 500,
          totalCost: 99999,
        }),
        invoice({
          id: "old-approved",
          invoiceNo: "MF-OLD",
          status: "approved",
          createdAt: "2026-06-01T10:00:00.000Z",
          finishedQty: 40,
          productName: "سجق نعام",
          totalCost: 4000,
          rawCost: 4000,
          spiceCost: 0,
          packagingCost: 0,
          extraCost: 0,
        }),
      ],
      lines: [
        {
          invoiceId: "i1",
          invoiceNo: "MF-1",
          productName: "برجر نعام",
          itemName: "لون احمر",
          kind: "spice",
          unit: "كجم",
          unitCost: 25000,
          quantity: 0.05,
          createdAt: "2026-09-15T10:00:00.000Z",
          invoiceStatus: "approved",
        },
      ],
      sales: [
        sale({}),
        sale({
          productName: "تكلفة الشحن",
          productId: null,
          quantity: 1,
          unitPrice: 120,
          totalPrice: 120,
        }),
        sale({ productName: "برجر", isGift: true, totalPrice: 0, quantity: 1 }),
        sale({ productName: "برجر", orderStatus: "cancelled", quantity: 20, totalPrice: 5000 }),
        sale({ productName: "قطع كباب", quantity: 4, totalPrice: 1600, productId: "cut" }),
      ],
    });

    const burger = report.rows.find((row) => row.key === "burger")!;
    expect(burger.kg).toBe(1000);
    expect(burger.tons).toBe(1);
    expect(burger.totalCost).toBe(138000);
    expect(burger.costPerTon).toBe(138000);
    expect(burger.soldKg).toBe(10);
    expect(burger.salesValue).toBe(2500);
    expect(burger.sellPerTon).toBe(250000);
    expect(burger.profitPerTon).toBe(112000);
    expect(burger.marginPct).toBeCloseTo(44.8, 1);
    expect(burger.invoices.map((inv) => inv.invoiceNo)).toEqual(["MF-1"]);

    expect(report.outliers[0].itemName).toBe("لون احمر");
    expect(report.outliers[0].maxUnitCost).toBe(25000);
    expect(report.untransferred.map((inv) => inv.invoiceNo).sort()).toEqual(["MF-1", "MF-OLD"]);
    expect(report.totals?.sellPerTon).toBe(250000);
  });
});
