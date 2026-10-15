import { describe, expect, it } from "vitest";
import {
  buildAgouzaStockReport,
  classifyOrder,
  inboundKind,
  normalizeItemName,
  type AgouzaItem,
  type AgouzaReportInput,
} from "../agouzaStockReport";

const burger: AgouzaItem = {
  id: "burger",
  name: "برجر",
  unit: "كيلو",
  productId: "p-burger",
  barcode: "6224",
  systemStock: 0,
  lowStockThreshold: 10,
};

const potato: AgouzaItem = {
  id: "potato",
  name: "بطاطس صوابع",
  unit: "عبوة",
  productId: "p-potato",
  barcode: null,
  systemStock: 10,
  lowStockThreshold: 0,
};

const base = (overrides: Partial<AgouzaReportInput> = {}): AgouzaReportInput => ({
  items: [burger, potato],
  counts: [{ itemId: "burger", countDate: "2026-10-01", actualQty: 37.5, sessionNo: "STK-1" }],
  orders: [],
  movements: [],
  pendingTransfers: [],
  fromDate: "2026-10-01",
  toDate: "2026-10-15",
  ...overrides,
});

describe("classifyOrder", () => {
  it("puts each current status in one bucket and ignores a cancel that never left", () => {
    expect(classifyOrder("delivered", "not_dispatched")).toBe("delivered");
    expect(classifyOrder("pending", "not_dispatched")).toBe("in_delivery");
    expect(classifyOrder("cancelled", "returned")).toBe("returned");
    expect(classifyOrder("cancelled", "not_dispatched")).toBe("ignore");
  });
});

describe("buildAgouzaStockReport", () => {
  it("drops orders dated before the stocktake and keeps the count day", () => {
    const report = buildAgouzaStockReport(base({
      orders: [
        {
          orderId: "old",
          orderNumber: "ORD-OLD",
          status: "delivered",
          stockStatus: "not_dispatched",
          createdAt: "2026-09-30T12:00:00.000Z",
          shippingBillNo: "ZX1",
          productId: "p-burger",
          productName: "برجر",
          quantity: 5,
          unresolvedFailure: false,
        },
        {
          orderId: "same-day",
          orderNumber: "ORD-DAY",
          status: "delivered",
          stockStatus: "dispatched",
          createdAt: "2026-10-01T10:00:00.000Z",
          shippingBillNo: null,
          productId: "p-burger",
          productName: "برجر",
          quantity: 2,
          unresolvedFailure: false,
        },
      ],
    }));
    const row = report.rows.find((r) => r.itemId === "burger")!;
    expect(report.excludedBeforeCount).toBe(1);
    expect(row.delivered).toBe(2);
    expect(row.balance).toBe(35.5);
    expect(report.alerts.deductionFailures).toHaveLength(0);
  });

  it("counts a delivered order once, adds a real return, and suggests replenishment", () => {
    const report = buildAgouzaStockReport(base({
      minLevels: { burger: 40 },
      orders: [
        {
          orderId: "d1",
          orderNumber: "ORD-D",
          status: "delivered",
          stockStatus: "not_dispatched",
          createdAt: "2026-10-12T12:00:00.000Z",
          shippingBillNo: "ZX804",
          productId: "p-burger",
          productName: "برجر",
          quantity: 8,
          unresolvedFailure: true,
        },
        {
          orderId: "p1",
          orderNumber: "ORD-P",
          status: "pending",
          stockStatus: "not_dispatched",
          createdAt: "2026-10-13T12:00:00.000Z",
          shippingBillNo: "ZX805",
          productId: "p-burger",
          productName: "برجر",
          quantity: 3,
          unresolvedFailure: false,
        },
        {
          orderId: "c1",
          orderNumber: "ORD-C",
          status: "cancelled",
          stockStatus: "not_dispatched",
          createdAt: "2026-10-13T12:00:00.000Z",
          shippingBillNo: null,
          productId: "p-burger",
          productName: "برجر",
          quantity: 9,
          unresolvedFailure: false,
        },
        {
          orderId: "r1",
          orderNumber: "ORD-R",
          status: "cancelled",
          stockStatus: "returned",
          createdAt: "2026-10-14T12:00:00.000Z",
          shippingBillNo: null,
          productId: "p-burger",
          productName: "برجر",
          quantity: 1.5,
          unresolvedFailure: false,
        },
      ],
      movements: [
        {
          itemId: "burger",
          itemName: "برجر نعام",
          quantity: 50,
          performedAt: "2026-10-06T08:00:00.000Z",
          reference: "STORE-238",
          kind: "zodex_in",
          sourceIsMain: true,
        },
        {
          itemId: "burger",
          itemName: "برجر",
          quantity: 25,
          performedAt: "2026-10-06T09:00:00.000Z",
          reference: "STORE-238-KGFIX",
          kind: "kg_fix",
          sourceIsMain: true,
        },
      ],
    }));
    const row = report.rows.find((r) => r.itemId === "burger")!;
    expect(row.baseline).toBe(37.5);
    expect(row.inbound).toBe(25);
    expect(row.delivered).toBe(8);
    expect(row.inDelivery).toBe(3);
    expect(row.returned).toBe(1.5);
    // 37.5 + 25 + 1.5 − 8 − 3 = 53
    expect(row.balance).toBe(53);
    expect(row.replenishment).toBe(0);
    expect(report.alerts.deductionFailures.map((a) => a.orderNumber)).toEqual(["ORD-D"]);
    expect(report.alerts.missingBarcodes.map((a) => a.name)).toEqual(["بطاطس صوابع"]);
  });

  it("suggests replenishment when the balance is under the minimum", () => {
    const report = buildAgouzaStockReport(base({
      orders: [{
        orderId: "d1",
        orderNumber: "ORD-D",
        status: "delivered",
        stockStatus: "dispatched",
        createdAt: "2026-10-10T12:00:00.000Z",
        shippingBillNo: null,
        productId: "p-burger",
        productName: "برجر",
        quantity: 30,
        unresolvedFailure: false,
      }],
    }));
    const row = report.rows.find((r) => r.itemId === "burger")!;
    expect(row.balance).toBe(7.5);
    expect(row.minLevel).toBe(10);
    expect(row.replenishment).toBe(2.5);
  });

  it("treats a MAIN store document and its plate correction as inbound", () => {
    expect(inboundKind({
      referenceType: "store_document",
      movementType: "in",
      notes: "تحويل وارد رئيسي|زودكس|سند 212|برجر",
    })).toBe("zodex_in");
    expect(inboundKind({
      referenceType: "store_document_kg_fix",
      movementType: "out",
      notes: "تصحيح أطباق→كجم",
    })).toBe("kg_fix");
    expect(inboundKind({
      referenceType: "store_document",
      movementType: "in",
      notes: "سند محلي",
    })).toBeNull();
  });

  it("matches a Zodex plate name to the coceg item", () => {
    expect(normalizeItemName("برجر نعام")).toBe("برجر");
    expect(normalizeItemName("كفتة ارز")).toBe(normalizeItemName("كفتة الرز"));
    expect(normalizeItemName("لحم مشفي")).toBe("لحم قطع");
  });
});
