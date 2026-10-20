import { useSearchParams } from 'react-router-dom';
import ModeratorKgCounterCard from '@/components/sales/ModeratorKgCounterCard';
import RisingPayrollTable from '@/components/sales/RisingPayrollTable';
import { BonusLayoutB, BonusLayoutC, BonusLayoutD } from '@/pages/dev/BonusCardVariants';
import {
  fixtureFocus,
  fixturePayrollRows,
  octoberBonusFixture,
  toBonusCardProps,
} from '@/pages/dev/octoberBonusFixture';

const VARIANTS = [
  { id: 'a', label: 'أ · العدّادات' },
  { id: 'b', label: 'ب · السلّم' },
  { id: 'c', label: 'ج · الطريق' },
  { id: 'd', label: 'د · اللوحة' },
] as const;

/** شاشة معاينة محلية. مش متاحة في نسخة الإنتاج. الأرقام من octoberBonusFixture.ts */
const BonusPreview = () => {
  const [params, setParams] = useSearchParams();
  const view = params.get('view');
  const variant = (params.get('variant') || 'a').toLowerCase();
  const showModerator = view !== 'admin';
  const showAdmin = view !== 'moderator';
  const focusProps = toBonusCardProps(fixtureFocus());
  const rows = fixturePayrollRows();
  return (
    <main dir="rtl" className="min-h-screen bg-[#FBF7FA] p-4" style={{ fontFamily: 'Cairo, sans-serif' }}>
      {showModerator && (
        <section className="mx-auto max-w-[390px]">
          <div className="mb-3 grid grid-cols-4" style={{ gap: 8 }}>
            {VARIANTS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  const next = new URLSearchParams(params);
                  next.set('view', 'moderator');
                  next.set('variant', item.id);
                  setParams(next);
                }}
                className="rounded-xl px-1 py-2 text-xs font-bold"
                style={{
                  background: variant === item.id ? '#A4288A' : 'white',
                  color: variant === item.id ? 'white' : '#A4288A',
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
          <p className="m-0 mb-3 text-center text-xs text-[#7A5A78]">
            معاينة فقط. التطبيق لسه على التصميم أ لحد ما عمرو يختار.
            {octoberBonusFixture.source === 'placeholder' ? ' الأرقام توضيحية لحد أرقام أكتوبر الحقيقية.' : ''}
          </p>
          <div id="moderator-screen">
            {variant === 'b' && <BonusLayoutB {...focusProps} />}
            {variant === 'c' && <BonusLayoutC {...focusProps} />}
            {variant === 'd' && <BonusLayoutD {...focusProps} />}
            {variant !== 'b' && variant !== 'c' && variant !== 'd' && (
              <ModeratorKgCounterCard {...focusProps} celebrate={false} />
            )}
          </div>
        </section>
      )}
      {showAdmin && (
        <section id="admin-screen" className={`mx-auto max-w-[390px] space-y-4 ${showModerator ? 'mt-8' : ''}`}>
          <h1 className="text-lg font-extrabold text-[#A4288A]">بونص المسوقات — الإدارة</h1>
          {octoberBonusFixture.moderators.map((row) => (
            <ModeratorKgCounterCard key={row.key} {...toBonusCardProps(row)} />
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
