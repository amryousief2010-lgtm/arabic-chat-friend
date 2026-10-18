import { toCairoDateString } from '@/lib/cairoDate';

/**
 * حافز المصنّعات التراكمي (حدّي): كل كيلو يُسعَّر بشريحته من أول كيلو،
 * بشرط بلوغ الحد الأدنى. قبل سريان أول جدول يبقى الحساب القديم (تارجت قيمة واحدة لكل الكيلو).
 */

export interface BonusBand {
  fromKg: number;
  /** نهاية حصرية. null = شريحة مفتوحة. */
  toKg: number | null;
  rate: number;
}

export interface MarginalSchedule {
  id?: string;
  /** أول يوم في شهر السريان، YYYY-MM-DD. */
  effectiveFrom: string;
  minimumKg: number;
  bands: BonusBand[];
}

export interface BandSlice extends BonusBand {
  kg: number;
  amount: number;
}

export const MARGINAL_SCHEME_START = '2026-10-01';

export const APPROVED_OCT_2026_SCHEDULE: MarginalSchedule = {
  effectiveFrom: MARGINAL_SCHEME_START,
  minimumKg: 400,
  bands: [
    { fromKg: 0, toKg: 400, rate: 4 },
    { fromKg: 400, toKg: 750, rate: 6 },
    { fromKg: 750, toKg: 1000, rate: 8 },
    { fromKg: 1000, toKg: 1500, rate: 10 },
    { fromKg: 1500, toKg: 2000, rate: 12 },
    { fromKg: 2000, toKg: null, rate: 14 },
  ],
};

export const monthKey = (year: number, month: number) =>
  `${year}-${String(month).padStart(2, '0')}-01`;

export const scheduleForMonth = (
  schedules: MarginalSchedule[],
  year: number,
  month: number,
): MarginalSchedule | null => {
  const key = monthKey(year, month);
  let best: MarginalSchedule | null = null;
  for (const schedule of schedules) {
    if (schedule.effectiveFrom <= key && (!best || schedule.effectiveFrom > best.effectiveFrom)) {
      best = schedule;
    }
  }
  return best;
};

const clampKg = (kg: number) => (Number.isFinite(kg) && kg > 0 ? kg : 0);

/**
 * qualifyingKg = كل كيلوات الشهر المحسوبة للحد الأدنى (كيلوات الشهر + المرحّل من شهر معتمد).
 * قرار 19 أكتوبر 2026: أوردرات الشهر السابق المسلّمة بعد اعتماد قبضه تُضاف لكيلوات الشهر الحالي
 * وتدخل في الحد الأدنى وفي الشرائح.
 */
export const meetsProcessedMinimum = (kg: number, schedule: MarginalSchedule) =>
  clampKg(kg) >= schedule.minimumKg;

/** حافز الشرائح بدون شرط الحد الأدنى. يُستخدم لتقسيم المبلغ بين كيلوات الشهر والمرحّل. */
export const rawMarginalBonus = (kg: number, schedule: MarginalSchedule) => {
  const qty = clampKg(kg);
  return [...schedule.bands]
    .sort((a, b) => a.fromKg - b.fromKg)
    .reduce((sum, band) => {
      const end = band.toKg ?? Number.POSITIVE_INFINITY;
      return sum + Math.max(0, Math.min(qty, end) - band.fromKg) * band.rate;
    }, 0);
};

export const marginalBreakdown = (
  kg: number,
  schedule: MarginalSchedule,
  qualifyingKg: number = kg,
): BandSlice[] => {
  const qty = clampKg(kg);
  const qualified = meetsProcessedMinimum(qualifyingKg, schedule);
  const bands = [...schedule.bands].sort((a, b) => a.fromKg - b.fromKg);
  return bands.map((band) => {
    if (!qualified) return { ...band, kg: 0, amount: 0 };
    const end = band.toKg ?? Number.POSITIVE_INFINITY;
    const inBand = Math.max(0, Math.min(qty, end) - band.fromKg);
    return { ...band, kg: inBand, amount: inBand * band.rate };
  });
};

export const marginalProcessedBonus = (kg: number, schedule: MarginalSchedule) =>
  marginalBreakdown(kg, schedule).reduce((sum, slice) => sum + slice.amount, 0);

