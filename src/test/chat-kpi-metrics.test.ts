import { describe, it, expect } from "vitest";
import {
  allocateSpend, convertedInWindow, isDelivered, isResolved, isCancelled, kpiByCampaign, kpiByModerator, kpiFirstReplyStatus,
  missedCallFollowedUp, formatPct, type KpiConv, type KpiOrder, type KpiSpend,
} from "@/lib/chatManagement/kpiMetrics";

// نفس بيانات cm_step4_test.sql (وهمية)
const ct = (t: string) => new Date(`${t}:00+03:00`); // القاهرة في سبتمبر 2026 = +03
const convs: KpiConv[] = [
  { moderator_id: "noura", campaign_id: "A", first_reply: "on_time", abandoned: false, converted: true },
  { moderator_id: "aya", campaign_id: "A", first_reply: "late", abandoned: false, converted: false },
  { moderator_id: "noura", campaign_id: "B", first_reply: "cover", abandoned: false, converted: false },
  { moderator_id: "noura", campaign_id: "B", first_reply: "late", abandoned: true, converted: false },
];
const orders: KpiOrder[] = [
  { moderator_id: "noura", campaign_id: "A", status: "delivered", total: 100, total_at_delivery: 90 },
  { moderator_id: "aya", campaign_id: "A", status: "cancelled", total: 50 },
  { moderator_id: "noura", campaign_id: "B", status: "collected", total: 200 },
];
const spend: KpiSpend[] = [{ campaign_id: "A", spend: 120 }, { campaign_id: "A", spend: 50 }, { campaign_id: "B", spend: 60 }];

describe("order statuses", () => {
  it("delivered / cancelled / resolved sets", () => {
    expect(isDelivered(" Delivered ")).toBe(true);
    expect(isDelivered("completed")).toBe(true);
    expect(isDelivered("shipped")).toBe(false);
    expect(isCancelled("cancelled")).toBe(true);
    expect(isResolved("fully_returned")).toBe(true);
    expect(isResolved("processing")).toBe(false);
    expect(isDelivered("partially_returned")).toBe(false);
  });
});

describe("first reply KPI status", () => {
  const base = { clockStartedAt: ct("2026-09-01T10:00"), wasCover: false, targetMinutes: 15, now: ct("2026-09-01T12:00") };
  it("on_time at exactly target, late after", () => {
    expect(kpiFirstReplyStatus({ ...base, firstReplyAt: ct("2026-09-01T10:15") })).toBe("on_time");
    expect(kpiFirstReplyStatus({ ...base, firstReplyAt: ct("2026-09-01T10:16") })).toBe("late");
  });
  it("cover wins, pending vs late when unreplied", () => {
    expect(kpiFirstReplyStatus({ ...base, firstReplyAt: ct("2026-09-01T11:30"), wasCover: true })).toBe("cover");
    expect(kpiFirstReplyStatus({ ...base, firstReplyAt: null, now: ct("2026-09-01T10:10") })).toBe("pending");
    expect(kpiFirstReplyStatus({ ...base, firstReplyAt: null })).toBe("late");
    expect(kpiFirstReplyStatus({ ...base, clockStartedAt: null, firstReplyAt: null })).toBeNull();
  });
  it("counts service minutes only (message 00:50, reply 09:30 next morning = 10+30 min)", () => {
    expect(kpiFirstReplyStatus({ ...base, targetMinutes: 60, clockStartedAt: ct("2026-09-01T00:50"), firstReplyAt: ct("2026-09-01T09:30") })).toBe("on_time");
    expect(kpiFirstReplyStatus({ ...base, targetMinutes: 39, clockStartedAt: ct("2026-09-01T00:50"), firstReplyAt: ct("2026-09-01T09:30") })).toBe("late");
  });
});

