import { arabicDaysRemainingPhrase, cairoMonthPace } from '@/lib/processedKgBonus';

/**
 * نظام بونص المسوقات المعتمد.
 * مصدر الحساب الوحيد للواجهة. نفس الأرقام في الدالة
 * public.moderator_kg_bonus حتى تبقى التقارير مطابقة.
 *
 * الكيلو المعدود هو كيلو المصنّعات المسلّم بنفس طريقة العدّ الحالية
 * (أوردرات الشهر + الكيلو المرحّل من شهر اتقيّد قبضه).
 * أقل من 400: صفر. عند 400 يفتح 2,400 جنيه.
 * من 401 إلى 1,000: مجموع حدّي، سعر الكيلو k يزيد خطيًا
 * 9 عند 400 → 12 عند 750 → 18 عند 1,000.
 * فوق 1,000: سعر حديّ متصل 10.5 عند 1,000 → 12.75 عند 1,500 → 14.25 عند 2,000
 * ثم 14.25 ثابت. الكسر = الكسر × سعر الكيلو التالي تحت 1,000،
 * وفوق 1,000 يدخل في المنحنى المتصل.
 */

const clampKg = (kg: number) => (Number.isFinite(kg) && kg > 0 ? kg : 0);

/** سعر الكيلو k في الشريحة الحدّية حتى الطن. k تُقيَّم عند رقم الكيلو نفسه. */
export const legacyRisingRate = (k: number): number => {
  if (k <= 750) return 9 + (3 * (k - 400)) / 350;
  return 12 + (6 * (k - 750)) / 250;
};

const discreteBonus = (kg: number): number => {
  const whole = Math.floor(kg);
  let sum = 2400;
  for (let k = 401; k <= whole; k += 1) sum += legacyRisingRate(k);
  const fraction = kg - whole;
  if (fraction > 0) sum += fraction * legacyRisingRate(whole + 1);
  return sum;
};

/** منحنى ما بعد الطن قبل نقله ليبدأ من بونص الألف كيلو. */
const continuousAfterTon = (kg: number): number => {
  if (kg <= 1500) {
    const d = kg - 1000;
    return 10500 + 10.5 * d + 0.00225 * d * d;
  }
  if (kg <= 2000) {
    const d = kg - 1500;
    return 16312.5 + 12.75 * d + 0.0015 * d * d;
  }
  return 23062.5 + 14.25 * (kg - 2000);
};

let bonusAtOneTon: number | null = null;
const bonusAt1000 = () => {
  if (bonusAtOneTon == null) bonusAtOneTon = discreteBonus(1000);
  return bonusAtOneTon;
};

/** بونص الشهر بالجنيه لكيلو معدود. صفر تحت 400. */
export const moderatorKgBonus = (kg: number): number => {
  const qty = clampKg(kg);
  if (qty < 400) return 0;
  if (qty <= 1000) return discreteBonus(qty);
  return continuousAfterTon(qty) - 10500 + bonusAt1000();
};

export const moderatorSalary = (kg: number, baseSalary: number) =>
  (Number.isFinite(baseSalary) ? baseSalary : 0) + moderatorKgBonus(kg);

export const RISING_MINIMUM_KG = 400;
export const BONUS_AT_MINIMUM = 2400;

export interface BonusMilestone {
  kg: number;
  title: string;
  /** اسم المحطة في جملة «فاضلِك على …». */
  goal: string;
}

export const BONUS_MILESTONES: BonusMilestone[] = [
  { kg: 400, title: '٤٠٠', goal: 'فتح البونص' },
  { kg: 1000, title: 'طن', goal: 'الطن' },
  { kg: 1500, title: 'طن ونص', goal: 'طن ونص' },
  { kg: 2000, title: '٢ طن', goal: 'الـ ٢ طن' },
];

export const formatBonusEgp = (n: number) => {
  const rounded = Math.round((Number.isFinite(n) ? n : 0) * 10) / 10;
  const digits = Number.isInteger(rounded) ? 0 : 1;
  return rounded.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: 1,
  });
};