/**
 * زيادة الحافز لكميات فوق رصيد قائم. الحد الأدنى يُقاس على الإجمالي (الرصيد + الإضافة)،
 * فلو الإجمالي بلغ الحد تُسعَّر الإضافة بشرائحها فوق الرصيد.
 */
export const marginalIncrement = (startKg: number, addKg: number, schedule: MarginalSchedule) => {
  const add = clampKg(addKg);
  if (add <= 0) return 0;
  const start = clampKg(startKg);
  if (!meetsProcessedMinimum(start + add, schedule)) return 0;
  return rawMarginalBonus(start + add, schedule) - rawMarginalBonus(start, schedule);
};

export const salaryWithProcessedBonus = (
  kg: number,
  baseSalary: number,
  schedule: MarginalSchedule = APPROVED_OCT_2026_SCHEDULE,
) => baseSalary + marginalProcessedBonus(kg, schedule);

export interface FlatTier {
  sales: number;
  bonus: number;
  label: string;
}

export const findSalesTier = (sales: number, tiers: FlatTier[]) => {
  let achieved: FlatTier | null = null;
  for (const tier of tiers) {
    if (sales >= tier.sales) achieved = tier;
  }
  return achieved;
};

export const activeBandIndex = (kg: number, bands: BonusBand[]) => {
  const qty = clampKg(kg);
  const ordered = [...bands].sort((a, b) => a.fromKg - b.fromKg);
  if (ordered.length === 0) return 0;
  for (let i = 0; i < ordered.length; i++) {
    const end = ordered[i].toKg;
    if (end == null || qty < end) return i;
  }
  return ordered.length - 1;
};

export const completedFiniteBands = (kg: number, bands: BonusBand[]) =>
  bands.filter((band) => band.toKg != null && clampKg(kg) >= band.toKg).length;

const visualOpenSpan = (bands: BonusBand[]) => {
  const widths = bands
    .filter((band) => band.toKg != null)
    .map((band) => (band.toKg as number) - band.fromKg)
    .filter((width) => width > 0);
  return widths.length ? widths[widths.length - 1] : 500;
};

export interface GaugeSegment {
  index: number;
  fromKg: number;
  toKg: number | null;
  rate: number;
  startDeg: number;
  endDeg: number;
  filledDeg: number;
  active: boolean;
  complete: boolean;
  color: string;
}

export interface GaugeMarker {
  kg: number;
  deg: number;
  label: string;
}

const GAUGE_COLORS = ['#F3E2A8', '#E8C872', '#F0C14A', '#C9A24A', '#F6E7B2', '#FFF6D4'];

export const buildGauge = (kg: number, schedule: MarginalSchedule) => {
  const qty = clampKg(kg);
  const bands = [...schedule.bands].sort((a, b) => a.fromKg - b.fromKg);
  const openSpan = visualOpenSpan(bands);
  const spans = bands.map((band) => (band.toKg == null ? openSpan : Math.max(0, band.toKg - band.fromKg)));
  const visualMax = spans.reduce((sum, span) => sum + span, 0) || 1;
  const gap = 2.2;
  let cursor = 0;
  const active = activeBandIndex(qty, bands);
  const segments: GaugeSegment[] = bands.map((band, index) => {
    const sweep = (spans[index] / visualMax) * 360;
    const startDeg = cursor + gap / 2;
    const endDeg = cursor + sweep - gap / 2;
    cursor += sweep;
    const spanKg = spans[index] || 1;
    const filledKg = band.toKg == null
      ? Math.max(0, Math.min(spanKg, qty - band.fromKg))
      : Math.max(0, Math.min(spanKg, qty - band.fromKg));
    const frac = band.toKg != null && qty >= band.toKg ? 1 : Math.max(0, Math.min(1, filledKg / spanKg));
    const safeEnd = Math.max(startDeg + 0.01, endDeg);
    return {
      index,
      fromKg: band.fromKg,
      toKg: band.toKg,
      rate: band.rate,
      startDeg,
      endDeg: safeEnd,
      filledDeg: startDeg + (safeEnd - startDeg) * frac,
      active: index === active,
      complete: band.toKg != null && qty >= band.toKg,
      color: GAUGE_COLORS[index % GAUGE_COLORS.length],
    };
  });
  const markers: GaugeMarker[] = [];
  let walked = 0;
  bands.forEach((band, index) => {
    walked += spans[index];
    if (band.toKg == null) return;
    markers.push({
      kg: band.toKg,
      deg: (walked / visualMax) * 360,
      label: formatKg(band.toKg, true),
    });
  });
  return { segments, markers, visualMax, activeIndex: active };
};

