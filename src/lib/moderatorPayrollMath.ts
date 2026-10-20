import { baseSalaryForKey } from '@/constants/moderators';
import {
  type RisingBreakdown,
  risingCarryIncrements,
  toRisingBreakdown,
} from '@/lib/moderatorKgBonus';
import {
  type BandSlice,
  type FlatTier,
  type MarginalSchedule,
  type StoredBandBreakdown,
  rawMarginalBonus,
  marginalProcessedBonus,
} from '@/lib/processedKgBonus';

export interface PayrollQty {
  meat: Record<string, number>;
  bone: Record<string, number>;
  processed: Record<string, number>;
}

export interface PayrollOverride {
  moderator_name: string;
  processed_bonus: number | null;
  meat_bonus: number | null;
  bone_bonus: number | null;
  processed_rate: number | null;
  meat_rate: number | null;
  bone_rate: number | null;
  deduction: number | null;
}

export interface PayrollBaseRow {
  girl: string;
  base: number;
  meatKg: number;
  boneKg: number;
  procKg: number;
  /** كيلوات مصنّعات مرحّلة من شهر معتمد، محسوبة في الحد الأدنى والشرائح. */
  carriedProcKg: number;
  /** procKg + carriedProcKg. */
  countedProcKg: number;
  chickCount: number;
  meatSales: number;
  procSales: number;
  procTier: FlatTier | null;
  meatTier: FlatTier | null;
  procRate: number;
  procRateOverridden: boolean;
  meatRate: number;
  meatRateOverridden: boolean;
  boneRate: number;
  boneRateOverridden: boolean;
  procBonus: number;
  meatBonus: number;
  boneBonus: number;
  chickBonus: number;
  deductions: number;
  procOverridden: boolean;
  meatOverridden: boolean;
  boneOverridden: boolean;
  total: number;
  scheme: 'flat' | 'marginal' | 'rising';
  bandBreakdown: BandSlice[];
  storedBreakdown: StoredBandBreakdown | RisingBreakdown | null;
  minimumKg: number | null;
  qualified: boolean;
  calculatedProcBonus: number;
  activeBandLabel: string | null;
}

export const buildPayrollBaseRows = (args: {
  girls: string[];
  qty: PayrollQty;
  prices: { meat_price: number; bone_meat_price: number; processed_price: number };
  processedTiers: FlatTier[];
  meatTiers: FlatTier[];
  chickQtyByGirl: Record<string, number>;
  chickBonusRate: number;
  bonePerKg: number;
  baseDefault: number;
  overrides: PayrollOverride[];
  year: number;
  month: number;
  schedules: MarginalSchedule[];
  /** كيلوات المصنّعات المرحّلة لكل مسوقة (أوردرات شهر سابق سُلّمت بعد اعتماد قبضه). */
  carriedProcessedKg?: Record<string, number>;
}): PayrollBaseRow[] => {
  // الشهور المفتوحة على المعادلة الجديدة. لقطة الشهر المعتمد هي اللي بتحفظ أرقام النظام القديم.
  void args.schedules;
  void args.processedTiers;
  void args.meatTiers;
  void args.bonePerKg;
  void args.chickBonusRate;
  return args.girls.map((girl) => {
    const meatKg = args.qty.meat[girl] || 0;
    const boneKg = args.qty.bone[girl] || 0;
    const procKg = args.qty.processed[girl] || 0;
    const carriedProcKg = Math.max(0, args.carriedProcessedKg?.[girl] || 0);
    const countedProcKg = procKg + carriedProcKg;
    const chickCount = args.chickQtyByGirl[girl] || 0;
    const meatSales = meatKg * args.prices.meat_price + boneKg * args.prices.bone_meat_price;
    const procSales = procKg * args.prices.processed_price;
    const ov = args.overrides.find((row) => row.moderator_name === girl);
    const deductions = ov?.deduction != null ? Number(ov.deduction) : 0;
    const base = baseSalaryForKey(girl, args.baseDefault);
    const storedBreakdown = toRisingBreakdown(procKg, carriedProcKg);
    const calculatedProcBonus = storedBreakdown.calculated_bonus;
    const procBonus = ov?.processed_bonus != null ? Number(ov.processed_bonus) : calculatedProcBonus;
    return {
      girl,
      base,
      meatKg,
      boneKg,
      procKg,
      carriedProcKg,
      countedProcKg,
      chickCount,
      meatSales,
      procSales,
      procTier: null,
      meatTier: null,
      procRate: 0,
      procRateOverridden: false,
      meatRate: 0,
      meatRateOverridden: false,
      boneRate: 0,
      boneRateOverridden: false,
      procBonus,
      meatBonus: 0,
      boneBonus: 0,
      chickBonus: 0,
      deductions,
      procOverridden: ov?.processed_bonus != null,
      meatOverridden: false,
      boneOverridden: false,
      total: base + procBonus - deductions,
      scheme: 'rising' as const,
      bandBreakdown: [],
      storedBreakdown,
      minimumKg: storedBreakdown.minimum_kg,
      qualified: storedBreakdown.qualified,
      calculatedProcBonus,
      activeBandLabel: null,
    };
  });
};

export interface CarrySliceInput {
  orderId: string;
  procKg: number;
  deliveredAt: string;
}

/**
 * بونص المصنّعات المرحّل.
 * النظام الحالي: فرق المعادلة فوق كيلوات الشهر، والمجموع يساوي بونص الإجمالي.
 * فرع الشرائح القديمة موجود بس لقراءة اختبارات اللقطات التاريخية.
 */
export const allocateProcessedCarry = (
  ownKg: number,
  row: Pick<PayrollBaseRow, 'scheme' | 'procTier' | 'procRate' | 'minimumKg'>,
  schedule: MarginalSchedule | null,
  items: CarrySliceInput[],
) => {
  const ordered = [...items].sort((a, b) => {
    const time = a.deliveredAt.localeCompare(b.deliveredAt);
    return time || a.orderId.localeCompare(b.orderId);
  });
  if (row.scheme === 'rising') {
    const pieces = risingCarryIncrements(ownKg, ordered);
    return pieces.map((item) => ({
      orderId: item.orderId,
      bonus: item.bonus,
      rate: 0,
      tierLabel: 'بونص الكيلو',
    }));
  }
  if (row.scheme !== 'marginal' || !schedule) {
    const rate = row.procTier ? row.procRate : 0;
    const tierLabel = row.procTier ? `التارجت ${row.procTier.label}` : 'لم يتحقق';
    return ordered.map((item) => ({
      orderId: item.orderId,
      bonus: item.procKg * rate,
      rate,
      tierLabel,
    }));
  }
  const carriedTotal = ordered.reduce((sum, item) => sum + Math.max(0, item.procKg), 0);
  const qualified = ownKg + carriedTotal >= (row.minimumKg ?? schedule.minimumKg);
  let cursor = ownKg;
  return ordered.map((item) => {
    if (!qualified || item.procKg <= 0) {
      return { orderId: item.orderId, bonus: 0, rate: 0, tierLabel: 'لم يبلغ الحد الأدنى' };
    }
    const bonus = rawMarginalBonus(cursor + item.procKg, schedule) - rawMarginalBonus(cursor, schedule);
    cursor += item.procKg;
    const rate = item.procKg ? bonus / item.procKg : 0;
    return { orderId: item.orderId, bonus, rate, tierLabel: 'شرائح الشهر الحالي' };
  });
};

export { marginalProcessedBonus };
