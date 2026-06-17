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
import { Plus, AlertCircle, ChevronRight, ChevronLeft, Save, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";

const DRAFT_KEY = "slaughter_batch_draft_v2";

export type SourceRow = {
  live_receipt_id: string;
  birds_count: number;
};

export type BatchDraft = {
  sources: SourceRow[];
  shift: string;
  birds_slaughtered: number;
  total_live_weight_kg: number;
  pre_slaughter_dead: number;
  rejected_birds: number;
  start_time: string;
  notes: string;
  butcher_1_id: string;
  butcher_2_id: string;
  butcher_3_id: string;
};

const defaultDraft: BatchDraft = {
  sources: [{ live_receipt_id: "", birds_count: 0 }],
  shift: "morning",
  birds_slaughtered: 0,
  total_live_weight_kg: 0,
  pre_slaughter_dead: 0,
  rejected_birds: 0,
  start_time: "",
  notes: "",
  butcher_1_id: "",
  butcher_2_id: "",
  butcher_3_id: "",
};

export type ReceiptOption = {
  id: string;
  receipt_number: string;
  bird_count: number;
  total_weight_kg: number;
  status: string;
  current_alive_count?: number;
  cost_per_bird_current?: number;
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  receipts: Array<ReceiptOption>;
  workers?: Array<{ id: string; full_name: string; role: string; is_active: boolean; lead_rank?: number | null }>;
  onSave: (draft: BatchDraft) => Promise<boolean>;
}

const fmt = (n: number) => Number(n || 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 });