export const formatKg = (n: number, compact = false) => {
  const value = Math.round(n * 10) / 10;
  const digits = Number.isInteger(value) ? 0 : 1;
  return value.toLocaleString('en-US', {
    minimumFractionDigits: compact ? 0 : digits,
    maximumFractionDigits: digits,
  });
};

export const formatEgp = (n: number) => Math.round(n).toLocaleString('en-US');

export const formatRate = (n: number) => {
  const value = Math.round(n * 100) / 100;
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
};

export interface CairoMonthPace {
  year: number;
  month: number;
  dayOfMonth: number;
  daysInMonth: number;
  /** الأيام بعد اليوم حتى آخر الشهر. */
  daysRemainingAfterToday: number;
  /** الأيام التي ما زال البيع فيها ممكنًا، بما فيها اليوم. */
  sellingDaysLeft: number;
}

export const cairoMonthPace = (now: Date = new Date()): CairoMonthPace => {
  const [year, month, dayOfMonth] = toCairoDateString(now).split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const daysRemainingAfterToday = Math.max(0, daysInMonth - dayOfMonth);
  return {
    year,
    month,
    dayOfMonth,
    daysInMonth,
    daysRemainingAfterToday,
    sellingDaysLeft: daysRemainingAfterToday + 1,
  };
};

export const arabicDaysRemainingPhrase = (daysAfterToday: number) => {
  if (daysAfterToday <= 0) return 'هذا آخر يوم في الشهر';
  if (daysAfterToday === 1) return 'باقي يوم واحد على نهاية الشهر';
  if (daysAfterToday === 2) return 'باقي يومان على نهاية الشهر';
  if (daysAfterToday >= 3 && daysAfterToday <= 10) return `باقي ${daysAfterToday} أيام على نهاية الشهر`;
  return `باقي ${daysAfterToday} يومًا على نهاية الشهر`;
};

export type CounterStatus =
  | 'below_far'
  | 'below_close'
  | 'below_month_end'
  | 'on_track'
  | 'close_to_next'
  | 'on_fire'
  | 'behind'
  | 'behind_month_end'
  | 'top_band';

export interface KgCounterView {
  /** إجمالي الكيلوات المحسوبة = كيلوات الشهر + المرحّل. */
  kg: number;
  ownKg: number;
  carriedKg: number;
  /** جزء حافز المصنّعات الناتج عن الكيلوات المرحّلة (داخل processedBonus). */
  carriedProcessedBonus: number;
  processedBonus: number;
  calculatedProcessedBonus: number;
  bandLabel: string;
  bandRate: number;
  kgToNext: number | null;
  nextRate: number | null;
  extraToNext: number;
  minimumKg: number;
  kgToMinimum: number;
  qualified: boolean;
  status: CounterStatus;
  onTrack: boolean;
  message: string;
  daysPhrase: string;
  daysRemainingAfterToday: number;
  sellingDaysLeft: number;
  avgPerDay: number;
  requiredPerDay: number;
  projectedKg: number;
  projectedProcessedBonus: number;
  salarySoFar: number;
  projectedSalary: number;
  goalLabel: string;
  activeIndex: number;
}

