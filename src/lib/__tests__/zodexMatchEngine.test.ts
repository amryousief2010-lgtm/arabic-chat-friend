import { describe, it, expect } from "vitest";
import {
  evaluateBill, auditExistingLink, mapZodexStatus, guardedStatusUpdate, normMobile,
  type CandidateOrder, type ZodexBill,
} from "@/lib/zodexMatchEngine";

// Synthetic fixtures modelled on the live failure patterns (27/10 diagnosis).
// Mobiles are fake (010000000xx).
const bill = (p: Partial<ZodexBill> = {}): ZodexBill => ({
  bill_no: "ZX800000001", phones: ["01000000001"], cod: 1000, shipment_date: "2026-10-20T10:00:00Z", ...p,
});
const order = (p: Partial<CandidateOrder> = {}): CandidateOrder => ({
  id: "o1", order_number: "ORD-20261019-000001", total: 1000, created_at: "2026-10-19T09:00:00Z",
  status: "pending", phones: ["201000000001"], shipping_bill_no: null, eligible: true, ...p,
});

describe("normMobile", () => {
  it("normalises +20 / 20 / 0020 / bare 10-digit forms", () => {
    for (const s of ["+201000000001", "201000000001", "00201000000001", "1000000001", "0100 000 0001"]) {
      expect(normMobile(s)).toBe("01000000001");
    }
  });
});

describe("tiering", () => {
  it("AUTO: unique candidate, exact mobile, exact amount, close date", () => {
    const d = evaluateBill(bill(), [order()]);
    expect(d.tier).toBe("AUTO");
    expect(d.best?.order_number).toBe("ORD-20261019-000001");
  });
  it("AUTO: amount = total + 110 shipping fee (the 1000 vs 1110 pattern)", () => {
    expect(evaluateBill(bill({ cod: 1110 }), [order()]).tier).toBe("AUTO");
  });
  it("REVIEW: amount mismatch (409 phone_only pattern, e.g. 1120 vs 1000) and never proposes overwriting the total", () => {
    const d = evaluateBill(bill({ cod: 1120 }), [order()]);
    expect(d.tier).toBe("REVIEW");
    expect(d.best?.amountDiff).toBe(120);
    expect(d.reasons.join(" ")).toContain("فرق في المبلغ");
  });
  it("REVIEW: shared mobile with two open orders of the same amount (24 shared-mobile pattern)", () => {
    const d = evaluateBill(bill(), [order(), order({ id: "o2", order_number: "ORD-20261019-000002", created_at: "2026-10-19T12:00:00Z" })]);
    expect(d.tier).toBe("REVIEW");
    expect(d.candidates.length).toBe(2);
    expect(d.reasons[0]).toContain("2 أوردرات");
  });
  it("AUTO: shared mobile but only one candidate's amount matches with a clear margin", () => {
    const d = evaluateBill(bill(), [order(), order({ id: "o2", order_number: "ORD-20261019-000002", total: 450 })]);
    expect(d.tier).toBe("AUTO");
    expect(d.best?.order_id).toBe("o1");
  });
  it("BLOCKED: wrong month — order 40 days older than the waybill (3 wrong-month pattern)", () => {
    const d = evaluateBill(bill(), [order({ created_at: "2026-09-10T09:00:00Z" })]);
    expect(d.tier).toBe("BLOCKED");
    expect(d.reasons.join(" ")).toContain("شهر مختلف");
  });
  it("BLOCKED: waybill already held by several orders (4 multi-order pattern)", () => {
    const d = evaluateBill(bill(), [order()], { billHolders: new Map([["ZX800000001", ["a", "b"]]]) });
    expect(d.tier).toBe("BLOCKED");
  });
  it("BLOCKED: only candidate already holds another waybill (9 multi-waybill pattern)", () => {
    const d = evaluateBill(bill(), [order({ shipping_bill_no: "ZX800000099" })]);
    expect(d.tier).toBe("BLOCKED");
    expect(d.reasons.join(" ")).toContain("ZX800000099");
  });
  it("BLOCKED: pickup / non-eligible order is never auto-linked", () => {
    expect(evaluateBill(bill(), [order({ eligible: false, fulfillment_type: "pickup" })]).tier).toBe("BLOCKED");
  });
  it("NO_ORDER: no coceg order on the mobile (27 no_matching_phone pattern)", () => {
    expect(evaluateBill(bill(), [order({ phones: ["01099999999"] })]).tier).toBe("NO_ORDER");
  });
  it("BLOCKED: waybill without a usable mobile", () => {
    expect(evaluateBill(bill({ phones: [""] }), [order()]).tier).toBe("BLOCKED");
  });
  it("REVIEW: wide date gap (8 days) even with exact amount", () => {
    expect(evaluateBill(bill({ shipment_date: "2026-10-27T10:00:00Z" }), [order()]).tier).toBe("REVIEW");
  });
  it("is deterministic regardless of candidate order", () => {
    const a = order(), b = order({ id: "o2", order_number: "ORD-20261019-000002" });
    expect(evaluateBill(bill(), [a, b]).best?.order_id).toBe(evaluateBill(bill(), [b, a]).best?.order_id);
  });
});

describe("existing-link audit", () => {
  it("flags each live failure pattern", () => {
    const s = auditExistingLink({
      bill: bill({ cod: 1120, shipment_date: "2026-11-20T00:00:00Z" }), order: order(),
      otherOpenSamePhone: 1, billOrderCount: 2, orderBillCount: 2,
    });
    expect(s).toEqual(expect.arrayContaining(["amount_diff", "wrong_month", "shared_mobile", "bill_multi_order", "order_multi_bill"]));
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
  it("only pending → delivered/cancelled, only on confident links", () => {
    expect(guardedStatusUpdate("pending", "delivered", "AUTO")).toBe("delivered");
    expect(guardedStatusUpdate("pending", "returned", "LINKED")).toBe("cancelled");
    expect(guardedStatusUpdate("pending", "delivered", "REVIEW")).toBeNull();
    expect(guardedStatusUpdate("delivered", "returned", "AUTO")).toBeNull();
  });
});
