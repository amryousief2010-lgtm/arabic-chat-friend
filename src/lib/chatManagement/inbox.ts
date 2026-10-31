// منطق صناديق المحادثات (بدون واجهة): الفلاتر، المهملة، المؤجلة للصباح، ومؤشرات أول رد.
import {
  DEFAULT_KPI_SETTINGS, evaluateFirstReply, isAbandoned, type AssignmentRow, type FirstReplyStatus, type KpiSettings,
} from "./responseClock";

export type ConversationStatus = "open" | "pending" | "closed" | "spam";

export interface InboxConversation {
  id: string;
  /** whatsapp | messenger | instagram | tiktok */
  channel?: string | null;
  /** اسم/معرّف العميل في ماسنجر/إنستجرام (لا يوجد رقم) */
  contact_name?: string | null;
  contact_handle?: string | null;
  external_contact_id?: string | null;
  /** بيانات عرض تجريبية */
  is_demo?: boolean | null;
  line_id: string | null;
  status: ConversationStatus;
  owner_moderator_id: string | null;
  assigned_moderator_id: string | null;
  phone_norm: string | null;
  customer_id: string | null;
  first_inbound_at: string | null;
  clock_started_at: string | null;
  first_reply_at: string | null;
  first_reply_was_cover: boolean | null;
  awaiting_reply_since: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  campaign_id?: string | null;
  ad_id?: string | null;
  ad_headline?: string | null;
  ad_source_type?: string | null;
  /** نتج عنها طلب فعلي (نفس تعريف «تحوّلت» في المؤشرات: طلب غير ملغي مربوط خلال نافذة التحويل). */
  has_order?: boolean;
  orders_count?: number;
  /** أدلة الطلبات المطابقة برقم العميل */
  order_evidence?: OrderEvidence[];
}

/** دليل طلب مطابق (من cm_conversation_order_flags / cm_call_order_flags). */
export interface OrderEvidence {
  order_id: string;
  order_number: string | null;
  created_at: string;
  status?: string | null;
  customer_name: string | null;
  registered_by: string | null;
  registered_by_id?: string | null;
  same_moderator: boolean | null;
  method?: string | null;
}

export const sameModeratorLabel = (e: Pick<OrderEvidence, "same_moderator">) =>
  e.same_moderator === true ? "سُجّل بواسطة نفس المودريتور" : e.same_moderator === false ? "سُجّل بواسطة مودريتور آخر" : "المودريتور غير محدد";

