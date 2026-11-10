import { cairoMonthStartUTC, currentCairoYearMonth, toCairoDateString } from "@/lib/cairoDate";

export const REPORT_MODERATOR_SLUGS = ["aya", "noura", "manal", "mariam", "soha"] as const;

/** الصافي يبقى الرقم الرئيسي. الملغي يُعرض بجانبه ولا يُطرح مرة ثانية. */
export const REGISTERED_ORDERS_LABEL = "الطلبات المسجّلة (الصافي بدون الملغي)";
export const CANCELLED_ORDERS_LABEL = "الملغي";

export const BRAND_PURPLE = "#A4288A";
export const BRAND_ORANGE = "#F37346";

export type ReportPreset = "today" | "week" | "this_month" | "last_month" | "custom";

export const REPORT_PRESETS: { value: ReportPreset; label: string }[] = [
  { value: "today", label: "اليوم" },
  { value: "week", label: "الأسبوع" },
  { value: "this_month", label: "الشهر الحالي" },
  { value: "last_month", label: "الشهر الماضي" },
  { value: "custom", label: "مخصص" },
];

export type KgSplit = { meat: number; bone: number; processed: number; gifts: number };

export type CallSplit = {
  answered: number;
  missed: number;
  under1Min: number;
  from1To5Min: number;
  over5Min: number;
  matchedOrder: number;
  answerRate: number | null;
};

export type ModeratorPeriodRow = {
  slug: string;
  name: string;
  ordersRegistered: number;
  /** null when the installed function does not send the column yet. */
  ordersCancelled: number | null;
  ordersDelivered: number;
  deliveredValue: number;
  averageOrderValue: number | null;
  collectionCollected: number;
  collectionNotCollected: number;
  collectionOther: number;
  kgRequested: KgSplit;
  kgDelivered: KgSplit;
  conversations: number | null;
  onTime: number | null;
  cover: number | null;
  late: number | null;
  unreplied: number | null;
  waitingCustomer: number | null;
  inboundMessages: number | null;
  outboundMessages: number | null;
  avgFirstReplyMin: number | null;
  medianFirstReplyMin: number | null;
  conversionPct: number | null;
  calls: CallSplit | null;
};

export type DailyPoint = { day: string; slug: string; orders: number; conversations: number | null };
export type LateHourPoint = { hour: number; slug: string; late: number };
export type AdCount = { adName: string; slug: string; conversations: number };

export type ModeratorPeriodReport = {
  from: string;
  to: string;
  conversationsVisible: boolean;
  moderators: ModeratorPeriodRow[];
  daily: DailyPoint[];
  lateByHour: LateHourPoint[];
  ads: AdCount[];
};

const emptyKg = (): KgSplit => ({ meat: 0, bone: 0, processed: 0, gifts: 0 });

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => (v == null || v === "" ? null : num(v));

const kgOf = (v: unknown): KgSplit => {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return { meat: num(o.meat), bone: num(o.bone), processed: num(o.processed), gifts: num(o.gifts) };
};

export const totalKg = (k: KgSplit) => k.meat + k.bone + k.processed + k.gifts;

const PHONE_KEY = /phone|wa_id|handle|transcript|recording_path/i;
const PHONE_VALUE = /^(?:\+?20|0)?1[0125]\d{8}$/;

function walkNoPhones(value: unknown): void {
  if (value == null) return;
  if (typeof value === "string") {
    if (PHONE_VALUE.test(value.replace(/[\s-]/g, ""))) {
      throw new Error("report payload contained a phone-like value");
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => walkNoPhones(item));
    return;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (PHONE_KEY.test(key)) throw new Error("report payload contained a private field");
      walkNoPhones(child);
    }
  }
}

export function assertReportHasNoPhones(value: unknown): void {
  walkNoPhones(value);
}

const ymd = (d: Date) => toCairoDateString(d);

const addMonths = (year: number, monthIndex0: number, delta: number) => {
  const total = year * 12 + monthIndex0 + delta;
  return { year: Math.floor(total / 12), monthIndex0: ((total % 12) + 12) % 12 };
};

const cairoWeekdayIndex = (now: Date) => {
  const label = new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Cairo", weekday: "short" }).format(now);
  return { Sat: 0, Sun: 1, Mon: 2, Tue: 3, Wed: 4, Thu: 5, Fri: 6 }[label] ?? 0;
};