export const buildKgCounterView = (input: {
  name: string;
  /** كيلوات مصنّعات الشهر نفسه. */
  kg: number;
  /** كيلوات مصنّعات أوردرات شهر سابق سُلّمت بعد اعتماد قبضه. تُضاف للإجمالي والحد الأدنى والشرائح. */
  carriedKg?: number;
  schedule?: MarginalSchedule;
  baseSalary: number;
  /** مرحّل غير المصنّعات (لحوم/عظم) إن وُجد. المصنّعات المرحّلة تدخل عبر carriedKg. */
  carriedBonus?: number;
  meatBonus?: number;
  boneBonus?: number;
  processedBonusOverride?: number | null;
  now?: Date;
  /** شهر انتهى أو معتمد: لا وتيرة يومية، والمتوقع يساوي المحقق. */
  frozen?: boolean;
}): KgCounterView => {
  const schedule = input.schedule ?? APPROVED_OCT_2026_SCHEDULE;
  const ownKg = clampKg(input.kg);
  const carriedKg = clampKg(input.carriedKg ?? 0);
  const kg = ownKg + carriedKg;
  const bands = [...schedule.bands].sort((a, b) => a.fromKg - b.fromKg);
  const pace = cairoMonthPace(input.now ?? new Date());
  const breakdown = marginalBreakdown(kg, schedule);
  const calculatedProcessedBonus = breakdown.reduce((sum, slice) => sum + slice.amount, 0);
  const carriedProcessedBonus = marginalIncrement(ownKg, carriedKg, schedule);
  // التعديل اليدوي يخص كيلوات الشهر فقط، والمرحّل يُضاف فوقه بشرائحه.
  const processedBonus = input.processedBonusOverride != null
    ? input.processedBonusOverride + carriedProcessedBonus
    : calculatedProcessedBonus;
  const qualified = meetsProcessedMinimum(kg, schedule);
  const active = activeBandIndex(kg, bands);
  const band = bands[active];
  const bandLabel = !band
    ? '—'
    : band.toKg == null
      ? `أكثر من ${formatKg(band.fromKg, true)}`
      : `${formatKg(band.fromKg, true)}–${formatKg(band.toKg, true)}`;
  const nextEdge = !qualified ? schedule.minimumKg : band?.toKg ?? null;
  const kgToNext = nextEdge == null ? null : Math.max(0, nextEdge - kg);
  const nextBand = nextEdge == null ? null : bands.find((item) => item.fromKg === nextEdge) ?? null;
  const extraToNext = nextEdge == null
    ? 0
    : Math.max(0, marginalProcessedBonus(nextEdge, schedule) - calculatedProcessedBonus);
  const elapsed = Math.max(1, pace.dayOfMonth);
  // الوتيرة من كيلوات الشهر فقط، والمرحّل رصيد ثابت فوقها.
  const avgPerDay = input.frozen ? ownKg / Math.max(1, pace.daysInMonth) : ownKg / elapsed;
  const projectedKg = input.frozen ? kg : avgPerDay * pace.daysInMonth + carriedKg;
  const projectedProcessedBonus = marginalProcessedBonus(projectedKg, schedule);
  const meat = input.meatBonus ?? 0;
  const bone = input.boneBonus ?? 0;
  const carried = input.carriedBonus ?? 0;
  const salarySoFar = input.baseSalary + processedBonus + meat + bone + carried;
  const projectedSalary = input.baseSalary + projectedProcessedBonus + meat + bone + carried;
  const requiredPerDay = nextEdge == null || kgToNext == null
    ? 0
    : kgToNext / Math.max(1, pace.sellingDaysLeft);
  const onTrack = nextEdge == null || projectedKg + 1e-6 >= nextEdge;
  const monthEnd = pace.daysRemainingAfterToday <= 3;
  const top = qualified && band?.toKg == null;
  const closeNext = qualified && kgToNext != null && kgToNext > 0 && kgToNext <= 40;
  const closeMin = !qualified && (kg >= schedule.minimumKg * 0.75 || (schedule.minimumKg - kg) <= 40);
  const onFire = qualified && !top && !closeNext && requiredPerDay > 0 && avgPerDay >= requiredPerDay * 1.35 && onTrack;
  const behind = !top && nextEdge != null && !onTrack;

  let status: CounterStatus = 'on_track';
  if (top) status = 'top_band';
  else if (!qualified && monthEnd) status = 'below_month_end';
  else if (monthEnd && behind) status = 'behind_month_end';
  else if (closeNext) status = 'close_to_next';
  else if (onFire) status = 'on_fire';
  else if (!qualified && closeMin) status = 'below_close';
  else if (!qualified) status = 'below_far';
  else if (behind) status = 'behind';

  if (input.frozen) {
    if (top) status = 'top_band';
    else if (!qualified) status = 'below_far';
    else status = 'on_track';
  }

  const name = input.name.trim();
  const called = name ? `يا ${name}` : 'يا بطلة';
  const leftText = kgToNext == null ? '' : formatKg(kgToNext);
  const extraText = formatEgp(extraToNext);
  let message = `${called}، أنتِ على المسار.`;
  if (status === 'top_band') {
    message = `${called}، بلغتِ أعلى شريحة: ${formatRate(band?.rate ?? 0)} جنيه عن كل كيلوجرام إضافي. كل كيلو الآن بأعلى سعر، استمري.`;
  } else if (status === 'below_month_end') {
    message = `${called}، الشهر أوشك على الانتهاء وتبقّى ${leftText} كجم على الحد الأدنى للحافز. ما زال بإمكانك الوصول إليه.`;
  } else if (status === 'behind_month_end') {
    message = `${called}، تبقّى وقت قليل. تحتاجين نحو ${formatKg(requiredPerDay)} كجم يوميًا لتبلغي الشريحة التالية قبل نهاية الشهر.`;
  } else if (status === 'close_to_next') {
    message = `${called}، الشريحة التالية على بُعد ${leftText} كجم فقط. عند بلوغها يزيد حافزك ${extraText} جنيه.`;
  } else if (status === 'on_fire') {
    message = `${called}، أداؤك متقدّم على المعدّل المطلوب. استمري بهذه الوتيرة، فالشريحة التالية على بعد ${leftText} كجم وتزيد حافزك ${extraText} جنيه.`;
  } else if (status === 'below_close') {
    message = `${called}، اقتربتِ كثيرًا. تبقّى ${leftText} كجم فقط ويبدأ حافز المصنّعات.`;
  } else if (status === 'below_far') {
    message = `${called}، تبقّى ${leftText} كجم حتى الحد الأدنى للحافز. كل كيلوجرام يقرّبك من بداية المكافأة.`;
  } else if (status === 'behind') {
    message = `${called}، وتيرتك الحالية أبطأ من المطلوب. تحتاجين نحو ${formatKg(requiredPerDay)} كجم يوميًا لتبلغي الشريحة التالية.`;
  } else if (qualified) {
    message = `${called}، أنتِ الآن في شريحة ${formatRate(band?.rate ?? 0)} جنيه للكيلوجرام، ويتبقّى ${leftText} كجم للشريحة التالية.`;
  }

  const goalLabel = !qualified
    ? 'باقي على الحد الأدنى للحافز'
    : top
      ? 'أعلى شريحة'
      : 'باقي على الشريحة التالية';

  return {
    kg,
    ownKg,
    carriedKg,
    carriedProcessedBonus,
    processedBonus,
    calculatedProcessedBonus,
    bandLabel,
    bandRate: band?.rate ?? 0,
    kgToNext: top ? null : kgToNext,
    nextRate: nextBand?.rate ?? null,
    extraToNext,
    minimumKg: schedule.minimumKg,
    kgToMinimum: Math.max(0, schedule.minimumKg - kg),
    qualified,
    status,
    onTrack,
    message,
    daysPhrase: input.frozen ? 'شهر مكتمل' : arabicDaysRemainingPhrase(pace.daysRemainingAfterToday),
    daysRemainingAfterToday: pace.daysRemainingAfterToday,
    sellingDaysLeft: pace.sellingDaysLeft,
    avgPerDay,
    requiredPerDay,
    projectedKg,
    projectedProcessedBonus,
    salarySoFar,
    projectedSalary,
    goalLabel,
    activeIndex: active,
  };
};

