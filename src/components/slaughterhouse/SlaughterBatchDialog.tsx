import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, AlertCircle, ChevronRight, ChevronLeft, Save, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

const DRAFT_KEY = "slaughter_batch_draft_v1";

export type BatchDraft = {
  live_receipt_id: string;
  shift: string;
  birds_slaughtered: number;
  total_live_weight_kg: number;
  pre_slaughter_dead: number;
  rejected_birds: number;
  start_time: string;
  notes: string;
};

const defaultDraft: BatchDraft = {
  live_receipt_id: "",
  shift: "morning",
  birds_slaughtered: 0,
  total_live_weight_kg: 0,
  pre_slaughter_dead: 0,
  rejected_birds: 0,
  start_time: "",
  notes: "",
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  receipts: Array<{ id: string; receipt_number: string; bird_count: number; total_weight_kg: number; status: string }>;
  onSave: (draft: BatchDraft) => Promise<boolean>;
}

export const SlaughterBatchDialog = ({ open, onOpenChange, receipts, onSave }: Props) => {
  const [form, setForm] = useState<BatchDraft>(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      return saved ? { ...defaultDraft, ...JSON.parse(saved) } : defaultDraft;
    } catch {
      return defaultDraft;
    }
  });
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [step, setStep] = useState("step1");
  const [saving, setSaving] = useState(false);
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);

  const isDirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(defaultDraft),
    [form]
  );

  // Persist draft on every change
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(form));
    } catch {}
  }, [form]);

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (!form.shift) e.shift = "اختر الشيفت";
    if (!form.birds_slaughtered || form.birds_slaughtered <= 0) e.birds_slaughtered = "أدخل عدد الطيور المذبوحة (أكبر من صفر)";
    if (!form.total_live_weight_kg || form.total_live_weight_kg <= 0) e.total_live_weight_kg = "أدخل الوزن الحي الإجمالي بالكجم";
    if (form.pre_slaughter_dead < 0) e.pre_slaughter_dead = "لا يمكن أن يكون سالباً";
    if (form.rejected_birds < 0) e.rejected_birds = "لا يمكن أن يكون سالباً";
    return e;
  }, [form]);

  const step1Valid = !errors.shift;
  const step2Valid = !errors.birds_slaughtered && !errors.total_live_weight_kg && !errors.pre_slaughter_dead && !errors.rejected_birds;
  const allValid = Object.keys(errors).length === 0;

  const update = <K extends keyof BatchDraft>(k: K, v: BatchDraft[K]) => {
    setForm((p) => ({ ...p, [k]: v }));
    setTouched((p) => ({ ...p, [k]: true }));
  };

  const handleReceiptChange = (v: string) => {
    const r = receipts.find((x) => x.id === v);
    setForm((p) => ({
      ...p,
      live_receipt_id: v,
      birds_slaughtered: r?.bird_count || p.birds_slaughtered,
      total_live_weight_kg: Number(r?.total_weight_kg || p.total_live_weight_kg),
    }));
    setTouched((p) => ({ ...p, live_receipt_id: true, birds_slaughtered: true, total_live_weight_kg: true }));
  };

  const handleSave = async () => {
    setTouched({
      shift: true, birds_slaughtered: true, total_live_weight_kg: true,
      pre_slaughter_dead: true, rejected_birds: true,
    });
    if (!allValid) {
      // jump to first invalid step
      if (!step1Valid) setStep("step1");
      else if (!step2Valid) setStep("step2");
      return;
    }
    setSaving(true);
    const ok = await onSave(form);
    setSaving(false);
    if (ok) {
      try { localStorage.removeItem(DRAFT_KEY); } catch {}
      setForm(defaultDraft);
      setTouched({});
      setStep("step1");
    }
  };

  const clearDraft = () => {
    try { localStorage.removeItem(DRAFT_KEY); } catch {}
    setForm(defaultDraft);
    setTouched({});
    setStep("step1");
  };

  const ErrMsg = ({ name }: { name: string }) =>
    touched[name] && errors[name] ? (
      <p className="text-xs text-destructive flex items-center gap-1 mt-1">
        <AlertCircle className="w-3 h-3" /> {errors[name]}
      </p>
    ) : null;

  const hasDraft = !!localStorage.getItem(DRAFT_KEY);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button className="bg-gradient-to-r from-primary to-accent">
          <Plus className="w-4 h-4 ml-1" />دفعة جديدة
        </Button>
      </DialogTrigger>
      <DialogContent dir="rtl" className="max-w-2xl max-h-[92vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-2">
            <span>دفعة ذبح جديدة</span>
            {hasDraft && (
              <Button type="button" size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={clearDraft}>
                <Trash2 className="w-3 h-3 ml-1" />مسح المسودة
              </Button>
            )}
          </DialogTitle>
        </DialogHeader>

        <Tabs value={step} onValueChange={setStep} className="mt-2">
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="step1" className={cn("text-xs sm:text-sm", !step1Valid && Object.keys(touched).length > 0 && "text-destructive")}>
              1. البيانات الأساسية
            </TabsTrigger>
            <TabsTrigger value="step2" className={cn("text-xs sm:text-sm", !step2Valid && Object.keys(touched).length > 0 && "text-destructive")}>
              2. الأعداد والأوزان
            </TabsTrigger>
            <TabsTrigger value="step3" className="text-xs sm:text-sm">3. ملاحظات وحفظ</TabsTrigger>
          </TabsList>

          {/* Step 1 */}
          <TabsContent value="step1" className="space-y-3 mt-4">
            <div>
              <Label>استلام حي مرتبط <span className="text-muted-foreground text-xs">(اختياري)</span></Label>
              <Select value={form.live_receipt_id || undefined} onValueChange={handleReceiptChange}>
                <SelectTrigger><SelectValue placeholder="اختر استلام..." /></SelectTrigger>
                <SelectContent className="z-[100] max-h-64">
                  {receipts.filter((r) => r.status !== "processed").length === 0 ? (
                    <div className="text-xs text-muted-foreground p-3 text-center">لا توجد استلامات متاحة</div>
                  ) : (
                    receipts.filter((r) => r.status !== "processed").map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.receipt_number} ({r.bird_count} طائر — {Number(r.total_weight_kg).toFixed(1)} كجم)
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">عند اختيار استلام، سيتم تعبئة الأعداد والوزن تلقائياً.</p>
            </div>
            <div>
              <Label>الشيفت <span className="text-destructive">*</span></Label>
              <Select value={form.shift} onValueChange={(v) => update("shift", v)}>
                <SelectTrigger><SelectValue placeholder="اختر الشيفت..." /></SelectTrigger>
                <SelectContent className="z-[100]">
                  <SelectItem value="morning">صباحي</SelectItem>
                  <SelectItem value="evening">مسائي</SelectItem>
                  <SelectItem value="night">ليلي</SelectItem>
                </SelectContent>
              </Select>
              <ErrMsg name="shift" />
            </div>
            <div>
              <Label>وقت البدء</Label>
              <Input type="time" value={form.start_time} onChange={(e) => update("start_time", e.target.value)} />
            </div>
          </TabsContent>

          {/* Step 2 */}
          <TabsContent value="step2" className="space-y-3 mt-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>عدد الطيور المذبوحة <span className="text-destructive">*</span></Label>
                <Input
                  type="number" inputMode="numeric" min={0}
                  value={form.birds_slaughtered || ""}
                  onChange={(e) => update("birds_slaughtered", +e.target.value)}
                  onBlur={() => setTouched((p) => ({ ...p, birds_slaughtered: true }))}
                  className={cn(touched.birds_slaughtered && errors.birds_slaughtered && "border-destructive")}
                />
                <ErrMsg name="birds_slaughtered" />
              </div>
              <div>
                <Label>الوزن الحي الإجمالي (كجم) <span className="text-destructive">*</span></Label>
                <Input
                  type="number" inputMode="decimal" step="0.1" min={0}
                  value={form.total_live_weight_kg || ""}
                  onChange={(e) => update("total_live_weight_kg", +e.target.value)}
                  onBlur={() => setTouched((p) => ({ ...p, total_live_weight_kg: true }))}
                  className={cn(touched.total_live_weight_kg && errors.total_live_weight_kg && "border-destructive")}
                />
                <ErrMsg name="total_live_weight_kg" />
              </div>
              <div>
                <Label>نافق قبل الذبح</Label>
                <Input
                  type="number" inputMode="numeric" min={0}
                  value={form.pre_slaughter_dead || ""}
                  onChange={(e) => update("pre_slaughter_dead", +e.target.value)}
                />
                <ErrMsg name="pre_slaughter_dead" />
              </div>
              <div>
                <Label>مرفوض صحياً</Label>
                <Input
                  type="number" inputMode="numeric" min={0}
                  value={form.rejected_birds || ""}
                  onChange={(e) => update("rejected_birds", +e.target.value)}
                />
                <ErrMsg name="rejected_birds" />
              </div>
            </div>
            {form.birds_slaughtered > 0 && form.total_live_weight_kg > 0 && (
              <div className="text-xs bg-muted/40 p-2 rounded">
                متوسط الوزن للطائر: <strong>{(form.total_live_weight_kg / form.birds_slaughtered).toFixed(2)} كجم</strong>
              </div>
            )}
          </TabsContent>

          {/* Step 3 */}
          <TabsContent value="step3" className="space-y-3 mt-4">
            <div>
              <Label>ملاحظات</Label>
              <Textarea rows={4} value={form.notes} onChange={(e) => update("notes", e.target.value)} placeholder="أي ملاحظات إضافية..." />
            </div>
            <div className="text-xs bg-muted/40 p-3 rounded space-y-1">
              <p><strong>ملخص قبل الحفظ:</strong></p>
              <p>الشيفت: {form.shift === "morning" ? "صباحي" : form.shift === "evening" ? "مسائي" : "ليلي"}</p>
              <p>الطيور: {form.birds_slaughtered} — الوزن الحي: {form.total_live_weight_kg} كجم</p>
              {form.pre_slaughter_dead > 0 && <p>نافق: {form.pre_slaughter_dead}</p>}
              {form.rejected_birds > 0 && <p>مرفوض: {form.rejected_birds}</p>}
            </div>
            {!allValid && (
              <div className="text-xs text-destructive flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> هناك حقول مطلوبة ناقصة — راجع الخطوات السابقة.
              </div>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter className="mt-4 flex flex-row justify-between gap-2">
          <div className="flex gap-2">
            {step !== "step1" && (
              <Button type="button" variant="outline" size="sm" onClick={() => setStep(step === "step3" ? "step2" : "step1")}>
                <ChevronRight className="w-4 h-4 ml-1" />السابق
              </Button>
            )}
            {step !== "step3" && (
              <Button type="button" variant="outline" size="sm" onClick={() => setStep(step === "step1" ? "step2" : "step3")}>
                التالي<ChevronLeft className="w-4 h-4 mr-1" />
              </Button>
            )}
          </div>
          <Button onClick={handleSave} disabled={saving} className="bg-gradient-to-r from-primary to-accent">
            <Save className="w-4 h-4 ml-1" />{saving ? "جاري الحفظ..." : "حفظ الدفعة"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
