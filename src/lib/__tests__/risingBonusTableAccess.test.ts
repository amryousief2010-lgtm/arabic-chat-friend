import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  BONUS_SETTINGS_READ_ROLES,
  RISING_BONUS_TABLE_ROLES,
  canReadBonusSettingsTable,
  canViewRisingBonusTable,
} from "@/lib/risingBonusTableAccess";

describe("rising bonus table access", () => {
  it("matches quick delivery: general manager, executive manager, and marketing sales manager", () => {
    expect([...RISING_BONUS_TABLE_ROLES]).toEqual([
      "general_manager",
      "executive_manager",
      "marketing_sales_manager",
    ]);
    expect(canViewRisingBonusTable(["general_manager"])).toBe(true);
    expect(canViewRisingBonusTable(["executive_manager"])).toBe(true);
    expect(canViewRisingBonusTable(["marketing_sales_manager", "sales_manager"])).toBe(true);
    expect(canViewRisingBonusTable(["sales_moderator"])).toBe(false);
    expect(canViewRisingBonusTable(["sales_manager"])).toBe(false);
    expect(canViewRisingBonusTable(["marketing_sales_viewer"])).toBe(false);
    expect(canViewRisingBonusTable([])).toBe(false);
    expect(canViewRisingBonusTable(null)).toBe(false);
  });

  it("lets the monthly target editors read settings, and not moderators", () => {
    for (const role of BONUS_SETTINGS_READ_ROLES) {
      expect(canReadBonusSettingsTable([role])).toBe(true);
    }
    expect(canReadBonusSettingsTable(["sales_moderator"])).toBe(false);
    expect(canReadBonusSettingsTable(["marketing_sales_viewer"])).toBe(false);
  });

  it("does not link the personal bonus card to the general table", () => {
    const card = readFileSync(resolve(process.cwd(), "src/components/sales/ModeratorKgCounterCard.tsx"), "utf8");
    const counters = readFileSync(resolve(process.cwd(), "src/components/sales/ModeratorKgCounters.tsx"), "utf8");
    expect(card).not.toMatch(/bonus-schedule|ProcessedKgBonusSettings|نظام البونص/);
    expect(counters).not.toMatch(/bonus-schedule|ProcessedKgBonusSettings/);
  });
});