export const validateScheduleDraft = (minimumKg: number, bands: BonusBand[]): string | null => {
  if (!Number.isFinite(minimumKg) || minimumKg < 0) return 'الحد الأدنى يجب أن يكون صفرًا أو أكثر.';
  if (bands.length < 1) return 'أضيفي شريحة واحدة على الأقل.';
  const ordered = [...bands].sort((a, b) => a.fromKg - b.fromKg);
  let prev = 0;
  for (let i = 0; i < ordered.length; i++) {
    const band = ordered[i];
    if (band.fromKg !== prev) return 'الشرائح يجب أن تتصل من الصفر بدون فجوات.';
    if (!Number.isFinite(band.rate) || band.rate < 0) return 'سعر الكيلو لا يمكن أن يكون سالبًا.';
    const last = i === ordered.length - 1;
    if (band.toKg == null) {
      if (!last) return 'الشريحة المفتوحة يجب أن تكون الأخيرة.';
      prev = Number.NaN;
    } else {
      if (!(band.toKg > band.fromKg)) return 'نهاية الشريحة يجب أن تكون أكبر من بدايتها.';
      prev = band.toKg;
    }
  }
  if (ordered[ordered.length - 1].toKg != null) return 'الشريحة الأخيرة يجب أن تكون مفتوحة.';
  return null;
};

