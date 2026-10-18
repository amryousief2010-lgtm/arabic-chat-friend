import { useEffect, useState } from 'react';
import {
  APPROVED_OCT_2026_SCHEDULE,
  type MarginalSchedule,
  buildGauge,
  buildKgCounterView,
  completedFiniteBands,
  formatEgp,
  formatKg,
} from '@/lib/processedKgBonus';

const arc = (cx: number, cy: number, r: number, start: number, end: number) => {
  if (end - start < 0.4) return '';
  const polar = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  };
  const [x1, y1] = polar(start);
  const [x2, y2] = polar(end);
  const large = end - start > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
};

const markerPoint = (deg: number) => {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: 150 + 124 * Math.cos(rad), y: 150 + 124 * Math.sin(rad) };
};

export interface ModeratorKgCounterCardProps {
  name: string;
  kg: number;
  baseSalary: number;
  carriedBonus?: number;
  meatBonus?: number;
  boneBonus?: number;
  processedBonusOverride?: number | null;
  schedule?: MarginalSchedule;
  now?: Date;
  celebrate?: boolean;
  storageKey?: string;
  forceCelebration?: boolean;
  frozen?: boolean;
}

const ModeratorKgCounterCard = ({
  name,
  kg,
  baseSalary,
  carriedBonus = 0,
  meatBonus = 0,
  boneBonus = 0,
  processedBonusOverride = null,
  schedule = APPROVED_OCT_2026_SCHEDULE,
  now,
  celebrate = false,
  storageKey,
  forceCelebration = false,
  frozen = false,
}: ModeratorKgCounterCardProps) => {
  const view = buildKgCounterView({
    name,
    kg,
    baseSalary,
    carriedBonus,
    meatBonus,
    boneBonus,
    processedBonusOverride,
    schedule,
    now,
    frozen,
  });
  const gauge = buildGauge(view.kg, schedule);
  const [burst, setBurst] = useState(forceCelebration);

  useEffect(() => {
    if (!celebrate || forceCelebration) return;
    const completed = completedFiniteBands(view.kg, schedule.bands);
    const key = `coceg-processed-band:${storageKey || name}`;
    const previous = Number(window.localStorage.getItem(key));
    if (Number.isFinite(previous) && completed > previous) setBurst(true);
    window.localStorage.setItem(key, String(completed));
  }, [celebrate, forceCelebration, name, schedule.bands, storageKey, view.kg]);

  useEffect(() => {
    if (!burst) return;
    const timer = window.setTimeout(() => setBurst(false), 4200);
    return () => window.clearTimeout(timer);
  }, [burst]);

  const activeBand = schedule.bands[view.activeIndex];
  const span = activeBand?.toKg == null ? null : activeBand.toKg - activeBand.fromKg;
  const intoBand = activeBand ? Math.max(0, view.kg - activeBand.fromKg) : 0;
  const bar = !view.qualified
    ? Math.max(0, Math.min(1, view.kg / Math.max(1, view.minimumKg)))
    : span
      ? Math.max(0, Math.min(1, intoBand / span))
      : 1;
  const goalText = !view.qualified
    ? `باقي ${formatKg(view.kgToMinimum)} كجم على الحد الأدنى للحافز`
    : view.kgToNext == null
      ? 'وصلتِ لأعلى شريحة'
      : `باقي ${formatKg(view.kgToNext)} كجم على الشريحة التالية`;
  const chip = view.status === 'top_band'
    ? 'أعلى شريحة'
    : view.status === 'on_fire'
      ? 'وتيرة قوية'
      : view.onTrack
        ? 'على المسار'
        : 'أبطأ من المطلوب';
  const chipHot = view.onTrack || view.status === 'top_band';

  return (
    <section
      dir="rtl"
      className="relative overflow-hidden rounded-3xl text-white shadow-xl"
      style={{ background: 'linear-gradient(165deg, #4B2364 0%, #321546 58%, #1C0E28 100%)' }}
      aria-label={`عداد كيلو المصنّعات لـ ${name}`}
    >
      <div className="pointer-events-none absolute -left-8 -top-10 h-32 w-32 rounded-full bg-[#E8C547]/20 blur-2xl" />
      <div className="pointer-events-none absolute -bottom-12 -right-8 h-36 w-36 rounded-full bg-[#F6E7B2]/10 blur-2xl" />
      {burst && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
          {Array.from({ length: 18 }).map((_, index) => (
            <span
              key={index}
              className="absolute top-4 h-2 w-2 rounded-sm"
              style={{
                right: `${8 + (index * 17) % 84}%`,
                background: index % 2 ? '#E8C547' : '#FFF6D4',
                animation: `kg-confetti 1.1s ease-out ${index * 0.04}s both`,
              }}
            />
          ))}
          <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-[#E8C547] px-3 py-1 text-xs font-bold text-[#3A1D4E]">
            شريحة جديدة
          </div>
        </div>
      )}
      <style>{`@keyframes kg-confetti { from { transform: translateY(0) rotate(0deg); opacity: 1 } to { transform: translateY(92px) rotate(180deg); opacity: 0 } } @media (prefers-reduced-motion: reduce) { span { animation: none !important } }`}</style>

      <div className="relative space-y-4 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-[#F6E7B2]">حافز المصنّعات · هذا الشهر</p>
            <h2 className="text-2xl font-extrabold leading-tight">{name}</h2>
          </div>
          <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${chipHot ? 'bg-[#E8C547] text-[#3A1D4E]' : 'bg-white/15 text-[#F6E7B2]'}`}>
            {chip}
          </span>
        </div>

        <div className="mx-auto w-full max-w-[280px]">
          <svg viewBox="0 0 300 300" className="h-auto w-full" role="img" aria-label={`${formatKg(view.kg)} كجم، الشريحة ${view.bandLabel}`} style={{ fontFamily: 'Cairo, "Noto Naskh Arabic", sans-serif' }}>
            {gauge.segments.map((segment) => (
              <g key={segment.index}>
                <path d={arc(150, 150, 96, segment.startDeg, segment.endDeg)} fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth={segment.active ? 20 : 16} strokeLinecap="butt" />
                <path d={arc(150, 150, 96, segment.startDeg, segment.filledDeg)} fill="none" stroke={segment.color} strokeWidth={segment.active ? 20 : 16} strokeLinecap="butt" />
              </g>
            ))}
            {gauge.markers.map((marker) => {
              const point = markerPoint(marker.deg);
              return (
                <g key={marker.kg}>
                  <circle cx={point.x} cy={point.y} r="3.5" fill="#E8C547" />
                  <text x={point.x} y={point.y - 8} textAnchor="middle" fill="#F6E7B2" fontSize="11" fontWeight="700">
                    {marker.label}
                  </text>
                </g>
              );
            })}
            <text x="150" y="142" textAnchor="middle" fill="#F6E7B2" fontSize="13">المصنّعات</text>
            <text x="150" y="176" textAnchor="middle" fill="#FFFFFF" fontSize="40" fontWeight="800">{formatKg(view.kg)}</text>
            <text x="150" y="198" textAnchor="middle" fill="#E8C547" fontSize="14" fontWeight="700">كجم</text>
          </svg>
        </div>

        <div className="text-center">
          <p className="text-sm text-[#F6E7B2]">
            {view.qualified ? `الشريحة الحالية ${view.bandLabel} · ${formatKg(view.bandRate)} ج/كجم` : `قبل الحد الأدنى ${formatKg(view.minimumKg, true)} كجم`}
          </p>
          <p className="mt-1 text-base font-bold">{goalText}</p>
        </div>

        <div className="h-2.5 overflow-hidden rounded-full bg-white/15">
          <div className="h-full rounded-full bg-[#E8C547]" style={{ width: `${Math.round(bar * 100)}%` }} />
        </div>

        <div className="flex flex-wrap justify-center gap-1.5">
          {schedule.bands.map((band, index) => (
            <span
              key={`${band.fromKg}-${band.rate}`}
              className={`rounded-full px-2 py-0.5 text-[11px] ${index === view.activeIndex ? 'bg-[#E8C547] font-bold text-[#3A1D4E]' : 'bg-white/10 text-[#F6E7B2]'}`}
            >
              {band.toKg == null ? `+${formatKg(band.fromKg, true)}` : formatKg(band.toKg, true)} · {formatKg(band.rate)} ج
            </span>
          ))}
        </div>

        <div className="rounded-2xl bg-white/10 px-3 py-2 text-center text-sm">
          <span className="font-bold text-[#E8C547]">{view.daysPhrase}</span>
        </div>

        {!frozen && (
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-2xl bg-white/10 p-3">
              <p className="text-[11px] text-[#F6E7B2]">معدّلك اليومي</p>
              <p className="text-2xl font-extrabold tabular-nums">{formatKg(view.avgPerDay)}</p>
              <p className="text-[11px] text-white/80">كجم / يوم</p>
            </div>
            <div className="rounded-2xl bg-white/10 p-3">
              <p className="text-[11px] text-[#F6E7B2]">{view.kgToNext == null ? 'لا شريحة تالية' : 'المطلوب يوميًا'}</p>
              <p className="text-2xl font-extrabold tabular-nums">{view.kgToNext == null ? '—' : formatKg(view.requiredPerDay)}</p>
              <p className="text-[11px] text-white/80">{view.kgToNext == null ? 'أعلى سعر' : 'كجم / يوم للهدف القادم'}</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-2xl bg-[#E8C547]/15 p-3">
            <p className="text-[11px] text-[#F6E7B2]">حافز المصنّعات حتى الآن</p>
            <p className="text-2xl font-extrabold tabular-nums">{formatEgp(view.processedBonus)}</p>
            <p className="text-[11px]">جنيه</p>
          </div>
          <div className="rounded-2xl bg-[#E8C547]/15 p-3">
            <p className="text-[11px] text-[#F6E7B2]">{view.qualified ? 'زيادة الشريحة التالية' : 'حافز الحد الأدنى'}</p>
            <p className="text-2xl font-extrabold tabular-nums">{view.kgToNext == null ? '—' : formatEgp(view.extraToNext)}</p>
            <p className="text-[11px]">{view.kgToNext == null ? 'كل كيلو بأعلى سعر' : 'جنيه عند بلوغها'}</p>
          </div>
        </div>

        <div className="space-y-1 rounded-2xl bg-black/20 p-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span>المرتب حتى الآن</span>
            <span className="text-xl font-extrabold tabular-nums">{formatEgp(view.salarySoFar)} ج</span>
          </div>
          <p className="text-[11px] leading-5 text-white/75">
            أساسي {formatEgp(baseSalary)} + مصنّعات {formatEgp(view.processedBonus)}
            {carriedBonus ? ` + مرحّل ${formatEgp(carriedBonus)}` : ''}
            {meatBonus ? ` + لحوم ${formatEgp(meatBonus)}` : ''}
            {boneBonus ? ` + عظم ${formatEgp(boneBonus)}` : ''}
          </p>
          {!frozen && (
            <>
              <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-2">
                <span>المتوقع آخر الشهر</span>
                <span className="text-lg font-extrabold tabular-nums text-[#E8C547]">{formatEgp(view.projectedSalary)} ج</span>
              </div>
              <p className="text-[11px] leading-5 text-white/75">
                على وتيرتك الحالية: {formatKg(Math.round(view.projectedKg))} كجم مصنّعات، وحافزها {formatEgp(view.projectedProcessedBonus)} ج. اللحوم والعظم والمرحّل كما هما اليوم.
              </p>
            </>
          )}
        </div>

        <p className="rounded-2xl border border-[#E8C547]/40 bg-[#E8C547]/10 px-3 py-3 text-sm leading-7">
          {view.message}
        </p>
      </div>
    </section>
  );
};

export default ModeratorKgCounterCard;
