import { describe, expect, it } from "vitest";
import {
  AGOUZA_WAREHOUSE_ID,
  amountMatchesZodex,
  classifyLinkIssue,
  explainNoBillOrder,
  explainOrphanBill,
  fulfillmentKeepsZodexWaybill,
  isExpectedZodexShipment,
  last9PhoneKey,
  scoreCandidate,
  suggestBillForOrder,
  type MissingBill,
  type OrderCandidate,
} from "../zodexClassify";

const bill = (over: Partial<MissingBill> = {}): MissingBill => ({
  id: "m1",
  bill_no: "ZX100",
  customer_name: "أحمد علي",
  customer_phone: "01012345678",
  cod_amount: 500,
  moderator_name: "نورا",
  shipment_date: "2026-09-10T10:00:00+02:00",
  first_seen_at: "2026-09-10T10:00:00.000Z",
  ...over,
});

const order = (over: Partial<OrderCandidate> = {}): OrderCandidate => ({
  id: "o1",
  order_number: "NA-1",
  total: 500,
  created_at: "2026-09-09T10:00:00.000Z",
  moderator: "نورا",
  shipping_bill_no: null,
  status: "processing",
  customer: { name: "أحمد علي", phone: "01012345678", phone2: null },
  ...over,
});

describe("last9PhoneKey / amountMatchesZodex", () => {
  it("uses last 9 digits so 01 and 20 prefixes collide", () => {
    expect(last9PhoneKey("01012345678")).toBe("1012345678".slice(-9));
    expect(last9PhoneKey("+201012345678")).toBe(last9PhoneKey("01012345678"));
  });

  it("treats exact +110 COD as a locked shipping-fee match, not a 30–160 window", () => {
    expect(amountMatchesZodex(500, 610).ok).toBe(true);
    expect(amountMatchesZodex(500, 610).via).toBe("shipping_fee");
    expect(amountMatchesZodex(500, 580).ok).toBe(false);
  });
});

describe("classifyLinkIssue — no invented one-click matches", () => {
  it("marks phone+amount+moderator high scores as bill_not_saved when phone is exact", () => {
    const scored = scoreCandidate(bill(), order());
    expect(scored.score).toBeGreaterThanOrEqual(90);
    const issue = classifyLinkIssue(bill(), scored);
    expect(issue?.kind).toBe("bill_not_saved_on_order");
    expect(issue?.fixable).toBe(true);
  });

  it("does not offer one-click confirm when the phone is not a strong key", () => {
    const base = scoreCandidate(
      bill(),
      order({ customer: { name: "شخص آخر", phone: "01500000000", phone2: null } }),
    );
    const issue = classifyLinkIssue(bill(), { ...base, score: 72 });
    expect(issue?.kind).toBe("weak_match");
    expect(issue?.fixable).toBe(false);
  });
});

describe("explainOrphanBill / no-bill orders", () => {
  it("labels invalid Zodex phones as scrape/data, not a missing local order", () => {
    const why = explainOrphanBill({ bill: bill({ customer_phone: "N/A" }), weakCandidates: [] });
    expect(why.kind).toBe("no_valid_phone");
  });

  it("labels missing shipment_date instead of pretending the row is new", () => {
    const why = explainOrphanBill({ bill: bill({ shipment_date: null }), weakCandidates: [] });
    expect(why.kind).toBe("missing_zodex_date");
  });

  it("does not treat phone-only (amount off) as a match", () => {
    const sugg = suggestBillForOrder(500, [bill({ cod_amount: 900 })], "الموبايل الأساسي");
    expect(sugg?.kind).toBe("phone_only");
    const why = explainNoBillOrder({ hasWarehouse: true, shippingCompany: "zodex", suggestion: sugg });
    expect(why.kind).toBe("phone_only_bill");
  });

  it("accepts last-9 phone + exact-or-+110 amount as a labeled pending bill, not an auto-link", () => {
    const sugg = suggestBillForOrder(500, [bill({ cod_amount: 610 })], "الموبايل الأساسي");
    expect(sugg?.kind).toBe("amount_ok");
    const why = explainNoBillOrder({ hasWarehouse: true, shippingCompany: "zodex", suggestion: sugg });
    expect(why.detail).toMatch(/إعادة الربط/);
  });
});

describe("isExpectedZodexShipment / fulfillmentKeepsZodexWaybill", () => {
  it("expects a Zodex bill on Agouza delivery, not customer pickup", () => {
    expect(isExpectedZodexShipment({
      status: "pending",
      source_warehouse_id: AGOUZA_WAREHOUSE_ID,
      fulfillment_type: "delivery",
    })).toBe(true);
    expect(isExpectedZodexShipment({
      status: "pending",
      source_warehouse_id: AGOUZA_WAREHOUSE_ID,
      fulfillment_type: "pickup",
    })).toBe(false);
  });

  it("does not treat private-courier or cancelled rows as Zodex shipments", () => {
    expect(isExpectedZodexShipment({
      status: "pending",
      shipping_company: "مندوب خاص",
      fulfillment_type: "delivery",
    })).toBe(false);
    expect(isExpectedZodexShipment({
      status: "cancelled",
      source_warehouse_id: AGOUZA_WAREHOUSE_ID,
      fulfillment_type: "delivery",
    })).toBe(false);
  });

  it("keeps ZX when editing Agouza delivery or شركة شحن, wipes it for pickup/كيمو", () => {
    expect(fulfillmentKeepsZodexWaybill("delivery_agouza")).toBe(true);
    expect(fulfillmentKeepsZodexWaybill("shipping_company")).toBe(true);
    expect(fulfillmentKeepsZodexWaybill("pickup_agouza")).toBe(false);
    expect(fulfillmentKeepsZodexWaybill("pickup_main")).toBe(false);
    expect(fulfillmentKeepsZodexWaybill("delivery_main")).toBe(false);
  });
});
