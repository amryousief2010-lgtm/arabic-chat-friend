import { describe, expect, it } from "vitest";
import {
  ALL_MODERATOR_KEYS,
  DEFAULT_BASE_SALARY,
  FILTER_MARKETERS,
  MODERATORS,
  baseSalaryForKey,
  displayModeratorName,
  findModeratorByName,
  findModeratorBySlug,
  isOrderForModerator,
  matchesModeratorGroup,
  moderatorKeysForMonth,
  moderatorsForMonth,
} from "../../constants/moderators";
import { buildPayrollBaseRows } from "../moderatorPayrollMath";

const soha = () => MODERATORS.find((m) => m.slug === "soha")!;

describe("سها as an independent moderator slot", () => {
  it("is a payroll moderator (not an extra marketer) with her own key", () => {
    const m = soha();
    expect(m).toBeDefined();
    expect(m.payrollKey).toBe("سها");
    expect(m.canonicalModerator).toBe("سها");
    expect(m.displayName).toBe("سها");
    expect(m.startDate).toBe("2026-10-01");
    expect(ALL_MODERATOR_KEYS).toContain("سها");
    expect(FILTER_MARKETERS.some((f) => f.slug === "soha")).toBe(true);
    expect(findModeratorBySlug("soha")?.payrollKey).toBe("سها");
  });

  it("gets the same base salary scheme as نورا/هاجر (shared editable default)", () => {
    expect(soha().baseSalary).toBe(DEFAULT_BASE_SALARY);
    expect(baseSalaryForKey("سها", 2800)).toBe(baseSalaryForKey("نورا", 2800));
  });

  it("is active from October 2026 only, alongside مريم", () => {
    expect(moderatorKeysForMonth(2026, 9)).not.toContain("سها");
    const oct = moderatorKeysForMonth(2026, 10);
    expect(oct).toEqual(["اية", "نورا", "منال", "مريم", "سها"]);
    expect(moderatorKeysForMonth(2026, 11)).toContain("سها");
    expect(moderatorsForMonth(2026, 10).map((m) => m.slug)).toContain("soha");
  });

  it("auto-detects her from her profile name (NewOrder / own screens)", () => {
    expect(findModeratorByName("سها")?.slug).toBe("soha");
    expect(findModeratorByName("مريم")?.slug).toBe("mariam");
  });

  it("keeps مريم's orders with مريم and سها's orders with سها", () => {
    const mariam = MODERATORS.find((m) => m.slug === "mariam")!;
    expect(isOrderForModerator(soha(), "مريم", "مريم")).toBe(false);
    expect(isOrderForModerator(mariam, "مريم", "مريم")).toBe(true);
    expect(isOrderForModerator(soha(), "سها", "سها")).toBe(true);
    expect(isOrderForModerator(mariam, "سها", "سها")).toBe(false);
    // Order created by سها but reassigned to مريم counts for مريم only.
    expect(isOrderForModerator(soha(), "مريم", "سها")).toBe(false);
    expect(MODERATORS.filter((m) => isOrderForModerator(m, "سها", null)).map((m) => m.slug)).toEqual(["soha"]);
    expect(matchesModeratorGroup("سها", "سها")).toBe(true);
    expect(matchesModeratorGroup("مريم", "سها")).toBe(false);
    expect(displayModeratorName("سها")).toBe("سها");
  });

  it("gets a payroll row with the hybrid processed bonus like the others", () => {
    const rows = buildPayrollBaseRows({
      girls: moderatorKeysForMonth(2026, 10),
      qty: {
        meat: { سها: 10, نورا: 10 },
        bone: {},
        processed: { سها: 120, نورا: 120 },
      } as any,
      prices: { meat_price: 600, bone_meat_price: 400, processed_price: 500 },
      processedTiers: [],
      meatTiers: [],
      chickQtyByGirl: {},
      chickBonusRate: 0,
      bonePerKg: 3.5,
      baseDefault: 2500,
      overrides: [],
      year: 2026,
      month: 10,
      schedules: [],
    });
    const s = rows.find((r) => r.girl === "سها")!;
    const n = rows.find((r) => r.girl === "نورا")!;
    expect(s).toBeDefined();
    expect(s.base).toBe(2500);
    expect(s.procKg).toBe(120);
    expect(s.calculatedProcBonus).toBe(n.calculatedProcBonus);
    expect(s.scheme).toBe(n.scheme);
  });
});
