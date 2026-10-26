import { describe, it, expect } from "vitest";
import { HR_DEPARTMENTS, ALL_JOB_TITLES, isCatalogueJob, jobsForDepartment, findDepartmentByName } from "./jobCatalogue";

describe("HR job catalogue", () => {
  it("separates sales and marketing", () => {
    expect(findDepartmentByName("المبيعات")?.code).toBe("sales");
    expect(findDepartmentByName("التسويق")?.code).toBe("marketing");
    expect(findDepartmentByName("خدمة العملاء")?.parent).toBe("sales");
    expect(findDepartmentByName("الشحن والتوصيل")?.parent).toBe("sales");
  });
  it("has unique department codes/names and valid parents", () => {
    const codes = HR_DEPARTMENTS.map((d) => d.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(new Set(HR_DEPARTMENTS.map((d) => d.name)).size).toBe(codes.length);
    HR_DEPARTMENTS.forEach((d) => d.parent && expect(codes).toContain(d.parent));
  });
  it("has unique job titles", () => {
    expect(new Set(ALL_JOB_TITLES).size).toBe(ALL_JOB_TITLES.length);
  });
  it("treats legacy free text as other", () => {
    expect(isCatalogueJob("موديريتور مبيعات")).toBe(true);
    expect(isCatalogueJob("موديرتور")).toBe(false);
    expect(isCatalogueJob("")).toBe(false);
  });
  it("lists chosen department first", () => {
    expect(jobsForDepartment("المجزر")[0].code).toBe("slaughterhouse");
  });
  it("hardcodes no manager names", () => {
    const blob = JSON.stringify(HR_DEPARTMENTS);
    expect(blob).not.toMatch(/آلاء|محمد سيد/);
  });
});
