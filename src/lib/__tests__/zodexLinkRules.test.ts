import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fulfillmentKeepsZodexWaybill } from "../zodexClassify";
import {
  isAutoLinkCandidate, isExpectedZodexShipment, pickAutoLinkWinner,
} from "../../../supabase/functions/_shared/zodexSync";

const o = (x: Record<string, any>) => ({ id: "x", total: 500, created_at: "2026-10-28T08:00:00Z", status: "pending", ...x });

describe("capital carrier link rules (28/10)", () => {
  it("pickup orders are eligible", () => {
    expect(fulfillmentKeepsZodexWaybill("pickup_agouza")).toBe(true);
    expect(fulfillmentKeepsZodexWaybill("pickup_main")).toBe(true);
    expect(fulfillmentKeepsZodexWaybill("delivery_main")).toBe(false);
    expect(isExpectedZodexShipment({ status: "pending", fulfillment_type: "pickup" })).toBe(true);
    expect(isAutoLinkCandidate({ status: "pending", fulfillment_type: "pickup" })).toBe(true);
  });
  it("private courier stays excluded (any status/type)", () => {
    for (const status of ["pending", "cancelled", "delivered"]) {
      expect(isAutoLinkCandidate({ status, shipping_company: "مندوب خاص" })).toBe(false);
      expect(isAutoLinkCandidate({ status, shipping_company: " مندوب خاص ", fulfillment_type: "pickup" })).toBe(false);
    }
  });
  it("other carriers and drafts are excluded", () => {
    expect(isAutoLinkCandidate({ status: "pending", shipping_company: "بوسطة" })).toBe(false);
    expect(isAutoLinkCandidate({ status: "draft" })).toBe(false);
  });
  it("cancelled orders are eligible for a documentation link only", () => {
    expect(isAutoLinkCandidate({ status: "cancelled", fulfillment_type: "pickup" })).toBe(true);
    const p: any = pickAutoLinkWinner([o({ id: "c", status: "cancelled" })], 500)!;
    expect(p.blocked).toBeUndefined();
    expect(!p.blocked && p.winner.id).toBe("c");
    expect(!p.blocked && p.flags).toContain("cancelled_order_doc");
  });
  it("open order preferred over cancelled for the same phone", () => {
    const p: any = pickAutoLinkWinner([o({ id: "c", status: "cancelled", created_at: "2026-10-01T00:00:00Z" }), o({ id: "open" })], 500)!;
    expect(!p.blocked && p.winner.id).toBe("open");
    expect(!p.blocked && p.flags).toEqual([]);
  });
  it("return bill links only to a cancelled order, never an open one", () => {
    expect(pickAutoLinkWinner([o({ id: "open" })], 500, { returnBill: true })).toBeNull();
    expect((pickAutoLinkWinner([o({ id: "open" }), o({ id: "c", status: "cancelled" })], 500, { returnBill: true }) as any).winner.id).toBe("c");
  });
  it("amount difference is NOT linked → review with both amounts + suggested order", () => {
    const order = o({ id: "a", total: 665 });
    const snapshot = JSON.stringify(order);
    const p: any = pickAutoLinkWinner([order], 990)!;
    expect(p.blocked).toBe("amount_mismatch");
    expect(p.blocked && p.suggested.id).toBe("a");
    expect(p.blocked && [p.cod, p.order_total]).toEqual([990, 665]);
    expect("winner" in p).toBe(false);
    expect(JSON.stringify(order)).toBe(snapshot);
  });
  it("cancelled order with different amount is also held for review", () => {
    expect(pickAutoLinkWinner([o({ status: "cancelled", total: 100 })], 990)!.blocked).toBe("amount_mismatch");
  });
  it("shipments: amount_mismatch is reported as unresolved and skipped before the link", () => {
    const ship = readFileSync("supabase/functions/sync-zodex-shipments/index.ts", "utf8");
    const b = ship.indexOf("if (picked.blocked)");
    expect(b).toBeGreaterThan(0);
    expect(b).toBeLessThan(ship.indexOf("const { error: updErr }", b));
    expect(ship.slice(b, ship.indexOf("continue;", b))).toMatch(/failure\("amount_mismatch"[\s\S]*suggested_order/);
    expect(ship).toMatch(/unresolved = [^;]*amount_mismatch/);
  });
  it("matching amount → no flag", () => {
    expect((pickAutoLinkWinner([o({ total: 500 })], 500) as any).flags).toEqual([]);
  });
});

describe("edge functions: no stock/ledger side effects + run guards", () => {
  const ship = readFileSync("supabase/functions/sync-zodex-shipments/index.ts", "utf8");
  const del = readFileSync("supabase/functions/sync-zodex-deliveries/index.ts", "utf8");
  it("shipments link step writes only shipping_bill_no", () => {
    const start = ship.indexOf("pickAutoLinkWinner(candidates");
    const link = ship.slice(ship.indexOf("const { error: updErr }", start), ship.indexOf("claimedThisRun.add(winner.id)", start));
    expect(link).toMatch(/\.update\(\{ shipping_bill_no: row\.bill_no \}\)/);
    expect(link).not.toMatch(/status|release_agouza|stock|ledger|total/);
  });
  it("deliveries never changes status of a cancelled order", () => {
    const i = del.indexOf("isCancelledStatus(matchedOrder.status)");
    expect(i).toBeGreaterThan(0);
    expect(del.slice(i, del.indexOf("} else if", i))).not.toMatch(/patch\.\w+ =|rpc\(/);
  });
  it("deliveries filters candidates through isAutoLinkCandidate", () => {
    expect(del).toMatch(/filter\(\(c\) => isAutoLinkCandidate\(c\)\)/);
  });
  it("deliveries closes its run row in finally + has a time budget", () => {
    expect(del).toMatch(/finally \{[\s\S]*zodex_sync_runs[\s\S]*eq\("status", "running"\)/);
    expect(del).toMatch(/DELIVERIES_TIME_BUDGET_MS = \d+/);
  });
  it("schedule lock window is 5 minutes", () => {
    expect(ship).toMatch(/RUNNING_LOCK_MINUTES = 5;/);
    expect(ship).not.toMatch(/20 \* 60_000/);
  });
});
