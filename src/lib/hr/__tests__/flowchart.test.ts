import { describe, it, expect } from "vitest";
import { buildFlowchart, pickHead } from "@/lib/hr/flowchart";
import type { DirectoryEmployee } from "@/lib/hr/directory";

const e = (id: string, department: string, job_title: string, status: "active" | "inactive" = "active"): DirectoryEmployee =>
  ({ id, code: id, full_name: "موظف " + id, job_title, department, current_location_id: null, status, pay_day: 1 });

describe("flowchart", () => {
  const list = [
    e("1", "المبيعات", "موديريتور مبيعات"),
    e("2", "المبيعات", "مدير المبيعات"),
    e("3", "المزرعة", "مشرف مزرعة"),
    e("4", "المزرعة", "عامل مزرعة تسمين", "inactive"),
    e("5", "المجزر", "جزار"),
  ];
  it("picks a manager before a supervisor", () => {
    expect(pickHead([e("a", "x", "مشرف"), e("b", "x", "مديرة القسم")])?.id).toBe("b");
  });
  it("puts head apart from staff", () => {
    const s = buildFlowchart(list).find((d) => d.name === "المبيعات")!;
    expect(s.head?.id).toBe("2");
    expect(s.staff.map((m) => m.id)).toEqual(["1"]);
  });
  it("department without a head has null head", () => {
    expect(buildFlowchart(list).find((d) => d.name === "المجزر")!.head).toBeNull();
  });
  it("inactive staff only when requested, never as head", () => {
    const f = buildFlowchart(list).find((d) => d.name === "المزرعة")!;
    expect(f.staff).toHaveLength(0);
    expect(f.inactiveCount).toBe(1);
    expect(buildFlowchart(list, { showInactive: true }).find((d) => d.name === "المزرعة")!.staff.map((m) => m.id)).toEqual(["4"]);
  });
});