export const formatBonusKg = (n: number) => {
  const rounded = Math.round((Number.isFinite(n) ? n : 0) * 10) / 10;
  const digits = Number.isInteger(rounded) ? 0 : 1;
  return rounded.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: 1,
  });
};

export interface RisingBreakdown {
  scheme: 'rising';
  minimum_kg: number;
  qualified: boolean;
  /** جزء كيلوات الشهر نفسه، قبل أي تعديل يدوي. */
  calculated_bonus: number;
  /** بونص الكيلو المعدود كله = الشهر + المرحّل. */
  total_bonus: number;
  carried_kg: number;
  counted_kg: number;
  own_kg: number;
}

export const toRisingBreakdown = (ownKg: number, carriedKg = 0): RisingBreakdown => {
  const own = clampKg(ownKg);
  const carried = clampKg(carriedKg);
  const counted = own + carried;
  return {
    scheme: 'rising',
    minimum_kg: RISING_MINIMUM_KG,
    qualified: counted >= RISING_MINIMUM_KG,
    calculated_bonus: moderatorKgBonus(own),
    total_bonus: moderatorKgBonus(counted),
    carried_kg: carried,
    counted_kg: counted,
    own_kg: own,
  };
};

/**
 * فرق البونص لما الكيلو المرحّل يتضاف فوق رصيد قائم.
 * المجموع = بونص الإجمالي. تحت 400 الاتنين صفر.
 */
export const risingCarryIncrements = (
  ownKg: number,
  items: Array<{ orderId: string; procKg: number; deliveredAt: string }>,
) => {
  const ordered = [...items].sort((a, b) => {
    const time = a.deliveredAt.localeCompare(b.deliveredAt);
    return time || a.orderId.localeCompare(b.orderId);
  });
  const own = clampKg(ownKg);
  const carriedTotal = ordered.reduce((sum, item) => sum + clampKg(item.procKg), 0);
  const qualified = own + carriedTotal >= RISING_MINIMUM_KG;
  let cursor = own;
  return ordered.map((item) => {
    const qty = clampKg(item.procKg);
    if (!qualified || qty <= 0) {
      return { orderId: item.orderId, bonus: 0 };
    }
    const bonus = moderatorKgBonus(cursor + qty) - moderatorKgBonus(cursor);
    cursor += qty;
    return { orderId: item.orderId, bonus };
  });
};

export interface ModeratorBonusView {
  kg: number;
  ownKg: number;
  carriedKg: number;
  bonus: number;
  salary: number;
  baseSalary: number;
  qualified: boolean;
  /** أعلى محطة اتعدّت، أو null. */
  reachedKg: number | null;
  reachedTitle: string | null;
  nextMilestoneKg: number | null;
  nextMilestoneTitle: string | null;
  nextGoal: string | null;
  kgRemaining: number | null;
  bonusAtNext: number | null;
  /** من 0 إلى 1 جوّه المحطة الجاية. 1 بعد الـ 2 طن. */
  segmentProgress: number;
  segmentFromKg: number;
  daysPhrase: string;
  daysRemainingAfterToday: number;
  message: string;
  milestoneIndex: number;
}

const calledName = (name: string) => {
  const trimmed = name.trim();
  return trimmed ? `يا ${trimmed}` : 'يا قمر';
};

