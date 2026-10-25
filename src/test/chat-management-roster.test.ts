import { describe, it, expect } from "vitest";
import { generateWeek, rosterWarnings, weekStartSaturday, dowOf, type ShiftTemplate, type RosterModerator } from "@/lib/chatManagement/roster";

const T: ShiftTemplate[] = [
  { day_pattern: "four_shift", slot_no: 1, label: "ش1", starts_at: "09:00", ends_at: "13:00" },
  { day_pattern: "four_shift", slot_no: 2, label: "ش2", starts_at: "13:00", ends_at: "17:00" },
  { day_pattern: "four_shift", slot_no: 3, label: "ش3", starts_at: "17:00", ends_at: "21:00" },
  { day_pattern: "four_shift", slot_no: 4, label: "ش4", starts_at: "21:00", ends_at: "01:00" },
  { day_pattern: "three_shift", slot_no: 1, label: "ش1", starts_at: "09:00", ends_at: "14:00" },
  { day_pattern: "three_shift", slot_no: 2, label: "ش2", starts_at: "14:00", ends_at: "20:00" },
  { day_pattern: "three_shift", slot_no: 3, label: "ش3", starts_at: "20:00", ends_at: "01:00" },
];
const mod = (id: string, sort_order: number, extra: Partial<RosterModerator> = {}): RosterModerator =>
  ({ id, display_name: id, sort_order, is_active: true, chat_active: true, ...extra });
const NOV = [mod("noura", 1), mod("aya", 2), mod("hagar", 3), mod("soha", 4), mod("mariam", 5, { end_date: "2026-10-31" }), mod("fatma", 6, { chat_active: false })];

describe("roster generation", () => {
  it("week starts on Saturday", () => {
    expect(weekStartSaturday("2026-10-27")).toBe("2026-10-24");
    expect(dowOf("2026-10-24")).toBe(6);
  });

  it("uses 4 shifts Sat/Sun/Mon and 3 shifts Tue–Fri", () => {
    const w = generateWeek({ weekStart: "2026-11-07", templates: T, moderators: NOV, daysOff: {} });
    expect(w.map((d) => d.slots.length)).toEqual([4, 4, 4, 3, 3, 3, 3]);
    expect(w[0].slots[3]).toMatchObject({ starts_at: "21:00", ends_at: "01:00" });
  });

  it("excludes ended (مريم after Oct) and chat-inactive (فاطمة) moderators", () => {
    const w = generateWeek({ weekStart: "2026-11-07", templates: T, moderators: NOV, daysOff: {} });
    const ids = new Set(w.flatMap((d) => d.slots.map((s) => s.moderator_id)));
    expect(ids.has("mariam")).toBe(false);
    expect(ids.has("fatma")).toBe(false);
    expect(w[0].slots.map((s) => s.moderator_id)).toEqual(["noura", "aya", "hagar", "soha"]);
  });

  it("skips the moderator on her weekly day off and leaves no duplicate in a day", () => {
    const w = generateWeek({ weekStart: "2026-11-07", templates: T, moderators: NOV, daysOff: { aya: 2 /* الثلاثاء */ } });
    const tue = w.find((d) => d.dow === 2)!;
    expect(tue.off_moderator_ids).toEqual(["aya"]);
    expect(tue.slots.map((s) => s.moderator_id)).toEqual(["noura", "hagar", "soha"]);
    for (const d of w) {
      const ids = d.slots.map((s) => s.moderator_id).filter(Boolean);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("reproduces the agreed 24–30 Oct week (نورا/آية/هاجر) and flags empty slots", () => {
    const three = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, "three_shift" as const]));
    const mods = [mod("noura", 1), mod("aya", 2), mod("hagar", 3)];
    const w = generateWeek({ weekStart: "2026-10-24", templates: T, moderators: mods, daysOff: {}, patterns: three });
    expect(w.every((d) => d.slots.map((s) => s.moderator_id).join() === "noura,aya,hagar")).toBe(true);
    const four = generateWeek({ weekStart: "2026-10-24", templates: T, moderators: mods, daysOff: {} });
    expect(four[0].slots[3].moderator_id).toBeNull();
    expect(rosterWarnings(four).length).toBeGreaterThan(0);
  });

  it("rotation offset shifts who takes the first slot", () => {
    const w = generateWeek({ weekStart: "2026-11-07", templates: T, moderators: NOV, daysOff: {}, rotationOffset: 1 });
    expect(w[0].slots.map((s) => s.moderator_id)).toEqual(["aya", "hagar", "soha", "noura"]);
  });
});
