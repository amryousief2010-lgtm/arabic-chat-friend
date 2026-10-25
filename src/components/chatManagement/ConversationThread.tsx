import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { COMPOSER_DISABLED_PLACEHOLDER } from "@/config/chatManagement";
import { BRAND } from "./brand";

const db = supabase as any;
interface Msg { id: string; direction: "in" | "out"; type: string; body: string | null; sent_at: string }

const fmt = (s: string) => new Date(s).toLocaleString("ar-EG", { timeZone: "Africa/Cairo", dateStyle: "short", timeStyle: "short" });

/** عرض المحادثة (قراءة فقط) + حقل كتابة معطّل حتى يُربط الإرسال عبر واتساب. */
export default function ConversationThread({ conversationId, title }: { conversationId: string | null; title?: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!conversationId) { setMsgs([]); return; }
    let live = true;
    setLoading(true);
    db.from("cm_messages").select("id,direction,type,body,sent_at").eq("conversation_id", conversationId)
      .order("sent_at", { ascending: true }).limit(500)
      .then(({ data }: { data: Msg[] | null }) => { if (live) { setMsgs(data ?? []); setLoading(false); } });
    return () => { live = false; };
  }, [conversationId]);

  return (
    <Card className="flex flex-col h-full" dir="rtl">
      <CardHeader className="py-3"><CardTitle className="text-base">{title ?? "المحادثة"}</CardTitle></CardHeader>
      <CardContent className="flex-1 flex flex-col gap-3">
        <div className="flex-1 min-h-[300px] max-h-[55vh] overflow-y-auto space-y-2 rounded-md bg-muted/30 p-3" data-testid="thread">
          {!conversationId && <p className="text-sm text-muted-foreground text-center">اختاري محادثة من القائمة</p>}
          {conversationId && loading && <p className="text-sm text-muted-foreground text-center">جارٍ التحميل…</p>}
          {conversationId && !loading && msgs.length === 0 && <p className="text-sm text-muted-foreground text-center">لا توجد رسائل</p>}
          {msgs.map((m) => (
            <div key={m.id} className={`flex ${m.direction === "in" ? "justify-start" : "justify-end"}`}>
              <div className="max-w-[80%] rounded-lg px-3 py-2 text-sm shadow-sm"
                style={m.direction === "out" ? { background: BRAND.purple, color: "#fff" } : { background: "#fff", border: `1px solid ${BRAND.magenta}33` }}>
                <div className="whitespace-pre-wrap">{m.body ?? `[${m.type}]`}</div>
                <div className="text-[10px] opacity-70 mt-1">{fmt(m.sent_at)}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="flex gap-2 items-end">
          <Textarea disabled placeholder={COMPOSER_DISABLED_PLACEHOLDER} aria-label="كتابة رد" className="resize-none" data-testid="composer" />
          <Button disabled>إرسال</Button>
        </div>
      </CardContent>
    </Card>
  );
}
