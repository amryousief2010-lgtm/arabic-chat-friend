import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Archive, Send, Download, Loader2, CheckCircle2, Circle } from "lucide-react";
import { PriorityBadge, MessagePriority } from "@/components/internal-messages/PriorityBadge";
import { useSignedAttachmentUrl } from "@/hooks/useSignedAttachmentUrl";
import { toast } from "sonner";
import { format } from "date-fns";
import { ar } from "date-fns/locale";

interface MessageData {
  id: string;
  subject: string;
  body: string;
  priority: MessagePriority;
  has_attachments: boolean;
  created_at: string;
  sender_id: string;
  sender_name: string;
}
interface RecipientData {
  id: string;
  recipient_id: string;
  recipient_name: string;
  read_at: string | null;
  archived_at: string | null;
}
interface AttachmentData {
  id: string;
  file_url: string;
  file_name: string | null;
  file_type: string | null;
}
interface ReplyData {
  id: string;
  sender_id: string;
  sender_name: string;
  body: string;
  created_at: string;
}

const MessageDetails = () => {
  const { id: messageId } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [replyText, setReplyText] = useState("");

  const q = useQuery({
    queryKey: ["internal-message", messageId],
    enabled: !!messageId && !!user,
    queryFn: async () => {
      const { data: m } = await (supabase as any)
        .from("internal_messages")
        .select("id, subject, body, priority, has_attachments, created_at, sender_id")
        .eq("id", messageId)
        .maybeSingle();
      if (!m) throw new Error("الرسالة غير موجودة أو لا تملك صلاحية الوصول");

      const [{ data: recs }, { data: atts }, { data: reps }] = await Promise.all([
        (supabase as any).from("internal_message_recipients").select("id, recipient_id, read_at, archived_at").eq("message_id", messageId),
        (supabase as any).from("internal_message_attachments").select("id, file_url, file_name, file_type").eq("message_id", messageId),
        (supabase as any).from("internal_message_replies").select("id, sender_id, body, created_at").eq("message_id", messageId).order("created_at"),
      ]);

      const allUserIds = Array.from(new Set<string>([
        m.sender_id,
        ...(recs || []).map((r: any) => r.recipient_id as string),
        ...(reps || []).map((r: any) => r.sender_id as string),
      ]));
      const { data: profiles } = await supabase.from("profile_directory").select("id, full_name").in("id", allUserIds);
      const nameMap = new Map((profiles || []).map((p: any) => [p.id, p.full_name || "موظف"]));

      const message: MessageData = { ...m, sender_name: nameMap.get(m.sender_id) || "موظف" };
      const recipients: RecipientData[] = (recs || []).map((r: any) => ({ ...r, recipient_name: nameMap.get(r.recipient_id) || "موظف" }));
      const replies: ReplyData[] = (reps || []).map((r: any) => ({ ...r, sender_name: nameMap.get(r.sender_id) || "موظف" }));
      return { message, recipients, attachments: (atts as AttachmentData[]) || [], replies };
    },
  });

  const myRow = q.data?.recipients.find((r) => r.recipient_id === user?.id);
  const isParticipant = q.data && (q.data.message.sender_id === user?.id || !!myRow);

  // Mark as read on open
  useEffect(() => {
    if (!myRow || myRow.read_at || !user) return;
    (async () => {
      await (supabase as any)
        .from("internal_message_recipients")
        .update({ read_at: new Date().toISOString() })
        .eq("id", myRow.id)
        .eq("recipient_id", user.id);
      qc.invalidateQueries({ queryKey: ["internal-message", messageId] });
      qc.invalidateQueries({ queryKey: ["internal-messages"] });
    })();
  }, [myRow?.id, myRow?.read_at, user?.id, messageId, qc]);

  // Realtime replies
  useEffect(() => {
    if (!messageId) return;
    const ch = supabase
      .channel(`msg-replies-${messageId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "internal_message_replies", filter: `message_id=eq.${messageId}` },
        () => qc.invalidateQueries({ queryKey: ["internal-message", messageId] }),
      )
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [messageId, qc]);

  const archive = useMutation({
    mutationFn: async () => {
      if (!myRow) return;
      const { error } = await (supabase as any)
        .from("internal_message_recipients")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", myRow.id)
        .eq("recipient_id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تمت الأرشفة");
      qc.invalidateQueries({ queryKey: ["internal-messages"] });
      navigate("/internal-messages");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const unarchive = useMutation({
    mutationFn: async () => {
      if (!myRow) return;
      const { error } = await (supabase as any)
        .from("internal_message_recipients")
        .update({ archived_at: null })
        .eq("id", myRow.id)
        .eq("recipient_id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم إلغاء الأرشفة");
      qc.invalidateQueries({ queryKey: ["internal-messages"] });
      qc.invalidateQueries({ queryKey: ["internal-message", messageId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sendReply = useMutation({
    mutationFn: async () => {
      if (!replyText.trim()) throw new Error("اكتب رد");
      const { error } = await (supabase as any).from("internal_message_replies").insert({
        message_id: messageId,
        sender_id: user!.id,
        body: replyText.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setReplyText("");
      qc.invalidateQueries({ queryKey: ["internal-message", messageId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading) {
    return <DashboardLayout><div className="py-16 text-center text-muted-foreground">جاري التحميل...</div></DashboardLayout>;
  }
  if (q.isError || !q.data || !isParticipant) {
    return (
      <DashboardLayout>
        <Header title="الرسالة غير متاحة" subtitle="" />
        <Button variant="outline" onClick={() => navigate("/internal-messages")}>
          <ArrowRight className="w-4 h-4 ml-1" /> رجوع
        </Button>
      </DashboardLayout>
    );
  }

  const { message, recipients, attachments, replies } = q.data;

  return (
    <DashboardLayout>
      <Header title="تفاصيل الرسالة" subtitle={message.subject} />

      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => navigate("/internal-messages")}>
          <ArrowRight className="w-4 h-4 ml-1" /> رجوع
        </Button>
        {myRow && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => (myRow.archived_at ? unarchive.mutate() : archive.mutate())}
            disabled={archive.isPending || unarchive.isPending}
          >
            <Archive className="w-4 h-4 ml-1" />
            {myRow.archived_at ? "إلغاء الأرشفة" : "أرشفة"}
          </Button>
        )}
      </div>

      <Card className="glass-card mb-4">
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-lg">{message.subject}</CardTitle>
            <PriorityBadge priority={message.priority} />
          </div>
          <div className="text-sm text-muted-foreground">
            من: <span className="font-medium">{message.sender_name}</span> ·{" "}
            {format(new Date(message.created_at), "PPpp", { locale: ar })}
          </div>
          <div className="text-xs text-muted-foreground flex flex-wrap gap-1">
            إلى:
            {recipients.map((r) => (
              <Badge key={r.id} variant={r.read_at ? "secondary" : "outline"} className="gap-1">
                {r.read_at ? <CheckCircle2 className="w-3 h-3 text-green-600" /> : <Circle className="w-3 h-3" />}
                {r.recipient_name}
              </Badge>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap leading-relaxed">{message.body}</p>
          {attachments.length > 0 && (
            <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-3">
              {attachments.map((a) => (
                <AttachmentCard key={a.id} att={a} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Replies */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-base">الردود ({replies.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {replies.length === 0 && <p className="text-sm text-muted-foreground">لا توجد ردود بعد.</p>}
          {replies.map((r) => (
            <div key={r.id} className={`rounded-lg p-3 ${r.sender_id === user?.id ? "bg-primary/10 mr-8" : "bg-muted ml-8"}`}>
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                <span className="font-semibold text-foreground">{r.sender_name}</span>
                <span>{format(new Date(r.created_at), "PPp", { locale: ar })}</span>
              </div>
              <p className="text-sm whitespace-pre-wrap">{r.body}</p>
            </div>
          ))}

          <div className="pt-2 border-t">
            <Textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              rows={3}
              placeholder="اكتب ردك..."
              className="resize-none"
            />
            <div className="flex justify-end mt-2">
              <Button onClick={() => sendReply.mutate()} disabled={sendReply.isPending || !replyText.trim()} className="gap-2">
                {sendReply.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                إرسال الرد
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </DashboardLayout>
  );
};

const AttachmentCard = ({ att }: { att: AttachmentData }) => {
  const url = useSignedAttachmentUrl(att.file_url);
  const isImage = (att.file_type || "").startsWith("image/");
  return (
    <div className="border rounded-lg p-2 bg-card">
      {isImage && url ? (
        <a href={url} target="_blank" rel="noopener noreferrer">
          <img src={url} alt={att.file_name || ""} className="w-full h-32 object-cover rounded" />
        </a>
      ) : (
        <div className="h-32 flex items-center justify-center bg-muted rounded text-muted-foreground text-xs">
          {url ? "ملف" : "جاري التحميل..."}
        </div>
      )}
      <div className="flex items-center justify-between mt-2 gap-1">
        <span className="text-xs truncate flex-1">{att.file_name || "مرفق"}</span>
        {url && (
          <a href={url} target="_blank" rel="noopener noreferrer" download className="text-primary hover:opacity-80">
            <Download className="w-4 h-4" />
          </a>
        )}
      </div>
    </div>
  );
};

export default MessageDetails;
