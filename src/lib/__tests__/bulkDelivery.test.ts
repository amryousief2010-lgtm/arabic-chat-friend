import { describe, expect, it } from "vitest";
import { BULK_DELIVERY_CAP, bulkDeliveryPlan } from "../bulkDelivery";

describe("bulkDeliveryPlan", () => {
  it("lets a single order default the delivery time", () => {
    expect(bulkDeliveryPlan(1, "")).toEqual({ ok: true });
  });

  it("requires a batch timestamp and caps the batch", () => {
    expect(bulkDeliveryPlan(2, "").ok).toBe(false);
    const planned = bulkDeliveryPlan(3, "2026-09-30T18:00");
    expect(planned.ok).toBe(true);
    if (planned.ok) expect(planned.deliveredAt).toBeTruthy();
    expect(bulkDeliveryPlan(BULK_DELIVERY_CAP + 1, "2026-09-30T18:00").ok).toBe(false);
  });
});
