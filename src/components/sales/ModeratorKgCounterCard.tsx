import { useEffect, useState } from 'react';
import companyLogo from '@/assets/company-logo.jpg';
import {
  BONUS_MILESTONES,
  type BonusLane,
  buildModeratorBonusBoard,
  formatBonusEgp,
  formatBonusKg,
} from '@/lib/moderatorKgBonus';

const PURPLE = '#A4288A';
const ORANGE = '#F37346';
const INK = '#3A1238';

const RING = 42;
const CIRC = 2 * Math.PI * RING;

export interface ModeratorKgCounterCardProps {
  name: string;
  /** كيلوات مصنّعات الشهر نفسه. */
  kg: number;
  /** كيلوات مصنّعات مرحّلة من شهر معتمد. */
  carriedKg?: number;
  baseSalary: number;
  /** بونص المصنّعات لو الإدارة عدّلته، شامل المرحّل لو اتبعت. */
  bonusOverride?: number | null;
  meatKg?: number;
  meatSales?: number;
  meatBonus?: number;
  meatTiers?: Array<{ sales: number; label: string }>;
  boneKg?: number;
  boneBonus?: number;
  chickCount?: number;
  chickBonus?: number;
  carriedSideBonus?: number;
  processedBonusOverride?: number | null;
  periodLabel?: string;
  now?: Date;
  celebrate?: boolean;
  storageKey?: string;
  forceCelebration?: boolean;
  frozen?: boolean;
}

const quantityText = (lane: BonusLane) => {
  const digits = lane.id === 'chicks' ? formatBonusEgp(lane.quantity) : formatBonusKg(lane.quantity);
  return `${digits} ${lane.unit}`;
};

const LaneGauge = ({ lane, drawn }: { lane: BonusLane; drawn: boolean }) => {
  const progress = drawn ? lane.progress : 0;
  const offset = CIRC * (1 - progress);
  return (
    <section
      aria-label={`${lane.title}: ${quantityText(lane)}، بونص ${formatBonusEgp(lane.bonus)}`}
      style={{ background: '#FBF7FA', borderRadius: 13, padding: 13 }}
    >
      <div className="flex items-center justify-between" style={{ gap: 8 }}>
        <h3 className="m-0 font-extrabold" style={{ color: PURPLE, fontSize: 16 }}>{lane.title}</h3>
        <span className="font-bold tabular-nums" style={{ color: ORANGE, fontSize: 13 }}>{formatBonusEgp(lane.bonus)} ج</span>
      </div>
      <svg viewBox="0 0 120 120" className="mx-auto h-auto w-full" style={{ maxWidth: 128 }} role="img">
        <circle cx="60" cy="60" r={RING} fill="none" stroke="#F3D5E8" strokeWidth="9" />
        <circle
          cx="60"
          cy="60"
          r={RING}
          fill="none"
          stroke={ORANGE}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={offset}
          transform="rotate(-90 60 60)"
          style={{ transition: 'stroke-dashoffset 900ms cubic-bezier(.22,.8,.24,1)' }}
        />
        <text x="60" y="56" textAnchor="middle" fill={INK} fontSize="16" fontWeight="800">
          {lane.id === 'chicks' ? formatBonusEgp(lane.quantity) : formatBonusKg(lane.quantity)}
        </text>
        <text x="60" y="74" textAnchor="middle" fill={PURPLE} fontSize="11" fontWeight="700">{lane.unit}</text>
      </svg>
      <p className="m-0 text-center" style={{ fontSize: 13, lineHeight: 1.45, minHeight: 38 }}>
        {lane.nextHint ?? (lane.id === 'chicks' ? 'كل كتكوت بيزوّد البونص' : 'مفيش مستوى جاي')}
      </p>
    </section>
  );
};

