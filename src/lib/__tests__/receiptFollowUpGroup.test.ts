import { describe, it, expect } from "vitest";
import { receiptFollowUpGroup } from "@/components/warehouses/WarehouseReceiptsTab";

const now = new Date("2026-10-10T12:00:00Z").getTime();
const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString();

describe("receiptFollowUpGroup", () => {
  it("pending under 3 days is waiting", () => {
    expect(receiptFollowUpGroup({ status: "pending", date: daysAgo(2) }, now)).toBe("waiting");
  });
  it("pending 3+ days is stuck", () => {
    expect(receiptFollowUpGroup({ status: "pending", date: daysAgo(3) }, now)).toBe("stuck");
  });
  it("rejected is stuck", () => {
    expect(receiptFollowUpGroup({ status: "rejected", date: daysAgo(0) }, now)).toBe("stuck");
  });
  it("received and partial are received", () => {
    expect(receiptFollowUpGroup({ status: "received", date: daysAgo(10) }, now)).toBe("received");
    expect(receiptFollowUpGroup({ status: "partial", date: daysAgo(10) }, now)).toBe("received");
  });
});
