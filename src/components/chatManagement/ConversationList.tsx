import { Badge } from "@/components/ui/badge";
import { ConversationPhone, OrderBadge, type PhoneAccess } from "./ConversationPhone";
import {
  FIRST_REPLY_LABELS, STATUS_LABELS, firstReplyStatusOf, isConversationAbandoned, isDeferredToMorning, groupByDay,
  type InboxConversation,
} from "@/lib/chatManagement/inbox";
import type { AssignmentRow, KpiSettings } from "@/lib/chatManagement/responseClock";
import { BRAND } from "./brand";
import { ChannelBadge } from "./ChannelTabs";
import { contactLabel } from "@/lib/chatManagement/channels";

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
  /** مستوى إظهار الرقم حسب الدور */
  phoneAccess?: PhoneAccess;
}

export default function ConversationList({ items, selectedId, onSelect, now, assignments, settings, moderatorName, lineName, sourceLabel, phoneAccess = "masked" }: Props) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground p-4 text-center" data-testid="empty-list">لا توجد محادثات</p>;
  return (
    <ul className="max-h-[60vh] overflow-y-auto" dir="rtl" data-testid="conversation-list">
      {groupByDay(items, now, settings.timezone).map((g) => (
      <li key={g.key || "none"} data-testid="day-group">
        <div className="sticky top-0 z-10 bg-background/95 border-b px-3 py-1 text-xs font-semibold flex justify-between" style={{ color: BRAND.purple }} data-testid="day-header">
          <span>{g.label}</span><span>{g.count} محادثة</span>
        </div>
        <ul className="divide-y">
      {g.items.map((c) => {
        const fr = firstReplyStatusOf(c, assignments, now, settings);
        const abandoned = isConversationAbandoned(c, now, settings);
        const deferred = isDeferredToMorning(c, now);
        const src = sourceLabel?.(c) ?? null;
        const who = contactLabel(c);
        return (
          <li key={c.id} className="relative">
            <span className="absolute top-3 right-3 z-[1] flex items-center gap-1">
              <ChannelBadge channel={c.channel} />
              {c.phone_norm || !who ? <ConversationPhone conversationId={c.id} phone={c.phone_norm} access={phoneAccess} />
                : <span className="font-medium text-sm truncate max-w-[12rem]" data-testid="contact-name">{who}</span>}
            </span>
            <button type="button" onClick={() => onSelect(c.id)}
              className={`w-full text-right p-3 hover:bg-muted/50 ${selectedId === c.id ? "bg-muted" : ""}`}
              style={selectedId === c.id ? { borderInlineStart: `3px solid ${BRAND.magenta}` } : undefined}>
              <div className="flex justify-between gap-2">
                <span className="invisible font-medium" dir="ltr" aria-hidden>00000000000 إظهار الرقم</span>
                <span className="flex gap-1 shrink-0">
                  {c.is_demo && <Badge variant="outline" style={{ borderColor: BRAND.orange, color: BRAND.orange }}>تجريبية</Badge>}
                  {c.has_order && <OrderBadge evidence={c.order_evidence} count={c.orders_count} source="chat" tz={settings.timezone} />}
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
      </li>
      ))}
    </ul>
  );
}
