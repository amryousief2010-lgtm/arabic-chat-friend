import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { canListenRecordings, canManageConversations } from "@/config/chatManagement";
import { maskPhone, orderEvidenceText, sameModeratorLabel, type OrderEvidence, type DayFilter } from "@/lib/chatManagement/inbox";
import { formatDateTime12 } from "@/lib/chatManagement/timeFormat";
import { Badge } from "@/components/ui/badge";

const db = supabase as any;
export type PhoneAccess = "full" | "reveal" | "masked";

/** رقم العميل: كامل للمديرين، إظهار مُسجَّل (cm_reveal_conversation_phone) لمن يملك صلاحية التسجيلات، ومُقنَّع لغيرهم. */
export function ConversationPhone({ conversationId, phone, access }: { conversationId: string; phone: string | null; access: PhoneAccess }) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const shown = access === "full" ? phone : revealed;
  const reveal = async () => {
    const { data, error } = await db.rpc("cm_reveal_conversation_phone", { _conversation_id: conversationId });
    if (error) { toast.error(error.message.includes("CM_NO_PHONE") ? "لا يوجد رقم لهذه المحادثة" : "غير مسموح بإظهار الرقم"); return; }
    setRevealed(data as string);
  };
  const copy = async () => {
    if (!shown) return;
    try { await navigator.clipboard.writeText(shown); toast.success("تم نسخ الرقم"); } catch { toast.error("تعذّر النسخ"); }
  };
  return (
    <span className="inline-flex items-center gap-1" data-testid="conv-phone">
      <span className="font-medium" dir="ltr">{shown ?? maskPhone(phone)}</span>
      {shown && <button type="button" className="text-xs underline text-muted-foreground" onClick={(e) => { e.stopPropagation(); copy(); }} data-testid="copy-phone">نسخ</button>}
      {!shown && access === "reveal" && phone && <button type="button" className="text-xs underline text-muted-foreground" onClick={(e) => { e.stopPropagation(); reveal(); }} data-testid="reveal-phone">إظهار الرقم</button>}
    </span>
  );
}

/** شارة «تم الطلب» مع الدليل في التلميح. */
export function OrderBadge({ evidence, count, source, tz }: { evidence?: OrderEvidence[]; count?: number; source: "chat" | "call"; tz?: string }) {
  const t = orderEvidenceText(evidence, source, tz) || (count && count > 1 ? `${count} طلبات` : "طلب واحد");
  return <Badge style={{ background: "#16a34a", color: "#fff" }} data-testid="order-badge" title={t}>✓ تم الطلب</Badge>;
}

/** لوحة الأدلة (في المحادثة المفتوحة). */
export function OrderEvidencePanel({ evidence, source }: { evidence?: OrderEvidence[]; source: "chat" | "call" }) {
  if (!evidence?.length) return null;
  return (
    <div className="rounded-md border border-green-600/40 bg-green-50 p-2 text-xs space-y-1" data-testid="order-evidence">
      <div className="font-medium text-green-800">✓ تم الطلب — {source === "chat" ? "من المحادثة" : "من المكالمة"} (مطابقة برقم العميل في الطلبات)</div>
      {evidence.map((e) => (
        <div key={e.order_id}>
          طلب <b dir="ltr">{e.order_number ?? "—"}</b> · {formatDateTime12(e.created_at)} · العميل: {e.customer_name ?? "—"} · سجّلته: {e.registered_by ?? "غير معروف"} · {sameModeratorLabel(e)}
        </div>
      ))}
    </div>
  );
}

const DAY_CHIPS: { v: DayFilter; label: string }[] = [
  { v: "all", label: "كل الأيام" }, { v: "today", label: "اليوم" }, { v: "yesterday", label: "أمس" }, { v: "7d", label: "آخر 7 أيام" }, { v: "date", label: "تاريخ محدد" },
];
/** شرائح فلتر اليوم. */
export function DayFilterChips({ day = "all", date, onChange }: { day?: DayFilter; date?: string; onChange: (p: { day: DayFilter; date?: string }) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1" data-testid="day-filter">
      {DAY_CHIPS.map((c) => (
        <button key={c.v} type="button" onClick={() => onChange({ day: c.v, date })}
          className={`rounded-full border px-3 py-1 text-xs ${day === c.v ? "bg-primary text-primary-foreground" : "bg-background"}`}>{c.label}</button>
      ))}
      {day === "date" && <input type="date" className="rounded border px-2 py-1 text-xs" value={date ?? ""} onChange={(e) => onChange({ day: "date", date: e.target.value })} aria-label="التاريخ" />}
    </div>
  );
}

export const phoneAccessFor = (roles: readonly string[] | null | undefined): PhoneAccess =>
  canManageConversations(roles) ? "full" : canListenRecordings(roles) ? "reveal" : "masked";
