import { useSearchParams } from 'react-router-dom';
import ModeratorKgCounterCard from '@/components/sales/ModeratorKgCounterCard';
import RisingPayrollTable, { type RisingPayrollRow } from '@/components/sales/RisingPayrollTable';
import { baseSalaryForKey, displayModeratorName } from '@/constants/moderators';
import { toRisingBreakdown } from '@/lib/moderatorKgBonus';
import { findSalesTier } from '@/lib/processedKgBonus';

const NOW = new Date('2026-10-20T10:00:00.000Z');
const MEAT_PRICE = 450;
const BONE_PRICE = 320;
const BONE_PER_KG = 3.5;
const CHICK_RATE = 50;
const TIERS = [
  { sales: 75000, bonus: 5, label: 'الأول' },
  { sales: 125000, bonus: 6, label: 'الثاني' },
];
const TIER_STEPS = TIERS.map((tier) => ({ sales: tier.sales, label: tier.label }));

const SAMPLE = [
  { key: 'اية', ownKg: 820, carriedKg: 40, meatKg: 220, boneKg: 40, chicks: 8 },
  { key: 'نورا', ownKg: 430, carriedKg: 0, meatKg: 30, boneKg: 6, chicks: 2 },
  { key: 'منال', ownKg: 180, carriedKg: 0, meatKg: 10, boneKg: 0, chicks: 0 },
  { key: 'مريم', ownKg: 1100, carriedKg: 0, meatKg: 300, boneKg: 25, chicks: 12 },
];

const rows: RisingPayrollRow[] = SAMPLE.map((girl) => {
  const breakdown = toRisingBreakdown(girl.ownKg, girl.carriedKg);
  const meatSales = girl.meatKg * MEAT_PRICE + girl.boneKg * BONE_PRICE;
  const tier = findSalesTier(meatSales, TIERS);
  const meatBonus = tier ? tier.bonus * girl.meatKg : 0;
  const boneBonus = tier ? BONE_PER_KG * girl.boneKg : 0;
  const chickBonus = girl.chicks * CHICK_RATE;
  const base = baseSalaryForKey(girl.key);
  return {
    girl: girl.key,
    name: displayModeratorName(girl.key),
    base,
    ownKg: girl.ownKg,
    carriedKg: girl.carriedKg,
    countedKg: breakdown.counted_kg,
    ownBonus: breakdown.calculated_bonus,
    carriedBonus: breakdown.total_bonus - breakdown.calculated_bonus,
    meatKg: girl.meatKg,
    meatBonus,
    meatRate: tier ? tier.bonus : 0,
    meatRateOverridden: false,
    meatTierLabel: tier?.label ?? null,
    meatOverridden: false,
    boneKg: girl.boneKg,
    boneBonus,
    boneRate: tier ? BONE_PER_KG : 0,
    boneRateOverridden: false,
    boneOverridden: false,
    chickCount: girl.chicks,
    chickBonus,
    deductions: 0,
    total: base + breakdown.total_bonus + meatBonus + boneBonus + chickBonus,
    overridden: false,
    qualified: breakdown.qualified,
  };
});

const focus = rows[0];
const focusSample = SAMPLE[0];

/** شاشة معاينة محلية للأرقام التوضيحية. مش متاحة في نسخة الإنتاج. */
const BonusPreview = () => {
  const [params] = useSearchParams();
  const view = params.get('view');
  const showModerator = view !== 'admin';
  const showAdmin = view !== 'moderator';
  return (
  <main dir="rtl" className="min-h-screen bg-[#FBF7FA] p-4" style={{ fontFamily: 'Cairo, sans-serif' }}>
    {showModerator && (
    <section id="moderator-screen" className="mx-auto max-w-[390px]">
      <ModeratorKgCounterCard
        name={focus.name}
        kg={focus.ownKg}
        carriedKg={focus.carriedKg}
        baseSalary={focus.base}
        meatKg={focus.meatKg}
        meatSales={focusSample.meatKg * MEAT_PRICE + focusSample.boneKg * BONE_PRICE}
        meatBonus={focus.meatBonus}
        meatTiers={TIER_STEPS}
        boneKg={focus.boneKg}
        boneBonus={focus.boneBonus}
        chickCount={focus.chickCount}
        chickBonus={focus.chickBonus}
        periodLabel="أكتوبر 2026"
        now={NOW}
        celebrate={false}
      />
    </section>
    )}
    {showAdmin && (
    <section id="admin-screen" className={`mx-auto max-w-[390px] space-y-4 ${showModerator ? 'mt-8' : ''}`}>
      <h1 className="text-lg font-extrabold text-[#A4288A]">بونص المسوقات — الإدارة</h1>
      {rows.map((row) => {
        const sample = SAMPLE.find((item) => item.key === row.girl)!;
        return (
          <ModeratorKgCounterCard
            key={row.girl}
            name={row.name}
            kg={row.ownKg}
            carriedKg={row.carriedKg}
            baseSalary={row.base}
            meatKg={row.meatKg}
            meatSales={sample.meatKg * MEAT_PRICE + sample.boneKg * BONE_PRICE}
            meatBonus={row.meatBonus}
            meatTiers={TIER_STEPS}
            boneKg={row.boneKg}
            boneBonus={row.boneBonus}
            chickCount={row.chickCount}
            chickBonus={row.chickBonus}
            periodLabel="أكتوبر 2026"
            now={NOW}
          />
        );
      })}
      <div className="rounded-[21px] bg-white p-3 shadow">
        <RisingPayrollTable rows={rows} />
      </div>
    </section>
    )}
  </main>
  );
};

export default BonusPreview;
