import { describe, expect, it } from "vitest";
import { AI_REPORTS_PATH, AI_REPORTS_ROLES, canManageAiRules, canViewAiReports } from "@/config/aiReports";
import { moduleSections } from "@/components/layout/SidebarMenuSections";

describe("AI reports & alerts access (GM + sales manager only)", () => {
  it("only general_manager and sales_manager can view", () => {
    expect(AI_REPORTS_ROLES).toEqual(["general_manager", "sales_manager"]);
    expect(canViewAiReports(["general_manager"])).toBe(true);
    expect(canViewAiReports(["sales_manager"])).toBe(true);
    for (const r of ["executive_manager", "marketing_sales_manager", "sales_moderator", "accountant", "marketing_sales_viewer"])
      expect(canViewAiReports([r])).toBe(false);
    expect(canViewAiReports(null)).toBe(false);
  });
  it("only general_manager edits rules and approves", () => {
    expect(canManageAiRules(["general_manager"])).toBe(true);
    expect(canManageAiRules(["sales_manager"])).toBe(false);
  });
  it("sidebar entry uses the same roles", () => {
    const item = moduleSections.flatMap((s) => s.items).find((i) => i.path === AI_REPORTS_PATH)!;
    expect(item.roles).toEqual(AI_REPORTS_ROLES);
  });
});
