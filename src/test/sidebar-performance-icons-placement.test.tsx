/**
 * Verifies that "أداء الفريق" and "أداء الموديراتور" live inside the
 * "1. التسويق والمبيعات" sidebar section, in the expected order, and remain
 * visible for:
 *   - marketing_sales_manager only  (Mohamed Sayed)
 *   - sales_manager                 (regular sales manager, e.g. Alaa)
 *   - general_manager / executive_manager
 *
 * These are the canonical role/placement policies described in
 * @/config/sidebarOverrides.ts + SidebarMenuSections.tsx.
 */
import { describe, it, expect } from "vitest";
import { moduleSections } from "@/components/layout/SidebarMenuSections";
import {
  SIDEBAR_ITEM_MOVES,
  MARKETING_ONLY_EXTRA_PREFIXES,
} from "@/config/sidebarOverrides";

const TEAM = "/team-performance";
const MOD = "/moderator-performance";

const salesSection = moduleSections.find((s) => s.id === "sales")!;

describe("Sidebar — performance icons live in the sales section", () => {
  it("both icons belong to the sales section", () => {
    const paths = salesSection.items.map((i) => i.path);
    expect(paths).toContain(TEAM);
    expect(paths).toContain(MOD);
  });

  it("team-performance comes immediately before moderator-performance", () => {
    const paths = salesSection.items.map((i) => i.path);
    const teamIdx = paths.indexOf(TEAM);
    const modIdx = paths.indexOf(MOD);
    expect(teamIdx).toBeGreaterThanOrEqual(0);
    expect(modIdx).toBe(teamIdx + 1);
  });

  it("neither icon is being moved out of its section by sidebarOverrides", () => {
    const movedPaths = SIDEBAR_ITEM_MOVES.map((m) => m.path);
    expect(movedPaths).not.toContain(TEAM);
    expect(movedPaths).not.toContain(MOD);
  });

  it.each([
    ["marketing_sales_manager", TEAM],
    ["marketing_sales_manager", MOD],
    ["sales_manager", TEAM],
    ["sales_manager", MOD],
    ["general_manager", TEAM],
    ["general_manager", MOD],
    ["executive_manager", TEAM],
    ["executive_manager", MOD],
  ])("role %s can see %s", (role, path) => {
    const item = salesSection.items.find((i) => i.path === path)!;
    expect(item.roles).toContain(role);
  });

  it("marketing-only allowlist keeps both paths reachable (no redirect)", () => {
    expect(MARKETING_ONLY_EXTRA_PREFIXES).toContain(TEAM);
    expect(MARKETING_ONLY_EXTRA_PREFIXES).toContain(MOD);
  });
});
