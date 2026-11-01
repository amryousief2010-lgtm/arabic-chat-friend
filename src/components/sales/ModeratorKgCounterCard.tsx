import { useEffect, useState } from 'react';
import companyLogo from '@/assets/company-logo.jpg';
import { EgpInline, IsolatedNumbers, LtrNum } from '@/components/sales/egpInline';
import ModeratorRoadRunner from '@/components/sales/ModeratorRoadRunner';
import {
  type BonusLane,
  type ModeratorBonusView,
  buildModeratorBonusBoard,
  carriedProcessedPhrase,
  formatBonusEgp,
  formatBonusKg,
} from '@/lib/moderatorKgBonus';

const PURPLE = '#A4288A';
const ORANGE = '#F37346';
const INK = '#1A1A1A';
const MUTED = '#5C5C5C';
const PAPER = '#F6F6F6';
const LINE = '#E6E6E6';
const FONT = 'Cairo, sans-serif';

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
  /** للمعاينة بس. لو اتبعت، بتستبدل الصورة الموقّعة. */
  avatarUrl?: string | null;
  reduceMotion?: boolean;
  /** للمعاينة: تقف عند بداية الطريق لحد ما تتساب. */
  hold?: boolean;
}

const qtyText = (lane: BonusLane) => (lane.id === 'chicks' ? formatBonusEgp(lane.quantity) : formatBonusKg(lane.quantity));

const laneHint = (lane: BonusLane) => lane.nextHint ?? 'مفيش مستوى جاي';

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
        فاضلِك <LtrNum value={formatBonusKg(view.kgRemaining ?? 0)} /> كجم والبونص يفتح بـ <LtrNum value={formatBonusEgp(view.bonusAtNext ?? 0)} /> جنيه
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
  avatarUrl,
  reduceMotion = false,
  hold = false,
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
      className="coceg-card relative bg-white shadow-lg"
      style={{ fontFamily: FONT, color: INK, borderRadius: 34, overflow: 'hidden', containerType: 'inline-size' }}
      aria-label={`بونص ${name}`}
    >
      <style>{`
        .coceg-lanes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:13px;align-items:stretch}
        .coceg-lane{display:flex;flex-direction:column;align-items:center;min-width:0;height:100%;text-align:center}
        .coceg-lane-qty{margin:8px 0 0;font-size:21px;font-weight:800;line-height:1.2;max-width:100%;overflow-wrap:anywhere}
        .coceg-lane-hint{margin:8px 0 0;width:100%;font-size:13px;line-height:1.45;color:${MUTED};min-height:calc(1.45em * 2)}
        .coceg-pay-row{display:grid;grid-template-columns:minmax(0,1.618fr) minmax(0,1fr);gap:13px;align-items:stretch}
        .coceg-pay-card{min-width:0;height:100%;display:flex;flex-direction:column;box-sizing:border-box;border-radius:21px}
        .coceg-pay-card--bonus{background:${PAPER};padding:21px}
        .coceg-pay-card--salary{background:${INK};color:#fff;padding:16px}
        .coceg-bonus-figure,.coceg-salary-figure{margin:8px 0 0;font-weight:800;max-width:100%;overflow-wrap:anywhere}
        .coceg-bonus-figure{font-size:34px;line-height:1.15;color:${PURPLE}}
        .coceg-salary-figure{font-size:21px;line-height:1.3;color:${ORANGE}}
        .coceg-bonus-figure bdi,.coceg-salary-figure bdi,.coceg-salary-base bdi{display:inline-block;max-width:100%;overflow-wrap:anywhere}
        .coceg-salary-base{margin:8px 0 0;font-size:13px;line-height:1.618;color:rgba(255,255,255,0.75)}
        @container (max-width: 480px){
          .coceg-pay-row{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
          .coceg-pay-card--bonus,.coceg-pay-card--salary{padding:14px 16px}
          .coceg-bonus-figure{font-size:22px}
          .coceg-salary-figure{font-size:16px}
          .coceg-lane-qty{font-size:18px}
          .coceg-lane-hint{font-size:11px;line-height:1.35;min-height:calc(1.35em * 4)}
        }
        @container (max-width: 380px){
          .coceg-pay-card--bonus,.coceg-pay-card--salary{padding:12px 14px}
          .coceg-bonus-figure{font-size:18px}
          .coceg-salary-figure{font-size:15px}
        }
      `}</style>
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
          طريق المصنّعات · <span style={{ fontWeight: 800, color: INK }}><LtrNum value={formatBonusKg(view.kg)} /></span> كجم · بونص <LtrNum value={formatBonusEgp(view.bonus)} /> جنيه
        </p>
      </div>

      <ModeratorRoadRunner kg={view.kg} name={name} userId={userId} avatarUrl={avatarUrl} reduceMotion={reduceMotion} hold={hold} />

      <div style={{ padding: 21, display: 'flex', flexDirection: 'column', gap: 21 }}>
        <UnlockTeaser view={view} />
        {view.carriedKg > 0 && (
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.618, color: PURPLE, textAlign: 'center' }}>
            <IsolatedNumbers text={carriedProcessedPhrase(view.carriedKg)} />
          </p>
        )}
        <div className="coceg-lanes">
          {lanes.map((lane) => (
            <section key={lane.id} className="coceg-lane" aria-label={`${lane.title}: ${qtyText(lane)} ${lane.unit}`}>
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <MiniRing progress={lane.progress} color={colors[lane.id] ?? PURPLE} />
              </div>
              <p style={{ margin: '8px 0 0', fontSize: 13, fontWeight: 800, color: PURPLE }}>{lane.title}</p>
              <p className="coceg-lane-qty">
                <LtrNum value={qtyText(lane)} />
              </p>
              <p style={{ margin: 0, fontSize: 13, color: MUTED }}>{lane.unit}</p>
              <p style={{ margin: '8px 0 0', fontSize: 13, fontWeight: 800, color: ORANGE }}>
                <EgpInline amount={lane.bonus} />
              </p>
              <p className="coceg-lane-hint"><IsolatedNumbers text={laneHint(lane)} /></p>
            </section>
          ))}
        </div>
        <div className="coceg-pay-row">
          <div className="coceg-pay-card coceg-pay-card--bonus">
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.618, color: MUTED }}>البونص كله</p>
            <p className="coceg-bonus-figure">
              <LtrNum value={formatBonusEgp(board.totalBonus)} />
            </p>
            <p style={{ margin: '8px 0 0', fontSize: 13, color: MUTED }}>جنيه</p>
          </div>
          <div className="coceg-pay-card coceg-pay-card--salary">
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.618, color: 'rgba(255,255,255,0.75)' }}>المرتب المتوقع</p>
            <p className="coceg-salary-figure">
              <LtrNum value={formatBonusEgp(board.salary)} />
            </p>
            <p className="coceg-salary-base">
              أساسي <LtrNum value={formatBonusEgp(board.baseSalary)} />
            </p>
          </div>
        </div>
        {carriedSideBonus > 0 && (
          <p style={{ margin: 0, textAlign: 'center', fontSize: 13, lineHeight: 1.618, color: PURPLE }}>
            الإجمالي شامل <LtrNum value={formatBonusEgp(carriedSideBonus)} /> جنيه لحوم وعظم من الشهر اللي فات
          </p>
        )}
        <p style={{ margin: 0, textAlign: 'center', fontSize: 13, fontWeight: 800, color: ORANGE, lineHeight: 1.618 }}>{board.daysPhrase}</p>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.618, color: INK }}><IsolatedNumbers text={board.message} /></p>
      </div>
    </article>
  );
};

export default ModeratorKgCounterCard;