export const SlaughterBatchDialog = ({ open, onOpenChange, receipts, workers = [], onSave }: Props) => {
  const sortedWorkers = [...workers]
    .filter((w) => w.is_active !== false)
    .sort((a, b) => (a.lead_rank ?? 99) - (b.lead_rank ?? 99) || a.full_name.localeCompare(b.full_name, "ar"));

  const [form, setForm] = useState<BatchDraft>(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      const parsed = saved ? JSON.parse(saved) : null;
      if (parsed && Array.isArray(parsed.sources)) return { ...defaultDraft, ...parsed };
      return defaultDraft;
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

  useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(form)); } catch {}
  }, [form]);

  // Build receipt map for quick lookup
  const receiptMap = useMemo(() => {
    const m = new Map<string, ReceiptOption>();
    receipts.forEach((r) => m.set(r.id, r));
    return m;
  }, [receipts]);

  // Receipts that are available as sources (have alive birds and not rejected/processed)
  const availableReceipts = useMemo(
    () =>
      receipts.filter((r) => {
        const alive = Number(r.current_alive_count ?? r.bird_count) || 0;
        return r.status !== "processed" && r.status !== "rejected" && alive > 0;
      }),
    [receipts]
  );

  // Sources aggregates
  const sourcesTotalBirds = form.sources.reduce((s, x) => s + (Number(x.birds_count) || 0), 0);
  const sourcesTotalCost = form.sources.reduce((s, x) => {
    const r = receiptMap.get(x.live_receipt_id);
    const cost = Number(r?.cost_per_bird_current || 0);
    return s + (Number(x.birds_count) || 0) * cost;
  }, 0);

  const sourceErrors = useMemo(() => {
    const errs: string[] = [];
    const seen = new Set<string>();
    form.sources.forEach((s, idx) => {
      if (!s.live_receipt_id) return; // empty row skipped
      if (seen.has(s.live_receipt_id)) {
        errs[idx] = "هذه الدفعة مختارة بالفعل في صف آخر";
        return;
      }
      seen.add(s.live_receipt_id);
      const r = receiptMap.get(s.live_receipt_id);
      const avail = Number(r?.current_alive_count ?? r?.bird_count ?? 0);
      if (!s.birds_count || s.birds_count <= 0) {
        errs[idx] = "أدخل عدد النعام المطلوب دبحه";
      } else if (s.birds_count > avail) {
        errs[idx] = `العدد المطلوب أكبر من المتاح (${avail})`;
      }
    });
    return errs;
  }, [form.sources, receiptMap]);

  const validSourceRows = form.sources.filter((s) => s.live_receipt_id && s.birds_count > 0);
  const hasAnyValidSource = validSourceRows.length > 0;
  const sourcesValid = hasAnyValidSource && sourceErrors.every((e) => !e);

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (!form.shift) e.shift = "اختر الشيفت";
    if (!sourcesValid) e.sources = "اختر دفعة نعام واحدة على الأقل وأدخل العدد بشكل صحيح";
    if (!form.total_live_weight_kg || form.total_live_weight_kg <= 0)
      e.total_live_weight_kg = "أدخل الوزن الحي الإجمالي بالكجم";
    if (form.pre_slaughter_dead < 0) e.pre_slaughter_dead = "لا يمكن أن يكون سالباً";
    if (form.rejected_birds < 0) e.rejected_birds = "لا يمكن أن يكون سالباً";
    return e;
  }, [form, sourcesValid]);

  const step1Valid = !errors.shift && !errors.sources;
  const step2Valid = !errors.total_live_weight_kg && !errors.pre_slaughter_dead && !errors.rejected_birds;
  const allValid = Object.keys(errors).length === 0;

  const update = <K extends keyof BatchDraft>(k: K, v: BatchDraft[K]) => {
    setForm((p) => ({ ...p, [k]: v }));
    setTouched((p) => ({ ...p, [k]: true }));
  };

  // Auto-sync birds_slaughtered from sources whenever sources change
  useEffect(() => {
    setForm((p) => ({ ...p, birds_slaughtered: sourcesTotalBirds }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourcesTotalBirds]);

  const setSourceField = (idx: number, patch: Partial<SourceRow>) => {
    setForm((p) => ({
      ...p,
      sources: p.sources.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    }));
    setTouched((p) => ({ ...p, sources: true }));
  };

  const addSourceRow = () => {
    setForm((p) => ({ ...p, sources: [...p.sources, { live_receipt_id: "", birds_count: 0 }] }));
  };

  const removeSourceRow = (idx: number) => {
    setForm((p) => ({
      ...p,
      sources: p.sources.length <= 1 ? [{ live_receipt_id: "", birds_count: 0 }] : p.sources.filter((_, i) => i !== idx),
    }));
  };

  const handleSave = async () => {
    setTouched({
      shift: true, birds_slaughtered: true, total_live_weight_kg: true,
      pre_slaughter_dead: true, rejected_birds: true, sources: true,
    });
    if (!allValid) {
      if (!step1Valid) setStep("step1");
      else if (!step2Valid) setStep("step2");
      return;
    }
    setSaving(true);
    // Send only valid rows
    const draftToSave: BatchDraft = { ...form, sources: validSourceRows };
    const ok = await onSave(draftToSave);
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

  const goNext = () => {
    if (step === "step1") {
      setTouched((p) => ({ ...p, shift: true, sources: true }));
      if (!step1Valid) return;
      setStep("step2");
    } else if (step === "step2") {
      setTouched((p) => ({ ...p, total_live_weight_kg: true, pre_slaughter_dead: true, rejected_birds: true }));
      if (!step2Valid) return;
      setStep("step3");
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && isDirty) {
      setConfirmCloseOpen(true);
      return;
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button className="bg-gradient-to-r from-primary to-accent">
          <Plus className="w-4 h-4 ml-1" />دفعة جديدة
        </Button>
      </DialogTrigger>
      <DialogContent dir="rtl" className="max-w-3xl max-h-[92vh] overflow-y-auto p-4 sm:p-6" onEscapeKeyDown={(e) => { if (isDirty) { e.preventDefault(); setConfirmCloseOpen(true); } }} onPointerDownOutside={(e) => { if (isDirty) { e.preventDefault(); setConfirmCloseOpen(true); } }}>
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
              1. المصادر والشيفت
            </TabsTrigger>
            <TabsTrigger value="step2" className={cn("text-xs sm:text-sm", !step2Valid && Object.keys(touched).length > 0 && "text-destructive")}>
              2. الأوزان
            </TabsTrigger>
            <TabsTrigger value="step3" className="text-xs sm:text-sm">3. ملاحظات وحفظ</TabsTrigger>
          </TabsList>

          {/* Step 1 — Sources + Shift */}
          <TabsContent value="step1" className="space-y-4 mt-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-sm font-semibold">مصادر النعام الداخل للدبح <span className="text-destructive">*</span></Label>
                <Button type="button" size="sm" variant="outline" onClick={addSourceRow}>
                  <Plus className="w-3 h-3 ml-1" />إضافة دفعة أخرى
                </Button>
              </div>

              {availableReceipts.length === 0 && (
                <div className="text-xs text-destructive bg-destructive/10 p-3 rounded mb-2">
                  لا توجد دفعات نعام حية متاحة للدبح حالياً.
                </div>
              )}

              <div className="border rounded overflow-x-auto">
                <table className="w-full text-xs sm:text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-right p-2">دفعة النعام</th>
                      <th className="text-center p-2">المتاح</th>
                      <th className="text-center p-2">تكلفة النعامة</th>
                      <th className="text-center p-2 w-24">المطلوب دبحه</th>
                      <th className="text-left p-2">إجمالي تكلفة المصدر</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.sources.map((row, idx) => {
                      const r = receiptMap.get(row.live_receipt_id);
                      const avail = Number(r?.current_alive_count ?? r?.bird_count ?? 0);
                      const cost = Number(r?.cost_per_bird_current || 0);
                      const lineTotal = (Number(row.birds_count) || 0) * cost;
                      const rowErr = sourceErrors[idx];
                      const chosenIds = new Set(form.sources.filter((_, i) => i !== idx).map((s) => s.live_receipt_id).filter(Boolean));
                      const opts = availableReceipts.filter((opt) => !chosenIds.has(opt.id) || opt.id === row.live_receipt_id);
                      return (
                        <tr key={idx} className="border-t align-top">
                          <td className="p-2">
                            <Select
                              value={row.live_receipt_id || undefined}
                              onValueChange={(v) => setSourceField(idx, { live_receipt_id: v })}
                            >
                              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="اختر دفعة..." /></SelectTrigger>
                              <SelectContent className="z-[100] max-h-64">
                                {opts.length === 0 ? (
                                  <div className="text-xs text-muted-foreground p-3 text-center">لا توجد دفعات متاحة</div>
                                ) : opts.map((opt) => {
                                  const a = Number(opt.current_alive_count ?? opt.bird_count) || 0;
                                  const c = Number(opt.cost_per_bird_current || 0);
                                  return (
                                    <SelectItem key={opt.id} value={opt.id}>
                                      {opt.receipt_number} — متاح {a} — تكلفة/نعامة {fmt(c)}
                                    </SelectItem>
                                  );
                                })}
                              </SelectContent>
                            </Select>
                            {rowErr && (
                              <p className="text-[11px] text-destructive flex items-center gap-1 mt-1">
                                <AlertCircle className="w-3 h-3" /> {rowErr}
                              </p>
                            )}
                          </td>
                          <td className="text-center p-2 tabular-nums">{r ? avail : "—"}</td>
                          <td className="text-center p-2 tabular-nums">{r ? fmt(cost) : "—"}</td>
                          <td className="p-2">
                            <Input
                              type="number" inputMode="numeric" min={0} max={avail || undefined}
                              value={row.birds_count || ""}
                              onChange={(e) => setSourceField(idx, { birds_count: +e.target.value })}
                              className={cn("h-8 text-center", rowErr && "border-destructive")}
                            />
                          </td>
                          <td className="p-2 text-left tabular-nums font-semibold">{fmt(lineTotal)}</td>
                          <td className="p-1">
                            <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeSourceRow(idx)} title="حذف الصف">
                              <X className="w-3 h-3" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-muted/40 font-semibold">
                    <tr>
                      <td className="p-2 text-right" colSpan={3}>الإجمالي</td>
                      <td className="p-2 text-center tabular-nums">{sourcesTotalBirds}</td>
                      <td className="p-2 text-left tabular-nums">{fmt(sourcesTotalCost)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <ErrMsg name="sources" />
              <p className="text-xs text-muted-foreground mt-2">يتم خصم النعام من كل دفعة مصدر تلقائياً عند حفظ الدفعة.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
            </div>
          </TabsContent>

          {/* Step 2 — Weights */}
          <TabsContent value="step2" className="space-y-3 mt-4">
            <div className="text-xs bg-muted/40 p-2 rounded">
              عدد الطيور المذبوحة من المصادر: <strong>{sourcesTotalBirds}</strong>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
            {sourcesTotalBirds > 0 && form.total_live_weight_kg > 0 && (
              <div className="text-xs bg-muted/40 p-2 rounded">
                متوسط الوزن للطائر: <strong>{(form.total_live_weight_kg / sourcesTotalBirds).toFixed(2)} كجم</strong>
              </div>
            )}
          </TabsContent>

          {/* Step 3 — Butchers + notes */}
          <TabsContent value="step3" className="space-y-3 mt-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {[1, 2, 3].map((rank) => {
                const key = `butcher_${rank}_id` as "butcher_1_id" | "butcher_2_id" | "butcher_3_id";
                const labelMap: Record<number, string> = { 1: "الجزار المسؤول الأول", 2: "الجزار المسؤول الثاني", 3: "الجزار المسؤول الثالث" };
                return (
                  <div key={rank}>
                    <Label>{labelMap[rank]}</Label>
                    <Select value={form[key] || undefined} onValueChange={(v) => update(key, v)}>
                      <SelectTrigger><SelectValue placeholder="اختر جزار..." /></SelectTrigger>
                      <SelectContent className="z-[100] max-h-64">
                        {sortedWorkers.length === 0 ? (
                          <div className="text-xs text-muted-foreground p-3 text-center">لا يوجد عمال</div>
                        ) : sortedWorkers.map((w) => (
                          <SelectItem key={w.id} value={w.id}>
                            {w.full_name}{w.lead_rank ? ` — مسؤول ${w.lead_rank === 1 ? "أول" : w.lead_rank === 2 ? "ثاني" : "ثالث"}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
            <div>
              <Label>ملاحظات</Label>
              <Textarea rows={4} value={form.notes} onChange={(e) => update("notes", e.target.value)} placeholder="أي ملاحظات إضافية..." />
            </div>
            <div className="text-xs bg-muted/40 p-3 rounded space-y-1">
              <p><strong>ملخص قبل الحفظ:</strong></p>
              <p>المصادر: {validSourceRows.length} دفعة — إجمالي النعام: {sourcesTotalBirds}</p>
              <p>إجمالي تكلفة النعام للدبح: <strong>{fmt(sourcesTotalCost)} ج</strong></p>
              <p>الشيفت: {form.shift === "morning" ? "صباحي" : form.shift === "evening" ? "مسائي" : "ليلي"} — الوزن الحي: {form.total_live_weight_kg} كجم</p>
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
              <Button
                type="button" variant="outline" size="sm"
                onClick={goNext}
                disabled={(step === "step1" && !step1Valid) || (step === "step2" && !step2Valid)}
                title={(step === "step1" && !step1Valid) || (step === "step2" && !step2Valid) ? "أكمل الحقول المطلوبة أولاً" : undefined}
              >
                التالي<ChevronLeft className="w-4 h-4 mr-1" />
              </Button>
            )}
          </div>
          <Button onClick={handleSave} disabled={saving} className="bg-gradient-to-r from-primary to-accent">
            <Save className="w-4 h-4 ml-1" />{saving ? "جاري الحفظ..." : "حفظ الدفعة"}
          </Button>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={confirmCloseOpen} onOpenChange={setConfirmCloseOpen}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>هل تريد إغلاق النموذج؟</AlertDialogTitle>
            <AlertDialogDescription>
              لديك مسودة غير محفوظة. سيتم الاحتفاظ ببياناتك تلقائياً وسترجع لها عند فتح النموذج مرة أخرى. اختر "تجاهل" لمسح المسودة نهائياً.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel>متابعة التعديل</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmCloseOpen(false); onOpenChange(false); }}>
              إغلاق مع الاحتفاظ بالمسودة
            </AlertDialogAction>
            <Button variant="destructive" onClick={() => { clearDraft(); setConfirmCloseOpen(false); onOpenChange(false); }}>
              <Trash2 className="w-4 h-4 ml-1" />تجاهل ومسح
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
};
