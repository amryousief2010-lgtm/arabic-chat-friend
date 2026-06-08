import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RecipientSelector } from "./RecipientSelector";
import { toast } from "sonner";
import { Paperclip, Send, Loader2, X } from "lucide-react";
import type { MessagePriority } from "./PriorityBadge";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const ComposeMessageDialog = ({ open, onOpenChange }: Props) => {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [recipients, setRecipients] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState<MessagePriority>("normal");
  const [files, setFiles] = useState<File[]>([]);

  const reset = () => {
    setRecipients([]);
    setSubject("");
    setBody("");
    setPriority("normal");
    setFiles([]);
  };

  const send = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("غير مصرح");
      if (recipients.length === 0) throw new Error("اختر مستلمًا واحدًا على الأقل");
      if (!subject.trim()) throw new Error("العنوان مطلوب");
      if (!body.trim()) throw new Error("نص الرسالة مطلوب");

      // 1) insert message
      const { data: msg, error: msgErr } = await (supabase as any)
        .from("internal_messages")
        .insert({
          sender_id: user.id,
          subject: subject.trim(),
          body: body.trim(),
          priority,
          has_attachments: files.length > 0,
        })
        .select("id")
        .single();
      if (msgErr) throw msgErr;
      const messageId = msg.id as string;

      // 2) insert recipients
      const { error: recErr } = await (supabase as any)
        .from("internal_message_recipients")
        .insert(recipients.map((rid) => ({ message_id: messageId, recipient_id: rid })));
      if (recErr) throw recErr;

      // 3) upload attachments + insert rows
      for (const file of files) {
        const path = `${messageId}/${Date.now()}-${file.name}`;
        const { error: upErr } = await supabase.storage
          .from("internal-message-attachments")
          .upload(path, file, { upsert: false });
        if (upErr) throw upErr;
        const { error: attErr } = await (supabase as any)
          .from("internal_message_attachments")
          .insert({
            message_id: messageId,
            file_url: path,
            file_name: file.name,
            file_type: file.type,
            file_size: file.size,
            uploaded_by: user.id,
          });
        if (attErr) throw attErr;
      }
      return messageId;
    },
    onSuccess: () => {
      toast.success("تم إرسال الرسالة");
      qc.invalidateQueries({ queryKey: ["internal-messages"] });
      reset();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files || []);
    setFiles((prev) => [...prev, ...list]);
    e.target.value = "";
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle>رسالة داخلية جديدة</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="mb-1.5 block">المستلمون</Label>
            <RecipientSelector value={recipients} onChange={setRecipients} />
          </div>
          <div>
            <Label className="mb-1.5 block">العنوان</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
          </div>
          <div>
            <Label className="mb-1.5 block">الأولوية</Label>
            <Select value={priority} onValueChange={(v) => setPriority(v as MessagePriority)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="normal">عادي</SelectItem>
                <SelectItem value="important">مهم</SelectItem>
                <SelectItem value="urgent">عاجل</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-1.5 block">نص الرسالة</Label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              maxLength={4000}
              className="resize-none"
            />
          </div>
          <div>
            <Label className="mb-1.5 block">مرفقات (صور)</Label>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" asChild>
                <label className="cursor-pointer">
                  <Paperclip className="w-4 h-4 ml-1" />
                  إرفاق صورة
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleFiles}
                  />
                </label>
              </Button>
              <span className="text-xs text-muted-foreground">{files.length} ملف/ملفات</span>
            </div>
            {files.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center gap-1 px-2 py-1 bg-muted rounded-md text-xs">
                    <span className="truncate max-w-[140px]">{f.name}</span>
                    <button
                      type="button"
                      onClick={() => setFiles(files.filter((_, idx) => idx !== i))}
                      className="hover:text-destructive"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={send.isPending}>
            إلغاء
          </Button>
          <Button onClick={() => send.mutate()} disabled={send.isPending} className="gap-2">
            {send.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            إرسال
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
