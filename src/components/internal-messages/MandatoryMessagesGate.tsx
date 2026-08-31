import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Send, AlertTriangle, Download } from "lucide-react";
import { PriorityBadge, MessagePriority } from "@/components/internal-messages/PriorityBadge";
import { useSignedAttachmentUrl } from "@/hooks/useSignedAttachmentUrl";
import { format } from "date-fns";
import { ar } from "date-fns/locale";

interface Attachment {
  id: string;
  file_url: string;
  file_name: string | null;
  file_type: string | null;
}

interface PendingMessage {
  id: string;
  subject: string;
  body: string;
  priority: MessagePriority;
  created_at: string;
  reply_due_at: string | null;
  sender_name: string;
  attachments: Attachment[];
}

const PRIORITY_RANK: Record<string, number> = { urgent: 0, important: 1, normal: 2 };

/**
 * Blocking dialog for mandatory (requires_reply) internal messages sent by the
 * General Manager. The employee must write an actual reply before it closes.
 * Mounted once inside DashboardLayout — never renders a route of its own.
 */
const MandatoryMessagesGate = () => {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["mandatory-internal-messages", user?.id],
    enabled: !!user,
    retry: 1,
    queryFn: async (): Promise<PendingMessage[]> => {
      const { data: recs, error: recErr } = await (supabase as any)
        .from("internal_message_recipients")
        .select("message_id, replied_at")
        .eq("recipient_id", user!.id)
        .is("replied_at", null);
      if (recErr) throw recErr;
      const ids = (recs || []).map((r: any) => r.message_id as string);
      if (ids.length === 0) return [];

      const { data: msgs, error: msgErr } = await (supabase as any)
        .from("internal_messages")
        .select("id, subject, body, priority, created_at, sender_id, reply_due_at, requires_reply, is_deleted")
        .in("id", ids)
        .eq("requires_reply", true)
        .eq("is_deleted", false);
      if (msgErr) throw msgErr;
      const list = msgs || [];
      if (list.length === 0) return [];

      const senderIds: string[] = Array.from(new Set(list.map((m: any) => String(m.sender_id))));
      const msgIds: string[] = list.map((m: any) => String(m.id));
      const [{ data: profiles }, { data: atts }] = await Promise.all([
        supabase.from("profile_directory").select("id, full_name").in("id", senderIds),
        (supabase as any)
          .from("internal_message_attachments")
          .select("id, message_id, file_url, file_name, file_type")
          .in("message_id", list.map((m: any) => m.id)),
      ]);
      const nameMap = new Map((profiles || []).map((p: any) => [p.id, p.full_name || "موظف"]));
      const attMap = new Map<string, Attachment[]>();
      (atts || []).forEach((a: any) => {
        const arr = attMap.get(a.message_id) || [];
        arr.push({ id: a.id, file_url: a.file_url, file_name: a.file_name, file_type: a.file_type });
        attMap.set(a.message_id, arr);
      });

      return list
        .map((m: any) => ({
          id: m.id,
          subject: m.subject,
          body: m.body,
          priority: m.priority as MessagePriority,
          created_at: m.created_at,
          reply_due_at: m.reply_due_at,
          sender_name: nameMap.get(m.sender_id) || "موظف",
          attachments: attMap.get(m.id) || [],
        }))
        .sort((a, b) => {
          const pr = (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2);
          if (pr !== 0) return pr;
          return a.created_at.localeCompare(b.created_at);
        });
    },
  });

  // Realtime: a new mandatory message arriving while the user is inside the app
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`mandatory-msgs-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "internal_message_recipients",
          filter: `recipient_id=eq.${user.id}`,
        },
        () => qc.invalidateQueries({ queryKey: ["mandatory-internal-messages"] }),
      )
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [user?.id, qc]);

  const current = useMemo(() => (q.data && q.data.length > 0 ? q.data[0] : null), [q.data]);

  // Mark as read once the mandatory dialog is actually shown
  useEffect(() => {
    if (!current || !user) return;
    setError(null);
    void (supabase as any)
      .from("internal_message_recipients")
      .update({ read_at: new Date().toISOString() })
      .eq("message_id", current.id)
      .eq("recipient_id", user.id)
      .is("read_at", null);
  }, [current?.id, user?.id]);

  const submit = async () => {
    if (!current) return;
    const body = replyText.trim();
    if (!body) {
      setError("لا يمكن إرسال رد فارغ");
      return;
    }
    setSending(true);
    setError(null);
    const { error: rpcErr } = await (supabase as any).rpc("im_send_reply", {
      p_message_id: current.id,
      p_body: body,
    });
    setSending(false);
    if (rpcErr) {
      setError(
        rpcErr.message?.includes("empty_reply_not_allowed")
          ? "لا يمكن إرسال رد فارغ"
          : rpcErr.message?.includes("not_a_participant")
            ? "لا تملك صلاحية الرد على هذه الرسالة"
            : "تعذر إرسال الرد، تحقق من الاتصال ثم أعد المحاولة",
      );
      return;
    }
    setReplyText("");
    await qc.invalidateQueries({ queryKey: ["mandatory-internal-messages"] });
    qc.invalidateQueries({ queryKey: ["internal-messages"] });
    qc.invalidateQueries({ queryKey: ["internal-message", current.id] });
  };

  if (!current) return null;

  const overdue = current.reply_due_at && new Date(current.reply_due_at) < new Date();

  return (
    <Dialog open modal>
      <DialogContent
        dir="rtl"
        className="max-w-lg max-h-[90vh] overflow-y-auto [&>button]:hidden"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-right">
            <AlertTriangle className="w-5 h-5 text-destructive" />
            رسالة تتطلب ردًا
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">{current.sender_name}</span>
            <PriorityBadge priority={current.priority} />
            <span className="text-xs text-muted-foreground">
              {format(new Date(current.created_at), "PPp", { locale: ar })}
            </span>
            {current.reply_due_at && (
              <Badge variant={overdue ? "destructive" : "outline"} className="text-xs">
                آخر موعد للرد: {format(new Date(current.reply_due_at), "PPp", { locale: ar })}
                {overdue ? " (متأخر)" : ""}
              </Badge>
            )}
          </div>

          <div className="font-semibold">{current.subject}</div>
          <p className="whitespace-pre-wrap leading-relaxed text-sm bg-muted rounded-lg p-3">{current.body}</p>

          {current.attachments.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {current.attachments.map((a) => (
                <GateAttachment key={a.id} att={a} />
              ))}
            </div>
          )}

          <div>
            <Textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              rows={4}
              placeholder="اكتب ردك هنا (إلزامي)..."
              className="resize-none"
            />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription className="text-sm">{error}</AlertDescription>
            </Alert>
          )}

          <p className="text-xs text-muted-foreground">
            لا يمكن إغلاق هذه الرسالة أو أرشفتها قبل إرسال رد فعلي.
          </p>

          <Button onClick={submit} disabled={sending || !replyText.trim()} className="w-full gap-2">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {error ? "إعادة المحاولة" : "إرسال الرد"}
          </Button>
          {q.data && q.data.length > 1 && (
            <p className="text-xs text-center text-muted-foreground">
              متبقٍ {q.data.length - 1} رسالة إلزامية أخرى
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

const GateAttachment = ({ att }: { att: Attachment }) => {
  const url = useSignedAttachmentUrl(att.file_url);
  const isImage = (att.file_type || "").startsWith("image/");
  return (
    <div className="border rounded-lg p-2 bg-card">
      {isImage && url ? (
        <a href={url} target="_blank" rel="noopener noreferrer">
          <img src={url} alt={att.file_name || "مرفق"} className="w-full h-24 object-cover rounded" />
        </a>
      ) : (
        <div className="h-24 flex items-center justify-center bg-muted rounded text-xs text-muted-foreground">
          {url ? "ملف" : "جاري التحميل..."}
        </div>
      )}
      <div className="flex items-center justify-between gap-1 mt-1">
        <span className="text-xs truncate flex-1">{att.file_name || "مرفق"}</span>
        {url && (
          <a href={url} target="_blank" rel="noopener noreferrer" download className="text-primary">
            <Download className="w-4 h-4" />
          </a>
        )}
      </div>
    </div>
  );
};

export default MandatoryMessagesGate;