export const bandsToJson = (bands: BonusBand[]) =>
  [...bands]
    .sort((a, b) => a.fromKg - b.fromKg)
    .map((band) => ({ from_kg: band.fromKg, to_kg: band.toKg, rate: band.rate }));

export const parseBands = (value: unknown): BonusBand[] | null => {
  if (!Array.isArray(value) || value.length === 0) return null;
  const bands: BonusBand[] = [];
  for (const row of value) {
    if (!row || typeof row !== 'object') return null;
    const rec = row as Record<string, unknown>;
    const fromKg = Number(rec.from_kg ?? rec.fromKg);
    const rate = Number(rec.rate ?? rec.rate_per_kg);
    const rawTo = rec.to_kg ?? rec.toKg;
    const toKg = rawTo == null || rawTo === '' ? null : Number(rawTo);
    if (!Number.isFinite(fromKg) || !Number.isFinite(rate)) return null;
    if (toKg != null && !Number.isFinite(toKg)) return null;
    bands.push({ fromKg, toKg, rate });
  }
  return validateScheduleDraft(0, bands) ? null : bands;
};

export const parseScheduleRow = (row: {
  id?: string;
  effective_from: string;
  minimum_kg: number;
  bands: unknown;
}): MarginalSchedule | null => {
  const bands = parseBands(row.bands);
  if (!bands) return null;
  const minimumKg = Number(row.minimum_kg);
  if (!Number.isFinite(minimumKg) || validateScheduleDraft(minimumKg, bands)) return null;
  return {
    id: row.id,
    effectiveFrom: String(row.effective_from).slice(0, 10),
    minimumKg,
    bands,
  };
};

export interface StoredBandBreakdown {
  scheme: 'marginal';
  minimum_kg: number;
  qualified: boolean;
  calculated_bonus: number;
  /** كيلوات مرحّلة دخلت في الحد الأدنى والشرائح (تُدفع في payroll_carried_orders). */
  carried_kg?: number;
  /** الإجمالي المحسوب للشرائح = كيلوات الشهر + المرحّل. */
  counted_kg?: number;
  bands: Array<{ from_kg: number; to_kg: number | null; rate: number; kg: number; amount: number }>;
}

export const toStoredBreakdown = (
  kg: number,
  schedule: MarginalSchedule,
  carriedKg = 0,
): StoredBandBreakdown => {
  const carried = clampKg(carriedKg);
  const counted = clampKg(kg) + carried;
  const slices = marginalBreakdown(kg, schedule, counted);
  return {
    scheme: 'marginal',
    minimum_kg: schedule.minimumKg,
    qualified: meetsProcessedMinimum(counted, schedule),
    calculated_bonus: slices.reduce((sum, slice) => sum + slice.amount, 0),
    carried_kg: carried,
    counted_kg: counted,
    bands: slices.map((slice) => ({
      from_kg: slice.fromKg,
      to_kg: slice.toKg,
      rate: slice.rate,
      kg: slice.kg,
      amount: slice.amount,
    })),
  };
};

export const slicesFromStored = (value: unknown): BandSlice[] | null => {
  if (!value || typeof value !== 'object') return null;
  const bands = (value as { bands?: unknown }).bands;
  if (!Array.isArray(bands)) return null;
  const slices: BandSlice[] = [];
  for (const row of bands) {
    if (!row || typeof row !== 'object') return null;
    const rec = row as Record<string, unknown>;
    const fromKg = Number(rec.from_kg);
    const rate = Number(rec.rate);
    const kg = Number(rec.kg);
    const amount = Number(rec.amount);
    const rawTo = rec.to_kg;
    const toKg = rawTo == null ? null : Number(rawTo);
    if (![fromKg, rate, kg, amount].every(Number.isFinite)) return null;
    if (toKg != null && !Number.isFinite(toKg)) return null;
    slices.push({ fromKg, toKg, rate, kg, amount });
  }
  return slices;
};
