import type { ReactNode } from 'react';
import companyLogo from '@/assets/company-logo.jpg';
import {
  BONUS_MILESTONES,
  type BonusLane,
  type ModeratorBonusBoard,
  buildModeratorBonusBoard,
  carriedProcessedPhrase,
  formatBonusEgp,
  formatBonusKg,
} from '@/lib/moderatorKgBonus';

const PURPLE = '#A4288A';
const ORANGE = '#F37346';
const INK = '#3A1238';

export interface BonusVariantProps {
  name: string;
  kg: number;
  carriedKg?: number;
  baseSalary: number;
  meatKg?: number;
  meatSales?: number;
  meatBonus?: number;
  meatTiers?: Array<{ sales: number; label: string }>;
  boneKg?: number;
  boneBonus?: number;
  chickCount?: number;
  chickBonus?: number;
  carriedSideBonus?: number;
  periodLabel?: string;
  now?: Date;
}

const useBoard = (props: BonusVariantProps) => buildModeratorBonusBoard(props);

const Frame = ({
  name,
  periodLabel,
  variant,
  children,
}: {
  name: string;
  periodLabel?: string;
  variant: string;
  children: ReactNode;
}) => (
  <article
    dir="rtl"
    data-testid="moderator-bonus-card"
    data-variant={variant}
    className="bg-white text-[#3A1238] shadow-lg"
    style={{ borderRadius: 21, fontFamily: 'Cairo, sans-serif' }}
    aria-label={`بونص ${name}`}
  >
    <header
      className="flex items-center justify-between text-white"
      style={{ background: PURPLE, padding: 21, gap: 13, minHeight: 89 }}
    >
      <div className="min-w-0 flex-1">
        <p className="m-0 font-medium text-white/80" style={{ fontSize: 13, lineHeight: 1.45 }}>بونص الشهر</p>
        <h2 className="m-0 font-extrabold" style={{ fontSize: 26, lineHeight: 1.45, marginTop: 4 }}>{name}</h2>
        {periodLabel && (
          <p className="m-0 text-white/90" style={{ fontSize: 16, lineHeight: 1.45, marginTop: 4 }}>{periodLabel}</p>
        )}
      </div>
      <img src={companyLogo} alt="" className="shrink-0 rounded-full bg-white object-contain" style={{ width: 55, height: 55, padding: 4 }} />
    </header>
    <div style={{ padding: 21, display: 'flex', flexDirection: 'column', gap: 21 }}>{children}</div>
  </article>
);

const Carried = ({ kg }: { kg: number }) => (
  kg > 0 ? (
    <p className="m-0 text-center" style={{ fontSize: 16, lineHeight: 1.6, color: PURPLE }}>
      {carriedProcessedPhrase(kg)}
    </p>
  ) : null
);

const Totals = ({ board }: { board: ModeratorBonusBoard }) => (
  <div className="grid grid-cols-2" style={{ gap: 13 }}>
    <div style={{ background: '#F6ECF4', borderRadius: 13, padding: 13 }}>
      <p className="m-0" style={{ fontSize: 13, lineHeight: 1.45, color: PURPLE }}>إجمالي البونص</p>
      <p className="m-0 font-extrabold tabular-nums" style={{ fontSize: 26, lineHeight: 1.35 }}>{formatBonusEgp(board.totalBonus)}</p>
      <p className="m-0" style={{ fontSize: 13, lineHeight: 1.45 }}>جنيه</p>
    </div>
    <div style={{ background: '#FDE4D8', borderRadius: 13, padding: 13 }}>
      <p className="m-0" style={{ fontSize: 13, lineHeight: 1.45, color: '#9A3B22' }}>المرتب المتوقع</p>
      <p className="m-0 font-extrabold tabular-nums" style={{ fontSize: 26, lineHeight: 1.35 }}>{formatBonusEgp(board.salary)}</p>
      <p className="m-0" style={{ fontSize: 13, lineHeight: 1.45 }}>أساسي {formatBonusEgp(board.baseSalary)}</p>
    </div>
  </div>
);

const Days = ({ phrase }: { phrase: string }) => (
  <div className="text-center font-bold" style={{ borderRadius: 13, background: '#FFF6F1', color: ORANGE, padding: '13px 16px', fontSize: 16, lineHeight: 1.45 }}>
    {phrase}
  </div>
);

const Message = ({ text }: { text: string }) => (
  <p className="m-0" style={{ borderRadius: 13, background: '#FBF7FA', borderRight: `4px solid ${ORANGE}`, padding: '13px 16px', fontSize: 16, lineHeight: 1.7 }}>
    {text}
  </p>
);

