// منطق صناديق المحادثات (بدون واجهة): الفلاتر، المهملة، المؤجلة للصباح، ومؤشرات أول رد.
import {
  DEFAULT_KPI_SETTINGS, evaluateFirstReply, isAbandoned, type AssignmentRow, type FirstReplyStatus, type KpiSettings,
} from "./responseClock";

export type ConversationStatus = "open" | "pending" | "closed" | "spam";

export interface InboxConversation {
  id: string;
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
}

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
  status?: ConversationStatus | "all";
  lineId?: string | "all";
  moderatorId?: string | "all" | "unassigned";
  abandonedOnly?: boolean;
  deferredOnly?: boolean;
}

export const filterConversations = (
  list: InboxConversation[], f: InboxFilters, now: Date, s: KpiSettings = DEFAULT_KPI_SETTINGS,
) => list.filter((c) => {
  if (f.status && f.status !== "all" && c.status !== f.status) return false;
  if (f.lineId && f.lineId !== "all" && c.line_id !== f.lineId) return false;
  if (f.moderatorId === "unassigned" && c.assigned_moderator_id) return false;
  if (f.moderatorId && !["all", "unassigned"].includes(f.moderatorId) && c.assigned_moderator_id !== f.moderatorId) return false;
  if (f.abandonedOnly && !isConversationAbandoned(c, now, s)) return false;
  if (f.deferredOnly && !isDeferredToMorning(c, now)) return false;
  return true;
});

/** الأحدث نشاطاً أولاً. */
export const sortByActivity = (list: InboxConversation[]) =>
  [...list].sort((a, b) => {
    const t = (c: InboxConversation) => Math.max(Date.parse(c.last_inbound_at ?? "") || 0, Date.parse(c.last_outbound_at ?? "") || 0);
    return t(b) - t(a);
  });

/** يخفي منتصف الرقم في القوائم (01xxxxxx345). */
export const maskPhone = (p: string | null) => (!p ? "—" : p.length <= 5 ? p : p.slice(0, 3) + "•".repeat(p.length - 6) + p.slice(-3));
