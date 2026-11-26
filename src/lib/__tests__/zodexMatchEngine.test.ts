import { describe, it, expect } from "vitest";
import {
  evaluateBill, auditExistingLink, mapZodexStatus, guardedStatusUpdate, normMobile,
  reverseMatch, resolveSheetRows, planStatusUpdates,
  type CandidateOrder, type ZodexBill,
} from "@/lib/zodexMatchEngine";

// Synthetic fixtures modelled on live patterns (diagnosis 27/10). Mobiles are fake.
const bill = (p: Partial<ZodexBill> = {}): ZodexBill => ({
  bill_no: "ZX800000001", phones: ["01000000001"], cod: 1000, shipment_date: "2026-10-20T10:00:00Z", ...p,
});
const order = (p: Partial<CandidateOrder> = {}): CandidateOrder => ({
  id: "o1", order_number: "ORD-20261019-000001", total: 1000, created_at: "2026-10-19T09:00:00Z",
  status: "pending", phones: ["201000000001"], shipping_bill_no: null, ...p,
});

describe("normMobile", () => {
  it("normalises +20 / 20 / 0020 / bare forms", () => {
    for (const s of ["+201000000001", "201000000001", "00201000000001", "1000000001", "0100 000 0001"]) expect(normMobile(s)).toBe("01000000001");
  });
});

describe("tiering (mobile-first, amount informational)", () => {
  it("AUTO: one open order on the mobile, date OK", () => {
    const d = evaluateBill(bill(), [order()]);
    expect(d.tier).toBe("AUTO");
    expect(d.best?.order_number).toBe("ORD-20261019-000001");
  });
  it("amount difference never downgrades: 1120 vs 1000 still AUTO, diff kept as info", () => {
    const d = evaluateBill(bill({ cod: 1120 }), [order()]);
    expect(d.tier).toBe("AUTO");
    expect(d.best?.amountDiff).toBe(120);
    expect(d.reasons.join(" ")).toContain("للعلم");
  });
  it("amount never breaks a tie: two open orders → REVIEW, suggestion = closest date", () => {
    const d = evaluateBill(bill(), [order({ id: "o2", order_number: "ORD-20261012-000002", created_at: "2026-10-12T09:00:00Z" }), order({ total: 450 })]);
    expect(d.tier).toBe("REVIEW");
    expect(d.best?.order_id).toBe("o1");
    expect(d.reasons[0]).toContain("2 أوردرات");
  });
  it("27/10: pending PICKUP order links automatically", () => {
    expect(evaluateBill(bill(), [order({ fulfillment_type: "pickup" })]).tier).toBe("AUTO");
  });
  it("27/10: private-courier («مندوب خاص») order links automatically", () => {
    expect(evaluateBill(bill(), [order({ fulfillment_type: "delivery" })]).tier).toBe("AUTO");
  });
  it("27/10 ZX…365 pattern: older delivered orders already holding waybills don't block the new one", () => {
    const d = evaluateBill(bill({ shipment_date: "2026-10-24T14:00:00Z" }), [
      order({ id: "old1", order_number: "A", status: "delivered", created_at: "2026-10-07T20:00:00Z", shipping_bill_no: "ZX800000010" }),
      order({ id: "old2", order_number: "B", status: "delivered", created_at: "2026-10-01T02:00:00Z", shipping_bill_no: "ZX800000011" }),
      order({ id: "new", order_number: "C", created_at: "2026-10-24T10:00:00Z", fulfillment_type: "pickup" }),
    ]);
    expect(d.tier).toBe("AUTO");
    expect(d.best?.order_id).toBe("new");
  });
  it("BLOCKED: wrong month (order 40 days older)", () => {
    const d = evaluateBill(bill(), [order({ created_at: "2026-09-10T09:00:00Z" })]);
    expect(d.tier).toBe("BLOCKED");
    expect(d.reasons.join(" ")).toContain("شهر مختلف");
  });
  it("BLOCKED: waybill dated before the order", () => {
    expect(evaluateBill(bill({ shipment_date: "2026-10-15T10:00:00Z" }), [order()]).tier).toBe("BLOCKED");
  });
  it("BLOCKED: waybill already on several orders", () => {
    expect(evaluateBill(bill(), [order()], { billHolders: new Map([["ZX800000001", ["a", "b"]]]) }).tier).toBe("BLOCKED");
  });
  it("BLOCKED: only candidate already holds another waybill (one waybill per order)", () => {
    const d = evaluateBill(bill(), [order({ shipping_bill_no: "ZX800000099" })]);
    expect(d.tier).toBe("BLOCKED");
    expect(d.reasons.join(" ")).toContain("ZX800000099");
  });
  it("BLOCKED: cancelled order never auto-linked", () => {
    expect(evaluateBill(bill(), [order({ status: "cancelled" })]).tier).toBe("BLOCKED");
  });
  it("REVIEW: far date gap (15 days)", () => {
    expect(evaluateBill(bill({ shipment_date: "2026-11-03T10:00:00Z" }), [order()]).tier).toBe("REVIEW");
  });
  it("NO_ORDER: no order on the mobile (yet)", () => {
    expect(evaluateBill(bill(), [order({ phones: ["01099999999"] })]).tier).toBe("NO_ORDER");
  });
  it("BLOCKED: no usable mobile", () => {
    expect(evaluateBill(bill({ phones: [""] }), [order()]).tier).toBe("BLOCKED");
  });
  it("deterministic regardless of input order", () => {
    const a = order(), b = order({ id: "o2", order_number: "ORD-2" });
    expect(evaluateBill(bill(), [a, b]).best?.order_id).toBe(evaluateBill(bill(), [b, a]).best?.order_id);
  });
});

