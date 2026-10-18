import { describe, expect, it } from "vitest";
import { baseSalaryForKey } from "@/constants/moderators";
import { allocateProcessedCarry } from "@/lib/moderatorPayrollMath";
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
  salaryWithProcessedBonus,
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

  it("adds carried kilograms on top of the current bands only after the minimum is reached", () => {
    expect(marginalIncrement(857.5, 76.125, schedule)).toBe(609);
    expect(marginalIncrement(400, 100, schedule)).toBe(600);
    expect(marginalIncrement(399, 50, schedule)).toBe(1894);
    const blocked = allocateProcessedCarry(
      399,
      { scheme: "marginal", procTier: null, procRate: 0, minimumKg: 400 },
      schedule,
      [{ orderId: "a", procKg: 50, deliveredAt: "2026-10-02T00:00:00Z" }],
    );
    expect(blocked[0].bonus).toBe(0);
    const added = allocateProcessedCarry(
      857.5,
      { scheme: "marginal", procTier: { sales: 0, bonus: 8, label: "750–1000" }, procRate: 8, minimumKg: 400 },
      schedule,
      [{ orderId: "a", procKg: 76.125, deliveredAt: "2026-10-02T00:00:00Z" }],
    );
    expect(added[0].bonus).toBe(609);
  });

  it("rejects a broken band draft and accepts the approved table", () => {
    expect(validateScheduleDraft(schedule.minimumKg, schedule.bands)).toBeNull();
    expect(validateScheduleDraft(-1, schedule.bands)).toMatch(/الحد الأدنى/);
    expect(validateScheduleDraft(400, schedule.bands.slice(0, 5))).toMatch(/مفتوحة/);
  });
});

describe("October 2026 counter for the real month-to-date figures", () => {
  it("matches Aya on 18 Oct with her own 3,000 base", () => {
    const view = buildKgCounterView({
      name: "آية",
      kg: 857.5,
      baseSalary: 3000,
      carriedBonus: 609,
      now: OCT_18,
      schedule,
    });
    expect(view.bandLabel).toBe("750–1,000");
    expect(view.kgToNext).toBe(142.5);
    expect(view.processedBonus).toBe(4560);
    expect(view.salarySoFar).toBe(8169);
    expect(view.daysPhrase).toBe("باقي 13 يومًا على نهاية الشهر");
    expect(view.avgPerDay).toBeCloseTo(47.6389, 3);
    expect(Math.round(view.projectedKg)).toBe(1477);
    expect(view.message.startsWith("يا آية")).toBe(true);
    expect(view.qualified).toBe(true);
  });

  it("matches Noura and Manal with the shared 2,500 base", () => {
    const noura = buildKgCounterView({
      name: "نورا",
      kg: 620.5,
      baseSalary: 2500,
      carriedBonus: 565,
      now: OCT_18,
      schedule,
    });
    expect(noura.bandLabel).toBe("400–750");
    expect(noura.kgToNext).toBe(129.5);
    expect(noura.processedBonus).toBe(2923);
    expect(noura.salarySoFar).toBe(5988);
    expect(Math.round(noura.avgPerDay * 10) / 10).toBe(34.5);
    expect(Math.round(noura.projectedKg)).toBe(1069);

    const manal = buildKgCounterView({
      name: "هاجر",
      kg: 452.5,
      baseSalary: baseSalaryForKey("منال"),
      carriedBonus: 347,
      now: OCT_18,
      schedule,
    });
    expect(manal.bandLabel).toBe("400–750");
    expect(manal.kgToNext).toBe(297.5);
    expect(manal.processedBonus).toBe(1915);
    expect(manal.salarySoFar).toBe(4762);
    expect(Math.round(manal.avgPerDay * 10) / 10).toBe(25.1);
    expect(Math.round(manal.projectedKg)).toBe(779);
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
