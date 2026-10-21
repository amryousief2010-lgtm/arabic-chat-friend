import { useEffect, useState } from 'react';
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
  const reduceMotion = params.get('motion') === 'off';
  const armed = params.get('arm') === '1';
  const [held, setHeld] = useState(armed);
  useEffect(() => {
    if (!armed) return undefined;
    const start = () => setHeld(false);
    window.addEventListener('road-play', start);
    return () => window.removeEventListener('road-play', start);
  }, [armed]);
  const sampleAvatar = params.get('photo') === '1'
    ? `data:image/svg+xml;utf8,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' fill='#7ec8e3'/><circle cx='50' cy='46' r='22' fill='#f2c9a8'/><circle cx='42' cy='44' r='3' fill='#2b1630'/><circle cx='58' cy='44' r='3' fill='#2b1630'/><path d='M42 54 Q50 62 58 54' fill='none' stroke='#a4288a' stroke-width='3'/><rect y='80' width='100' height='20' fill='#f37346'/></svg>")}`
    : undefined;
  const focusRow = requestedGirl
    ? octoberBonusFixture.moderators.find((row) => row.key === requestedGirl || row.name === requestedGirl) ?? fixtureFocus()
    : fixtureFocus();
  const rows = fixturePayrollRows();
  return (
    <main dir="rtl" className="min-h-screen bg-[#F4F4F5] p-0" style={{ fontFamily: 'Cairo, sans-serif' }}>
      {showModerator && (
        <section className="mx-auto max-w-[390px]">
          <div id="moderator-screen">
            <ModeratorKgCounterCard {...toBonusCardProps(focusRow)} celebrate={false} avatarUrl={sampleAvatar} reduceMotion={reduceMotion} hold={held} />
          </div>
        </section>
      )}
      {showAdmin && (
        <section id="admin-screen" className={`mx-auto max-w-[390px] space-y-4 ${showModerator ? 'mt-8' : ''}`}>
          <h1 className="text-lg font-extrabold text-[#A4288A]">بونص المسوقات — الإدارة</h1>
          {octoberBonusFixture.moderators.map((row) => (
            <ModeratorKgCounterCard key={row.key} {...toBonusCardProps(row)} avatarUrl={sampleAvatar} reduceMotion={reduceMotion} />
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
