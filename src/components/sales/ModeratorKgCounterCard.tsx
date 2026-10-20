import { useEffect, useId, useState } from 'react';
import companyLogo from '@/assets/company-logo.jpg';
import { useAvatarUrl } from '@/hooks/useAvatars';
import {
  type BonusLane,
  type ModeratorBonusView,
  buildModeratorBonusBoard,
  carriedProcessedPhrase,
  formatBonusEgp,
  formatBonusKg,
  moderatorKgBonus,
} from '@/lib/moderatorKgBonus';

const PURPLE = '#A4288A';
const ORANGE = '#F37346';
const INK = '#1A1A1A';
const MUTED = '#5C5C5C';
const PAPER = '#F6F6F6';
const LINE = '#E6E6E6';
const FONT = 'Cairo, sans-serif';

const ROAD_FLAGS = [
  { kg: 400, title: '٤٠٠' },
  { kg: 750, title: '٧٥٠' },
  { kg: 1000, title: 'طن' },
  { kg: 1500, title: 'طن ونص' },
  { kg: 2000, title: '٢ طن' },
  { kg: 2500, title: '٢٫٥ طن' },
] as const;

const ROAD_MAX = 2500;
const ROAD_W = 360;
const ROAD_H = 980;
const ROAD_TOP = 64;
const ROAD_BOTTOM = 900;

const roadPoint = (kg: number) => {
  const t = Math.max(0, Math.min(1, kg / ROAD_MAX));
  const y = ROAD_BOTTOM - t * (ROAD_BOTTOM - ROAD_TOP);
  const x = 180 + Math.sin(t * Math.PI * 3) * 26;
  return { x, y };
};

const ROAD_D = (() => {
  let d = '';
  for (let kg = 0; kg <= ROAD_MAX; kg += 25) {
    const { x, y } = roadPoint(kg);
    d += `${kg === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)} `;
  }
  return d;
})();

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
  /**
   * مستخدم الصورة. للمسوقة الداخلة ده user.id بتاع الجلسة.
   * الرابط الموقّع ييجي من useAvatarUrl على bucket avatars.
   */
  userId?: string | null;
}

const qtyText = (lane: BonusLane) => (lane.id === 'chicks' ? formatBonusEgp(lane.quantity) : formatBonusKg(lane.quantity));

const laneHint = (lane: BonusLane) => lane.nextHint ?? 'مفيش مستوى جاي';

