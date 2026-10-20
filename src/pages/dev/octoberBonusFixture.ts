import type { BonusVariantProps } from '@/pages/dev/BonusCardVariants';
import type { RisingPayrollRow } from '@/components/sales/RisingPayrollTable';
import { toRisingBreakdown } from '@/lib/moderatorKgBonus';

/**
 * أرقام شاشات المعاينة لشهر أكتوبر 2026.
 * ملف واحد: لما يوصل JSON الإنتاج، استبدل `octoberBonusFixture` بنفس الشكل.
 * الكارت بيحسب بونص المصنّعات من الكيلو. اللحوم والعظم والكتاكيت أرقام جاهزة من هنا.
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
  asOf: '2026-10-20T10:00:00.000Z',
  source: 'placeholder',
  focusKey: 'اية',
  meatTiers: [
    { sales: 75000, label: 'الأول' },
    { sales: 125000, label: 'الثاني' },
  ],
  moderators: [
    {
      key: 'اية',
      name: 'آية',
      baseSalary: 3000,
      processedKg: 820,
      carriedProcessedKg: 40,
      meatKg: 220,
      meatSales: 111800,
      meatBonus: 1100,
      meatTierLabel: 'الأول',
      meatRate: 5,
      boneKg: 40,
      boneBonus: 140,
      boneRate: 3.5,
      chickCount: 8,
      chickBonus: 400,
    },
    {
      key: 'نورا',
      name: 'نورا',
      baseSalary: 2500,
      processedKg: 430,
      carriedProcessedKg: 0,
      meatKg: 30,
      meatSales: 15420,
      meatBonus: 0,
      meatTierLabel: null,
      meatRate: 0,
      boneKg: 6,
      boneBonus: 0,
      boneRate: 0,
      chickCount: 2,
      chickBonus: 100,
    },
    {
      key: 'منال',
      name: 'هاجر',
      baseSalary: 2500,
      processedKg: 180,
      carriedProcessedKg: 0,
      meatKg: 10,
      meatSales: 4500,
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
      processedKg: 1100,
      carriedProcessedKg: 0,
      meatKg: 300,
      meatSales: 143000,
      meatBonus: 1800,
      meatTierLabel: 'الثاني',
      meatRate: 6,
      boneKg: 25,
      boneBonus: 87.5,
      boneRate: 3.5,
      chickCount: 12,
      chickBonus: 600,
    },
  ],
};

export const fixtureNow = () => new Date(octoberBonusFixture.asOf);

export const fixtureFocus = () =>
  octoberBonusFixture.moderators.find((row) => row.key === octoberBonusFixture.focusKey)
  ?? octoberBonusFixture.moderators[0];

export const toBonusCardProps = (row: OctoberModeratorFixture): BonusVariantProps => ({
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
