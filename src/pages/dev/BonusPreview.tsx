import { useSearchParams } from 'react-router-dom';
import ModeratorKgCounterCard from '@/components/sales/ModeratorKgCounterCard';
import RisingPayrollTable from '@/components/sales/RisingPayrollTable';
import {
  fixtureFocus,
  fixturePayrollRows,
  octoberBonusFixture,
  toBonusCardProps,
} from '@/pages/dev/octoberBonusFixture';

/** شاشة معاينة محلية للكارت الحي. مش متاحة في نسخة الإنتاج. */
const BonusPreview = () => {
  const [params] = useSearchParams();
  const view = params.get('view');
  const showModerator = view !== 'admin';
  const showAdmin = view !== 'moderator';
  const requestedGirl = params.get('girl');
  const focusRow = requestedGirl
    ? octoberBonusFixture.moderators.find((row) => row.key === requestedGirl || row.name === requestedGirl) ?? fixtureFocus()
    : fixtureFocus();
  const rows = fixturePayrollRows();
  return (
    <main dir="rtl" className="min-h-screen bg-[#F4F4F5] p-0" style={{ fontFamily: 'Cairo, sans-serif' }}>
      {showModerator && (
        <section className="mx-auto max-w-[390px]">
          <div id="moderator-screen">
            <ModeratorKgCounterCard {...toBonusCardProps(focusRow)} celebrate={false} />
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
