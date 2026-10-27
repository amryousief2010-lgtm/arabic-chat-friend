import { describe, it, expect } from "vitest";
import { groupByDepartment, filterDirectory, summarizePayDays, initialOf, LEADERSHIP, type DirectoryEmployee } from "@/lib/hr/directory";
import { phi, SCALE, BRAND } from "@/lib/hr/brand";

const e = (o: Partial<DirectoryEmployee>): DirectoryEmployee => ({
  id: o.id || Math.random().toString(), code: "E", full_name: "موظف", job_title: null, department: null,
  current_location_id: null, status: "active", pay_day: 1, ...o,
});

describe("HR directory", () => {
  it("groups by real department in catalogue order and keeps inactive staff visible", () => {
    const g = groupByDepartment([
      e({ full_name: "ب", department: "المجزر" }),
      e({ full_name: "أ", department: "المبيعات" }),
      e({ id: "95b5ce20", full_name: "ج", department: "المزرعة", job_title: "عامل مزرعة تسمين", status: "inactive" }),
      e({ full_name: "د" }),
    ]);
    expect(g.map((x) => x.name)).toEqual(["المبيعات", "المزرعة", "المجزر", "بدون قسم"]);
    const farm = g.find((x) => x.name === "المزرعة")!;
    expect(farm.active).toHaveLength(0);
    expect(farm.inactive[0].job_title).toBe("عامل مزرعة تسمين");
  });

  it("filters by search, department and status", () => {
    const list = [e({ full_name: "آلاء", department: "المبيعات" }), e({ full_name: "سيد", status: "inactive", department: "المزرعة" })];
    expect(filterDirectory(list, { status: "active" })).toHaveLength(1);
    expect(filterDirectory(list, { status: "all", department: "المزرعة" })).toHaveLength(1);
    expect(filterDirectory(list, { status: "all", search: "آلاء" })[0].full_name).toBe("آلاء");
  });

  it("summarises pay days for active staff only", () => {
    const s = summarizePayDays([e({ pay_day: 5, department: "المبيعات" }), e({ pay_day: 1 }), e({ pay_day: 1, status: "inactive" })]);
    expect(s).toEqual([{ day: 1, count: 1, departments: ["بدون قسم"] }, { day: 5, count: 1, departments: ["المبيعات"] }]);
  });

  it("strips honorifics for initials", () => {
    expect(initialOf("م/ آلاء")).toBe("آ");
    expect(initialOf("أ. أحمد")).toBe("أ");
    expect(initialOf("")).toBe("م");
  });

  it("never uses the owner title", () => {
    expect(LEADERSHIP.map((l) => l.title)).toEqual(["المدير العام", "المدير التنفيذي"]);
    expect(JSON.stringify(LEADERSHIP)).not.toContain("المالك");
  });

  it("uses the golden-ratio scale and logo colours", () => {
    expect([SCALE.xs, SCALE.sm, SCALE.md, SCALE.lg, SCALE.xl, SCALE.xxl]).toEqual([6, 10, 16, 26, 42, 68]);
    expect(phi(1) / phi(0)).toBeCloseTo(1.625, 1);
    expect(Object.values(BRAND)).toEqual(["#A4288A", "#F37346", "#662D8C"]);
  });
});
