import type { ModeratorKgCounterCardProps } from '@/components/sales/ModeratorKgCounterCard';
import type { RisingPayrollRow } from '@/components/sales/RisingPayrollTable';
import { toRisingBreakdown } from '@/lib/moderatorKgBonus';

/**
 * أرقام شاشات المعاينة لشهر أكتوبر 2026 من الإنتاج (قراءة فقط).
 * الكارت بيحسب بونص المصنّعات من الكيلو. اللحوم والعظم والكتاكيت أرقام جاهزة من هنا.
 * عظم ٣ ج/كجم وكتكوت ٥٠ ج، والاتنين بيتدفعوا بعد تارجت اللحوم. محدش وصل للتارجت فبونص اللحمة والعظم صفر.
 */
export interface OctoberModeratorFixture {
  key: string;
  name: string;
  baseSalary: number;
  processedKg: number;
  carriedProcessedKg: number;
  meatKg: number;
  meatSales: number;
  meatBonus: number;
  meatTierLabel: string | null;
  /** صف الإدارة بس. الكارت مش بيعرض السعر. */
  meatRate: number;
  boneKg: number;
  boneBonus: number;
  boneRate: number;
  chickCount: number;
  chickBonus: number;
  deductions?: number;
}

export interface OctoberBonusFixture {
  periodLabel: string;
  asOf: string;
  /** placeholder لحد ما تتبدل بأرقام الإنتاج. */
  source: 'placeholder' | 'production';
  focusKey: string;
  meatTiers: Array<{ sales: number; label: string }>;
  moderators: OctoberModeratorFixture[];
}

export const octoberBonusFixture: OctoberBonusFixture = {
  periodLabel: 'أكتوبر 2026',
  asOf: '2026-10-21T00:55:00+03:00',
  source: 'production',
  focusKey: 'اية',
  meatTiers: [
    { sales: 100000, label: 'الأول' },
    { sales: 125000, label: 'الثاني' },
    { sales: 200000, label: 'الثالث' },
    { sales: 300000, label: 'الرابع' },
  ],
  moderators: [
    {
      key: 'اية',
      name: 'آية',
      baseSalary: 3000,
      processedKg: 917,
      carriedProcessedKg: 120.5,
      meatKg: 102.5,
      meatSales: 39975,
      meatBonus: 0,
      meatTierLabel: null,
      meatRate: 0,
      boneKg: 0,
      boneBonus: 0,
      boneRate: 0,
      chickCount: 4,
      chickBonus: 200,
    },
    {
      key: 'نورا',
      name: 'نورا',
      baseSalary: 2500,
      processedKg: 667,
      carriedProcessedKg: 126,
      meatKg: 74,
      meatSales: 30960,
      meatBonus: 0,
      meatTierLabel: null,
      meatRate: 0,
      boneKg: 6,
      boneBonus: 0,
      boneRate: 0,
      chickCount: 0,
      chickBonus: 0,
    },
    {
      key: 'منال',
      name: 'هاجر',
      baseSalary: 2500,
      processedKg: 491,
      carriedProcessedKg: 90,
      meatKg: 65,
      meatSales: 25350,
      meatBonus: 0,
      meatTierLabel: null,
      meatRate: 0,
      boneKg: 0,
      boneBonus: 0,
      boneRate: 0,
      chickCount: 0,
      chickBonus: 0,
    },
    {
      key: 'مريم',
      name: 'مريم',
      baseSalary: 2500,
      processedKg: 127.5,
      carriedProcessedKg: 22.5,
      meatKg: 21.5,
      meatSales: 10485,
      meatBonus: 0,
      meatTierLabel: null,
      meatRate: 0,
      boneKg: 6,
      boneBonus: 0,
      boneRate: 0,
      chickCount: 0,
      chickBonus: 0,
    },
  ],
};

export const fixtureNow = () => new Date(octoberBonusFixture.asOf);

export const fixtureFocus = () =>
  octoberBonusFixture.moderators.find((row) => row.key === octoberBonusFixture.focusKey)
  ?? octoberBonusFixture.moderators[0];

export const toBonusCardProps = (row: OctoberModeratorFixture): ModeratorKgCounterCardProps => ({
  name: row.name,
  kg: row.processedKg,
  carriedKg: row.carriedProcessedKg,
  baseSalary: row.baseSalary,
  meatKg: row.meatKg,
  meatSales: row.meatSales,
  meatBonus: row.meatBonus,
  meatTiers: octoberBonusFixture.meatTiers,
  boneKg: row.boneKg,
  boneBonus: row.boneBonus,
  chickCount: row.chickCount,
  chickBonus: row.chickBonus,
  periodLabel: octoberBonusFixture.periodLabel,
  now: fixtureNow(),
});

export const toPayrollRow = (row: OctoberModeratorFixture): RisingPayrollRow => {
  const breakdown = toRisingBreakdown(row.processedKg, row.carriedProcessedKg);
  const deductions = row.deductions ?? 0;
  return {
    girl: row.key,
    name: row.name,
    base: row.baseSalary,
    ownKg: row.processedKg,
    carriedKg: row.carriedProcessedKg,
    countedKg: breakdown.counted_kg,
    ownBonus: breakdown.calculated_bonus,
    carriedBonus: breakdown.total_bonus - breakdown.calculated_bonus,
    meatKg: row.meatKg,
    meatBonus: row.meatBonus,
    meatRate: row.meatRate,
    meatRateOverridden: false,
    meatTierLabel: row.meatTierLabel,
    meatOverridden: false,
    boneKg: row.boneKg,
    boneBonus: row.boneBonus,
    boneRate: row.boneRate,
    boneRateOverridden: false,
    boneOverridden: false,
    chickCount: row.chickCount,
    chickBonus: row.chickBonus,
    deductions,
    total: row.baseSalary + breakdown.total_bonus + row.meatBonus + row.boneBonus + row.chickBonus - deductions,
    overridden: false,
    qualified: breakdown.qualified,
  };
};

export const fixturePayrollRows = () => octoberBonusFixture.moderators.map(toPayrollRow);
