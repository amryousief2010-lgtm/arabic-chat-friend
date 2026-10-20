import { useEffect, useMemo, useState } from 'react';
import { currentCairoYearMonth } from '@/lib/cairoDate';
import { findModeratorByName, moderatorKeysForMonth, displayModeratorName } from '@/constants/moderators';
import { useAuth } from '@/hooks/useAuth';
import { useModeratorBonusProgress } from '@/hooks/useModeratorBonusProgress';
import ModeratorKgCounterCard from '@/components/sales/ModeratorKgCounterCard';
import { supabase } from '@/integrations/supabase/client';

const monthNames = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

interface BoardProps {
  year: number;
  month: number;
  /** لو حُدّد، تُعرض هذه المسوقة فقط. */
  onlyPayrollKey?: string;
  celebrate?: boolean;
}

/** يطابق مسوقة بمستخدمها عشان صورة profiles.avatar_url تتوقَّع بالجلسة. */
const usePayrollUserIds = () => {
  const [ids, setIds] = useState<Map<string, string>>(() => new Map());
  useEffect(() => {
    let live = true;
    supabase.from('profile_directory').select('id, full_name').then(({ data, error }) => {
      if (!live || error || !data) return;
      const next = new Map<string, string>();
      data.forEach((row) => {
        const moderator = findModeratorByName(row.full_name);
        if (moderator && row.id) next.set(moderator.payrollKey, row.id);
      });
      setIds(next);
    });
    return () => {
      live = false;
    };
  }, []);
  return ids;
};

export const ModeratorKgCounterBoard = ({ year, month, onlyPayrollKey, celebrate = false }: BoardProps) => {
  const progress = useModeratorBonusProgress(year, month);
  const { user, profile } = useAuth();
  const payrollUserIds = usePayrollUserIds();
  const selfKey = findModeratorByName(profile?.full_name)?.payrollKey;
  const cairo = currentCairoYearMonth();
  const isCurrent = year === cairo.year && month === cairo.monthIndex0 + 1;
  const keys = onlyPayrollKey ? progress.girls.filter((girl) => girl === onlyPayrollKey) : progress.girls;
  const periodLabel = `${monthNames[month - 1]} ${year}`;

  if (progress.isLoading && !progress.rows.some((row) => row.countedProcKg > 0)) {
    return <div className="h-40 animate-pulse rounded-3xl bg-[#A4288A]/15" />;
  }

  return (
    <div className={`grid grid-cols-1 gap-[21px] ${keys.length > 1 ? 'xl:grid-cols-2' : ''}`} dir="rtl">
      {keys.map((key) => {
        const row = progress.rows.find((item) => item.girl === key);
        if (!row) return null;
        const carriedBonus = progress.carriedByGirl.get(key) || 0;
        return (
          <ModeratorKgCounterCard
            key={key}
            name={displayModeratorName(key)}
            kg={row.procKg}
            carriedKg={row.carriedProcKg}
            baseSalary={row.base}
            bonusOverride={row.procOverridden ? row.procBonus + carriedBonus : null}
            meatKg={row.meatKg}
            meatSales={row.meatSales}
            meatBonus={row.meatBonus}
            meatTiers={progress.meatTiers}
            boneKg={row.boneKg}
            boneBonus={row.boneBonus}
            chickCount={row.chickCount}
            chickBonus={row.chickBonus}
            carriedSideBonus={progress.sideCarryByGirl.get(key) || 0}
            periodLabel={periodLabel}
            celebrate={celebrate && onlyPayrollKey === key}
            storageKey={`${key}:${year}-${month}`}
            frozen={!isCurrent}
            userId={key === selfKey ? user?.id ?? payrollUserIds.get(key) ?? null : payrollUserIds.get(key) ?? null}
          />
        );
      })}
    </div>
  );
};

/** أعلى صفحة المسوقة: عداد شهرها الحالي فقط. */
export const ModeratorOwnKgCounter = () => {
  const { isSalesModerator, profile } = useAuth();
  const own = useMemo(() => findModeratorByName(profile?.full_name), [profile?.full_name]);
  const cairo = currentCairoYearMonth();
  if (!isSalesModerator || !own) return null;
  const active = moderatorKeysForMonth(cairo.year, cairo.monthIndex0 + 1);
  if (!active.includes(own.payrollKey)) return null;
  return (
    <div className="mb-4">
      <ModeratorKgCounterBoard
        year={cairo.year}
        month={cairo.monthIndex0 + 1}
        onlyPayrollKey={own.payrollKey}
        celebrate
      />
    </div>
  );
};