describe("existing-link audit", () => {
  it("flags structural problems but NOT amount differences", () => {
    const s = auditExistingLink({ bill: bill({ cod: 1120, shipment_date: "2026-11-20T00:00:00Z" }), order: order(),
      otherOpenSamePhone: 1, billOrderCount: 2, orderBillCount: 2 });
    expect(s).not.toContain("amount_diff");
    expect(s).toEqual(expect.arrayContaining(["wrong_month", "shared_mobile", "bill_multi_order", "order_multi_bill"]));
  });
  it("clean link → no flags", () => {
    expect(auditExistingLink({ bill: bill(), order: order(), otherOpenSamePhone: 0, billOrderCount: 1, orderBillCount: 1 })).toEqual([]);
  });
});

describe("status guards", () => {
  it("maps Arabic Zodex statuses", () => {
    expect(mapZodexStatus("تم التسليم")).toBe("delivered");
    expect(mapZodexStatus("مرتجع للراسل")).toBe("returned");
    expect(mapZodexStatus("إلغاء")).toBe("cancelled");
    expect(mapZodexStatus("مع المندوب")).toBe("in_transit");
  });
  it("only pending → delivered/cancelled on confident links", () => {
    expect(guardedStatusUpdate("pending", "delivered", "AUTO")).toBe("delivered");
    expect(guardedStatusUpdate("pending", "returned", "LINKED")).toBe("cancelled");
    expect(guardedStatusUpdate("pending", "delivered", "REVIEW")).toBeNull();
    expect(guardedStatusUpdate("delivered", "returned", "AUTO")).toBeNull();
  });
});

describe("missing automatic paths (27/10)", () => {
  it("reverse match: waybill seen before the order; registering the order links it", () => {
    const d = reverseMatch(order({ fulfillment_type: "pickup" }), [bill(), bill({ bill_no: "ZX9", phones: ["01055555555"] })], () => []);
    expect(d).toHaveLength(1);
    expect(d[0].tier).toBe("AUTO");
  });
  it("delivery sheet: unknown waybill resolves by mobile instead of a bare 'not found'", () => {
    const rows = [
      { bill_no: "ZX1", phones: ["01000000001"], cod: 1000, date: "2026-10-20T10:00:00Z", outcome: "delivered" as const },
      { bill_no: "ZX2", phones: ["01000000002"], cod: 500, date: "2026-10-20T10:00:00Z", outcome: "delivered" as const },
      { bill_no: "ZX3", phones: ["01077777777"], cod: 500, date: "2026-10-20T10:00:00Z", outcome: "returned" as const },
    ];
    const pool = [order({ fulfillment_type: "pickup" }), order({ id: "a", order_number: "A", phones: ["01000000002"] }), order({ id: "b", order_number: "B", phones: ["01000000002"] })];
    const r = resolveSheetRows(rows, new Map(), (ph) => pool.filter((o) => o.phones.some((x) => normMobile(x) === normMobile(ph[0]))));
    expect(r.map((x) => x.via)).toEqual(["auto_link", "review", "not_found"]);
    expect(r[1].order_id).not.toBeNull();
  });
  it("bulk returns plan: pending→cancelled automatic; delivered→returned and doubtful links go to review", () => {
    const p = planStatusUpdates([
      { order_id: "1", bill_no: "ZX1", current: "pending", zodex: "returned", link: "LINKED" },
      { order_id: "2", bill_no: "ZX2", current: "delivered", zodex: "returned", link: "LINKED" },
      { order_id: "3", bill_no: "ZX3", current: "pending", zodex: "delivered", link: "REVIEW" },
    ]);
    expect(p[0].to).toBe("cancelled");
    expect(p[1]).toMatchObject({ to: null, needs_review: true });
    expect(p[2]).toMatchObject({ to: null, needs_review: true });
  });
});