/** الأسبوع التجاري يبدأ السبت (نفس بداية شيفتات البنات) وينتهي اليوم بتوقيت القاهرة. */
export function resolveReportRange(
  preset: ReportPreset,
  customFrom = "",
  customTo = "",
  now: Date = new Date(),
): { from: string; to: string } {
  const today = ymd(now);
  const { year, monthIndex0 } = currentCairoYearMonth(now);
  if (preset === "today") return { from: today, to: today };
  if (preset === "week") {
    const [y, m, d] = today.split("-").map(Number);
    const start = new Date(Date.UTC(y, m - 1, d));
    start.setUTCDate(start.getUTCDate() - cairoWeekdayIndex(now));
    const from = start.toISOString().slice(0, 10);
    return { from, to: today };
  }
  if (preset === "this_month") {
    return { from: ymd(cairoMonthStartUTC(year, monthIndex0)), to: today };
  }
  if (preset === "last_month") {
    const prev = addMonths(year, monthIndex0, -1);
    const start = cairoMonthStartUTC(prev.year, prev.monthIndex0);
    const end = new Date(cairoMonthStartUTC(year, monthIndex0).getTime() - 12 * 60 * 60 * 1000);
    return { from: ymd(start), to: ymd(end) };
  }
  const from = customFrom || customTo || today;
  const to = customTo || customFrom || today;
  return from <= to ? { from, to } : { from: to, to: from };
}

export function formatReportPeriod(range: { from: string; to: string }): string {
  const f = (s: string) => s.split("-").reverse().join("/");
  return range.from === range.to ? f(range.from) : `${f(range.from)} – ${f(range.to)}`;
}

export function cairoTimestampLabel(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
    timeZone: "Africa/Cairo",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(now);
}

type Raw = Record<string, unknown>;

export function mapModeratorPeriodReport(raw: unknown, viewerMaySeeConversations: boolean): ModeratorPeriodReport {
  assertReportHasNoPhones(raw);
  const o = (raw && typeof raw === "object" ? raw : {}) as Raw;
  const visible = o.conversations_visible === true && viewerMaySeeConversations;
  const moderators = (Array.isArray(o.moderators) ? o.moderators : []).map((row) => {
    const r = row as Raw;
    const callsRaw = r.calls as Raw | null | undefined;
    const calls: CallSplit | null = visible && callsRaw
      ? {
          answered: num(callsRaw.answered),
          missed: num(callsRaw.missed),
          under1Min: num(callsRaw.under_1_min),
          from1To5Min: num(callsRaw.from_1_to_5_min),
          over5Min: num(callsRaw.over_5_min),
          matchedOrder: num(callsRaw.matched_order),
          answerRate: numOrNull(callsRaw.answer_rate),
        }
      : null;
    return {
      slug: String(r.slug ?? ""),
      name: String(r.name ?? ""),
      ordersRegistered: num(r.orders_registered),
      ordersCancelled: Object.prototype.hasOwnProperty.call(r, "orders_cancelled") ? num(r.orders_cancelled) : null,
      ordersDelivered: num(r.orders_delivered),
      deliveredValue: num(r.delivered_value),
      averageOrderValue: numOrNull(r.average_order_value),
      collectionCollected: num(r.collection_collected),
      collectionNotCollected: num(r.collection_not_collected),
      collectionOther: num(r.collection_other),
      kgRequested: kgOf(r.kg_requested),
      kgDelivered: kgOf(r.kg_delivered),
      conversations: visible ? num(r.conversations) : null,
      onTime: visible ? num(r.on_time) : null,
      cover: visible ? num(r.cover) : null,
      late: visible ? num(r.late) : null,
      unreplied: visible ? num(r.unreplied) : null,
      waitingCustomer: visible ? num(r.waiting_customer) : null,
      inboundMessages: visible ? num(r.inbound_messages) : null,
      outboundMessages: visible ? num(r.outbound_messages) : null,
      avgFirstReplyMin: visible ? numOrNull(r.avg_first_reply_min) : null,
      medianFirstReplyMin: visible ? numOrNull(r.median_first_reply_min) : null,
      conversionPct: visible ? numOrNull(r.conversion_pct) : null,
      calls,
    } satisfies ModeratorPeriodRow;
  });
  const daily = (Array.isArray(o.daily) ? o.daily : []).map((row) => {
    const r = row as Raw;
    return {
      day: String(r.day ?? "").slice(0, 10),
      slug: String(r.slug ?? ""),
      orders: num(r.orders),
      conversations: visible && r.conversations != null ? num(r.conversations) : null,
    };
  });
  const lateByHour = visible
    ? (Array.isArray(o.late_by_hour) ? o.late_by_hour : []).map((row) => {
        const r = row as Raw;
        return { hour: num(r.hour), slug: String(r.slug ?? ""), late: num(r.late) };
      })
    : [];
  const ads = visible
    ? (Array.isArray(o.ads) ? o.ads : []).map((row) => {
        const r = row as Raw;
        return { adName: String(r.ad_name ?? "بدون إعلان"), slug: String(r.slug ?? ""), conversations: num(r.conversations) };
      })
    : [];
  return {
    from: String(o.from ?? ""),
    to: String(o.to ?? ""),
    conversationsVisible: visible,
    moderators,
    daily,
    lateByHour,
    ads,
  };
}