describe("missed call follow-up", () => {
  const m = ct("2026-09-01T12:00");
  it("callback within 60 min counts; at 61 does not", () => {
    expect(missedCallFollowedUp(m, { callbacks: [ct("2026-09-01T12:40")] })).toBe(true);
    expect(missedCallFollowedUp(m, { callbacks: [ct("2026-09-01T13:00")] })).toBe(true);
    expect(missedCallFollowedUp(m, { callbacks: [ct("2026-09-01T13:01")] })).toBe(false);
  });
  it("earlier calls are ignored; message or manual mark counts", () => {
    expect(missedCallFollowedUp(m, { callbacks: [ct("2026-09-01T11:00")] })).toBe(false);
    expect(missedCallFollowedUp(m, { messages: [ct("2026-09-01T15:00")] })).toBe(false);
    expect(missedCallFollowedUp(m, { messages: [ct("2026-09-01T12:30")] })).toBe(true);
    expect(missedCallFollowedUp(m, { manualAt: ct("2026-09-01T12:10") })).toBe(true);
    expect(missedCallFollowedUp(m, {})).toBe(false);
  });
});

describe("conversion within 7 days", () => {
  const f = ct("2026-09-01T10:00");
  it("linked, not cancelled, inside window", () => {
    expect(convertedInWindow(f, [{ created_at: ct("2026-09-02T12:00"), status: "delivered" }])).toBe(true);
    expect(convertedInWindow(f, [{ created_at: ct("2026-09-01T13:00"), status: "cancelled" }])).toBe(false);
    expect(convertedInWindow(f, [{ created_at: ct("2026-09-09T12:00"), status: "pending" }])).toBe(false);
    expect(convertedInWindow(f, [{ created_at: ct("2026-09-08T09:59"), status: "pending" }])).toBe(true);
    expect(convertedInWindow(f, [{ created_at: ct("2026-09-01T09:00"), status: "pending" }])).toBe(false);
  });
});

describe("per campaign (same numbers as SQL test)", () => {
  const r = Object.fromEntries(kpiByCampaign(convs, orders, spend).map((x) => [x.campaign_id, x]));
  it("campaign A", () => expect(r.A).toEqual({ campaign_id: "A", spend: 170, conversations: 2, converted: 1, orders: 2, delivered: 1,
    resolved: 2, delivered_value: 90, cost_per_delivered: 170 }));
  it("campaign B", () => expect(r.B).toMatchObject({ spend: 60, conversations: 2, delivered: 1, delivered_value: 200, cost_per_delivered: 60 }));
  it("retroactive cancellation removes delivery", () => {
    const o2 = orders.map((o, i) => (i === 0 ? { ...o, status: "cancelled" } : o));
    expect(kpiByCampaign(convs, o2, spend).find((x) => x.campaign_id === "A")).toMatchObject({ delivered: 0, delivered_value: 0, cost_per_delivered: null });
  });
  it("spend-only campaign appears with null cost", () => {
    expect(kpiByCampaign([], [], [{ campaign_id: "C", spend: 10 }])[0]).toMatchObject({ campaign_id: "C", cost_per_delivered: null });
  });
});

describe("per moderator", () => {
  const r = Object.fromEntries(kpiByModerator(convs, orders, spend).map((x) => [x.moderator_id, x]));
  it("allocation by conversation share", () => {
    const a = allocateSpend(convs, spend);
    expect(a.get("noura")).toBe(145);
    expect(a.get("aya")).toBe(85);
  });
  it("noura", () => expect(r.noura).toEqual({ moderator_id: "noura", conversations: 3, on_time: 1, cover: 1, late: 1, pending: 0, abandoned: 1,
    converted: 1, orders: 2, delivered: 2, resolved: 2, delivered_value: 290, campaign_delivered: 2, allocated_spend: 145, cost_per_delivered: 72.5 }));
  it("aya", () => expect(r.aya).toMatchObject({ conversations: 1, late: 1, orders: 1, delivered: 0, resolved: 1, allocated_spend: 85, cost_per_delivered: null }));
  it("delivered orders without a campaign do not dilute cost per delivered", () => {
    const extra = [...orders, { moderator_id: "noura", campaign_id: null, status: "delivered", total: 10 }];
    expect(kpiByModerator(convs, extra, spend).find((x) => x.moderator_id === "noura")).toMatchObject({ delivered: 3, campaign_delivered: 2, cost_per_delivered: 72.5 });
  });
  it("percent formatting", () => { expect(formatPct(1, 3)).toBe("33٪"); expect(formatPct(1, 0)).toBe("—"); });
});
