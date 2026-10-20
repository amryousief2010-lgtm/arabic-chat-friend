import { describe, expect, it } from "vitest";
import { baseSalaryForKey } from "@/constants/moderators";
import {
  BONUS_AT_MINIMUM,
  buildModeratorBonusBoard,
  buildModeratorBonusView,
  formatBonusEgp,
  moderatorKgBonus,
  moderatorSalary,
  risingCarryIncrements,
  toRisingBreakdown,
} from "@/lib/moderatorKgBonus";

const OCT_20 = new Date("2026-10-20T10:00:00.000Z");

describe("moderator kg bonus", () => {
  it("matches the adopted checkpoints", () => {
    const cases: Array<[number, number]> = [
      [399, 0],
      [400, 2400],
      [500, 3343.2857142857],
      [750, 6076.5],
      [1000, 9829.5],
      [1000.5, 9834.7505625],
      [1500, 15642],
      [2000, 22392],
      [2100, 23817],
      [2500, 29517],
    ];
    for (const [kg, bonus] of cases) {
      expect(moderatorKgBonus(kg)).toBeCloseTo(bonus, 6);
    }
  });

  it("pays nothing below the unlock, including zero and negative kilograms", () => {
    expect(moderatorKgBonus(0)).toBe(0);
    expect(moderatorKgBonus(-20)).toBe(0);
    expect(moderatorKgBonus(Number.NaN)).toBe(0);
    expect(moderatorKgBonus(399.9)).toBe(0);
    expect(moderatorKgBonus(400)).toBe(BONUS_AT_MINIMUM);
  });

  it("adds a fractional kilogram times the next kilogram's rate below one ton", () => {
    const whole = moderatorKgBonus(500);
    const next = moderatorKgBonus(500.3) - whole;
    expect(next).toBeCloseTo(0.3 * (9 + (3 * (501 - 400)) / 350), 8);
    expect(moderatorKgBonus(999.5) - moderatorKgBonus(999)).toBeCloseTo(0.5 * 18, 8);
  });

  it("prints the handout table, including salary on a 2,500 base", () => {
    const rows: Array<[number, string, string]> = [
      [400, "2,400", "4,900"],
      [500, "3,343.3", "5,843.3"],
      [1000, "9,829.5", "12,329.5"],
      [1500, "15,642", "18,142"],
      [2000, "22,392", "24,892"],
      [2100, "23,817", "26,317"],
      [2500, "29,517", "32,017"],
    ];
    for (const [kg, bonus, salary] of rows) {
      expect(formatBonusEgp(moderatorKgBonus(kg))).toBe(bonus);
      expect(formatBonusEgp(moderatorSalary(kg, 2500))).toBe(salary);
    }
  });

  it("keeps Aya's own base and leaves everyone else on the shared default", () => {
    expect(moderatorSalary(400, baseSalaryForKey("اية"))).toBe(5400);
    expect(moderatorSalary(400, baseSalaryForKey("نورا"))).toBe(4900);
    expect(moderatorSalary(0, baseSalaryForKey("اية"))).toBe(3000);
  });

  it("splits carried kilograms so the pieces sum to the bonus on the total", () => {
    const breakdown = toRisingBreakdown(350, 60);
    expect(breakdown.qualified).toBe(true);
    expect(breakdown.counted_kg).toBe(410);
    expect(breakdown.calculated_bonus).toBe(0);
    expect(breakdown.total_bonus).toBeCloseTo(moderatorKgBonus(410), 8);
    const pieces = risingCarryIncrements(350, [
      { orderId: "early", procKg: 30, deliveredAt: "2026-10-02T00:00:00Z" },
      { orderId: "late", procKg: 30, deliveredAt: "2026-10-05T00:00:00Z" },
    ]);
    expect(pieces[0].bonus).toBe(0);
    expect(pieces.reduce((sum, piece) => sum + piece.bonus, 0)).toBeCloseTo(moderatorKgBonus(410), 8);

    const above = risingCarryIncrements(500, [
      { orderId: "a", procKg: 100, deliveredAt: "2026-10-03T00:00:00Z" },
    ]);
    expect(above[0].bonus).toBeCloseTo(moderatorKgBonus(600) - moderatorKgBonus(500), 8);
    expect(toRisingBreakdown(200, 50).total_bonus).toBe(0);
  });
});

