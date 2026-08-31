import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, Clock, Loader2, Send, Timer } from "lucide-react";
import { PriorityBadge, MessagePriority } from "@/components/internal-messages/PriorityBadge";
import { useMandatoryMessages } from "@/hooks/useMandatoryMessages";
import { toast } from "sonner";
import { format } from "date-fns";
import { ar } from "date-fns/locale";

interface MyRow {
  message_id: string;
  subject: string;
  body: string;
  priority: MessagePriority;
  created_at: string;
  reply_due_at: string | null;
  replied_at: string | null;
  sender_name: string;
}

interface SentRow {
  id: string;
  subject: string;
  created_at: string;
  priority: MessagePriority;
  reply_due_at: string | null;
  recipients: { recipient_id: string; name: string; read_at: string | null; replied_at: string | null }[];
}

const fmt = (d: string | null) => (d ? format(new Date(d), "d MMM yyyy - HH:mm", { locale: ar }) : "—");

const MandatoryMessages = () => {
  const { user, isGeneralManager } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { refetch: refetchCount } = useMandatoryMessages();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sendingId, setSendingId] = useState<string | null>(null);

  const mineQ = useQuery({
    queryKey: ["mandatory-messages-page", "mine", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<MyRow[]> => {
      const { data: recs } = await (supabase as any)
        .from("internal_message_recipients")
        .select("message_id, replied_at")
        .eq("recipient_id", user!.id);
      const rows = recs || [];
      if (rows.length === 0) return [];
      const { data: msgs } = await (supabase as any)
        .from("internal_messages")
        .select("id, subject, body, priority, created_at, reply_due_at, sender_id")
        .in("id", rows.map((r: any) => r.message_id))
        .eq("requires_reply", true)
        .eq("is_deleted", false);
      const list = msgs || [];
      if (list.length === 0) return [];
      const senderIds = Array.from(new Set(list.map((m: any) => String(m.sender_id))));
      const { data: profiles } = await supabase.from("profile_directory").select("id, full_name").in("id", senderIds);
      const nameMap = new Map((profiles || []).map((p: any) => [p.id, p.full_name || "موظف"]));
      const repliedMap = new Map(rows.map((r: any) => [r.message_id, r.replied_at]));
      return list
        .map((m: any) => ({
          message_id: m.id,
          subject: m.subject,
          body: m.body,
          priority: m.priority,
          created_at: m.created_at,
          reply_due_at: m.reply_due_at,
          replied_at: repliedMap.get(m.id) ?? null,
          sender_name: nameMap.get(m.sender_id) || "موظف",
        }))
        .sort((a, b) => Number(!!a.replied_at) - Number(!!b.replied_at) || +new Date(b.created_at) - +new Date(a.created_at));
    },
  });

  const sentQ = useQuery({
    queryKey: ["mandatory-messages-page", "sent", user?.id],
    enabled: !!user && !!isGeneralManager,
    queryFn: async (): Promise<SentRow[]> => {
      const { data: msgs } = await (supabase as any)
        .from("internal_messages")
        .select("id, subject, created_at, priority, reply_due_at")
        .eq("sender_id", user!.id)
        .eq("requires_reply", true)
        .eq("is_deleted", false)
        .order("created_at", { ascending: false });
      const list = msgs || [];
      if (list.length === 0) return [];
      const { data: recs } = await (supabase as any)
        .from("internal_message_recipients")
        .select("message_id, recipient_id, read_at, replied_at")
        .in("message_id", list.map((m: any) => m.id));
      const ids = Array.from(new Set((recs || []).map((r: any) => String(r.recipient_id))));
      const { data: profiles } = ids.length
        ? await supabase.from("profile_directory").select("id, full_name").in("id", ids)
        : { data: [] as any[] };
      const nameMap = new Map((profiles || []).map((p: any) => [p.id, p.full_name || "موظف"]));
      return list.map((m: any) => ({
        ...m,
        recipients: (recs || [])
          .filter((r: any) => r.message_id === m.id)
          .map((r: any) => ({
            recipient_id: r.recipient_id,
            name: nameMap.get(r.recipient_id) || "موظف",
            read_at: r.read_at,
            replied_at: r.replied_at,
          })),
      }));
    },
  });

  const sendReply = async (messageId: string) => {
    const body = (drafts[messageId] || "").trim();
    if (!body) {
      toast.error("لا يمكن إرسال رد فارغ");
      return;
    }
    setSendingId(messageId);
    const { error } = await (supabase as any).rpc("im_send_reply", { p_message_id: messageId, p_body: body });
    setSendingId(null);
    if (error) {
      toast.error(error.message.includes("empty_reply_not_allowed") ? "لا يمكن إرسال رد فارغ" : error.message);
      return;
    }
    toast.success("تم إرسال الرد");
    setDrafts((d) => ({ ...d, [messageId]: "" }));
    qc.invalidateQueries({ queryKey: ["mandatory-messages-page"] });
    qc.invalidateQueries({ queryKey: ["mandatory-internal-messages"] });
    void refetchCount();
  };

  const mine = mineQ.data || [];
  const pending = mine.filter((m) => !m.replied_at);
  const answered = mine.filter((m) => m.replied_at);

  return (
    <DashboardLayout>
      <Header title="الرسائل الإلزامية" subtitle="رسائل المدير العام التي تتطلب ردًا فعليًا" />
      <div className="p-4 md:p-6 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              <div>
                <p className="text-xs text-muted-foreground">بانتظار ردك</p>
                <p className="text-xl font-bold">{pending.length}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              <div>
                <p className="text-xs text-muted-foreground">تم الرد عليها</p>
                <p className="text-xl font-bold">{answered.length}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="col-span-2 md:col-span-1">
            <CardContent className="p-4 flex items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">كل الرسائل</span>
              <Button variant="outline" size="sm" onClick={() => navigate("/internal-messages")}>
                الرسائل الداخلية
              </Button>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="mine">
          <TabsList>
            <TabsTrigger value="mine">الواردة إليّ</TabsTrigger>
            {isGeneralManager && <TabsTrigger value="tracking">لوحة التتبع</TabsTrigger>}
          </TabsList>

          <TabsContent value="mine" className="space-y-3 pt-3">
            {mineQ.isLoading && <Loader2 className="w-5 h-5 animate-spin" />}
            {!mineQ.isLoading && mine.length === 0 && (
              <Card><CardContent className="p-6 text-center text-muted-foreground">لا توجد رسائل إلزامية</CardContent></Card>
            )}
            {mine.map((m) => (
              <Card key={m.message_id} className={m.replied_at ? "" : "border-destructive/50"}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <CardTitle className="text-base">{m.subject}</CardTitle>
                    <div className="flex items-center gap-2">
                      <PriorityBadge priority={m.priority} />
                      {m.replied_at ? (
                        <Badge className="bg-emerald-600 hover:bg-emerald-700">تم الرد</Badge>
                      ) : (
                        <Badge variant="destructive">بانتظار الرد</Badge>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    من: {m.sender_name} • {fmt(m.created_at)}
                    {m.reply_due_at && <span className="mr-2 inline-flex items-center gap-1"><Timer className="w-3 h-3" />موعد الرد: {fmt(m.reply_due_at)}</span>}
                  </p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="whitespace-pre-wrap text-sm">{m.body}</p>
                  {m.replied_at ? (
                    <p className="text-xs text-emerald-700 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> تم الرد بتاريخ {fmt(m.replied_at)}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      <Textarea
                        value={drafts[m.message_id] || ""}
                        onChange={(e) => setDrafts((d) => ({ ...d, [m.message_id]: e.target.value }))}
                        placeholder="اكتب ردك هنا (الرد الفارغ غير مقبول)"
                        rows={3}
                      />
                      <Button
                        onClick={() => sendReply(m.message_id)}
                        disabled={sendingId === m.message_id || !(drafts[m.message_id] || "").trim()}
                      >
                        {sendingId === m.message_id ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : <Send className="w-4 h-4 ml-2" />}
                        إرسال الرد
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          {isGeneralManager && (
            <TabsContent value="tracking" className="space-y-3 pt-3">
              {sentQ.isLoading && <Loader2 className="w-5 h-5 animate-spin" />}
              {!sentQ.isLoading && (sentQ.data || []).length === 0 && (
                <Card><CardContent className="p-6 text-center text-muted-foreground">لم ترسل رسائل إلزامية بعد</CardContent></Card>
              )}
              {(sentQ.data || []).map((m) => {
                const replied = m.recipients.filter((r) => r.replied_at).length;
                return (
                  <Card key={m.id}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <CardTitle className="text-base">{m.subject}</CardTitle>
                        <Badge variant={replied === m.recipients.length ? "default" : "destructive"}>
                          {replied}/{m.recipients.length} ردوا
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{fmt(m.created_at)}</p>
                    </CardHeader>
                    <CardContent className="space-y-1">
                      {m.recipients.map((r) => {
                        const overdue = !r.replied_at && m.reply_due_at && new Date(m.reply_due_at) < new Date();
                        return (
                          <div key={r.recipient_id} className="flex items-center justify-between text-sm border-b last:border-0 py-1.5">
                            <span>{r.name}</span>
                            {r.replied_at ? (
                              <span className="text-emerald-700 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" />رد • {fmt(r.replied_at)}</span>
                            ) : overdue ? (
                              <span className="text-destructive flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />متأخر</span>
                            ) : (
                              <span className="text-muted-foreground flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{r.read_at ? "قرأ ولم يرد" : "بانتظار الرد"}</span>
                            )}
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>
                );
              })}
            </TabsContent>
          )}
        </Tabs>
      </div>
    </DashboardLayout>
  );
};

export default MandatoryMessages;
