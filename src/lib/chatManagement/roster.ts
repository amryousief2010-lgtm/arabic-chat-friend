// إدارة جدول الشيفتات المرن: التوليد من القوالب، التحقق من التداخلات والإجازات وفجوات التغطية،
// ودعم الشيفتات الممتدة بعد منتصف الليل وتعيين أكثر من مودريتور في الشيفت الواحد.

import { formatClock12 } from "@/lib/chatManagement/timeFormat";

export type DayPattern = string;

export interface ShiftPattern {
  key: string;
  name: string;
  sort_order: number;
}

export interface ShiftTemplate {
  id?: string;
  day_pattern: DayPattern;
  slot_no: number;
  label: string;
  starts_at: string; // "HH:MM" أو "HH:MM:SS"
  ends_at: string;
  staff_count?: number;
  is_active?: boolean;
}

export interface RosterModerator {
  id: string;
  display_name: string;
  sort_order: number;
  is_active: boolean;
  chat_active: boolean;
  start_date?: string | null; // YYYY-MM-DD
  end_date?: string | null;
}

export interface DayShift {
  id: string;
  work_date: string;
  sort_order: number;
  label: string;
  starts_at: string; // "HH:MM"
  ends_at: string;   // "HH:MM"
  staff_count: number;
  source: "generated" | "manual" | "seed" | string;
  moderator_ids: string[];
}

export interface GeneratedSlot {
  slot_no: number;
  label: string;
  starts_at: string;
  ends_at: string;
  staff_count: number;
  moderator_id: string | null;
  moderator_ids: string[];
}

export interface GeneratedDay {
  work_date: string;
  dow: number; // 0=الأحد … 6=السبت (مثل Postgres)
  day_pattern: DayPattern;
  off_moderator_ids: string[];
  slots: GeneratedSlot[];
}

export const AR_WEEKDAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

export const DEFAULT_WEEKDAY_PATTERNS: Record<number, DayPattern> = {
  6: "four_shift", 0: "four_shift", 1: "four_shift",
  2: "three_shift", 3: "three_shift", 4: "three_shift", 5: "three_shift",
};

export const SLOT_LABELS = [
  "الشيفت الأول", "الشيفت الثاني", "الشيفت الثالث",
  "الشيفت الرابع", "الشيفت الخامس", "الشيفت السادس",
];

const DAY_MIN = 1440;
const pad = (n: number) => String(n).padStart(2, "0");

export const hhmm = (t: string | null | undefined): string => (t ?? "").slice(0, 5);

export const parseDate = (d: string): Date => {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
};

export const formatDate = (d: Date): string =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

export const addDays = (d: string, n: number): string => {
  const x = parseDate(d);
  x.setUTCDate(x.getUTCDate() + n);
  return formatDate(x);
};

export const dowOf = (d: string): number => parseDate(d).getUTCDay();

/** أول يوم في الأسبوع (السبت) الذي يحتوي التاريخ. */
export const weekStartSaturday = (d: string): string => {
  const dow = dowOf(d);
  return addDays(d, -((dow + 1) % 7));
};

export const weekDates = (start: string): string[] => Array.from({ length: 7 }, (_, i) => addDays(start, i));

export const isValidHHMM = (t: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm(t));

