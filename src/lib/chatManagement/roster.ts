// توليد جدول الشيفتات من (قوالب الشيفتات + نمط كل يوم + يوم الأجازة الأسبوعي لكل مودريتور + الترتيب).
// دالة نقية بلا قاعدة بيانات حتى تُختبر وحدها. الواجهة تحفظ الناتج في cm_roster_days/cm_shift_assignments
// ومديرة المبيعات تعدّل أي خانة يدوياً بعد التوليد.

export type DayPattern = "four_shift" | "three_shift";

export interface ShiftTemplate {
  day_pattern: DayPattern;
  slot_no: number;
  label: string;
  starts_at: string; // "HH:MM" أو "HH:MM:SS"
  ends_at: string;
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

export interface GeneratedSlot {
  slot_no: number;
  label: string;
  starts_at: string;
  ends_at: string;
  moderator_id: string | null;
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

export const SLOT_LABELS = ["الشيفت الأول", "الشيفت الثاني", "الشيفت الثالث", "الشيفت الرابع", "الشيفت الخامس", "الشيفت السادس"];

const pad = (n: number) => String(n).padStart(2, "0");

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

const isWorkingOn = (m: RosterModerator, date: string) =>
  m.is_active && m.chat_active &&
  (!m.start_date || m.start_date <= date) &&
  (!m.end_date || m.end_date >= date);

export interface GenerateWeekInput {
  weekStart: string;
  templates: ShiftTemplate[];
  moderators: RosterModerator[];
  /** moderator_id → يوم الأجازة الأسبوعي (0..6) */
  daysOff: Record<string, number | null | undefined>;
  patterns?: Record<number, DayPattern>;
  rotationOffset?: number;
}

export const generateWeek = ({
  weekStart, templates, moderators, daysOff, patterns = DEFAULT_WEEKDAY_PATTERNS, rotationOffset = 0,
}: GenerateWeekInput): GeneratedDay[] =>
  weekDates(weekStart).map((date) => {
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
    const slots = slotsT.map((t, i) => ({
      slot_no: t.slot_no,
      label: t.label,
      starts_at: t.starts_at.slice(0, 5),
      ends_at: t.ends_at.slice(0, 5),
      moderator_id: i < n ? available[(((i + rotationOffset) % n) + n) % n].id : null,
    }));
    return { work_date: date, dow, day_pattern, off_moderator_ids: off, slots };
  });

/** تحذيرات قبل الحفظ: يوم بلا تغطية لخانة، أو أكثر من مودريتور أجازتها في نفس اليوم. */
export const rosterWarnings = (days: GeneratedDay[]): string[] => {
  const w: string[] = [];
  for (const d of days) {
    const empty = d.slots.filter((s) => !s.moderator_id).map((s) => s.label);
    if (empty.length) w.push(`${AR_WEEKDAYS[d.dow]} ${d.work_date}: ${empty.join("، ")} بلا مودريتور`);
    if (d.off_moderator_ids.length > 1) w.push(`${AR_WEEKDAYS[d.dow]} ${d.work_date}: أكثر من مودريتور في أجازة`);
  }
  return w;
};
