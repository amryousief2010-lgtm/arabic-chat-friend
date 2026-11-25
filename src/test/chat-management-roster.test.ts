import { describe, it, expect } from "vitest";
import {
  buildCopiedDayShifts,
  buildCopiedWeekShifts,
  computeDayCoverageGaps,
  dowOf,
  findModeratorOverlaps,
  formatDurationAr,
  generateWeek,
  isOvernightShift,
  rosterWarnings,
  shiftDurationMinutes,
  validateShiftDraft,
  validateWeekRoster,
  weekStartSaturday,
  type DayShift,
  type RosterModerator,
  type ShiftTemplate,
} from "@/lib/chatManagement/roster";

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

const NOV = [
  mod("noura", 1),
  mod("aya", 2),
  mod("hagar", 3),
  mod("soha", 4),
  mod("mariam", 5, { end_date: "2026-10-31" }),
  mod("fatma", 6, { chat_active: false }),
];

const shift = (id: string, work_date: string, starts_at: string, ends_at: string, moderator_ids: string[], staff_count = 1): DayShift => ({
  id,
  work_date,
  sort_order: 1,
  label: `شيفت ${id}`,
  starts_at,
  ends_at,
  staff_count,
  source: "manual",
  moderator_ids,
});

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

  it("supports custom patterns with >4 shifts and staff_count > 1 per shift", () => {
    const customTemplates: ShiftTemplate[] = [
      { day_pattern: "busy_5", slot_no: 1, label: "صباحي", starts_at: "09:00", ends_at: "12:00", staff_count: 2 },
      { day_pattern: "busy_5", slot_no: 2, label: "ظهيرة", starts_at: "12:00", ends_at: "15:00", staff_count: 1 },
      { day_pattern: "busy_5", slot_no: 3, label: "عصر", starts_at: "15:00", ends_at: "18:00", staff_count: 1 },
      { day_pattern: "busy_5", slot_no: 4, label: "مساء", starts_at: "18:00", ends_at: "21:00", staff_count: 1 },
      { day_pattern: "busy_5", slot_no: 5, label: "سهرة", starts_at: "21:00", ends_at: "01:00", staff_count: 1 },
    ];
    const mods = [mod("noura", 1), mod("aya", 2), mod("hagar", 3), mod("soha", 4), mod("mona", 5), mod("rana", 6)];
    const patterns = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, "busy_5"]));
    const w = generateWeek({ weekStart: "2026-11-21", templates: customTemplates, moderators: mods, daysOff: {}, patterns });
    expect(w[0].slots).toHaveLength(5);
    expect(w[0].slots[0].moderator_ids).toEqual(["noura", "aya"]);
    expect(w[0].slots[1].moderator_ids).toEqual(["hagar"]);
    expect(w[0].slots[4].moderator_ids).toEqual(["rana"]);
  });
});

describe("flexible shift validations & helpers", () => {
  it("computes overnight duration and label accurately", () => {
    expect(isOvernightShift("21:00", "01:00")).toBe(true);
    expect(isOvernightShift("09:00", "13:00")).toBe(false);
    expect(shiftDurationMinutes("21:00", "01:30")).toBe(270);
    expect(formatDurationAr(270)).toBe("4 س 30 د");
    expect(shiftDurationMinutes("09:00", "09:00")).toBe(0);
  });

  it("detects same-day and cross-midnight overlaps, while allowing touching shifts", () => {
    const existing: DayShift[] = [
      shift("s1", "2026-11-21", "09:00", "13:00", ["noura"]),
      shift("s2", "2026-11-21", "21:00", "02:00", ["aya"]),
    ];

    // Touching 13:00–17:00 for noura is valid
    expect(
      findModeratorOverlaps({ work_date: "2026-11-21", label: "x", starts_at: "13:00", ends_at: "17:00", staff_count: 1, moderator_ids: ["noura"] }, existing),
    ).toHaveLength(0);

    // Overlapping 12:00–15:00 for noura is caught
    expect(
      findModeratorOverlaps({ work_date: "2026-11-21", label: "x", starts_at: "12:00", ends_at: "15:00", staff_count: 1, moderator_ids: ["noura"] }, existing),
    ).toHaveLength(1);

    // Overnight spillover: Sun 01:00–05:00 overlaps Sat 21:00–02:00 for aya
    expect(
      findModeratorOverlaps({ work_date: "2026-11-22", label: "فجر", starts_at: "01:00", ends_at: "05:00", staff_count: 1, moderator_ids: ["aya"] }, existing),
    ).toHaveLength(1);
  });

  it("warns on day-off conflicts and understaffing without returning them as blocking errors", () => {
    const res = validateShiftDraft(
      { work_date: "2026-11-24", label: "مساء", starts_at: "14:00", ends_at: "20:00", staff_count: 2, moderator_ids: ["aya"] },
      [],
      NOV,
      { aya: 2 /* Tuesday 2026-11-24 */ },
    );
    expect(res.errors).toHaveLength(0);
    expect(res.dayOffModeratorIds.has("aya")).toBe(true);
    expect(res.warnings.length).toBe(2); // day off + 1/2 understaffed
  });

  it("computes coverage gaps accurately including empty shifts and overnight continuity", () => {
    const shifts: DayShift[] = [
      shift("a", "2026-11-21", "09:00", "13:00", ["noura"]),
      shift("b", "2026-11-21", "15:00", "21:00", ["aya"]),
      shift("c", "2026-11-21", "21:00", "01:00", []), // unassigned => gap!
    ];
    const gaps = computeDayCoverageGaps("2026-11-21", shifts, "09:00", "01:00");
    expect(gaps).toEqual([
      { start: "13:00", end: "15:00" },
      { start: "21:00", end: "01:00" },
    ]);

    const full = [
      ...shifts.slice(0, 2),
      shift("b2", "2026-11-21", "13:00", "15:00", ["hagar"]),
      shift("c2", "2026-11-21", "21:00", "01:00", ["soha"]),
    ];
    expect(computeDayCoverageGaps("2026-11-21", full, "09:00", "01:00")).toEqual([]);
  });

  it("validates week roster and builds copied day/week shifts", () => {
    const s1 = shift("1", "2026-11-21", "09:00", "14:00", ["noura", "aya"], 2);
    const s2 = shift("2", "2026-11-21", "14:00", "01:00", ["hagar"], 1);
    const check = validateWeekRoster({
      dates: ["2026-11-21"],
      shifts: [s1, s2],
      moderators: NOV,
      daysOff: { aya: 6 },
    });
    expect(check.errors).toHaveLength(0);
    expect(check.coverageGapsByDate["2026-11-21"]).toEqual([]);
    expect(check.dayOffConflictKeys.has("1|aya")).toBe(true);

    const copiedDay = buildCopiedDayShifts([s1, s2], ["2026-11-22", "2026-11-23"], { includeModerators: false });
    expect(copiedDay).toHaveLength(4);
    expect(copiedDay[0].moderator_ids).toEqual([]);

    const copiedWeek = buildCopiedWeekShifts([s1, s2], "2026-11-21", "2026-11-28", { includeModerators: true });
    expect(copiedWeek).toHaveLength(2);
    expect(copiedWeek[0].work_date).toBe("2026-11-28");
    expect(copiedWeek[0].moderator_ids).toEqual(["noura", "aya"]);
  });
});
