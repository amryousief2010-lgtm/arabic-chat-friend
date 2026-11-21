// ساعة الرد: نافذة الخدمة 09:00–01:00 بتوقيت القاهرة (قابلة للتعديل من cm_kpi_settings).
// - رسالة تصل بين 01:00 و09:00 لا تُحسب تأخيراً: العداد يبدأ 09:00.
// - المحادثة المهملة: X دقيقة بلا رد، تُحسب داخل النافذة فقط (يتوقف العداد 01:00 ويستأنف 09:00).
// - صاحبة المحادثة = صاحبة الخط. هدف أول رد: 15 دقيقة إن كانت في شيفتها، 60 إن كانت خارجه.
//   عند التجاوز يُنبَّه من في الشيفت للتغطية، ويُسجَّل «تغطية» وليس تأخيراً على صاحبة الخط.
// ملاحظة: الحساب بالساعة المحلية للقاهرة عبر Intl؛ عند تغيير التوقيت الصيفي قد يحدث فرق ساعة في يوم التحويل فقط.

export interface KpiSettings {
  timezone: string;
  service_window_start: string; // "09:00"
  service_window_end: string; // "01:00" (بعد منتصف الليل)
  abandoned_minutes: number;
  first_reply_target_on_shift_min: number;
  first_reply_target_off_shift_min: number;
}

export const DEFAULT_KPI_SETTINGS: KpiSettings = {
  timezone: "Africa/Cairo",
  service_window_start: "09:00",
  service_window_end: "01:00",
  abandoned_minutes: 30,
  first_reply_target_on_shift_min: 15,
  first_reply_target_off_shift_min: 60,
};

const MIN = 60_000;
const DAY_MIN = 1440;

export const timeToMinutes = (t: string): number => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
};

/** إزاحة المنطقة الزمنية بالدقائق لهذه اللحظة. */
export const tzOffsetMinutes = (instant: Date, timeZone: string): number => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(instant);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second"));
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / MIN);
};

/** دقائق «الساعة المحلية» منذ epoch (ساعة حائط القاهرة كأنها UTC). */
const localMinutes = (d: Date, tz: string) => Math.floor(d.getTime() / MIN) + tzOffsetMinutes(d, tz);
const fromLocalMinutes = (lm: number, tz: string) => {
  const guess = new Date(lm * MIN);
  return new Date((lm - tzOffsetMinutes(guess, tz)) * MIN);
};

/** فترات النافذة (بالدقائق المحلية) لليوم المحلي الذي يبدأ عند dayStart. */
const windowFor = (dayStart: number, s: KpiSettings): [number, number] => {
  const a = timeToMinutes(s.service_window_start);
  let b = timeToMinutes(s.service_window_end);
  if (b <= a) b += DAY_MIN; // تمتد بعد منتصف الليل
  return [dayStart + a, dayStart + b];
};

const windowsOverlapping = (from: number, to: number, s: KpiSettings): [number, number][] => {
  const out: [number, number][] = [];
  const firstDay = Math.floor(from / DAY_MIN) * DAY_MIN - DAY_MIN;
  for (let d = firstDay; d <= to; d += DAY_MIN) {
    const [a, b] = windowFor(d, s);
    if (b > from && a < to) out.push([a, b]);
  }
  return out;
};

export const isInServiceWindow = (at: Date, s: KpiSettings = DEFAULT_KPI_SETTINGS): boolean => {
  const lm = localMinutes(at, s.timezone);
  return windowsOverlapping(lm, lm + 1, s).some(([a, b]) => lm >= a && lm < b);
};

/** بداية العداد: لحظة الوصول إن كانت داخل النافذة، وإلا بداية النافذة التالية (09:00). */
export const clockStart = (arrival: Date, s: KpiSettings = DEFAULT_KPI_SETTINGS): Date => {
  if (isInServiceWindow(arrival, s)) return arrival;
  const lm = localMinutes(arrival, s.timezone);
  const next = windowsOverlapping(lm, lm + 2 * DAY_MIN, s).find(([a]) => a > lm)!;
  return fromLocalMinutes(next[0], s.timezone);
};

