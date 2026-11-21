import { describe, it, expect } from "vitest";
import { clockStart, serviceMinutesBetween, isAbandoned, isInServiceWindow, evaluateFirstReply, onShiftModeratorIds } from "@/lib/chatManagement/responseClock";
import { pickModerator } from "@/lib/chatManagement/distribution";

// القاهرة في نوفمبر 2026 = UTC+2 (بعد انتهاء التوقيت الصيفي)
const cairo = (local: string) => new Date(`${local}+02:00`);

describe("service window 09:00–01:00 (Cairo)", () => {
  it("knows inside / outside", () => {
    expect(isInServiceWindow(cairo("2026-11-10T09:00:00"))).toBe(true);
    expect(isInServiceWindow(cairo("2026-11-11T00:30:00"))).toBe(true);
    expect(isInServiceWindow(cairo("2026-11-11T01:00:00"))).toBe(false);
    expect(isInServiceWindow(cairo("2026-11-11T05:00:00"))).toBe(false);
  });

  it("a message at 03:00 starts its clock at 09:00", () => {
    expect(clockStart(cairo("2026-11-11T03:00:00")).toISOString()).toBe(cairo("2026-11-11T09:00:00").toISOString());
    const inside = cairo("2026-11-11T12:00:00");
    expect(clockStart(inside)).toBe(inside);
  });

  it("counts only minutes inside the window", () => {
    expect(serviceMinutesBetween(cairo("2026-11-11T00:50:00"), cairo("2026-11-11T09:20:00"))).toBe(30);
    expect(serviceMinutesBetween(cairo("2026-11-11T03:00:00"), cairo("2026-11-11T08:59:00"))).toBe(0);
    expect(serviceMinutesBetween(cairo("2026-11-11T10:00:00"), cairo("2026-11-12T10:00:00"))).toBe(16 * 60);
  });

  it("abandoned after 30 window-minutes, paused overnight", () => {
    expect(isAbandoned(cairo("2026-11-11T00:45:00"), null, cairo("2026-11-11T09:10:00"))).toBe(false); // 15+10
    expect(isAbandoned(cairo("2026-11-11T00:45:00"), null, cairo("2026-11-11T09:15:00"))).toBe(true);
    expect(isAbandoned(cairo("2026-11-11T12:00:00"), cairo("2026-11-11T12:05:00"), cairo("2026-11-11T13:00:00"))).toBe(false);
  });
});

describe("first reply target and cover", () => {
  const rows = [
    { work_date: "2026-11-10", starts_at: "09:00", ends_at: "14:00", moderator_id: "noura" },
    { work_date: "2026-11-10", starts_at: "14:00", ends_at: "20:00", moderator_id: "aya" },
    { work_date: "2026-11-10", starts_at: "20:00", ends_at: "01:00", moderator_id: "hagar" },
  ];
  it("overnight shift belongs to its start date", () => {
    expect(onShiftModeratorIds(cairo("2026-11-11T00:30:00"), rows)).toEqual(["hagar"]);
  });
  it("owner on shift: 15 min target", () => {
    const r = evaluateFirstReply({ arrival: cairo("2026-11-10T10:00:00"), firstReply: cairo("2026-11-10T10:10:00"), now: cairo("2026-11-10T11:00:00"), ownerId: "noura", assignments: rows });
    expect(r).toMatchObject({ status: "on_time", target_min: 15, owner_on_shift: true });
  });
  it("owner off shift: 60 min target, then cover by the on-shift moderator (not a delay on the owner)", () => {
    const ok = evaluateFirstReply({ arrival: cairo("2026-11-10T10:00:00"), firstReply: null, now: cairo("2026-11-10T10:40:00"), ownerId: "aya", assignments: rows });
    expect(ok).toMatchObject({ status: "pending", target_min: 60 });
    const late = evaluateFirstReply({ arrival: cairo("2026-11-10T10:00:00"), firstReply: null, now: cairo("2026-11-10T11:05:00"), ownerId: "aya", assignments: rows });
    expect(late).toMatchObject({ status: "cover", cover_moderator_ids: ["noura"] });
  });
  it("owner on shift and past 15 min with nobody else: late", () => {
    const r = evaluateFirstReply({ arrival: cairo("2026-11-10T10:00:00"), firstReply: cairo("2026-11-10T10:20:00"), now: cairo("2026-11-10T11:00:00"), ownerId: "noura", assignments: rows });
    expect(r.status).toBe("late");
  });
  it("night message: clock starts 09:00", () => {
    const r = evaluateFirstReply({ arrival: cairo("2026-11-11T04:00:00"), firstReply: cairo("2026-11-11T09:10:00"), now: cairo("2026-11-11T10:00:00"), ownerId: "noura", assignments: [{ ...rows[0], work_date: "2026-11-11" }] });
    expect(r).toMatchObject({ status: "on_time", elapsed_min: 10 });
  });
});

describe("distribution", () => {
  const c = [{ id: "a", open_conversations: 5, max_open: 20 }, { id: "b", open_conversations: 2, max_open: 20 }];
  it("line owner always wins", () => expect(pickModerator({ method: "load", fallback: "load", lineOwnerId: "x", candidates: c }).id).toBe("x"));
  it("campaign then load fallback", () => {
    expect(pickModerator({ method: "campaign", fallback: "load", campaignOwnerId: "a", candidates: c })).toEqual({ id: "a", via: "campaign" });
    expect(pickModerator({ method: "campaign", fallback: "load", candidates: c })).toEqual({ id: "b", via: "load" });
  });
  it("round robin", () => expect(pickModerator({ method: "round_robin", fallback: "none", candidates: c, lastAssignedId: "a" }).id).toBe("b"));
});