const Walker = ({ name, userId }: { name: string; userId?: string | null }) => {
  const signedUrl = useAvatarUrl(userId);
  const [failed, setFailed] = useState(false);
  const photo = Boolean(signedUrl) && !failed;
  const initial = name.trim().charAt(0) || 'م';
  return (
    <div
      data-avatar-state={photo ? 'photo' : 'initial'}
      style={{
        width: 55,
        height: 55,
        borderRadius: 55,
        overflow: 'hidden',
        background: PURPLE,
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 21,
        fontWeight: 800,
        border: '3px solid #fff',
        boxShadow: `0 0 0 2px ${ORANGE}, 0 8px 21px rgba(26,26,26,0.28)`,
      }}
    >
      {photo ? (
        <img
          src={signedUrl ?? ''}
          alt=""
          onError={() => setFailed(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        initial
      )}
    </div>
  );
};

const MiniRing = ({ progress, color }: { progress: number; color: string }) => {
  const r = 20;
  const c = 2 * Math.PI * r;
  const shown = Math.max(0, Math.min(1, progress));
  return (
    <svg width="55" height="55" viewBox="0 0 55 55" aria-hidden>
      <circle cx="27.5" cy="27.5" r={r} fill="none" stroke={LINE} strokeWidth="5" />
      <circle
        cx="27.5"
        cy="27.5"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={`${c * shown} ${c}`}
        transform="rotate(-90 27.5 27.5)"
      />
    </svg>
  );
};

const UnlockTeaser = ({ view }: { view: ModeratorBonusView }) => {
  if (view.qualified) return null;
  return (
    <div style={{ background: '#FFF4EF', border: `1px solid ${ORANGE}`, borderRadius: 21, padding: '13px 21px', textAlign: 'center' }}>
      <p style={{ margin: 0, color: ORANGE, fontWeight: 800, fontSize: 21, lineHeight: 1.618 }}>افتحي البونص</p>
      <p style={{ margin: '8px 0 0', color: INK, fontSize: 13, lineHeight: 1.618 }}>
        فاضلِك {formatBonusKg(view.kgRemaining ?? 0)} كجم والبونص يفتح بـ {formatBonusEgp(view.bonusAtNext ?? 0)} جنيه
      </p>
    </div>
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
  userId = null,
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
  const gradientId = `road-${useId().replace(/:/g, '')}`;
  const nextFlag = ROAD_FLAGS.find((flag) => view.kg < flag.kg) ?? null;
  const walker = roadPoint(Math.min(view.kg, ROAD_MAX));
  const lanes = board.lanes.filter((lane) => lane.id !== 'processed');
  const colors: Record<string, string> = { meat: ORANGE, bone: PURPLE, chicks: ORANGE };
  const [burst, setBurst] = useState(forceCelebration);

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
      className="relative bg-white shadow-lg"
      style={{ fontFamily: FONT, color: INK, borderRadius: 34, overflow: 'hidden' }}
      aria-label={`بونص ${name}`}
    >
      <div style={{ padding: 21, display: 'flex', flexDirection: 'column', gap: 13 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 13 }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 34, lineHeight: 1.3, fontWeight: 800 }}>{name}</h2>
            {periodLabel && <p style={{ margin: '4px 0 0', fontSize: 13, lineHeight: 1.618, color: MUTED }}>{periodLabel}</p>}
          </div>
          <img src={companyLogo} alt="" width={34} height={34} style={{ width: 34, height: 34, borderRadius: 8, objectFit: 'cover', background: '#fff' }} />
        </div>
        {burst && (
          <p style={{ margin: 0, textAlign: 'center', background: ORANGE, color: '#fff', borderRadius: 21, padding: '8px 13px', fontSize: 13, fontWeight: 800 }}>
            مبروك يا {name.trim() || 'قمر'}
          </p>
        )}
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.618, color: MUTED }}>
          طريق المصنّعات · <span className="tabular-nums" style={{ fontWeight: 800, color: INK }}>{formatBonusKg(view.kg)}</span> كجم · بونص {formatBonusEgp(view.bonus)} جنيه
        </p>
      </div>

      <div style={{ position: 'relative', width: '100%', aspectRatio: `${ROAD_W} / ${ROAD_H}` }}>
        <svg viewBox={`0 0 ${ROAD_W} ${ROAD_H}`} width="100%" height="100%" role="img" aria-label="طريق محطات المصنّعات">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor={PURPLE} />
              <stop offset="1" stopColor={ORANGE} />
            </linearGradient>
          </defs>
          <path d={ROAD_D} fill="none" stroke={LINE} strokeWidth="28" strokeLinecap="round" strokeLinejoin="round" />
          <path
            d={ROAD_D}
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth="28"
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={ROAD_MAX}
            strokeDasharray={`${Math.min(view.kg, ROAD_MAX)} ${ROAD_MAX}`}
          />
          <path d={ROAD_D} fill="none" stroke="rgba(255,255,255,0.88)" strokeWidth="3" strokeDasharray="8 12" strokeLinecap="round" />
          {ROAD_FLAGS.map((flag, index) => {
            const spot = roadPoint(flag.kg);
            const passed = view.kg >= flag.kg;
            const current = nextFlag?.kg === flag.kg;
            const edge = index % 2 === 0 ? 118 : 242;
            return (
              <line key={`pole-${flag.kg}`} x1={spot.x} y1={spot.y} x2={edge} y2={spot.y} stroke={passed ? PURPLE : current ? ORANGE : LINE} strokeWidth="2" />
            );
          })}
          {ROAD_FLAGS.map((flag) => {
            const spot = roadPoint(flag.kg);
            const passed = view.kg >= flag.kg;
            const current = nextFlag?.kg === flag.kg;
            return (
              <circle
                key={flag.kg}
                cx={spot.x}
                cy={spot.y}
                r={current ? 8 : 6}
                fill={passed ? '#fff' : current ? ORANGE : '#fff'}
                stroke={passed ? PURPLE : current ? ORANGE : LINE}
                strokeWidth="3"
              />
            );
          })}
        </svg>
        {ROAD_FLAGS.map((flag, index) => {
          const spot = roadPoint(flag.kg);
          const passed = view.kg >= flag.kg;
          const current = nextFlag?.kg === flag.kg;
          const onLeft = index % 2 === 0;
          return (
            <div
              key={flag.kg}
              style={{
                position: 'absolute',
                left: onLeft ? '2%' : 'auto',
                right: onLeft ? 'auto' : '2%',
                width: '30%',
                top: `${(spot.y / ROAD_H) * 100}%`,
                transform: 'translateY(-50%)',
                textAlign: 'center',
                background: passed ? PURPLE : current ? ORANGE : '#fff',
                color: passed || current ? '#fff' : INK,
                border: passed || current ? 'none' : `1px solid ${LINE}`,
                borderRadius: 13,
                padding: '8px 8px',
                boxShadow: current ? '0 8px 21px rgba(243,115,70,0.35)' : '0 4px 13px rgba(26,26,26,0.06)',
              }}
            >
              <p style={{ margin: 0, fontSize: 13, fontWeight: 800, lineHeight: 1.35 }}>{flag.title}</p>
              <p className="tabular-nums" style={{ margin: '4px 0 0', fontSize: 13, fontWeight: 800, lineHeight: 1.35, direction: 'ltr' }}>
                {formatBonusEgp(moderatorKgBonus(flag.kg))} ج
              </p>
              {current && (
                <p style={{ margin: '4px 0 0', fontSize: 13, fontWeight: 800, lineHeight: 1.45 }}>
                  فاضلِك {formatBonusKg(flag.kg - view.kg)} كجم
                </p>
              )}
            </div>
          );
        })}
        <div
          style={{
            position: 'absolute',
            left: `${(walker.x / ROAD_W) * 100}%`,
            top: `${(walker.y / ROAD_H) * 100}%`,
            transform: 'translate(-50%, -58%)',
            zIndex: 2,
          }}
        >
          <Walker name={name} userId={userId} />
        </div>
      </div>

      <div style={{ padding: 21, display: 'flex', flexDirection: 'column', gap: 21 }}>
        <UnlockTeaser view={view} />
        {view.carriedKg > 0 && (
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.618, color: PURPLE, textAlign: 'center' }}>
            {carriedProcessedPhrase(view.carriedKg)}
          </p>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 13 }}>
          {lanes.map((lane) => (
            <section key={lane.id} aria-label={`${lane.title}: ${qtyText(lane)} ${lane.unit}`} style={{ textAlign: 'center' }}>
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <MiniRing progress={lane.progress} color={colors[lane.id] ?? PURPLE} />
              </div>
              <p style={{ margin: '8px 0 0', fontSize: 13, fontWeight: 800, color: PURPLE }}>{lane.title}</p>
              <p className="tabular-nums" style={{ margin: '8px 0 0', fontSize: 21, fontWeight: 800, lineHeight: 1.2, direction: 'ltr' }}>
                {qtyText(lane)}
              </p>
              <p style={{ margin: 0, fontSize: 13, color: MUTED }}>{lane.unit}</p>
              <p className="tabular-nums" style={{ margin: '8px 0 0', fontSize: 13, fontWeight: 800, color: ORANGE }}>
                {formatBonusEgp(lane.bonus)} ج
              </p>
              <p style={{ margin: '8px 0 0', fontSize: 13, lineHeight: 1.618, color: MUTED }}>{laneHint(lane)}</p>
            </section>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1.618fr 1fr', gap: 13 }}>
          <div style={{ background: PAPER, borderRadius: 21, padding: 21 }}>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.618, color: MUTED }}>البونص كله</p>
            <p className="tabular-nums" style={{ margin: '8px 0 0', fontSize: 34, lineHeight: 1.15, fontWeight: 800, color: PURPLE, direction: 'ltr', textAlign: 'right' }}>
              {formatBonusEgp(board.totalBonus)}
            </p>
            <p style={{ margin: '8px 0 0', fontSize: 13, color: MUTED }}>جنيه</p>
          </div>
          <div style={{ background: INK, borderRadius: 21, padding: 13, color: '#fff' }}>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.618, color: 'rgba(255,255,255,0.75)' }}>المرتب المتوقع</p>
            <p className="tabular-nums" style={{ margin: '8px 0 0', fontSize: 21, lineHeight: 1.3, fontWeight: 800, color: ORANGE, direction: 'ltr', textAlign: 'right' }}>
              {formatBonusEgp(board.salary)}
            </p>
            <p style={{ margin: '8px 0 0', fontSize: 13, lineHeight: 1.618, color: 'rgba(255,255,255,0.75)' }}>
              أساسي {formatBonusEgp(board.baseSalary)}
            </p>
          </div>
        </div>
        {carriedSideBonus > 0 && (
          <p style={{ margin: 0, textAlign: 'center', fontSize: 13, lineHeight: 1.618, color: PURPLE }}>
            الإجمالي شامل {formatBonusEgp(carriedSideBonus)} جنيه لحوم وعظم من الشهر اللي فات
          </p>
        )}
        <p style={{ margin: 0, textAlign: 'center', fontSize: 13, fontWeight: 800, color: ORANGE, lineHeight: 1.618 }}>{board.daysPhrase}</p>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.618, color: INK }}>{board.message}</p>
      </div>
    </article>
  );
};

export default ModeratorKgCounterCard;