/** نص الدليل لتلميح الشارة. */
export const orderEvidenceText = (ev: OrderEvidence[] | undefined, source: "chat" | "call", tz = "Africa/Cairo"): string => {
  if (!ev?.length) return "";
  const head = source === "chat" ? "من المحادثة" : "من المكالمة";
  const d = (iso: string) => new Intl.DateTimeFormat("ar-EG-u-nu-latn", { timeZone: tz, day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  return [`${head} — مطابقة برقم العميل في الطلبات`, ...ev.map((e) =>
    `طلب ${e.order_number ?? "—"} · ${d(e.created_at)} · العميل: ${e.customer_name ?? "—"} · سجّلته: ${e.registered_by ?? "غير معروف"} · ${sameModeratorLabel(e)}`)].join("\n");
};

/** مصدر المحادثة للعرض: إعلان (عنوان + آخر أرقام المعرّف) أو عضوي. */
export const adSourceLabel = (c: Pick<InboxConversation, "ad_id" | "ad_headline" | "campaign_id">, campaignName?: string | null): string | null => {
  if (!c.ad_id && !c.campaign_id) return null;
  if (campaignName) return campaignName;
  const head = (c.ad_headline ?? "").replace(/^[\u064B-\u0652\s]+/, "").trim() || "إعلان";
  return c.ad_id ? `${head} · …${c.ad_id.slice(-6)}` : head;
};

export const STATUS_LABELS: Record<ConversationStatus, string> = {
  open: "مفتوحة", pending: "قيد المتابعة", closed: "مغلقة", spam: "مزعجة",
};
export const FIRST_REPLY_LABELS: Record<FirstReplyStatus, string> = {
  on_time: "في الوقت", cover: "تغطية", late: "متأخر", pending: "بانتظار الرد",
};

const d = (s: string | null) => (s ? new Date(s) : null);
const isActive = (c: InboxConversation) => c.status === "open" || c.status === "pending";

/** مهملة: مفتوحة ووصلتها رسالة لم يُرد عليها لمدة abandoned_minutes داخل نافذة الخدمة. */
export const isConversationAbandoned = (c: InboxConversation, now: Date, s: KpiSettings = DEFAULT_KPI_SETTINGS) =>
  isActive(c) && !!c.last_inbound_at && isAbandoned(new Date(c.last_inbound_at), d(c.last_outbound_at), now, s);

/** مؤجلة للصباح: بانتظار الرد وبداية عدّها (09:00) بعد وصول الرسالة — أي وصلت بين 01:00 و09:00. */
export const isDeferredToMorning = (c: InboxConversation, now: Date) => {
  if (!isActive(c) || !c.awaiting_reply_since) return false;
  const since = new Date(c.awaiting_reply_since);
  if (since > now) return true;
  return !c.first_reply_at && !!c.clock_started_at && !!c.first_inbound_at
    && new Date(c.clock_started_at) > new Date(c.first_inbound_at) && since.getTime() === new Date(c.clock_started_at).getTime();
};

/** حالة أول رد: «تغطية» إن ردّت غير المسندة، وإلا حسب evaluateFirstReply (نفس تعريف الخطوة 1). */
export const firstReplyStatusOf = (
  c: InboxConversation, assignments: AssignmentRow[], now: Date, s: KpiSettings = DEFAULT_KPI_SETTINGS,
): FirstReplyStatus | null => {
  if (!c.first_inbound_at) return null;
  if (c.first_reply_at && c.first_reply_was_cover) return "cover";
  return evaluateFirstReply({
    arrival: new Date(c.first_inbound_at), firstReply: d(c.first_reply_at), now,
    ownerId: c.owner_moderator_id ?? c.assigned_moderator_id, assignments, settings: s,
  }).status;
};

export interface InboxKpis { on_time: number; cover: number; late: number; pending: number; abandoned: number; total: number }

export const computeKpis = (
  list: InboxConversation[], assignments: AssignmentRow[], now: Date, s: KpiSettings = DEFAULT_KPI_SETTINGS,
): InboxKpis => {
  const k: InboxKpis = { on_time: 0, cover: 0, late: 0, pending: 0, abandoned: 0, total: list.length };
  for (const c of list) {
    const st = firstReplyStatusOf(c, assignments, now, s);
    if (st) k[st]++;
    if (isConversationAbandoned(c, now, s)) k.abandoned++;
  }
  return k;
};

export interface InboxFilters {
  /** القناة: all | whatsapp | messenger | instagram | tiktok */
  channel?: string;
  status?: ConversationStatus | "all";
  lineId?: string | "all";
  moderatorId?: string | "all" | "unassigned";
  abandonedOnly?: boolean;
  deferredOnly?: boolean;
  /** "all" | "ads" (أي إعلان) | "organic" | campaign_id */
  source?: string;
  /** "all" | "yes" (تم الطلب) | "no" (بدون طلب) */
  ordered?: "all" | "yes" | "no";
  /** فلتر اليوم حسب آخر نشاط (بتوقيت الإعدادات مثل cm_local_date) */
  day?: DayFilter;
  /** YYYY-MM-DD عند day = "date" */
  date?: string;
}

export type DayFilter = "all" | "today" | "yesterday" | "7d" | "date";

/** تاريخ محلي YYYY-MM-DD في المنطقة الزمنية (نفس اصطلاح cm_local_date). */
export const localDateKey = (d: Date, tz = "Africa/Cairo") =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

const shiftKey = (key: string, days: number) => {
  const d = new Date(key + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
};

export const lastActivityAt = (c: Pick<InboxConversation, "last_inbound_at" | "last_outbound_at" | "first_inbound_at">): number =>
  Math.max(Date.parse(c.last_inbound_at ?? "") || 0, Date.parse(c.last_outbound_at ?? "") || 0, Date.parse(c.first_inbound_at ?? "") || 0);

export const activityDateKey = (c: InboxConversation, tz = "Africa/Cairo") => {
  const t = lastActivityAt(c); return t ? localDateKey(new Date(t), tz) : "";
};

export const matchesDay = (key: string, f: Pick<InboxFilters, "day" | "date">, now: Date, tz = "Africa/Cairo") => {
  if (!f.day || f.day === "all") return true;
  const today = localDateKey(now, tz);
  if (f.day === "today") return key === today;
  if (f.day === "yesterday") return key === shiftKey(today, -1);
  if (f.day === "7d") return !!key && key >= shiftKey(today, -6) && key <= today;
  return !f.date || key === f.date;
};

/** عنوان اليوم: اليوم / أمس / «الخميس 29 أكتوبر». */
export const dayHeaderLabel = (key: string, now: Date, tz = "Africa/Cairo") => {
  if (!key) return "بدون تاريخ";
  const today = localDateKey(now, tz);
  if (key === today) return "اليوم";
  if (key === shiftKey(today, -1)) return "أمس";
  const d = new Date(key + "T12:00:00Z");
  const sameYear = key.slice(0, 4) === today.slice(0, 4);
  const p = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("ar-EG-u-nu-latn", { timeZone: "UTC", ...o }).format(d);
  return `${p({ weekday: "long" })} ${Number(key.slice(8, 10))} ${p({ month: "long" })}${sameYear ? "" : " " + key.slice(0, 4)}`;
};

export interface DayGroup { key: string; label: string; count: number; items: InboxConversation[] }

/** يجمع قائمة (مرتبة بالنشاط) حسب يوم آخر نشاط، مع الحفاظ على الترتيب. */
export const groupByDay = (list: InboxConversation[], now: Date, tz = "Africa/Cairo"): DayGroup[] => {
  const out: DayGroup[] = []; const idx = new Map<string, DayGroup>();
  for (const c of list) {
    const key = activityDateKey(c, tz);
    let g = idx.get(key);
    if (!g) { g = { key, label: dayHeaderLabel(key, now, tz), count: 0, items: [] }; idx.set(key, g); out.push(g); }
    g.items.push(c); g.count++;
  }
  return out;
};

export const filterConversations = (
  list: InboxConversation[], f: InboxFilters, now: Date, s: KpiSettings = DEFAULT_KPI_SETTINGS,
) => list.filter((c) => {
  if (f.channel && f.channel !== "all" && (c.channel ?? "whatsapp") !== f.channel) return false;
  if (f.status && f.status !== "all" && c.status !== f.status) return false;
  if (f.lineId && f.lineId !== "all" && c.line_id !== f.lineId) return false;
  if (f.moderatorId === "unassigned" && c.assigned_moderator_id) return false;
  if (f.moderatorId && !["all", "unassigned"].includes(f.moderatorId) && c.assigned_moderator_id !== f.moderatorId) return false;
  if (f.abandonedOnly && !isConversationAbandoned(c, now, s)) return false;
  if (f.deferredOnly && !isDeferredToMorning(c, now)) return false;
  if (f.source && f.source !== "all") {
    const fromAd = !!(c.ad_id || c.campaign_id);
    if (f.source === "ads" ? !fromAd : f.source === "organic" ? fromAd : c.campaign_id !== f.source) return false;
  }
  if (f.ordered === "yes" && !c.has_order) return false;
  if (f.ordered === "no" && c.has_order) return false;
  if (f.day && f.day !== "all" && !matchesDay(activityDateKey(c, s.timezone), f, now, s.timezone)) return false;
  return true;
});

/** يدمج أعلام الطلب (من cm_conversation_order_flags) في المحادثات. */
export const withOrderFlags = (
  list: InboxConversation[], flags: { conversation_id: string; orders: number | string | null; evidence?: OrderEvidence[] | null }[],
): InboxConversation[] => {
  const m = new Map(flags.map((f) => [f.conversation_id, f]));
  return list.map((c) => {
    const f = m.get(c.id);
    return { ...c, has_order: !!f, orders_count: f ? Number(f.orders ?? 0) || 1 : 0, order_evidence: f?.evidence ?? [] };
  });
};

/** الأحدث نشاطاً أولاً. */
export const sortByActivity = (list: InboxConversation[]) =>
  [...list].sort((a, b) => {
    return lastActivityAt(b) - lastActivityAt(a);
  });

/** يخفي منتصف الرقم في القوائم (01xxxxxx345). */
export const maskPhone = (p: string | null) => (!p ? "—" : p.length <= 5 ? p : p.slice(0, 3) + "•".repeat(p.length - 6) + p.slice(-3));