/** الدقائق الواقعة داخل نافذة الخدمة بين لحظتين. */
export const serviceMinutesBetween = (from: Date, to: Date, s: KpiSettings = DEFAULT_KPI_SETTINGS): number => {
  if (to <= from) return 0;
  const a = localMinutes(from, s.timezone);
  const b = localMinutes(to, s.timezone);
  return windowsOverlapping(a, b, s).reduce((sum, [x, y]) => sum + Math.max(0, Math.min(b, y) - Math.max(a, x)), 0);
};

export const isAbandoned = (
  lastInbound: Date, lastOutbound: Date | null, now: Date, s: KpiSettings = DEFAULT_KPI_SETTINGS,
): boolean => {
  if (lastOutbound && lastOutbound >= lastInbound) return false;
  return serviceMinutesBetween(lastInbound, now, s) >= s.abandoned_minutes;
};

// ───── الشيفتات ─────
export interface AssignmentRow {
  work_date: string; // YYYY-MM-DD (يوم الشيفت، حتى لو انتهى بعد منتصف الليل)
  starts_at: string;
  ends_at: string;
  moderator_id: string | null;
}

/** من في الشيفت في هذه اللحظة (شيفت 21:00–01:00 يتبع تاريخ بدايته). */
export const onShiftModeratorIds = (at: Date, rows: AssignmentRow[], tz = DEFAULT_KPI_SETTINGS.timezone): string[] => {
  const lm = localMinutes(at, tz);
  return rows
    .filter((r) => {
      if (!r.moderator_id) return false;
      const [y, mo, d] = r.work_date.split("-").map(Number);
      const day = Date.UTC(y, mo - 1, d) / MIN;
      const a = day + timeToMinutes(r.starts_at);
      let b = day + timeToMinutes(r.ends_at);
      if (b <= a) b += DAY_MIN;
      return lm >= a && lm < b;
    })
    .map((r) => r.moderator_id as string);
};

export type FirstReplyStatus = "pending" | "on_time" | "cover" | "late";

export interface FirstReplyResult {
  status: FirstReplyStatus;
  elapsed_min: number;
  target_min: number;
  owner_on_shift: boolean;
  /** من يُنبَّه للتغطية عند التجاوز (من في الشيفت غير صاحبة الخط). */
  cover_moderator_ids: string[];
}

/**
 * تقييم أول رد لصاحبة الخط.
 * - on_time: ردّت داخل الهدف.
 * - cover: تجاوز الهدف وهناك من في الشيفت يغطي ← يُسجَّل «تغطية» لا تأخيراً على صاحبة الخط.
 * - late: تجاوز الهدف وصاحبة الخط هي نفسها من في الشيفت (لا أحد يغطي) ← تأخير.
 * - pending: لم يُرد بعد ولم يتجاوز الهدف.
 */
export const evaluateFirstReply = (args: {
  arrival: Date;
  firstReply: Date | null;
  now: Date;
  ownerId: string | null;
  assignments: AssignmentRow[];
  settings?: KpiSettings;
}): FirstReplyResult => {
  const s = args.settings ?? DEFAULT_KPI_SETTINGS;
  const start = clockStart(args.arrival, s);
  const onShift = onShiftModeratorIds(start, args.assignments, s.timezone);
  const owner_on_shift = !!args.ownerId && onShift.includes(args.ownerId);
  const target_min = owner_on_shift ? s.first_reply_target_on_shift_min : s.first_reply_target_off_shift_min;
  const end = args.firstReply ?? args.now;
  const elapsed_min = serviceMinutesBetween(args.arrival, end, s);
  const cover_moderator_ids = onShift.filter((id) => id !== args.ownerId);
  let status: FirstReplyStatus;
  if (elapsed_min <= target_min) status = args.firstReply ? "on_time" : "pending";
  else status = cover_moderator_ids.length ? "cover" : "late";
  return { status, elapsed_min, target_min, owner_on_shift, cover_moderator_ids };
};
