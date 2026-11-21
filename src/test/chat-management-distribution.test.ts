import { describe, it, expect } from "vitest";
import { pickModerator, type Candidate } from "@/lib/chatManagement/distribution";
import { clockStart, DEFAULT_KPI_SETTINGS } from "@/lib/chatManagement/responseClock";

// نفس سيناريوهات supabase/tests/cm_step2_test.sql
const noura: Candidate = { id: "noura", open_conversations: 0, max_open: 40, sort_order: 1 };
const soha: Candidate = { id: "soha", open_conversations: 0, max_open: 40, sort_order: 4 };
const aya: Candidate = { id: "aya", open_conversations: 0, max_open: 40, sort_order: 2 };

describe("pickModerator (step 2 parity with SQL)", () => {
  it("on-leave owner keeps ownership and an on-shift cover is recorded", () => {
    expect(pickModerator({ method: "campaign", fallback: "load", lineOwnerId: "noura", lineOwnerOnLeave: true, candidates: [aya] }))
      .toEqual({ id: "noura", via: "line_owner", coverId: "aya" });
  });
  it("ended owner is treated as unowned", () => {
    expect(pickModerator({ method: "campaign", fallback: "load", lineOwnerId: "mariam", lineOwnerActive: false,
      campaignOwnerId: "soha", candidates: [noura] })).toEqual({ id: "soha", via: "campaign" });
  });
  it("unavailable campaign owner falls back to load", () => {
    expect(pickModerator({ method: "campaign", fallback: "load", campaignOwnerId: "soha", campaignOwnerAvailable: false,
      candidates: [soha, { ...noura, open_conversations: 3 }] })).toEqual({ id: "soha", via: "load" });
  });
  it("load ties break by sort order", () => {
    expect(pickModerator({ method: "load", fallback: "none", candidates: [soha, noura] }).id).toBe("noura");
  });
  it("round robin cycles in sort order and skips full moderators", () => {
    const c = [soha, noura];
    expect(pickModerator({ method: "round_robin", fallback: "none", candidates: c }).id).toBe("noura");
    expect(pickModerator({ method: "round_robin", fallback: "none", candidates: c, lastAssignedId: "noura" }).id).toBe("soha");
    expect(pickModerator({ method: "round_robin", fallback: "none", candidates: c, lastAssignedId: "soha" }).id).toBe("noura");
    expect(pickModerator({ method: "round_robin", fallback: "none", candidates: [soha, { ...noura, open_conversations: 40 }],
      lastAssignedId: "soha" }).id).toBe("soha");
  });
  it("no fallback when the primary method is not campaign", () => {
    expect(pickModerator({ method: "load", fallback: "round_robin", candidates: [] })).toEqual({ id: null, via: null });
  });
  it("a 03:00 message is distributed on the 09:00 shift (clock deferred)", () => {
    const start = clockStart(new Date("2026-11-03T03:00:00+02:00"), DEFAULT_KPI_SETTINGS);
    expect(start.toISOString()).toBe(new Date("2026-11-03T09:00:00+02:00").toISOString());
  });
});
