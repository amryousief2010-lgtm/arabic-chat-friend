import { baseSalaryForKey } from '@/constants/moderators';
import {
  type BandSlice,
  type FlatTier,
  type MarginalSchedule,
  type StoredBandBreakdown,
  findSalesTier,
  marginalIncrement,
  marginalProcessedBonus,
  activeBandIndex,
  meetsProcessedMinimum,
  scheduleForMonth,
  toStoredBreakdown,
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
  scheme: 'flat' | 'marginal';
  bandBreakdown: BandSlice[];
  storedBreakdown: StoredBandBreakdown | null;
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
}): PayrollBaseRow[] => {
  const schedule = scheduleForMonth(args.schedules, args.year, args.month);
  return args.girls.map((girl) => {
    const meatKg = args.qty.meat[girl] || 0;
    const boneKg = args.qty.bone[girl] || 0;
    const procKg = args.qty.processed[girl] || 0;
    const chickCount = args.chickQtyByGirl[girl] || 0;
    const meatSales = meatKg * args.prices.meat_price + boneKg * args.prices.bone_meat_price;
    const procSales = procKg * args.prices.processed_price;
    const meatTier = findSalesTier(meatSales, args.meatTiers);
    const ov = args.overrides.find((row) => row.moderator_name === girl);
    const tierMeatRate = meatTier ? meatTier.bonus : 0;
    const meatRate = ov?.meat_rate != null ? Number(ov.meat_rate) : tierMeatRate;
    const boneRate = ov?.bone_rate != null ? Number(ov.bone_rate) : (meatTier ? args.bonePerKg : 0);
    const calcMeatBonus = meatTier ? meatRate * meatKg : 0;
    const calcBoneBonus = meatTier ? boneRate * boneKg : 0;
    const meatBonus = ov?.meat_bonus != null ? Number(ov.meat_bonus) : calcMeatBonus;
    const boneBonus = ov?.bone_bonus != null ? Number(ov.bone_bonus) : calcBoneBonus;
    const chickBonus = chickCount * args.chickBonusRate;
    const deductions = ov?.deduction != null ? Number(ov.deduction) : 0;
    const base = baseSalaryForKey(girl, args.baseDefault);

    if (schedule) {
      const storedBreakdown = toStoredBreakdown(procKg, schedule);
      const bandBreakdown: BandSlice[] = storedBreakdown.bands.map((band) => ({
        fromKg: band.from_kg,
        toKg: band.to_kg,
        rate: band.rate,
        kg: band.kg,
        amount: band.amount,
      }));
      const calculatedProcBonus = storedBreakdown.calculated_bonus;
      const qualified = meetsProcessedMinimum(procKg, schedule);
      const active = bandBreakdown[activeBandIndex(procKg, schedule.bands)] ?? bandBreakdown[0];
      const activeBandLabel = !qualified || !active
        ? null
        : active.toKg == null
          ? `أكثر من ${active.fromKg}`
          : `${active.fromKg}–${active.toKg}`;
      const blended = procKg > 0 ? calculatedProcBonus / procKg : 0;
      const procBonus = ov?.processed_bonus != null ? Number(ov.processed_bonus) : calculatedProcBonus;
      const procTier = qualified && active
        ? { sales: 0, bonus: active.rate, label: activeBandLabel || 'تراكمي' }
        : null;
      return {
        girl,
        base,
        meatKg,
        boneKg,
        procKg,
        chickCount,
        meatSales,
        procSales,
        procTier,
        meatTier,
        procRate: blended,
        procRateOverridden: false,
        meatRate,
        meatRateOverridden: ov?.meat_rate != null,
        boneRate,
        boneRateOverridden: ov?.bone_rate != null,
        procBonus,
        meatBonus,
        boneBonus,
        chickBonus,
        deductions,
        procOverridden: ov?.processed_bonus != null,
        meatOverridden: ov?.meat_bonus != null,
        boneOverridden: ov?.bone_bonus != null,
        total: base + procBonus + meatBonus + boneBonus + chickBonus - deductions,
        scheme: 'marginal' as const,
        bandBreakdown,
        storedBreakdown,
        minimumKg: schedule.minimumKg,
        qualified,
        calculatedProcBonus,
        activeBandLabel,
      };
    }

    const procTier = findSalesTier(procSales, args.processedTiers);
    const tierProcRate = procTier ? procTier.bonus : 0;
    const procRate = ov?.processed_rate != null ? Number(ov.processed_rate) : tierProcRate;
    const calcProcBonus = procRate * procKg;
    const procBonus = ov?.processed_bonus != null ? Number(ov.processed_bonus) : calcProcBonus;
    return {
      girl,
      base,
      meatKg,
      boneKg,
      procKg,
      chickCount,
      meatSales,
      procSales,
      procTier,
      meatTier,
      procRate,
      procRateOverridden: ov?.processed_rate != null,
      meatRate,
      meatRateOverridden: ov?.meat_rate != null,
      boneRate,
      boneRateOverridden: ov?.bone_rate != null,
      procBonus,
      meatBonus,
      boneBonus,
      chickBonus,
      deductions,
      procOverridden: ov?.processed_bonus != null,
      meatOverridden: ov?.meat_bonus != null,
      boneOverridden: ov?.bone_bonus != null,
      total: base + procBonus + meatBonus + boneBonus + chickBonus - deductions,
      scheme: 'flat' as const,
      bandBreakdown: [],
      storedBreakdown: null,
      minimumKg: null,
      qualified: !!procTier,
      calculatedProcBonus: calcProcBonus,
      activeBandLabel: procTier?.label ?? null,
    };
  });
};

export interface CarrySliceInput {
  orderId: string;
  procKg: number;
  deliveredAt: string;
}

/** بونص المصنّعات المرحّل. قبل أكتوبر: سعر التارجت الواحد. من أكتوبر: تكملة الشرائح فوق كميات الشهر. */
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
  const qualified = ownKg >= (row.minimumKg ?? schedule.minimumKg);
  let cursor = ownKg;
  return ordered.map((item) => {
    if (!qualified || item.procKg <= 0) {
      return { orderId: item.orderId, bonus: 0, rate: 0, tierLabel: 'لم يبلغ الحد الأدنى' };
    }
    const bonus = marginalIncrement(cursor, item.procKg, schedule);
    cursor += item.procKg;
    const rate = item.procKg ? bonus / item.procKg : 0;
    return { orderId: item.orderId, bonus, rate, tierLabel: 'شرائح تراكميّة' };
  });
};

export { marginalProcessedBonus };