describe("moderator bonus screen", () => {
  it("points at the next milestone and the bonus waiting there", () => {
    const before = buildModeratorBonusView({ name: "نورا", kg: 399, baseSalary: 2500, now: OCT_20 });
    expect(before.qualified).toBe(false);
    expect(before.bonus).toBe(0);
    expect(before.salary).toBe(2500);
    expect(before.nextMilestoneKg).toBe(400);
    expect(before.kgRemaining).toBe(1);
    expect(before.bonusAtNext).toBe(2400);
    expect(before.daysPhrase).toBe("باقي 11 يومًا على نهاية الشهر");

    const opening = buildModeratorBonusView({ name: "نورا", kg: 400, baseSalary: 2500, now: OCT_20 });
    expect(opening.bonus).toBe(2400);
    expect(opening.nextMilestoneKg).toBe(1000);
    expect(opening.bonusAtNext).toBe(9829.5);

    const mid = buildModeratorBonusView({ name: "آية", kg: 860, baseSalary: 3000, now: OCT_20 });
    expect(mid.nextMilestoneKg).toBe(1000);
    expect(mid.kgRemaining).toBe(140);
    expect(mid.bonusAtNext).toBeCloseTo(9829.5, 6);
    expect(mid.salary).toBeCloseTo(3000 + moderatorKgBonus(860), 6);

    const ton = buildModeratorBonusView({ name: "مريم", kg: 1000, baseSalary: 2500, now: OCT_20 });
    expect(ton.bonus).toBe(9829.5);
    expect(ton.nextMilestoneKg).toBe(1500);
    expect(ton.bonusAtNext).toBe(15642);

    const top = buildModeratorBonusView({ name: "هاجر", kg: 2500, baseSalary: 2500, now: OCT_20 });
    expect(top.bonus).toBe(29517);
    expect(top.nextMilestoneKg).toBeNull();
    expect(top.segmentProgress).toBe(1);
    expect(top.salary).toBe(32017);
  });

  it("talks to her in Egyptian feminine and hides rates, tiers, and margin", () => {
    for (const kg of [210, 399, 420, 860, 1000.5, 1320, 2100]) {
      const view = buildModeratorBonusView({ name: "نورا", kg, baseSalary: 2500, now: OCT_20 });
      expect(view.message.startsWith("يا نورا")).toBe(true);
      expect(view.message).not.toMatch(/ج\/كجم|شريحة|تارجت|14\.25|ربح|هامش/);
    }
    const close = buildModeratorBonusView({ name: "نورا", kg: 370, baseSalary: 2500, now: OCT_20 });
    expect(close.message).toContain("2,400");
    const past = buildModeratorBonusView({ name: "نورا", kg: 2100, baseSalary: 2500, now: OCT_20 });
    expect(past.message).toContain("٢ طن");
  });

  it("adds meat, bone, and chick bonuses on top of the processed formula", () => {
    const processed = moderatorKgBonus(500);
    const board = buildModeratorBonusBoard({
      name: "نورا",
      kg: 500,
      baseSalary: 2500,
      now: OCT_20,
      meatKg: 80,
      meatSales: 40000,
      meatBonus: 240,
      meatTiers: [
        { sales: 30000, label: "الأول" },
        { sales: 90000, label: "الثاني" },
      ],
      boneKg: 10,
      boneBonus: 35,
      chickCount: 4,
      chickBonus: 200,
      carriedSideBonus: 70,
    });
    expect(board.processed.bonus).toBeCloseTo(processed, 6);
    expect(board.lanes.map((lane) => lane.id)).toEqual(["processed", "meat", "bone", "chicks"]);
    expect(board.lanes.find((lane) => lane.id === "meat")?.progress).toBeCloseTo((40000 - 30000) / (90000 - 30000), 6);
    expect(board.lanes.find((lane) => lane.id === "bone")?.nextHint).toBe("البونص مفتوح");
    expect(board.lanes.find((lane) => lane.id === "chicks")?.nextHint).toBeNull();
    expect(board.totalBonus).toBeCloseTo(processed + 240 + 35 + 200 + 70, 6);
    expect(board.salary).toBeCloseTo(2500 + board.totalBonus, 6);
    for (const lane of board.lanes) {
      expect(lane.nextHint ?? "").not.toMatch(/ج\/كجم|14\.25|ربح|هامش/);
    }
  });
});