const Bar = ({ lane }: { lane: BonusLane }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
    <div className="flex items-baseline justify-between" style={{ gap: 8 }}>
      <span className="font-extrabold" style={{ color: PURPLE, fontSize: 16 }}>{lane.title}</span>
      <span className="font-bold tabular-nums" style={{ color: ORANGE, fontSize: 13 }}>
        {lane.id === 'chicks' ? formatBonusEgp(lane.quantity) : formatBonusKg(lane.quantity)} {lane.unit} · {formatBonusEgp(lane.bonus)} ج
      </span>
    </div>
    <div style={{ height: 8, borderRadius: 8, background: '#F3D5E8', overflow: 'hidden' }}>
      <div style={{ width: `${Math.round(lane.progress * 100)}%`, height: '100%', background: ORANGE, borderRadius: 8 }} />
    </div>
    {lane.nextHint && <p className="m-0" style={{ fontSize: 13, lineHeight: 1.45 }}>{lane.nextHint}</p>}
  </div>
);

/** ب: عداد كبير للمصنّعات، وسلّم محطات عمودي، وأشرطة صغيرة للباقي. */
export const BonusLayoutB = (props: BonusVariantProps) => {
  const board = useBoard(props);
  const view = board.processed;
  const ring = 70;
  const circ = 2 * Math.PI * ring;
  const climb = [...BONUS_MILESTONES].reverse();
  return (
    <Frame name={props.name} periodLabel={props.periodLabel} variant="b">
      <div style={{ display: 'grid', gridTemplateColumns: '1.618fr 1fr', gap: 13, alignItems: 'center' }}>
        <svg viewBox="0 0 180 180" className="h-auto w-full" role="img" aria-label={`${formatBonusKg(view.kg)} كيلوجرام مصنّعات`}>
          <circle cx="90" cy="90" r={ring} fill="none" stroke="#F3D5E8" strokeWidth="12" />
          <circle
            cx="90"
            cy="90"
            r={ring}
            fill="none"
            stroke={ORANGE}
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={circ * (1 - view.segmentProgress)}
            transform="rotate(-90 90 90)"
          />
          <text x="90" y="78" textAnchor="middle" fill={PURPLE} fontSize="12" fontWeight="700">مصنّعات</text>
          <text x="90" y="104" textAnchor="middle" fill={INK} fontSize="28" fontWeight="800">{formatBonusKg(view.kg)}</text>
          <text x="90" y="124" textAnchor="middle" fill={ORANGE} fontSize="12" fontWeight="700">{formatBonusEgp(view.bonus)} ج</text>
        </svg>
        <ol className="m-0 list-none p-0" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {climb.map((step) => {
            const done = view.kg >= step.kg;
            const current = view.nextMilestoneKg === step.kg;
            return (
              <li key={step.kg} className="flex items-center" style={{ gap: 8 }}>
                <span style={{ width: 13, height: 13, borderRadius: 13, background: done ? PURPLE : current ? ORANGE : '#F3D5E8', flex: '0 0 auto' }} />
                <span className="font-extrabold" style={{ fontSize: 13, lineHeight: 1.45, color: done ? PURPLE : INK }}>{step.title}</span>
                <span style={{ fontSize: 11, lineHeight: 1.45, color: '#7A5A78' }}>{done ? 'اتحقق' : current ? 'جاي' : ''}</span>
              </li>
            );
          })}
        </ol>
      </div>
      <Carried kg={view.carriedKg} />
      {board.lanes.filter((lane) => lane.id !== 'processed').map((lane) => <Bar key={lane.id} lane={lane} />)}
      <Totals board={board} />
      <Days phrase={board.daysPhrase} />
      <Message text={board.message} />
    </Frame>
  );
};