export type MetricDef = {
  id: string;
  label: string;
  conversation: boolean;
  lowerIsBetter: boolean;
  value: (row: ModeratorPeriodRow) => number | null;
};

export const REPORT_METRICS: MetricDef[] = [
  { id: "conversations", label: "المحادثات", conversation: true, lowerIsBetter: false, value: (r) => r.conversations },
  { id: "onTime", label: "في الوقت", conversation: true, lowerIsBetter: false, value: (r) => r.onTime },
  { id: "cover", label: "تغطية", conversation: true, lowerIsBetter: false, value: (r) => r.cover },
  { id: "late", label: "متأخر", conversation: true, lowerIsBetter: true, value: (r) => r.late },
  { id: "unreplied", label: "بدون رد", conversation: true, lowerIsBetter: true, value: (r) => r.unreplied },
  { id: "waiting", label: "بانتظار العميل", conversation: true, lowerIsBetter: true, value: (r) => r.waitingCustomer },
  { id: "inbound", label: "رسائل واردة", conversation: true, lowerIsBetter: false, value: (r) => r.inboundMessages },
  { id: "outbound", label: "رسائل صادرة", conversation: true, lowerIsBetter: false, value: (r) => r.outboundMessages },
  { id: "avgReply", label: "متوسط أول رد (دقيقة)", conversation: true, lowerIsBetter: true, value: (r) => r.avgFirstReplyMin },
  { id: "medianReply", label: "وسيط أول رد (دقيقة)", conversation: true, lowerIsBetter: true, value: (r) => r.medianFirstReplyMin },
  { id: "conversion", label: "تحويل %", conversation: true, lowerIsBetter: false, value: (r) => r.conversionPct },
  { id: "answered", label: "مكالمات مُجابة", conversation: true, lowerIsBetter: false, value: (r) => r.calls?.answered ?? null },
  { id: "missed", label: "مكالمات فائتة", conversation: true, lowerIsBetter: true, value: (r) => r.calls?.missed ?? null },
  { id: "answerRate", label: "نسبة الرد %", conversation: true, lowerIsBetter: false, value: (r) => r.calls?.answerRate ?? null },
  { id: "matched", label: "مكالمة طابقت طلباً", conversation: true, lowerIsBetter: false, value: (r) => r.calls?.matchedOrder ?? null },
  { id: "orders", label: REGISTERED_ORDERS_LABEL, conversation: false, lowerIsBetter: false, value: (r) => r.ordersRegistered },
  { id: "cancelled", label: CANCELLED_ORDERS_LABEL, conversation: false, lowerIsBetter: true, value: (r) => r.ordersCancelled },
  { id: "delivered", label: "طلبات مسلّمة", conversation: false, lowerIsBetter: false, value: (r) => r.ordersDelivered },
  { id: "value", label: "قيمة المسلّم", conversation: false, lowerIsBetter: false, value: (r) => r.deliveredValue },
  { id: "aov", label: "متوسط الطلب", conversation: false, lowerIsBetter: false, value: (r) => r.averageOrderValue },
  { id: "kgReq", label: "كيلو مطلوب", conversation: false, lowerIsBetter: false, value: (r) => totalKg(r.kgRequested) },
  { id: "kgDel", label: "كيلو مسلّم", conversation: false, lowerIsBetter: false, value: (r) => totalKg(r.kgDelivered) },
  { id: "collected", label: "محصّل", conversation: false, lowerIsBetter: false, value: (r) => r.collectionCollected },
  { id: "notCollected", label: "غير محصّل", conversation: false, lowerIsBetter: true, value: (r) => r.collectionNotCollected },
];

export function visibleMetrics(report: ModeratorPeriodReport): MetricDef[] {
  return REPORT_METRICS.filter((m) => !m.conversation || report.conversationsVisible);
}

/** أسماء الصفوف الأفضل في هذا المؤشر. التعادل يُبرز الجميع. القيم الفارغة لا تدخل. */
export function bestSlugs(rows: ModeratorPeriodRow[], metric: MetricDef): string[] {
  const scored = rows
    .map((row) => ({ slug: row.slug, value: metric.value(row) }))
    .filter((x): x is { slug: string; value: number } => x.value != null);
  if (scored.length === 0) return [];
  const target = metric.lowerIsBetter
    ? Math.min(...scored.map((x) => x.value))
    : Math.max(...scored.map((x) => x.value));
  if (scored.every((x) => x.value === target)) return [];
  return scored.filter((x) => x.value === target).map((x) => x.slug);
}

export function viewerMaySeeConversationMetrics(roles: readonly string[] | null | undefined): boolean {
  return !!roles?.some((r) => r === "general_manager" || r === "executive_manager" || r === "sales_manager");
}
