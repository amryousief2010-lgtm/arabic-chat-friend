import { Badge } from "@/components/ui/badge";
import {
  FIRST_REPLY_LABELS, STATUS_LABELS, firstReplyStatusOf, isConversationAbandoned, isDeferredToMorning, maskPhone,
  type InboxConversation,
} from "@/lib/chatManagement/inbox";
import type { AssignmentRow, KpiSettings } from "@/lib/chatManagement/responseClock";
import { BRAND } from "./brand";

interface Props {
  items: InboxConversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  now: Date;
  assignments: AssignmentRow[];
  settings: KpiSettings;
  moderatorName?: (id: string | null) => string;
  lineName?: (id: string | null) => string;
  /** نص مصدر الإعلان أو null للعضوي */
  sourceLabel?: (c: InboxConversation) => string | null;
}

export default function ConversationList({ items, selectedId, onSelect, now, assignments, settings, moderatorName, lineName, sourceLabel }: Props) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground p-4 text-center" data-testid="empty-list">لا توجد محادثات</p>;
  return (
    <ul className="divide-y max-h-[60vh] overflow-y-auto" dir="rtl" data-testid="conversation-list">
      {items.map((c) => {
        const fr = firstReplyStatusOf(c, assignments, now, settings);
        const abandoned = isConversationAbandoned(c, now, settings);
        const deferred = isDeferredToMorning(c, now);
        const src = sourceLabel?.(c) ?? null;
        return (
          <li key={c.id}>
            <button type="button" onClick={() => onSelect(c.id)}
              className={`w-full text-right p-3 hover:bg-muted/50 ${selectedId === c.id ? "bg-muted" : ""}`}
              style={selectedId === c.id ? { borderInlineStart: `3px solid ${BRAND.magenta}` } : undefined}>
              <div className="flex justify-between gap-2">
                <span className="font-medium" dir="ltr">{maskPhone(c.phone_norm)}</span>
                <span className="flex gap-1 shrink-0">
                  {c.has_order && <Badge style={{ background: "#16a34a", color: "#fff" }} data-testid="order-badge"
                    title={c.orders_count && c.orders_count > 1 ? `${c.orders_count} طلبات` : "طلب واحد"}>✓ تم الطلب</Badge>}
                  <Badge variant="outline">{STATUS_LABELS[c.status]}</Badge>
                </span>
              </div>
              <div className="flex flex-wrap gap-1 mt-1 text-xs text-muted-foreground">
                {lineName && <span>{lineName(c.line_id)}</span>}
                {moderatorName && <span>· {moderatorName(c.assigned_moderator_id)}</span>}
                {fr && <Badge variant="secondary">{FIRST_REPLY_LABELS[fr]}</Badge>}
                {abandoned && <Badge style={{ background: BRAND.orange, color: "#fff" }}>مهملة</Badge>}
                {deferred && <Badge style={{ background: BRAND.purple, color: "#fff" }}>مؤجلة للصباح</Badge>}
              </div>
              {src && <div className="mt-1 text-xs text-muted-foreground truncate" title={src} data-testid="ad-badge">📣 {src}</div>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
