import { useEffect, useState, type ReactNode } from 'react';
import companyLogo from '@/assets/company-logo.jpg';
import {
  BONUS_MILESTONES,
  type BonusLane,
  type ModeratorBonusView,
  carriedProcessedPhrase,
  formatBonusEgp,
  formatBonusKg,
  moderatorKgBonus,
  buildModeratorBonusBoard,
} from '@/lib/moderatorKgBonus';
import type { BonusVariantProps } from '@/pages/dev/BonusCardVariants';
import { useModeratorAvatar } from '@/pages/dev/useModeratorAvatar';

const PURPLE = '#A4288A';
const ORANGE = '#F37346';
const INK = '#1A1A1A';
const MUTED = '#5C5C5C';
const PAPER = '#F6F6F6';
const LINE = '#E6E6E6';
const FONT = "'Noto Kufi Arabic', Cairo, sans-serif";

const GAUGE = { w: 390, h: 340, cx: 195, cy: 188, r: 112, labelR: 150, start: 210, sweep: 300, max: 2000 };

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

const useKufi = () => {
  useEffect(() => {
    const id = 'noto-kufi-arabic';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@500;600;700;800&display=swap';
    document.head.appendChild(link);
  }, []);
};

const polar = (cx: number, cy: number, r: number, degFromTop: number) => {
  const rad = ((degFromTop - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
};

const arcPath = (cx: number, cy: number, r: number, start: number, sweep: number) => {
  const a = polar(cx, cy, r, start);
  const b = polar(cx, cy, r, start + sweep);
  const large = sweep > 180 ? 1 : 0;
  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${large} 1 ${b.x} ${b.y}`;
};

const qtyText = (lane: BonusLane) => (lane.id === 'chicks' ? formatBonusEgp(lane.quantity) : formatBonusKg(lane.quantity));

const laneHint = (lane: BonusLane) => lane.nextHint ?? 'مفيش مستوى جاي';

const sideLanes = (lanes: BonusLane[]) => lanes.filter((lane) => lane.id !== 'processed');

function Shell({
  name,
  variant,
  children,
}: {
  name: string;
  variant: string;
  children: ReactNode;
}) {
  useKufi();
  return (
    <article
      id="bonus-card"
      dir="rtl"
      data-testid="moderator-bonus-card"
      data-variant={variant}
      aria-label={`بونص ${name}`}
      style={{
        fontFamily: FONT,
        background: '#fff',
        color: INK,
        borderRadius: 34,
        overflow: 'hidden',
        boxShadow: '0 21px 55px rgba(26,26,26,0.12)',
      }}
    >
      {children}
    </article>
  );
}

function KgFigure({ kg, color, size = 55 }: { kg: number; color: string; size?: number }) {
  const [whole, frac] = formatBonusKg(kg).split('.');
  const fracSize = Math.round(size / 1.618);
  return (
    <div style={{ direction: 'ltr', display: 'inline-flex', alignItems: 'flex-start', color, fontWeight: 800, lineHeight: 1 }}>
      <span className="tabular-nums" style={{ fontSize: size }}>{whole}</span>
      {frac && <span className="tabular-nums" style={{ fontSize: fracSize, marginTop: 8 }}>.{frac}</span>}
    </div>
  );
}

function MiniRing({ progress, color }: { progress: number; color: string }) {
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
}

function CarriedNote({ kg }: { kg: number }) {
  if (kg <= 0) return null;
  return (
    <p style={{ margin: 0, fontSize: 13, lineHeight: 1.618, color: PURPLE, textAlign: 'center' }}>
      {carriedProcessedPhrase(kg)}
    </p>
  );
}

function UnlockTeaser({ view, onDark }: { view: ModeratorBonusView; onDark?: boolean }) {
  if (view.qualified) return null;
  return (
    <div
      style={{
        background: onDark ? 'rgba(243,115,70,0.16)' : '#FFF4EF',
        border: `1px solid ${ORANGE}`,
        borderRadius: 21,
        padding: '13px 21px',
        textAlign: 'center',
      }}
    >
      <p style={{ margin: 0, color: ORANGE, fontWeight: 800, fontSize: 21, lineHeight: 1.618 }}>افتحي البونص</p>
      <p style={{ margin: '8px 0 0', color: onDark ? '#fff' : INK, fontSize: 13, lineHeight: 1.618 }}>
        فاضلِك {formatBonusKg(view.kgRemaining ?? 0)} كجم والبونص يفتح بـ {formatBonusEgp(view.bonusAtNext ?? 0)} جنيه
      </p>
    </div>
  );
}

function PrizeRow({ total, salary, base }: { total: number; salary: number; base: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.618fr 1fr', gap: 13 }}>
      <div style={{ background: PAPER, borderRadius: 21, padding: 21 }}>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.618, color: MUTED }}>البونص كله</p>
        <p className="tabular-nums" style={{ margin: '8px 0 0', fontSize: 34, lineHeight: 1.15, fontWeight: 800, color: PURPLE, direction: 'ltr', textAlign: 'right' }}>
          {formatBonusEgp(total)}
        </p>
        <p style={{ margin: '8px 0 0', fontSize: 13, color: MUTED }}>جنيه</p>
      </div>
      <div style={{ background: INK, borderRadius: 21, padding: 13, color: '#fff' }}>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.618, color: 'rgba(255,255,255,0.75)' }}>المرتب المتوقع</p>
        <p className="tabular-nums" style={{ margin: '8px 0 0', fontSize: 21, lineHeight: 1.3, fontWeight: 800, color: ORANGE, direction: 'ltr', textAlign: 'right' }}>
          {formatBonusEgp(salary)}
        </p>
        <p style={{ margin: '8px 0 0', fontSize: 13, lineHeight: 1.618, color: 'rgba(255,255,255,0.75)' }}>
          أساسي {formatBonusEgp(base)}
        </p>
      </div>
    </div>
  );
}

function LaneTrio({ lanes }: { lanes: BonusLane[] }) {
  const colors: Record<string, string> = { meat: ORANGE, bone: PURPLE, chicks: ORANGE };
  return (
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
  );
}

function QuestList({ lanes }: { lanes: BonusLane[] }) {
  const colors: Record<string, string> = { meat: ORANGE, bone: PURPLE, chicks: ORANGE };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
      {lanes.map((lane) => (
        <section
          key={lane.id}
          aria-label={`${lane.title}: ${qtyText(lane)} ${lane.unit}`}
          style={{ display: 'flex', alignItems: 'center', gap: 13, background: PAPER, borderRadius: 21, padding: 13 }}
        >
          <MiniRing progress={lane.progress} color={colors[lane.id] ?? PURPLE} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
              <p style={{ margin: 0, fontSize: 21, fontWeight: 800, color: PURPLE }}>{lane.title}</p>
              <p className="tabular-nums" style={{ margin: 0, fontSize: 21, fontWeight: 800, color: ORANGE, direction: 'ltr' }}>
                {formatBonusEgp(lane.bonus)} ج
              </p>
            </div>
            <p style={{ margin: '8px 0 0', fontSize: 13, lineHeight: 1.618 }}>
              <span className="tabular-nums" style={{ fontWeight: 800 }}>{qtyText(lane)}</span> {lane.unit}
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 13, lineHeight: 1.618, color: MUTED }}>{laneHint(lane)}</p>
          </div>
        </section>
      ))}
    </div>
  );
}

function Odometer({ view }: { view: ModeratorBonusView }) {
  const { w, h, cx, cy, r, labelR, start, sweep, max } = GAUGE;
  const kg = Math.max(0, Math.min(max, view.kg));
  const nextKg = view.nextMilestoneKg == null ? null : Math.min(max, view.nextMilestoneKg);
  const t = kg / max;
  const tNext = nextKg == null ? t : nextKg / max;
  const path = arcPath(cx, cy, r, start, sweep);
  const head = polar(cx, cy, r, start + t * sweep);
  return (
    <div style={{ position: 'relative', width: '100%', aspectRatio: `${w} / ${h}` }}>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="100%" role="img" aria-label={`${formatBonusKg(view.kg)} كيلوجرام مصنّعات`}>
        <defs>
          <linearGradient id="e-road" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor={PURPLE} />
            <stop offset="1" stopColor={ORANGE} />
          </linearGradient>
          <filter id="e-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="3.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <path d={path} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="16" strokeLinecap="round" />
        {tNext > t && (
          <path
            d={path}
            fill="none"
            stroke={ORANGE}
            strokeOpacity="0.45"
            strokeWidth="16"
            strokeLinecap="round"
            pathLength={1000}
            strokeDasharray={`${(tNext - t) * 1000} 1000`}
            strokeDashoffset={-t * 1000}
          />
        )}
        <path
          d={path}
          fill="none"
          stroke="url(#e-road)"
          strokeWidth="16"
          strokeLinecap="round"
          pathLength={1000}
          strokeDasharray={`${t * 1000} 1000`}
        />
        {BONUS_MILESTONES.map((step) => {
          const dot = polar(cx, cy, r, start + (step.kg / max) * sweep);
          const passed = view.kg >= step.kg;
          const current = view.nextMilestoneKg === step.kg;
          return (
            <circle
              key={step.kg}
              cx={dot.x}
              cy={dot.y}
              r={current ? 8 : 6}
              fill={passed ? ORANGE : current ? '#fff' : 'rgba(255,255,255,0.35)'}
              stroke={current ? ORANGE : 'transparent'}
              strokeWidth={current ? 3 : 0}
              filter={passed || current ? 'url(#e-glow)' : undefined}
            />
          );
        })}
        <circle cx={head.x} cy={head.y} r="9" fill="#fff" filter="url(#e-glow)" />
        <circle cx={head.x} cy={head.y} r="5" fill={ORANGE} />
      </svg>
      {BONUS_MILESTONES.map((step) => {
        const spot = polar(cx, cy, labelR, start + (step.kg / GAUGE.max) * sweep);
        const passed = view.kg >= step.kg;
        const current = view.nextMilestoneKg === step.kg;
        return (
          <span
            key={step.title}
            style={{
              position: 'absolute',
              left: `${(spot.x / w) * 100}%`,
              top: `${(spot.y / h) * 100}%`,
              transform: 'translate(-50%, -50%)',
              fontSize: 13,
              fontWeight: 800,
              lineHeight: 1.2,
              color: passed || current ? '#fff' : 'rgba(255,255,255,0.62)',
              whiteSpace: 'nowrap',
            }}
          >
            {step.title}
          </span>
        );
      })}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: `${(cy / h) * 100}%`,
          transform: 'translate(-50%, -50%)',
          textAlign: 'center',
          width: 200,
        }}
      >
        <KgFigure kg={view.kg} color="#fff" />
        <p style={{ margin: '8px 0 0', fontSize: 13, color: 'rgba(255,255,255,0.8)' }}>كجم مصنّعات</p>
      </div>
    </div>
  );
}

function Identity({ name, period, light }: { name: string; period?: string; light?: boolean }) {
  const color = light ? '#fff' : INK;
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 13 }}>
      <div style={{ minWidth: 0 }}>
        <h2 style={{ margin: 0, fontSize: 34, lineHeight: 1.3, fontWeight: 800, color }}>{name}</h2>
        {period && <p style={{ margin: '4px 0 0', fontSize: 13, lineHeight: 1.618, color: light ? 'rgba(255,255,255,0.78)' : MUTED }}>{period}</p>}
      </div>
      <img src={companyLogo} alt="" width={34} height={34} style={{ width: 34, height: 34, borderRadius: 8, objectFit: 'cover', background: '#fff' }} />
    </div>
  );
}

function Foot({ board }: { board: ReturnType<typeof buildModeratorBonusBoard> }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
      <p style={{ margin: 0, textAlign: 'center', fontSize: 13, fontWeight: 800, color: ORANGE, lineHeight: 1.618 }}>{board.daysPhrase}</p>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.618, color: INK }}>{board.message}</p>
    </div>
  );
}

/** ه: خاتم ليلي. العداد بيعدّ الرحلة لحد ٢ طن، والنقطة الجاية متضاءة بالمتبقي. */
export const BonusLayoutE = (props: BonusVariantProps) => {
  const board = buildModeratorBonusBoard(props);
  const view = board.processed;
  const passedTon = view.kg >= 1000;
  return (
    <Shell name={props.name} variant="e">
      <div
        style={{
          background: `
            radial-gradient(80% 60% at 100% 0%, rgba(164,40,138,0.92), transparent 58%),
            radial-gradient(70% 55% at 0% 100%, rgba(243,115,70,0.55), transparent 52%),
            ${INK}
          `,
          padding: '21px 13px 21px',
          display: 'flex',
          flexDirection: 'column',
          gap: 13,
        }}
      >
        <Identity name={props.name} period={props.periodLabel} light />
        <Odometer view={view} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 13, textAlign: 'center' }}>
          {passedTon && (
            <span style={{ background: ORANGE, color: '#fff', borderRadius: 21, padding: '8px 13px', fontSize: 13, fontWeight: 800 }}>
              وسام الطن
            </span>
          )}
          <UnlockTeaser view={view} onDark />
          {view.qualified && view.kgRemaining != null && (
            <>
              <p style={{ margin: 0, color: ORANGE, fontSize: 21, fontWeight: 800, lineHeight: 1.618 }}>
                فاضلِك {formatBonusKg(view.kgRemaining)} كجم
              </p>
              <p style={{ margin: 0, color: '#fff', fontSize: 13, lineHeight: 1.618 }}>
                على {view.nextGoal} · البونص هناك {formatBonusEgp(view.bonusAtNext ?? 0)} جنيه
              </p>
            </>
          )}
        </div>
      </div>
      <div style={{ padding: 21, display: 'flex', flexDirection: 'column', gap: 21 }}>
        <CarriedNote kg={view.carriedKg} />
        <LaneTrio lanes={sideLanes(board.lanes)} />
        <PrizeRow total={board.totalBonus} salary={board.salary} base={board.baseSalary} />
        <Foot board={board} />
      </div>
    </Shell>
  );
};

/** و: وسام معلّق وصف مهمات. الخاتم بيقيس الرحلة كلها، والمحطات تحتيه بتقول الخطوة الجاية. */
export const BonusLayoutF = (props: BonusVariantProps) => {
  const board = buildModeratorBonusBoard(props);
  const view = board.processed;
  const passedTon = view.kg >= 1000;
  const progress = Math.max(0, Math.min(1, view.kg / 2000));
  const ring = 96;
  const circ = 2 * Math.PI * ring;
  const ribbon = !view.qualified ? 'لسه مقفول' : passedTon ? 'وسام الطن' : 'البونص مفتوح';
  return (
    <Shell name={props.name} variant="f">
      <div style={{ padding: '21px 21px 0' }}>
        <Identity name={props.name} period={props.periodLabel} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '21px 21px 13px' }}>
        <div style={{ position: 'relative', width: 230, height: 230 }}>
          <svg width="230" height="230" viewBox="0 0 230 230" role="img" aria-label={`${formatBonusKg(view.kg)} كيلوجرام`}>
            <defs>
              <linearGradient id="f-ring" x1="0" y1="1" x2="1" y2="0">
                <stop offset="0" stopColor={PURPLE} />
                <stop offset="1" stopColor={ORANGE} />
              </linearGradient>
              <filter id="f-glow" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <circle cx="115" cy="115" r="108" fill="none" stroke={PURPLE} strokeOpacity="0.25" strokeWidth="2" strokeDasharray="2 7" />
            <circle cx="115" cy="115" r={ring} fill="#fff" stroke={LINE} strokeWidth="14" />
            <circle
              cx="115"
              cy="115"
              r={ring}
              fill="none"
              stroke="url(#f-ring)"
              strokeWidth="14"
              strokeLinecap="round"
              strokeDasharray={`${circ * progress} ${circ}`}
              transform="rotate(-90 115 115)"
              filter="url(#f-glow)"
            />
          </svg>
          <div style={{ position: 'absolute', left: 0, right: 0, top: 62, textAlign: 'center' }}>
            <KgFigure kg={view.kg} color={INK} />
            <p style={{ margin: '8px 0 0', fontSize: 13, color: MUTED }}>كجم مصنّعات</p>
          </div>
        </div>
        <div
          style={{
            marginTop: -13,
            background: !view.qualified ? INK : ORANGE,
            color: '#fff',
            fontSize: 13,
            fontWeight: 800,
            lineHeight: 1.4,
            padding: '8px 21px',
            borderRadius: 8,
            whiteSpace: 'nowrap',
          }}
        >
          {ribbon}
        </div>
        <div style={{ width: '100%', marginTop: 21 }}>
          <UnlockTeaser view={view} />
          {view.qualified && view.kgRemaining != null && (
            <p style={{ margin: '13px 0 0', textAlign: 'center', fontSize: 21, fontWeight: 800, lineHeight: 1.618, color: PURPLE }}>
              فاضلِك {formatBonusKg(view.kgRemaining)} كجم على {view.nextGoal}
            </p>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 21, position: 'relative' }}>
            <div style={{ position: 'absolute', top: 10, left: '10%', right: '10%', height: 2, background: LINE }} />
            {BONUS_MILESTONES.map((step) => {
              const passed = view.kg >= step.kg;
              const current = view.nextMilestoneKg === step.kg;
              return (
                <div key={step.kg} style={{ textAlign: 'center', position: 'relative' }}>
                  <span
                    style={{
                      display: 'block',
                      width: 21,
                      height: 21,
                      margin: '0 auto',
                      borderRadius: 21,
                      background: passed ? ORANGE : '#fff',
                      border: `3px solid ${passed || current ? ORANGE : LINE}`,
                      boxShadow: current ? `0 0 0 4px rgba(243,115,70,0.25)` : undefined,
                    }}
                  />
                  <span style={{ display: 'block', marginTop: 8, fontSize: 13, fontWeight: 800, color: passed ? PURPLE : MUTED }}>{step.title}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div style={{ padding: 21, display: 'flex', flexDirection: 'column', gap: 21 }}>
        <CarriedNote kg={view.carriedKg} />
        <QuestList lanes={sideLanes(board.lanes)} />
      </div>
      <div style={{ background: INK, color: '#fff', padding: 21, display: 'flex', flexDirection: 'column', gap: 13 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 13 }}>
          <div>
            <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.72)' }}>البونص كله</p>
            <p className="tabular-nums" style={{ margin: '8px 0 0', fontSize: 34, fontWeight: 800, color: ORANGE, lineHeight: 1.15, direction: 'ltr', textAlign: 'right' }}>
              {formatBonusEgp(board.totalBonus)}
            </p>
          </div>
          <div style={{ textAlign: 'left' }}>
            <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.72)' }}>المرتب المتوقع</p>
            <p className="tabular-nums" style={{ margin: '8px 0 0', fontSize: 21, fontWeight: 800, direction: 'ltr' }}>
              {formatBonusEgp(board.salary)}
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'rgba(255,255,255,0.72)' }}>أساسي {formatBonusEgp(board.baseSalary)}</p>
          </div>
        </div>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: ORANGE }}>{board.daysPhrase}</p>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.618, color: 'rgba(255,255,255,0.88)' }}>{board.message}</p>
      </div>
    </Shell>
  );
};

function Walker({ name, url }: { name: string; url: string | null }) {
  const [failed, setFailed] = useState(false);
  const photo = Boolean(url) && !failed;
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
        <img src={url ?? ''} alt="" onError={() => setFailed(true)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        initial
      )}
    </div>
  );
}

/** ز: طريق متعرّج. كل محطة علم ببونصها، وصورة المسوقة ماشية عند كيلوها. */
export const BonusLayoutG = (props: BonusVariantProps) => {
  const board = buildModeratorBonusBoard(props);
  const view = board.processed;
  const avatar = useModeratorAvatar(props.name);
  const nextFlag = ROAD_FLAGS.find((flag) => view.kg < flag.kg) ?? null;
  const walker = roadPoint(Math.min(view.kg, ROAD_MAX));
  const roadWidth = ROAD_W;
  const roadHeight = ROAD_H;

  return (
    <Shell name={props.name} variant="g">
      <div style={{ padding: 21, display: 'flex', flexDirection: 'column', gap: 13 }}>
        <Identity name={props.name} period={props.periodLabel} />
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.618, color: MUTED }}>
          طريق المصنّعات · <span className="tabular-nums" style={{ fontWeight: 800, color: INK }}>{formatBonusKg(view.kg)}</span> كجم · بونص {formatBonusEgp(view.bonus)} جنيه
        </p>
      </div>
      <div style={{ position: 'relative', width: '100%', aspectRatio: `360 / ${roadHeight}` }}>
        <svg viewBox={`0 0 ${roadWidth} ${roadHeight}`} width="100%" height="100%" role="img" aria-label="طريق محطات المصنّعات">
          <defs>
            <linearGradient id="g-road" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor={PURPLE} />
              <stop offset="1" stopColor={ORANGE} />
            </linearGradient>
          </defs>
          <path d={ROAD_D} fill="none" stroke={LINE} strokeWidth="28" strokeLinecap="round" strokeLinejoin="round" />
          <path
            d={ROAD_D}
            fill="none"
            stroke="url(#g-road)"
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
                top: `${(spot.y / roadHeight) * 100}%`,
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
            left: `${(walker.x / roadWidth) * 100}%`,
            top: `${(walker.y / roadHeight) * 100}%`,
            transform: 'translate(-50%, -58%)',
            zIndex: 2,
          }}
        >
          <Walker name={props.name} url={avatar.url} />
        </div>
      </div>
      <div style={{ padding: 21, display: 'flex', flexDirection: 'column', gap: 21 }}>
        {!view.qualified && <UnlockTeaser view={view} />}
        <CarriedNote kg={view.carriedKg} />
        <LaneTrio lanes={sideLanes(board.lanes)} />
        <PrizeRow total={board.totalBonus} salary={board.salary} base={board.baseSalary} />
        <Foot board={board} />
      </div>
    </Shell>
  );
};
