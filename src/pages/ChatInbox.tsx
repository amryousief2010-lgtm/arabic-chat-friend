import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useChatConversations } from "@/hooks/useChatConversations";
import { useAuth } from "@/hooks/useAuth";
import { adSourceLabel, computeKpis, filterConversations, sortByActivity, type DayFilter, type InboxConversation } from "@/lib/chatManagement/inbox";
import KpiStrip from "@/components/chatManagement/KpiStrip";
import ConversationList from "@/components/chatManagement/ConversationList";
import ConversationThread from "@/components/chatManagement/ConversationThread";
import { DayFilterChips, phoneAccessFor } from "@/components/chatManagement/ConversationPhone";
import CustomerPanel from "@/components/chatManagement/CustomerPanel";

const db = supabase as any;

/** صندوق رسائل المودريتور: محادثاتها هي فقط (RLS + فلتر بحسابها). */
export default function ChatInbox() {
  const [myId, setMyId] = useState<string | null | undefined>(undefined);
  useEffect(() => { db.rpc("cm_current_moderator_id").then((r: any) => setMyId(r.data ?? null)); }, []);
  if (myId === undefined) return <DashboardLayout><div dir="rtl" className="p-6 text-muted-foreground">جارٍ التحميل…</div></DashboardLayout>;
  if (myId === null) return (
    <DashboardLayout><div dir="rtl" className="space-y-4">
      <Header title="صندوق الرسائل" subtitle="إدارة المحادثات" />
      <Card><CardContent className="p-6">حسابك غير مربوط بمودريتور في إدارة المحادثات. تواصلي مع مديرة المبيعات.</CardContent></Card>
    </div></DashboardLayout>
  );
  return <InboxFor moderatorId={myId} />;
}

function InboxFor({ moderatorId }: { moderatorId: string }) {
  const { conversations, assignments, settings, lines, campaigns, loading, error } = useChatConversations({ moderatorId });
  const [selected, setSelected] = useState<string | null>(null);
  const { roles } = useAuth() as { roles?: string[] };
  const phoneAccess = phoneAccessFor(roles);
  const [day, setDay] = useState<{ day: DayFilter; date?: string }>({ day: "all" });
  const now = useMemo(() => new Date(), [conversations]);
  const items = useMemo(() => sortByActivity(filterConversations(conversations, day, now, settings)), [conversations, day, now, settings]);
  const kpis = useMemo(() => computeKpis(conversations, assignments, now, settings), [conversations, assignments, now, settings]);
  const sel = items.find((c) => c.id === selected) ?? null;
  const srcOf = (c: InboxConversation) => adSourceLabel(c, campaigns.find((x) => x.id === c.campaign_id)?.name);
  const lineName = (id: string | null) => lines.find((l) => l.id === id)?.label ?? "—";
  return (
    <DashboardLayout>
      <div dir="rtl" className="space-y-4">
        <Header title="صندوق الرسائل" subtitle="محادثاتك فقط — الإرسال من هنا يُفعَّل بعد ربط واتساب" />
        {error && <p className="text-sm text-destructive">تعذّر التحميل: {error}</p>}
        <KpiStrip kpis={kpis} />
        <DayFilterChips day={day.day} date={day.date} onChange={setDay} />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <Card className="lg:col-span-4"><CardContent className="p-0">
            {loading ? <p className="p-4 text-muted-foreground">جارٍ التحميل…</p> :
              <ConversationList items={items} phoneAccess={phoneAccess} selectedId={selected} onSelect={setSelected} now={now}
                assignments={assignments} settings={settings} lineName={lineName} sourceLabel={srcOf} />}
          </CardContent></Card>
          <div className="lg:col-span-5"><ConversationThread conversationId={selected} phone={sel?.phone_norm ?? null} phoneAccess={phoneAccess} evidence={sel?.order_evidence} source={sel ? srcOf(sel) : null} /></div>
          <div className="lg:col-span-3"><CustomerPanel customerId={sel?.customer_id ?? null} phoneNorm={sel?.phone_norm ?? null} /></div>
        </div>
      </div>
    </DashboardLayout>
  );
}