/** ج: طريق أفقي بمحطات، والصورة بتتحرك مع كيلو المصنّعات. */
export const BonusLayoutC = (props: BonusVariantProps) => {
  const board = useBoard(props);
  const view = board.processed;
  const progress = Math.max(0, Math.min(1, view.kg / 2000));
  const stops = BONUS_MILESTONES.map((step) => step.kg);
  return (
    <Frame name={props.name} periodLabel={props.periodLabel} variant="c">
      <div>
        <p className="m-0 font-extrabold" style={{ color: PURPLE, fontSize: 16, lineHeight: 1.45 }}>طريق المصنّعات</p>
        <p className="m-0" style={{ fontSize: 13, lineHeight: 1.45, marginTop: 4 }}>{formatBonusKg(view.kg)} كجم · بونص {formatBonusEgp(view.bonus)} جنيه</p>
        <div className="relative" style={{ height: 92, marginTop: 13 }}>
          <div style={{ position: 'absolute', top: 28, right: 18, left: 18, height: 8, borderRadius: 8, background: '#F3D5E8' }} />
          <div style={{ position: 'absolute', top: 28, right: 18, height: 8, borderRadius: 8, background: ORANGE, width: `calc((100% - 36px) * ${progress})` }} />
          {stops.map((kg) => {
            const title = BONUS_MILESTONES.find((step) => step.kg === kg)?.title ?? 'البداية';
            const done = view.kg >= kg;
            return (
              <div key={kg} style={{ position: 'absolute', top: 18, right: `calc(18px + (100% - 36px) * ${kg / 2000})`, transform: 'translateX(50%)', textAlign: 'center', width: 46 }}>
                <span style={{ display: 'block', width: 13, height: 13, margin: '8px auto 0', borderRadius: 13, background: done ? PURPLE : '#fff', border: `3px solid ${done ? PURPLE : ORANGE}` }} />
                <span className="font-bold" style={{ display: 'block', fontSize: 11, lineHeight: 1.35, marginTop: 6 }}>{title}</span>
              </div>
            );
          })}
          <div
            aria-hidden
            style={{
              position: 'absolute',
              top: 0,
              right: `calc(18px + (100% - 36px) * ${progress})`,
              transform: 'translateX(50%)',
              width: 34,
              height: 34,
              borderRadius: 34,
              background: PURPLE,
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 800,
              fontSize: 16,
              boxShadow: '0 4px 10px rgba(164,40,138,.35)',
            }}
          >
            {props.name.trim().slice(0, 1) || 'أ'}
          </div>
        </div>
      </div>
      <Carried kg={view.carriedKg} />
      <div className="grid grid-cols-2" style={{ gap: 13 }}>
        {board.lanes.map((lane) => (
          <div key={lane.id} style={{ background: '#FBF7FA', borderRadius: 13, padding: 13 }}>
            <p className="m-0 font-extrabold" style={{ color: PURPLE, fontSize: 13, lineHeight: 1.45 }}>{lane.title}</p>
            <p className="m-0 font-extrabold tabular-nums" style={{ fontSize: 21, lineHeight: 1.35, marginTop: 4 }}>
              {lane.id === 'chicks' ? formatBonusEgp(lane.quantity) : formatBonusKg(lane.quantity)}
              <span style={{ fontSize: 13, fontWeight: 700 }}> {lane.unit}</span>
            </p>
            <p className="m-0" style={{ color: ORANGE, fontSize: 13, lineHeight: 1.45 }}>{formatBonusEgp(lane.bonus)} جنيه</p>
          </div>
        ))}
      </div>
      <Totals board={board} />
      <Days phrase={board.daysPhrase} />
      <Message text={board.message} />
    </Frame>
  );
};

/** د: مربعات بشريط تقدم، وإجمالي البونص والمرتب في المقدمة. */
export const BonusLayoutD = (props: BonusVariantProps) => {
  const board = useBoard(props);
  return (
    <Frame name={props.name} periodLabel={props.periodLabel} variant="d">
      <div style={{ background: PURPLE, color: 'white', borderRadius: 21, padding: 21, textAlign: 'center' }}>
        <p className="m-0" style={{ fontSize: 13, lineHeight: 1.45, opacity: 0.85 }}>إجمالي البونص</p>
        <p className="m-0 font-extrabold tabular-nums" style={{ fontSize: 42, lineHeight: 1.2 }}>{formatBonusEgp(board.totalBonus)}</p>
        <p className="m-0" style={{ fontSize: 16, lineHeight: 1.45 }}>جنيه</p>
        <p className="m-0 font-bold" style={{ fontSize: 16, lineHeight: 1.45, marginTop: 8, color: '#FDE4D8' }}>
          المرتب المتوقع {formatBonusEgp(board.salary)} · أساسي {formatBonusEgp(board.baseSalary)}
        </p>
      </div>
      <Days phrase={board.daysPhrase} />
      <Message text={board.message} />
      <Carried kg={board.processed.carriedKg} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
        {board.lanes.map((lane) => (
          <div key={lane.id} style={{ background: '#FBF7FA', borderRadius: 13, padding: 13 }}>
            <Bar lane={lane} />
          </div>
        ))}
      </div>
    </Frame>
  );
};
