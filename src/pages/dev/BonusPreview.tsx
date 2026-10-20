import { useSearchParams } from 'react-router-dom';
import ModeratorKgCounterCard from '@/components/sales/ModeratorKgCounterCard';
import RisingPayrollTable, { type RisingPayrollRow } from '@/components/sales/RisingPayrollTable';
import { baseSalaryForKey, displayModeratorName } from '@/constants/moderators';
import { toRisingBreakdown } from '@/lib/moderatorKgBonus';

const NOW = new Date('2026-10-20T10:00:00.000Z');

const SAMPLE = [
  { key: 'اية', ownKg: 820, carriedKg: 40 },
  { key: 'نورا', ownKg: 430, carriedKg: 0 },
  { key: 'منال', ownKg: 180, carriedKg: 0 },
  { key: 'مريم', ownKg: 1100, carriedKg: 0 },
];

const rows: RisingPayrollRow[] = SAMPLE.map((girl) => {
  const breakdown = toRisingBreakdown(girl.ownKg, girl.carriedKg);
  const carriedBonus = breakdown.total_bonus - breakdown.calculated_bonus;
  const base = baseSalaryForKey(girl.key);
  return {
    girl: girl.key,
    name: displayModeratorName(girl.key),
    base,
    ownKg: girl.ownKg,
    carriedKg: girl.carriedKg,
    countedKg: breakdown.counted_kg,
    ownBonus: breakdown.calculated_bonus,
    carriedBonus,
    deductions: 0,
    total: base + breakdown.total_bonus,
    overridden: false,
    qualified: breakdown.qualified,
  };
});

const focus = rows[0];

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
        periodLabel="أكتوبر 2026"
        now={NOW}
        celebrate={false}
      />
    </section>
    )}
    {showAdmin && (
    <section id="admin-screen" className={`mx-auto max-w-[390px] space-y-4 ${showModerator ? 'mt-8' : ''}`}>
      <h1 className="text-lg font-extrabold text-[#A4288A]">بونص المسوقات — الإدارة</h1>
      {rows.map((row) => (
        <ModeratorKgCounterCard
          key={row.girl}
          name={row.name}
          kg={row.ownKg}
          carriedKg={row.carriedKg}
          baseSalary={row.base}
          periodLabel="أكتوبر 2026"
          now={NOW}
        />
      ))}
      <div className="rounded-[21px] bg-white p-3 shadow">
        <RisingPayrollTable rows={rows} />
      </div>
    </section>
    )}
  </main>
  );
};

export default BonusPreview;
