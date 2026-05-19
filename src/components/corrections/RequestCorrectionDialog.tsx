import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Paperclip, X } from "lucide-react";

interface RequestCorrectionDialogProps {
  /** Module label e.g. "المجزر - استلام حي" */
  targetModule: string;
  /** Free-text reference shown to the manager e.g. receipt number / batch number */
  targetReference?: string;
  /** Optional record UUID */
  targetId?: string | null;
  /** Optional sub-type for filtering */
  targetType?: string;
  /** Button label override */
  label?: string;
  /** Button variant */
  variant?: "default" | "outline" | "ghost" | "destructive" | "secondary";
  size?: "default" | "sm" | "lg" | "icon";
}

export default function RequestCorrectionDialog({
  targetModule,
  targetReference,
  targetId,
  targetType = "general",
  label = "طلب تصحيح",
  variant = "outline",
  size = "sm",
}: RequestCorrectionDialogProps) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [reference, setReference] = useState(targetReference ?? "");
  const [priority, setPriority] = useState<"low" | "normal" | "high" | "urgent">("normal");
  const [loading, setLoading] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    if (f && f.size > 10 * 1024 * 1024) {
      toast.error("حجم الملف يجب أن لا يتجاوز 10 ميجابايت");
      return;
    }
    setFile(f);
  };

  const handleSubmit = async () => {
    if (note.trim().length < 10) {
      toast.error("يرجى كتابة وصف واضح للخطأ (10 أحرف على الأقل)");
      return;
    }
    setLoading(true);

    let attachment_url: string | null = null;
    let attachment_name: string | null = null;
    let attachment_type: string | null = null;

    if (file) {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) {
        setLoading(false);
        toast.error("يجب تسجيل الدخول لرفع الملف");
        return;
      }
      const ext = file.name.split(".").pop() ?? "bin";
      const path = `${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("correction-attachments")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) {
        setLoading(false);
        toast.error("تعذّر رفع المرفق", { description: upErr.message });
        return;
      }
      attachment_url = path;
      attachment_name = file.name;
      attachment_type = file.type;
    }

    const { error } = await supabase.from("correction_requests").insert({
      target_module: targetModule,
      target_type: targetType,
      target_id: targetId ?? null,
      target_reference: reference || null,
      note: note.trim(),
      priority,
      attachment_url,
      attachment_name,
      attachment_type,
    });
    setLoading(false);

    if (error) {
      const msg = (error.message || "").toLowerCase();
      if (msg.includes("uniq_open_correction_per_target") || msg.includes("duplicate key")) {
        toast.error("لديك بالفعل طلب تصحيح مفتوح لنفس السجل", {
          description: "لا يمكن إرسال أكثر من ملاحظة واحدة للدفعة قبل أن يرد عليها المدير",
        });
      } else {
        toast.error("تعذّر إرسال طلب التصحيح", { description: error.message });
      }
      return;
    }
    toast.success("📨 تم إرسال طلب التصحيح للإدارة", {
      description: "سيصلك إشعار عند الرد",
    });
    setOpen(false);
    setNote("");
    setPriority("normal");
    setFile(null);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size={size} className="gap-2">
          <AlertTriangle className="w-4 h-4" />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle>طلب تصحيح بيانات</DialogTitle>
          <DialogDescription>
            سجّل ملاحظتك وسيتم إرسالها للمدير العام / التنفيذي فقط. لا يمكنك تعديل البيانات بنفسك،
            وسيقوم المدير بالتصحيح بعد المراجعة.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>القسم</Label>
            <Input value={targetModule} disabled />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ref">رقم/مرجع السجل (اختياري)</Label>
            <Input
              id="ref"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="مثال: REC-2026-001 أو رقم الدفعة"
            />
          </div>

          <div className="space-y-2">
            <Label>الأولوية</Label>
            <Select value={priority} onValueChange={(v) => setPriority(v as typeof priority)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">⚪ منخفضة</SelectItem>
                <SelectItem value="normal">🔵 عادية</SelectItem>
                <SelectItem value="high">🟠 مرتفعة</SelectItem>
                <SelectItem value="urgent">🔴 عاجل</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="note">وصف الخطأ والتصحيح المطلوب *</Label>
            <Textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="مثال: تم إدخال وزن الطائر رقم 12 على أنه 95 كجم بدلاً من 9.5 كجم - يرجى التعديل"
              rows={5}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="attachment" className="flex items-center gap-1">
              <Paperclip className="w-4 h-4" />
              مرفق داعم (صورة / مستند - اختياري)
            </Label>
            <Input
              id="attachment"
              type="file"
              accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
              onChange={handleFileChange}
            />
            {file && (
              <div className="flex items-center justify-between p-2 rounded-md bg-muted/40 text-xs">
                <span className="truncate">{file.name} ({(file.size / 1024).toFixed(0)} KB)</span>
                <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => setFile(null)}>
                  <X className="w-3 h-3" />
                </Button>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              يمكن رفع صورة من الشاشة أو ملف PDF/Excel كدليل للمدير. الحد الأقصى 10MB.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
            إلغاء
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? "جارٍ الإرسال..." : "إرسال للإدارة"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