const ModeratorKgCounterCard = ({
  name,
  kg,
  carriedKg = 0,
  baseSalary,
  bonusOverride = null,
  meatKg = 0,
  meatSales = 0,
  meatBonus = 0,
  meatTiers = [],
  boneKg = 0,
  boneBonus = 0,
  chickCount = 0,
  chickBonus = 0,
  carriedSideBonus = 0,
  processedBonusOverride = null,
  periodLabel,
  now,
  celebrate = false,
  storageKey,
  forceCelebration = false,
  frozen = false,
}: ModeratorKgCounterCardProps) => {
  const board = buildModeratorBonusBoard({
    name,
    kg,
    carriedKg,
    baseSalary,
    bonusOverride: bonusOverride ?? processedBonusOverride,
    meatKg,
    meatSales,
    meatBonus,
    meatTiers,
    boneKg,
    boneBonus,
    chickCount,
    chickBonus,
    carriedSideBonus,
    now,
    frozen,
  });
  const view = board.processed;
  const [burst, setBurst] = useState(forceCelebration);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setDrawn(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!celebrate || forceCelebration) return;
    const key = `coceg-rising-milestone:${storageKey || name}`;
    const previous = Number(window.localStorage.getItem(key));
    if (Number.isFinite(previous) && board.milestoneIndex > previous) setBurst(true);
    window.localStorage.setItem(key, String(board.milestoneIndex));
  }, [board.milestoneIndex, celebrate, forceCelebration, name, storageKey]);

  useEffect(() => {
    if (!burst) return;
    const timer = window.setTimeout(() => setBurst(false), 4200);
    return () => window.clearTimeout(timer);
  }, [burst]);

  return (
    <article
      dir="rtl"
      data-testid="moderator-bonus-card"
      className="relative overflow-hidden bg-white text-[#3A1238] shadow-lg"
      style={{ borderRadius: 21, fontFamily: 'Cairo, sans-serif' }}
      aria-label={`بونص ${name}`}
    >
      <header
        className="relative flex items-center justify-between text-white"
        style={{ background: PURPLE, padding: '21px 21px 18px', gap: 13 }}
      >
        <div className="min-w-0">
          <p className="m-0 font-medium text-white/80" style={{ fontSize: 13 }}>بونص الشهر</p>
          <h2 className="m-0 font-extrabold leading-none" style={{ fontSize: 26, marginTop: 4 }}>{name}</h2>
          {periodLabel && (
            <p className="m-0 text-white/85" style={{ fontSize: 13, marginTop: 6 }}>{periodLabel}</p>
          )}
        </div>
        <img
          src={companyLogo}
          alt=""
          className="shrink-0 rounded-full bg-white object-contain"
          style={{ width: 55, height: 55, padding: 4 }}
        />
        {burst && (
          <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center" aria-hidden>
            <span
              className="rounded-full px-3 py-1 font-extrabold"
              style={{ background: ORANGE, color: 'white', fontSize: 13 }}
            >
              مبروك يا {name.trim() || 'قمر'}
            </span>
          </div>
        )}
      </header>

      {burst && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
          {Array.from({ length: 16 }).map((_, index) => (
            <span
              key={index}
              className="absolute top-16 h-2 w-2 rounded-sm"
              style={{
                right: `${8 + (index * 17) % 84}%`,
                background: index % 2 ? ORANGE : PURPLE,
                animation: `bonus-confetti 1.15s ease-out ${index * 0.04}s both`,
              }}
            />
          ))}
        </div>
      )}
      <style>{`@keyframes bonus-confetti { from { transform: translateY(0) rotate(0deg); opacity: 1 } to { transform: translateY(120px) rotate(160deg); opacity: 0 } } @media (prefers-reduced-motion: reduce) { span { animation: none !important } }`}</style>

      <div style={{ padding: 21, display: 'flex', flexDirection: 'column', gap: 21 }}>
        <div className="grid grid-cols-2" style={{ gap: 13 }}>
          {board.lanes.map((lane) => <LaneGauge key={lane.id} lane={lane} drawn={drawn} />)}
        </div>

        {view.carriedKg > 0 && (
          <p className="m-0 text-center" style={{ fontSize: 13, marginTop: -8, color: PURPLE }}>
            كيلو المصنّعات فيه {formatBonusKg(view.carriedKg)} كجم من الشهر اللي فات
          </p>
        )}

        <ol className="m-0 grid list-none grid-cols-4 p-0" style={{ gap: 8 }}>
          {BONUS_MILESTONES.map((milestone) => {
            const done = view.kg >= milestone.kg;
            const current = view.nextMilestoneKg === milestone.kg;
            return (
              <li
                key={milestone.kg}
                className="text-center"
                style={{
                  borderRadius: 13,
                  padding: '8px 4px',
                  background: done ? PURPLE : current ? '#FDE4D8' : '#F6ECF4',
                  color: done ? 'white' : INK,
                }}
              >
                <div className="font-extrabold" style={{ fontSize: 13 }}>{milestone.title}</div>
                <div style={{ fontSize: 11, opacity: 0.85 }}>{done ? 'اتحقق' : 'جاي'}</div>
              </li>
            );
          })}
        </ol>

        {view.nextMilestoneKg != null && (
          <div style={{ borderRadius: 13, background: PURPLE, color: 'white', padding: '13px 16px' }}>
            <p className="m-0" style={{ fontSize: 13, opacity: 0.85 }}>مصنّعات: لما توصّلي {view.nextGoal}</p>
            <p className="m-0 font-extrabold" style={{ fontSize: 21 }}>
              بونص المصنّعات هيبقى {formatBonusEgp(view.bonusAtNext ?? 0)} جنيه
            </p>
          </div>
        )}

        <div className="grid grid-cols-2" style={{ gap: 13 }}>
          <div style={{ background: '#F6ECF4', borderRadius: 13, padding: 13 }}>
            <p className="m-0" style={{ fontSize: 13, color: PURPLE }}>إجمالي البونص</p>
            <p className="m-0 font-extrabold tabular-nums" style={{ fontSize: 26, lineHeight: 1.15 }}>{formatBonusEgp(board.totalBonus)}</p>
            <p className="m-0" style={{ fontSize: 13 }}>جنيه</p>
          </div>
          <div style={{ background: '#FDE4D8', borderRadius: 13, padding: 13 }}>
            <p className="m-0" style={{ fontSize: 13, color: '#9A3B22' }}>المرتب المتوقع</p>
            <p className="m-0 font-extrabold tabular-nums" style={{ fontSize: 26, lineHeight: 1.15 }}>{formatBonusEgp(board.salary)}</p>
            <p className="m-0" style={{ fontSize: 13 }}>أساسي {formatBonusEgp(board.baseSalary)}</p>
          </div>
        </div>

        {carriedSideBonus > 0 && (
          <p className="m-0 text-center" style={{ fontSize: 13, color: PURPLE }}>
            الإجمالي شامل {formatBonusEgp(carriedSideBonus)} جنيه لحوم وعظم من الشهر اللي فات
          </p>
        )}

        <div
          className="text-center font-bold"
          style={{ borderRadius: 13, background: '#FFF6F1', color: ORANGE, padding: '10px 13px', fontSize: 16 }}
        >
          {board.daysPhrase}
        </div>

        <p
          className="m-0"
          style={{
            borderRadius: 13,
            background: '#FBF7FA',
            borderRight: `4px solid ${ORANGE}`,
            padding: '13px 16px',
            fontSize: 16,
            lineHeight: 1.7,
          }}
        >
          {board.message}
        </p>
      </div>
    </article>
  );
};

export default ModeratorKgCounterCard;
