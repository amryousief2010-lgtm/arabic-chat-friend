import { describe, expect, it } from "vitest";
import { baseSalaryForKey } from "@/constants/moderators";
import { allocateProcessedCarry, buildPayrollBaseRows } from "@/lib/moderatorPayrollMath";
import { classifyPayrollProduct } from "@/lib/payrollProductCategories";
import {
  APPROVED_OCT_2026_SCHEDULE,
  activeBandIndex,
  arabicDaysRemainingPhrase,
  buildGauge,
  buildKgCounterView,
  completedFiniteBands,
  findSalesTier,
  marginalBreakdown,
  marginalIncrement,
  marginalProcessedBonus,
  rawMarginalBonus,
  salaryWithProcessedBonus,
  toStoredBreakdown,
  scheduleForMonth,
  validateScheduleDraft,
} from "@/lib/processedKgBonus";

const schedule = APPROVED_OCT_2026_SCHEDULE;
const OCT_18 = new Date("2026-10-18T10:00:00.000Z");

describe("marginal processed bonus", () => {
  it("pays nothing below 400 kg and the approved totals including a 2,500 base", () => {
    const cases: Array<[number, number]> = [
      [399, 2500],
      [400, 4100],
      [500, 4700],
      [750, 6200],
      [1000, 8200],
      [1250, 10700],
      [1500, 13200],
      [2000, 19200],
      [2500, 26200],
    ];
    for (const [kg, total] of cases) {
      expect(salaryWithProcessedBonus(kg, 2500, schedule)).toBe(total);
    }
    expect(marginalProcessedBonus(399, schedule)).toBe(0);
    expect(marginalProcessedBonus(0, schedule)).toBe(0);
    expect(marginalProcessedBonus(-5, schedule)).toBe(0);
  });

  it("splits 1,500 kg into the approved band amounts before adding base", () => {
    const slices = marginalBreakdown(1500, schedule).filter((slice) => slice.kg > 0);
    const amounts = slices.map((slice) => slice.amount);
    expect(amounts).toEqual([1600, 2100, 2000, 5000]);
    expect(amounts.reduce((sum, amount) => sum + amount, 0) + 2500).toBe(13200);
  });

  it("prices every kilogram in its own band, including fractional kilograms", () => {
    expect(marginalProcessedBonus(857.5, schedule)).toBe(4560);
    expect(marginalProcessedBonus(620.5, schedule)).toBe(2923);
    expect(marginalProcessedBonus(452.5, schedule)).toBe(1915);
    expect(marginalBreakdown(857.5, schedule).find((slice) => slice.rate === 8)?.kg).toBe(107.5);
  });

  it("keeps a moderator's own base instead of forcing 2,500", () => {
    expect(baseSalaryForKey("اية", 2500)).toBe(3000);
    expect(baseSalaryForKey("نورا", 2500)).toBe(2500);
    expect(baseSalaryForKey("منال", 2500)).toBe(2500);
    expect(salaryWithProcessedBonus(400, baseSalaryForKey("اية"), schedule)).toBe(4600);
    expect(salaryWithProcessedBonus(400, baseSalaryForKey("نورا"), schedule)).toBe(4100);
  });

  it("uses the October 2026 schedule from that month onward and the flat scheme before it", () => {
    expect(scheduleForMonth([schedule], 2026, 9)).toBeNull();
    expect(scheduleForMonth([schedule], 2026, 10)?.effectiveFrom).toBe("2026-10-01");
    const later = {
      ...schedule,
      effectiveFrom: "2026-12-01",
      minimumKg: 500,
    };
    expect(scheduleForMonth([schedule, later], 2026, 11)?.minimumKg).toBe(400);
    expect(scheduleForMonth([schedule, later], 2026, 12)?.minimumKg).toBe(500);
    expect(scheduleForMonth([schedule, later], 2027, 1)?.effectiveFrom).toBe("2026-12-01");
  });

  it("still resolves a single flat sales tier for meat and for months before October 2026", () => {
    const tiers = [
      { sales: 75000, bonus: 3, label: "الأول" },
      { sales: 90000, bonus: 4, label: "الثاني" },
      { sales: 125000, bonus: 6, label: "الثالث" },
    ];
    expect(findSalesTier(80000, tiers)?.bonus).toBe(3);
    expect(findSalesTier(90000, tiers)?.bonus).toBe(4);
    expect(findSalesTier(74999, tiers)).toBeNull();
    const tier = findSalesTier(130000, tiers);
    expect(tier && tier.bonus * 40).toBe(240);
  });

  it("counts carried kilograms toward the minimum and prices them at the current bands", () => {
    expect(marginalIncrement(857.5, 76.125, schedule)).toBe(609);
    expect(marginalIncrement(400, 100, schedule)).toBe(600);
    // 399 + 50 = 449 يبلغ الحد. المرحّل يأخذ ما فوق 399 فقط، وكيلوات الشهر تأخذ 1,596.
    expect(marginalIncrement(399, 50, schedule)).toBe(298);
    expect(rawMarginalBonus(399, schedule)).toBe(1596);
    expect(marginalIncrement(300, 50, schedule)).toBe(0);
    const reached = allocateProcessedCarry(
      399,
      { scheme: "marginal", procTier: null, procRate: 0, minimumKg: 400 },
      schedule,
      [{ orderId: "a", procKg: 50, deliveredAt: "2026-10-02T00:00:00Z" }],
    );
    expect(reached[0].bonus).toBe(298);
    const blocked = allocateProcessedCarry(
      300,
      { scheme: "marginal", procTier: null, procRate: 0, minimumKg: 400 },
      schedule,
      [
        { orderId: "a", procKg: 50, deliveredAt: "2026-10-02T00:00:00Z" },
        { orderId: "b", procKg: 40, deliveredAt: "2026-10-03T00:00:00Z" },
      ],
    );
    expect(blocked.map((item) => item.bonus)).toEqual([0, 0]);
    const split = allocateProcessedCarry(
      350,
      { scheme: "marginal", procTier: null, procRate: 0, minimumKg: 400 },
      schedule,
      [
        { orderId: "late", procKg: 30, deliveredAt: "2026-10-05T00:00:00Z" },
        { orderId: "early", procKg: 30, deliveredAt: "2026-10-02T00:00:00Z" },
      ],
    );
    // early: 350→380 × 4 = 120، late: 380→400 × 4 + 400→410 × 6 = 140
    expect(split.map((item) => [item.orderId, item.bonus])).toEqual([["early", 120], ["late", 140]]);
    const added = allocateProcessedCarry(
      857.5,
      { scheme: "marginal", procTier: { sales: 0, bonus: 8, label: "750–1000" }, procRate: 8, minimumKg: 400 },
      schedule,
      [{ orderId: "a", procKg: 76.125, deliveredAt: "2026-10-02T00:00:00Z" }],
    );
    expect(added[0].bonus).toBe(609);
  });

  it("qualifies the payroll row on month + carried kilograms with the rising bonus", () => {
    const build = (carried: number) => buildPayrollBaseRows({
      girls: ["نورا"],
      qty: { meat: { "نورا": 80 }, bone: { "نورا": 20 }, processed: { "نورا": 350 } },
      prices: { meat_price: 390, bone_meat_price: 350, processed_price: 250 },
      processedTiers: [],
      meatTiers: [{ sales: 1, bonus: 9, label: "قديم" }],
      chickQtyByGirl: { "نورا": 4 },
      chickBonusRate: 50,
      bonePerKg: 3.5,
      baseDefault: 2500,
      overrides: [],
      year: 2026,
      month: 10,
      schedules: [schedule],
      carriedProcessedKg: { "نورا": carried },
    })[0];
    const alone = build(0);
    expect(alone.scheme).toBe("rising");
    expect(alone.qualified).toBe(false);
    expect(alone.procBonus).toBe(0);
    expect(alone.meatBonus).toBe(720);
    expect(alone.boneBonus).toBe(70);
    expect(alone.chickBonus).toBe(200);
    expect(alone.total).toBe(2500 + 720 + 70 + 200);
    const withCarry = build(60);
    expect(withCarry.qualified).toBe(true);
    expect(withCarry.carriedProcKg).toBe(60);
    expect(withCarry.countedProcKg).toBe(410);
    expect(withCarry.procBonus).toBe(0);
    expect(withCarry.storedBreakdown?.scheme).toBe("rising");
    expect(withCarry.storedBreakdown?.carried_kg).toBe(60);
    expect(withCarry.storedBreakdown?.counted_kg).toBe(410);
    expect(withCarry.storedBreakdown?.qualified).toBe(true);
    const carry = allocateProcessedCarry(350, withCarry, schedule, [
      { orderId: "a", procKg: 60, deliveredAt: "2026-10-02T00:00:00Z" },
    ]);
    expect(withCarry.procBonus + carry[0].bonus).toBeCloseTo(
      (withCarry.storedBreakdown && "total_bonus" in withCarry.storedBreakdown
        ? withCarry.storedBreakdown.total_bonus
        : 0),
      6,
    );
    expect(toStoredBreakdown(350, schedule).qualified).toBe(false);
  });

  it("rejects a broken band draft and accepts the approved table", () => {
    expect(validateScheduleDraft(schedule.minimumKg, schedule.bands)).toBeNull();
    expect(validateScheduleDraft(-1, schedule.bands)).toMatch(/الحد الأدنى/);
    expect(validateScheduleDraft(400, schedule.bands.slice(0, 5))).toMatch(/مفتوحة/);
  });
});

