import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Paperclip, Plus, Inbox, Send as SendIcon, Archive, Mail, MailOpen } from "lucide-react";
import { PriorityBadge, MessagePriority } from "@/components/internal-messages/PriorityBadge";
import { ComposeMessageDialog } from "@/components/internal-messages/ComposeMessageDialog";
import { formatDistanceToNow } from "date-fns";
import { ar } from "date-fns/locale";

type Tab = "inbox" | "sent" | "archived";
type Filter = "all" | "unread" | "important" | "urgent";

interface InboxRow {
  recipient_row_id: string;
  message_id: string;
  read_at: string | null;
  archived_at: string | null;
  subject: string;
  body: string;
  priority: MessagePriority;
  has_attachments: boolean;
  created_at: string;
  sender_id: string;
  sender_name: string;
}

interface SentRow {
  id: string;
  subject: string;
  body: string;
  priority: MessagePriority;
  has_attachments: boolean;
  created_at: string;
  recipients: { recipient_id: string; recipient_name: string; read_at: string | null }[];
}

const InternalMessages = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("inbox");
  const [filter, setFilter] = useState<Filter>("all");
  const [compose, setCompose] = useState(false);

  // Realtime: refetch lists on any change to my recipient rows or messages I sent
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`internal-msg-lists-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "internal_message_recipients", filter: `recipient_id=eq.${user.id}` },
        () => qc.invalidateQueries({ queryKey: ["internal-messages"] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "internal_messages", filter: `sender_id=eq.${user.id}` },
        () => qc.invalidateQueries({ queryKey: ["internal-messages"] }),
      )
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [user?.id, qc]);

  // Inbox + Archived share the same query (filtered on the client by archived_at)
  const inboxQ = useQuery({
    queryKey: ["internal-messages", "inbox", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<InboxRow[]> => {
      const { data: recs } = await (supabase as any)
        .from("internal_message_recipients")
        .select("id, message_id, read_at, archived_at")
        .eq("recipient_id", user!.id)
        .order("created_at", { ascending: false });
      const rows = recs || [];
      if (rows.length === 0) return [];
      const ids = rows.map((r: any) => r.message_id);
      const { data: msgs } = await (supabase as any)
        .from("internal_messages")
        .select("id, subject, body, priority, has_attachments, created_at, sender_id")
        .in("id", ids)
        .eq("is_deleted", false);
      const senderIds = Array.from(new Set((msgs || []).map((m: any) => m.sender_id as string))) as string[];
      const { data: profiles } = senderIds.length
        ? await supabase.from("profile_directory").select("id, full_name").in("id", senderIds)
        : { data: [] as any[] };
      const nameMap = new Map((profiles || []).map((p: any) => [p.id, p.full_name || "موظف"]));
      const msgMap = new Map((msgs || []).map((m: any) => [m.id, m]));
      return rows
        .filter((r: any) => msgMap.has(r.message_id))
        .map((r: any) => {
          const m = msgMap.get(r.message_id) as any;
          return {
            recipient_row_id: r.id,
            message_id: r.message_id,
            read_at: r.read_at,
            archived_at: r.archived_at,
            subject: m.subject,
            body: m.body,
            priority: m.priority,
            has_attachments: m.has_attachments,
            created_at: m.created_at,
            sender_id: m.sender_id,
            sender_name: nameMap.get(m.sender_id) || "موظف",
          };
        })
        .sort((a: InboxRow, b: InboxRow) => b.created_at.localeCompare(a.created_at));
    },
  });

  const sentQ = useQuery({
    queryKey: ["internal-messages", "sent", user?.id],
    enabled: !!user && tab === "sent",
    queryFn: async (): Promise<SentRow[]> => {
      const { data: msgs } = await (supabase as any)
        .from("internal_messages")
        .select("id, subject, body, priority, has_attachments, created_at")
        .eq("sender_id", user!.id)
        .eq("is_deleted", false)
        .order("created_at", { ascending: false });
      const rows = msgs || [];
      if (rows.length === 0) return [];
      const ids = rows.map((m: any) => m.id);
      const { data: recs } = await (supabase as any)
        .from("internal_message_recipients")
        .select("message_id, recipient_id, read_at")
        .in("message_id", ids);
      const recipientIds = Array.from(new Set((recs || []).map((r: any) => r.recipient_id as string))) as string[];
      const { data: profiles } = recipientIds.length
        ? await supabase.from("profile_directory").select("id, full_name").in("id", recipientIds)
        : { data: [] as any[] };
      const nameMap = new Map((profiles || []).map((p: any) => [p.id, p.full_name || "موظف"]));
      const byMsg = new Map<string, SentRow["recipients"]>();
      (recs || []).forEach((r: any) => {
        const list = byMsg.get(r.message_id) || [];
        list.push({ recipient_id: r.recipient_id, recipient_name: nameMap.get(r.recipient_id) || "موظف", read_at: r.read_at });
        byMsg.set(r.message_id, list);
      });
      return rows.map((m: any) => ({ ...m, recipients: byMsg.get(m.id) || [] }));
    },
  });

  const inboxRows = useMemo(() => (inboxQ.data || []).filter((r) => !r.archived_at), [inboxQ.data]);
  const archivedRows = useMemo(() => (inboxQ.data || []).filter((r) => !!r.archived_at), [inboxQ.data]);

  const filteredInbox = useMemo(() => {
    return inboxRows.filter((r) => {
      if (filter === "unread") return !r.read_at;
      if (filter === "important") return r.priority === "important";
      if (filter === "urgent") return r.priority === "urgent";
      return true;
    });
  }, [inboxRows, filter]);

  return (
    <DashboardLayout>
      <Header title="الرسائل الداخلية" subtitle="رسائل خاصة بين موظفي التطبيق" />

      <div className="flex items-center justify-between mb-4">
        <div />
        <Button onClick={() => setCompose(true)} className="gap-2">
          <Plus className="w-4 h-4" /> إنشاء رسالة جديدة
        </Button>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="grid grid-cols-3 w-full max-w-md">
          <TabsTrigger value="inbox" className="gap-1">
            <Inbox className="w-4 h-4" /> الوارد
            {inboxRows.filter((r) => !r.read_at).length > 0 && (
              <Badge variant="destructive" className="h-5 min-w-5 px-1.5 text-xs ml-1">
                {inboxRows.filter((r) => !r.read_at).length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="sent" className="gap-1"><SendIcon className="w-4 h-4" /> المرسلة</TabsTrigger>
          <TabsTrigger value="archived" className="gap-1"><Archive className="w-4 h-4" /> المؤرشفة</TabsTrigger>
        </TabsList>

        <TabsContent value="inbox" className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            {(["all", "unread", "important", "urgent"] as Filter[]).map((f) => (
              <Button
                key={f}
                variant={filter === f ? "default" : "outline"}
                size="sm"
                onClick={() => setFilter(f)}
              >
                {f === "all" ? "الكل" : f === "unread" ? "غير مقروء" : f === "important" ? "مهم" : "عاجل"}
              </Button>
            ))}
          </div>
          <MessageListInbox rows={filteredInbox} onOpen={(id) => navigate(`/internal-messages/${id}`)} loading={inboxQ.isLoading} />
        </TabsContent>

        <TabsContent value="sent" className="mt-4">
          <MessageListSent rows={sentQ.data || []} loading={sentQ.isLoading} onOpen={(id) => navigate(`/internal-messages/${id}`)} />
        </TabsContent>

        <TabsContent value="archived" className="mt-4">
          <MessageListInbox rows={archivedRows} onOpen={(id) => navigate(`/internal-messages/${id}`)} loading={inboxQ.isLoading} />
        </TabsContent>
      </Tabs>

      <ComposeMessageDialog open={compose} onOpenChange={setCompose} />
    </DashboardLayout>
  );
};

const MessageListInbox = ({ rows, onOpen, loading }: { rows: InboxRow[]; onOpen: (id: string) => void; loading: boolean }) => {
  if (loading) return <Card className="glass-card"><CardContent className="py-8 text-center text-muted-foreground">جاري التحميل...</CardContent></Card>;
  if (rows.length === 0) return <Card className="glass-card"><CardContent className="py-12 text-center text-muted-foreground">لا توجد رسائل</CardContent></Card>;
  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const isUnread = !r.read_at;
        return (
          <Card
            key={r.recipient_row_id}
            className={`glass-card cursor-pointer hover:shadow-md transition ${isUnread ? "border-r-4 border-r-primary" : ""}`}
            onClick={() => onOpen(r.message_id)}
          >
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="mt-1">
                  {isUnread ? <Mail className="w-5 h-5 text-primary" /> : <MailOpen className="w-5 h-5 text-muted-foreground" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="font-semibold truncate">{r.sender_name}</div>
                    <div className="flex items-center gap-2">
                      <PriorityBadge priority={r.priority} />
                      {r.has_attachments && <Paperclip className="w-4 h-4 text-muted-foreground" />}
                    </div>
                  </div>
                  <div className={`text-sm mt-0.5 truncate ${isUnread ? "font-medium" : ""}`}>{r.subject}</div>
                  <div className="text-xs text-muted-foreground mt-1 line-clamp-1">{r.body}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {formatDistanceToNow(new Date(r.created_at), { addSuffix: true, locale: ar })}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};

const MessageListSent = ({ rows, onOpen, loading }: { rows: SentRow[]; onOpen: (id: string) => void; loading: boolean }) => {
  if (loading) return <Card className="glass-card"><CardContent className="py-8 text-center text-muted-foreground">جاري التحميل...</CardContent></Card>;
  if (rows.length === 0) return <Card className="glass-card"><CardContent className="py-12 text-center text-muted-foreground">لا توجد رسائل مرسلة</CardContent></Card>;
  return (
    <div className="space-y-2">
      {rows.map((m) => {
        const readCount = m.recipients.filter((r) => r.read_at).length;
        return (
          <Card key={m.id} className="glass-card cursor-pointer hover:shadow-md transition" onClick={() => onOpen(m.id)}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{m.subject}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    إلى: {m.recipients.map((r) => r.recipient_name).join("، ")}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 line-clamp-1">{m.body}</div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <PriorityBadge priority={m.priority} />
                  <Badge variant="outline" className="text-xs">
                    قرأها {readCount} من {m.recipients.length}
                  </Badge>
                  {m.has_attachments && <Paperclip className="w-4 h-4 text-muted-foreground" />}
                  <div className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(m.created_at), { addSuffix: true, locale: ar })}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};

export default InternalMessages;