export const timeToMinutes = (t: string): number => {
  const [h, m] = hhmm(t).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

export const minutesToHHMM = (min: number): string => {
  const norm = ((min % DAY_MIN) + DAY_MIN) % DAY_MIN;
  return `${pad(Math.floor(norm / 60))}:${pad(norm % 60)}`;
};

export const isOvernightShift = (startsAt: string, endsAt: string): boolean =>
  hhmm(startsAt) !== hhmm(endsAt) && timeToMinutes(endsAt) <= timeToMinutes(startsAt);

export const shiftDurationMinutes = (startsAt: string, endsAt: string): number => {
  const s = timeToMinutes(startsAt);
  const e = timeToMinutes(endsAt);
  if (s === e) return 0;
  return e > s ? e - s : e + DAY_MIN - s;
};

export const formatDurationAr = (minutes: number): string => {
  if (minutes <= 0) return "0 د";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h} س ${m} د`;
  if (h > 0) return `${h} س`;
  return `${m} د`;
};

const dayIndex = (workDate: string): number => Math.floor(parseDate(workDate).getTime() / 86_400_000);

/** فترة الشيفت بالدقائق المطلقة منذ epoch؛ الشيفت الليلي يمتد لليوم التالي. */
export const shiftIntervalMinutes = (workDate: string, startsAt: string, endsAt: string): [number, number] => {
  const base = dayIndex(workDate) * DAY_MIN;
  const s = timeToMinutes(startsAt);
  let e = timeToMinutes(endsAt);
  if (e <= s) e += DAY_MIN;
  return [base + s, base + e];
};

export const intervalsOverlap = (a: [number, number], b: [number, number]): boolean =>
  a[0] < b[1] && b[0] < a[1];

export const isWorkingOn = (m: RosterModerator, date: string) =>
  m.is_active && m.chat_active &&
  (!m.start_date || m.start_date <= date) &&
  (!m.end_date || m.end_date >= date);

export const shiftLabelForIndex = (index1Based: number): string =>
  SLOT_LABELS[index1Based - 1] ?? `الشيفت ${index1Based}`;

export interface GenerateWeekInput {
  weekStart: string;
  templates: ShiftTemplate[];
  moderators: RosterModerator[];
  /** moderator_id → يوم الإجازة الأسبوعي (0..6) */
  daysOff: Record<string, number | null | undefined>;
  patterns?: Record<number, DayPattern>;
  rotationOffset?: number;
}

export const generateWeek = ({
  weekStart, templates, moderators, daysOff, patterns = DEFAULT_WEEKDAY_PATTERNS, rotationOffset = 0,
}: GenerateWeekInput): GeneratedDay[] => {
  const prevIntervals = new Map<string, [number, number][]>();

  return weekDates(weekStart).map((date) => {
    const dow = dowOf(date);
    const day_pattern = patterns[dow] ?? "three_shift";
    const slotsT = templates
      .filter((t) => t.day_pattern === day_pattern && t.is_active !== false)
      .sort((a, b) => a.slot_no - b.slot_no);
    const working = moderators
      .filter((m) => isWorkingOn(m, date))
      .sort((a, b) => a.sort_order - b.sort_order || a.display_name.localeCompare(b.display_name));
    const off = working.filter((m) => daysOff[m.id] === dow).map((m) => m.id);
    const available = working.filter((m) => !off.includes(m.id));
    const n = available.length;
    const rotated = n > 0
      ? available.map((_, idx) => available[(((idx + rotationOffset) % n) + n) % n])
      : [];
    const usedToday = new Set<string>();

    const slots: GeneratedSlot[] = slotsT.map((t) => {
      const need = Math.max(1, Number(t.staff_count ?? 1));
      const iv = shiftIntervalMinutes(date, t.starts_at, t.ends_at);
      const picked: string[] = [];

      for (const m of rotated) {
        if (picked.length >= need) break;
        if (usedToday.has(m.id)) continue;
        const prior = prevIntervals.get(m.id) ?? [];
        if (prior.some((p) => intervalsOverlap(p, iv))) continue;
        picked.push(m.id);
        usedToday.add(m.id);
        prevIntervals.set(m.id, [...prior, iv]);
      }

      return {
        slot_no: t.slot_no,
        label: t.label,
        starts_at: hhmm(t.starts_at),
        ends_at: hhmm(t.ends_at),
        staff_count: need,
        moderator_id: picked[0] ?? null,
        moderator_ids: picked,
      };
    });

    return { work_date: date, dow, day_pattern, off_moderator_ids: off, slots };
  });
};

/** تحذيرات سريعة بعد التوليد (متوافق مع الاستخدام السابق + نقص التغطية). */
export const rosterWarnings = (days: GeneratedDay[]): string[] => {
  const w: string[] = [];
  for (const d of days) {
    const empty = d.slots.filter((s) => s.moderator_ids.length === 0).map((s) => s.label);
    if (empty.length) w.push(`${AR_WEEKDAYS[d.dow]} ${d.work_date}: ${empty.join("، ")} بلا مودريتور`);
    const partial = d.slots
      .filter((s) => s.moderator_ids.length > 0 && s.moderator_ids.length < s.staff_count)
      .map((s) => `${s.label} (${s.moderator_ids.length}/${s.staff_count})`);
    if (partial.length) w.push(`${AR_WEEKDAYS[d.dow]} ${d.work_date}: نقص عدد المودريتورز في ${partial.join("، ")}`);
    if (d.off_moderator_ids.length > 1) w.push(`${AR_WEEKDAYS[d.dow]} ${d.work_date}: أكثر من مودريتور في إجازة`);
  }
  return w;
};

export interface ShiftCandidate {
  id?: string;
  work_date: string;
  label: string;
  starts_at: string;
  ends_at: string;
  staff_count: number;
  moderator_ids: string[];
}

export interface ModeratorOverlap {
  moderatorId: string;
  conflictingShift: DayShift;
}

export const findModeratorOverlaps = (
  candidate: ShiftCandidate,
  existingShifts: DayShift[],
): ModeratorOverlap[] => {
  if (!isValidHHMM(candidate.starts_at) || !isValidHHMM(candidate.ends_at)) return [];
  if (hhmm(candidate.starts_at) === hhmm(candidate.ends_at)) return [];
  const iv = shiftIntervalMinutes(candidate.work_date, candidate.starts_at, candidate.ends_at);
  const out: ModeratorOverlap[] = [];

  for (const modId of candidate.moderator_ids) {
    for (const s of existingShifts) {
      if (candidate.id && s.id === candidate.id) continue;
      if (!s.moderator_ids.includes(modId)) continue;
      if (!isValidHHMM(s.starts_at) || !isValidHHMM(s.ends_at) || hhmm(s.starts_at) === hhmm(s.ends_at)) continue;
      const otherIv = shiftIntervalMinutes(s.work_date, s.starts_at, s.ends_at);
      if (intervalsOverlap(iv, otherIv)) {
        out.push({ moderatorId: modId, conflictingShift: s });
        break;
      }
    }
  }
  return out;
};

export interface ShiftValidationResult {
  errors: string[];
  warnings: string[];
  overlappingModeratorIds: Set<string>;
  dayOffModeratorIds: Set<string>;
}

export const validateShiftDraft = (
  candidate: ShiftCandidate,
  existingShifts: DayShift[],
  moderators: RosterModerator[],
  daysOff: Record<string, number | null | undefined>,
): ShiftValidationResult => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const overlappingModeratorIds = new Set<string>();
  const dayOffModeratorIds = new Set<string>();
  const nameOf = (id: string) => moderators.find((m) => m.id === id)?.display_name ?? "مودريتور";

  if (!candidate.label.trim()) {
    errors.push("اسم الشيفت مطلوب");
  }
  if (!isValidHHMM(candidate.starts_at) || !isValidHHMM(candidate.ends_at)) {
    errors.push("أدخلي وقت بداية ونهاية صحيحين بنظام 24 ساعة (مثل 09:00)");
  } else if (hhmm(candidate.starts_at) === hhmm(candidate.ends_at)) {
    errors.push("لا يمكن أن يتطابق وقت البداية والنهاية");
  }
  if (!Number.isFinite(candidate.staff_count) || candidate.staff_count < 1) {
    errors.push("العدد المطلوب للمودريتورز يجب أن يكون 1 على الأقل");
  }

  const overlaps = findModeratorOverlaps(candidate, existingShifts);
  for (const ov of overlaps) {
    overlappingModeratorIds.add(ov.moderatorId);
    const s = ov.conflictingShift;
    const sameDay = s.work_date === candidate.work_date;
    const dayLabel = sameDay ? "" : ` (${AR_WEEKDAYS[dowOf(s.work_date)]} ${s.work_date})`;
    errors.push(
      `تداخل أوقات لـ ${nameOf(ov.moderatorId)}: مع «${s.label}»${dayLabel} (${formatClock12(s.starts_at)} – ${formatClock12(s.ends_at)})`,
    );
  }

  const dow = dowOf(candidate.work_date);
  for (const modId of candidate.moderator_ids) {
    if (daysOff[modId] === dow) {
      dayOffModeratorIds.add(modId);
      warnings.push(`تعارض إجازة: ${nameOf(modId)} يوم ${AR_WEEKDAYS[dow]} هو إجازتها الأسبوعية`);
    }
  }

  if (candidate.moderator_ids.length < (candidate.staff_count || 1)) {
    warnings.push(
      `العدد المعين (${candidate.moderator_ids.length}) أقل من المطلوب (${candidate.staff_count}) — سيبقى الشيفت ناقص تغطية`,
    );
  }

  return { errors, warnings, overlappingModeratorIds, dayOffModeratorIds };
};

export interface CoverageGap {
  start: string; // HH:MM
  end: string;   // HH:MM
}

/** حساب فجوات التغطية داخل نافذة الخدمة ليوم محدد (تؤخذ في الاعتبار الشيفتات المعين بها مودريتور واحدة على الأقل). */
export const computeDayCoverageGaps = (
  workDate: string,
  allShifts: DayShift[],
  serviceWindowStart = "09:00",
  serviceWindowEnd = "01:00",
): CoverageGap[] => {
  if (!isValidHHMM(serviceWindowStart) || !isValidHHMM(serviceWindowEnd)) return [];
  if (hhmm(serviceWindowStart) === hhmm(serviceWindowEnd)) return [];

  const [winStart, winEnd] = shiftIntervalMinutes(workDate, serviceWindowStart, serviceWindowEnd);
  const covered = allShifts
    .filter((s) => s.moderator_ids.length > 0 && isValidHHMM(s.starts_at) && isValidHHMM(s.ends_at) && hhmm(s.starts_at) !== hhmm(s.ends_at))
    .map((s) => shiftIntervalMinutes(s.work_date, s.starts_at, s.ends_at))
    .filter(([a, b]) => b > winStart && a < winEnd)
    .map(([a, b]): [number, number] => [Math.max(a, winStart), Math.min(b, winEnd)])
    .sort((x, y) => x[0] - y[0] || x[1] - y[1]);

  const merged: [number, number][] = [];
  for (const iv of covered) {
    const last = merged[merged.length - 1];
    if (!last || iv[0] > last[1]) merged.push([...iv]);
    else last[1] = Math.max(last[1], iv[1]);
  }

  const gaps: CoverageGap[] = [];
  let cursor = winStart;
  for (const [a, b] of merged) {
    if (a > cursor) {
      gaps.push({ start: minutesToHHMM(cursor), end: minutesToHHMM(a) });
    }
    cursor = Math.max(cursor, b);
  }
  if (cursor < winEnd) {
    gaps.push({ start: minutesToHHMM(cursor), end: minutesToHHMM(winEnd) });
  }
  return gaps;
};

export interface WeekRosterValidation {
  errors: string[];
  warnings: string[];
  overlapShiftIds: Set<string>;
  overlapKeys: Set<string>; // `${shiftId}|${moderatorId}`
  dayOffConflictKeys: Set<string>; // `${shiftId}|${moderatorId}`
  understaffedShiftIds: Set<string>;
  coverageGapsByDate: Record<string, CoverageGap[]>;
}

export const validateWeekRoster = (args: {
  dates: string[];
  shifts: DayShift[];
  moderators: RosterModerator[];
  daysOff: Record<string, number | null | undefined>;
  serviceWindowStart?: string;
  serviceWindowEnd?: string;
}): WeekRosterValidation => {
  const { dates, shifts, moderators, daysOff, serviceWindowStart = "09:00", serviceWindowEnd = "01:00" } = args;
  const errors: string[] = [];
  const warnings: string[] = [];
  const overlapShiftIds = new Set<string>();
  const overlapKeys = new Set<string>();
  const dayOffConflictKeys = new Set<string>();
  const understaffedShiftIds = new Set<string>();
  const coverageGapsByDate: Record<string, CoverageGap[]> = {};
  const nameOf = (id: string) => moderators.find((m) => m.id === id)?.display_name ?? "مودريتور";

  // 1) تداخلات المودريتورز عبر الأسبوع (تشمل الشيفتات الليلية)
  const modShifts = new Map<string, { shift: DayShift; iv: [number, number] }[]>();
  for (const s of shifts) {
    if (!isValidHHMM(s.starts_at) || !isValidHHMM(s.ends_at) || hhmm(s.starts_at) === hhmm(s.ends_at)) continue;
    const iv = shiftIntervalMinutes(s.work_date, s.starts_at, s.ends_at);
    for (const modId of s.moderator_ids) {
      const list = modShifts.get(modId) ?? [];
      list.push({ shift: s, iv });
      modShifts.set(modId, list);
    }
  }

  for (const [modId, entries] of modShifts.entries()) {
    entries.sort((a, b) => a.iv[0] - b.iv[0]);
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        if (entries[j].iv[0] >= entries[i].iv[1]) break;
        const s1 = entries[i].shift;
        const s2 = entries[j].shift;
        overlapShiftIds.add(s1.id);
        overlapShiftIds.add(s2.id);
        overlapKeys.add(`${s1.id}|${modId}`);
        overlapKeys.add(`${s2.id}|${modId}`);
        errors.push(
          `تداخل لـ ${nameOf(modId)}: «${s1.label}» (${AR_WEEKDAYS[dowOf(s1.work_date)]} ${formatClock12(s1.starts_at)}–${formatClock12(s1.ends_at)}) مع «${s2.label}» (${AR_WEEKDAYS[dowOf(s2.work_date)]} ${formatClock12(s2.starts_at)}–${formatClock12(s2.ends_at)})`,
        );
      }
    }
  }

  // 2) تعارض الإجازات ونقص التغطية لكل شيفت
  const dateSet = new Set(dates);
  for (const s of shifts) {
    if (!dateSet.has(s.work_date)) continue;
    const dow = dowOf(s.work_date);
    for (const modId of s.moderator_ids) {
      if (daysOff[modId] === dow) {
        dayOffConflictKeys.add(`${s.id}|${modId}`);
        warnings.push(
          `تعارض إجازة: ${nameOf(modId)} في «${s.label}» يوم ${AR_WEEKDAYS[dow]} ${s.work_date}`,
        );
      }
    }
    if (s.moderator_ids.length < Math.max(1, s.staff_count)) {
      understaffedShiftIds.add(s.id);
      warnings.push(
        `نقص تغطية: ${AR_WEEKDAYS[dow]} ${s.work_date} – ${s.label} (${s.moderator_ids.length}/${s.staff_count})`,
      );
    }
  }

  // 3) فجوات التغطية اليومية وتعارض تعدد الإجازات
  const activeWorkingMods = moderators.filter((m) => m.is_active && m.chat_active);
  for (const d of dates) {
    const gaps = computeDayCoverageGaps(d, shifts, serviceWindowStart, serviceWindowEnd);
    coverageGapsByDate[d] = gaps;
    if (gaps.length > 0) {
      const gapText = gaps.map((g) => `${formatClock12(g.start)}–${formatClock12(g.end)}`).join("، ");
      warnings.push(`فجوة تغطية يوم ${AR_WEEKDAYS[dowOf(d)]} ${d}: ${gapText}`);
    }
    const dow = dowOf(d);
    const offMods = activeWorkingMods.filter((m) => isWorkingOn(m, d) && daysOff[m.id] === dow);
    if (offMods.length > 1) {
      warnings.push(
        `${AR_WEEKDAYS[dow]} ${d}: أكثر من مودريتور في إجازة (${offMods.map((m) => m.display_name).join("، ")})`,
      );
    }
  }

  return {
    errors,
    warnings,
    overlapShiftIds,
    overlapKeys,
    dayOffConflictKeys,
    understaffedShiftIds,
    coverageGapsByDate,
  };
};

export interface CopyShiftDraft {
  work_date: string;
  sort_order: number;
  label: string;
  starts_at: string;
  ends_at: string;
  staff_count: number;
  moderator_ids: string[];
}

export const buildCopiedDayShifts = (
  sourceShifts: DayShift[],
  targetDates: string[],
  opts: { includeModerators: boolean },
): CopyShiftDraft[] => {
  const ordered = [...sourceShifts].sort(
    (a, b) => timeToMinutes(a.starts_at) - timeToMinutes(b.starts_at) || a.sort_order - b.sort_order,
  );
  return targetDates.flatMap((work_date) =>
    ordered.map((s, idx) => ({
      work_date,
      sort_order: idx + 1,
      label: s.label,
      starts_at: hhmm(s.starts_at),
      ends_at: hhmm(s.ends_at),
      staff_count: Math.max(1, s.staff_count || 1),
      moderator_ids: opts.includeModerators ? [...s.moderator_ids] : [],
    })),
  );
};

export const buildCopiedWeekShifts = (
  sourceShifts: DayShift[],
  sourceWeekStart: string,
  targetWeekStart: string,
  opts: { includeModerators: boolean },
): CopyShiftDraft[] => {
  const srcDates = weekDates(sourceWeekStart);
  const tgtDates = weekDates(targetWeekStart);
  const out: CopyShiftDraft[] = [];

  for (let i = 0; i < 7; i++) {
    const dayShifts = sourceShifts.filter((s) => s.work_date === srcDates[i]);
    out.push(...buildCopiedDayShifts(dayShifts, [tgtDates[i]], opts));
  }
  return out;
};