export const buildModeratorBonusView = (input: {
  name: string;
  /** كيلوات الشهر نفسه. */
  kg: number;
  carriedKg?: number;
  baseSalary: number;
  /** لو الإدارة عدّلت البونص يدويًا، ده الرقم المستحق بدل المعادلة. */
  bonusOverride?: number | null;
  now?: Date;
  frozen?: boolean;
}): ModeratorBonusView => {
  const ownKg = clampKg(input.kg);
  const carriedKg = clampKg(input.carriedKg ?? 0);
  const kg = ownKg + carriedKg;
  const formulaBonus = moderatorKgBonus(kg);
  const bonus = input.bonusOverride != null && Number.isFinite(input.bonusOverride)
    ? input.bonusOverride
    : formulaBonus;
  const baseSalary = Number.isFinite(input.baseSalary) ? input.baseSalary : 0;
  const pace = cairoMonthPace(input.now ?? new Date());
  const reached = [...BONUS_MILESTONES].reverse().find((item) => kg >= item.kg) ?? null;
  const next = BONUS_MILESTONES.find((item) => kg < item.kg) ?? null;
  const segmentFromKg = next
    ? ([...BONUS_MILESTONES].reverse().find((item) => item.kg < next.kg)?.kg ?? 0)
    : 2000;
  const segmentSpan = next ? next.kg - segmentFromKg : 1;
  const segmentProgress = next
    ? Math.max(0, Math.min(1, (kg - segmentFromKg) / segmentSpan))
    : 1;
  const kgRemaining = next ? Math.max(0, next.kg - kg) : null;
  const bonusAtNext = next ? moderatorKgBonus(next.kg) : null;
  const qualified = kg >= RISING_MINIMUM_KG;
  const called = calledName(input.name);
  const daysPhrase = input.frozen ? 'شهر مكتمل' : arabicDaysRemainingPhrase(pace.daysRemainingAfterToday);

  let message: string;
  if (!qualified) {
    const left = formatBonusKg(RISING_MINIMUM_KG - kg);
    if (RISING_MINIMUM_KG - kg <= 40) {
      message = `${called}، فاضلِك ${left} كجم بس والبونص هيفتح بـ ${formatBonusEgp(BONUS_AT_MINIMUM)} جنيه. كمّلي، إنتي قريبة أوي.`;
    } else {
      message = `${called}، لسه قدامك ${left} كجم عشان البونص يفتح. كل كيلو بتسلّميه بيفرّقك، والـ ${formatBonusEgp(BONUS_AT_MINIMUM)} جنيه مستنياكي.`;
    }
  } else if (next?.kg === 1000) {
    const left = formatBonusKg(kgRemaining ?? 0);
    if ((kgRemaining ?? 0) <= 50) {
      message = `${called}، الطن على بعد ${left} كجم. لما توصّليه البونص هيبقى ${formatBonusEgp(bonusAtNext ?? 0)} جنيه.`;
    } else {
      message = `${called}، البونص اتفتح وبايتكم ${formatBonusEgp(bonus)} جنيه. فاضل ${left} كجم على الطن، وهناك البونص هيبقى ${formatBonusEgp(bonusAtNext ?? 0)} جنيه.`;
    }
  } else if (next?.kg === 1500) {
    const left = formatBonusKg(kgRemaining ?? 0);
    message = kg < 1100
      ? `${called}، عدّيتي الطن. بونصك ${formatBonusEgp(bonus)} جنيه، وفاضلِك ${left} كجم على طن ونص وهناك هيبقى ${formatBonusEgp(bonusAtNext ?? 0)} جنيه.`
      : `${called}، ماشية حلو أوي. فاضل ${left} كجم على طن ونص، وهناك البونص هيبقى ${formatBonusEgp(bonusAtNext ?? 0)} جنيه.`;
  } else if (next?.kg === 2000) {
    const left = formatBonusKg(kgRemaining ?? 0);
    message = `${called}، طن ونص اتحسبولك. فاضل ${left} كجم على الـ ٢ طن، وهناك البونص هيبقى ${formatBonusEgp(bonusAtNext ?? 0)} جنيه. كمّلي.`;
  } else {
    message = `${called}، عدّيتي الـ ٢ طن وده إنجاز كبير. البونص ${formatBonusEgp(bonus)} جنيه، وكل كيلو زيادة لسه بيزوّده. كمّلي يا نجمة.`;
  }

  return {
    kg,
    ownKg,
    carriedKg,
    bonus,
    salary: baseSalary + bonus,
    baseSalary,
    qualified,
    reachedKg: reached?.kg ?? null,
    reachedTitle: reached?.title ?? null,
    nextMilestoneKg: next?.kg ?? null,
    nextMilestoneTitle: next?.title ?? null,
    nextGoal: next?.goal ?? null,
    kgRemaining,
    bonusAtNext,
    segmentProgress,
    segmentFromKg,
    daysPhrase,
    daysRemainingAfterToday: pace.daysRemainingAfterToday,
    message,
    milestoneIndex: reached ? BONUS_MILESTONES.findIndex((item) => item.kg === reached.kg) + 1 : 0,
  };
};