describe("October 2026 counter for the real month-to-date figures", () => {
  it("matches Aya on 18 Oct with her own 3,000 base and carried September kilograms", () => {
    const view = buildKgCounterView({
      name: "آية",
      kg: 857.5,
      carriedKg: 114.5,
      baseSalary: 3000,
      now: OCT_18,
      schedule,
    });
    expect(view.kg).toBe(972);
    expect(view.ownKg).toBe(857.5);
    expect(view.carriedKg).toBe(114.5);
    expect(view.bandLabel).toBe("750–1,000");
    expect(view.kgToNext).toBe(28);
    expect(view.processedBonus).toBe(5476);
    expect(view.carriedProcessedBonus).toBe(916);
    expect(view.salarySoFar).toBe(8476);
    expect(view.daysPhrase).toBe("باقي 13 يومًا على نهاية الشهر");
    // الوتيرة من كيلوات الشهر فقط، والمرحّل يُضاف للمتوقع كرصيد ثابت.
    expect(view.avgPerDay).toBeCloseTo(47.6389, 3);
    expect(Math.round(view.projectedKg)).toBe(1591);
    expect(view.message.startsWith("يا آية")).toBe(true);
    expect(view.qualified).toBe(true);
  });

  it("matches Noura and Hajar with the shared 2,500 base", () => {
    const noura = buildKgCounterView({
      name: "نورا",
      kg: 620.5,
      carriedKg: 120,
      baseSalary: 2500,
      now: OCT_18,
      schedule,
    });
    expect(noura.bandLabel).toBe("400–750");
    expect(noura.kgToNext).toBe(9.5);
    expect(noura.processedBonus).toBe(3643);
    expect(noura.carriedProcessedBonus).toBe(720);
    expect(noura.salarySoFar).toBe(6143);
    expect(Math.round(noura.avgPerDay * 10) / 10).toBe(34.5);
    expect(Math.round(noura.projectedKg)).toBe(1189);

    const hajar = buildKgCounterView({
      name: "هاجر",
      kg: 452.5,
      carriedKg: 82,
      baseSalary: baseSalaryForKey("منال"),
      now: OCT_18,
      schedule,
    });
    expect(hajar.bandLabel).toBe("400–750");
    expect(hajar.kgToNext).toBe(215.5);
    expect(hajar.processedBonus).toBe(2407);
    expect(hajar.salarySoFar).toBe(4907);
    expect(Math.round(hajar.avgPerDay * 10) / 10).toBe(25.1);
    expect(Math.round(hajar.projectedKg)).toBe(861);
  });

  it("lets carried kilograms lift a moderator over the 400 kg minimum", () => {
    const view = buildKgCounterView({ name: "س", kg: 350, carriedKg: 60, baseSalary: 2500, now: OCT_18, schedule });
    expect(view.qualified).toBe(true);
    expect(view.kg).toBe(410);
    expect(view.processedBonus).toBe(1660);
    expect(view.carriedProcessedBonus).toBe(260);
    expect(view.salarySoFar).toBe(4160);
    const short = buildKgCounterView({ name: "س", kg: 300, carriedKg: 60, baseSalary: 2500, now: OCT_18, schedule });
    expect(short.qualified).toBe(false);
    expect(short.kgToMinimum).toBe(40);
    expect(short.processedBonus).toBe(0);
    const overridden = buildKgCounterView({
      name: "س", kg: 857.5, carriedKg: 114.5, baseSalary: 3000, now: OCT_18, schedule, processedBonusOverride: 4000,
    });
    expect(overridden.processedBonus).toBe(4916);
  });

  it("highlights the current band on the gauge", () => {
    expect(activeBandIndex(857.5, schedule.bands)).toBe(2);
    expect(activeBandIndex(620.5, schedule.bands)).toBe(1);
    expect(activeBandIndex(399, schedule.bands)).toBe(0);
    expect(activeBandIndex(2000, schedule.bands)).toBe(5);
    expect(completedFiniteBands(399, schedule.bands)).toBe(0);
    expect(completedFiniteBands(400, schedule.bands)).toBe(1);
    const gauge = buildGauge(857.5, schedule);
    expect(gauge.segments[2].active).toBe(true);
    expect(gauge.markers.map((marker) => marker.kg)).toEqual([400, 750, 1000, 1500, 2000]);
  });
});

describe("classifyPayrollProduct", () => {
  it("keeps the historical category order", () => {
    expect(classifyPayrollProduct("برجر جامبو")).toBe("processed");
    expect(classifyPayrollProduct("دبوس بالعظم")).toBe("bone");
    expect(classifyPayrollProduct("استيك")).toBe("meat");
    expect(classifyPayrollProduct("كتكوت")).toBeNull();
  });
});

describe("arabic days remaining", () => {
  it("uses the right counted form", () => {
    expect(arabicDaysRemainingPhrase(0)).toBe("هذا آخر يوم في الشهر");
    expect(arabicDaysRemainingPhrase(1)).toBe("باقي يوم واحد على نهاية الشهر");
    expect(arabicDaysRemainingPhrase(2)).toBe("باقي يومان على نهاية الشهر");
    expect(arabicDaysRemainingPhrase(5)).toBe("باقي 5 أيام على نهاية الشهر");
    expect(arabicDaysRemainingPhrase(13)).toBe("باقي 13 يومًا على نهاية الشهر");
  });
});
