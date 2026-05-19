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
import { AlertTriangle } from "lucide-react";

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

  const handleSubmit = async () => {
    if (note.trim().length < 10) {
      toast.error("يرجى كتابة وصف واضح للخطأ (10 أحرف على الأقل)");
      return;
    }
    setLoading(true);
    const { error } = await supabase.from("correction_requests").insert({
      target_module: targetModule,
      target_type: targetType,
      target_id: targetId ?? null,
      target_reference: reference || null,
      note: note.trim(),
      priority,
    });
    setLoading(false);

    if (error) {
      toast.error("تعذّر إرسال طلب التصحيح", { description: error.message });
      return;
    }
    toast.success("📨 تم إرسال طلب التصحيح للإدارة", {
      description: "سيصلك إشعار عند الرد",
    });
    setOpen(false);
    setNote("");
    setPriority("normal");
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
