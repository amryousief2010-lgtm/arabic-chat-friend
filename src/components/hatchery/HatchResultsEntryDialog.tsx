import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Save, Loader2, AlertCircle, Lock, Unlock } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Props {
  group: any;
  onClose: () => void;
  onSaved?: () => void;
}

type RowDraft = {
  id: string;
  customer_name: string;
  batch_number: string;
  total_eggs: number;
  net_eggs: number;
  candle1_infertile: number | string;
  candle2_dead: number | string;
  hatcher_dead: number | string;
  hatched_chicks: number | string;
  notes: string;
};

const toNum = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Per-customer hatch results entry for an operational batch currently in the hatcher.
 * Computes:
 *   net_after_c1 = total_eggs - candle1_infertile
 *   net_after_c2 = net_after_c1 - candle2_dead
 * Validates that no stage exceeds the remaining net from the previous stage.
 */
const HatchResultsEntryDialog = ({ group, onClose, onSaved }: Props) => {
  const { roles } = useAuth();
  const canReopen = roles?.some((r) => r === "general_manager" || r === "executive_manager");
  const isLocked = (group.customers || []).every((c: any) => {
    const s = c._raw?.status ?? c.status;
    return s === "completed" || s === "closed";
  }) && (group.customers || []).length > 0;
  const today = new Date().toISOString().slice(0, 10);
  const [exitDate, setExitDate] = useState(today);
  const [saving, setSaving] = useState(false);
  const [confirmReopen, setConfirmReopen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>(() => {
    const m: Record<string, RowDraft> = {};
    (group.customers || []).forEach((c: any) => {
      const raw = c._raw || {};
      m[c.id] = {
        id: c.id,
        customer_name: c.customer_name,
        batch_number: c.batch_number,
        total_eggs: raw.received_eggs ?? c.total_eggs ?? 0,
        net_eggs: raw.net_eggs ?? c.net_eggs ?? 0,
        candle1_infertile: raw.candle1_infertile ?? 0,
        candle2_dead: raw.candle2_dead ?? 0,
        hatcher_dead: raw.hatcher_dead ?? 0,
        hatched_chicks: raw.hatched_chicks ?? 0,
        notes: raw.notes ?? "",
      };
    });
    return m;
  });

  const update = (id: string, field: keyof RowDraft, value: any) =>
    setDrafts((p) => ({ ...p, [id]: { ...p[id], [field]: value } }));

  // Per-row computed values + errors
  const computed = useMemo(() => {
    const map: Record<string, { netC1: number; netC2: number; error: string | null }> = {};
    for (const r of Object.values(drafts)) {
      const eggs = toNum(r.total_eggs);
      const c1 = toNum(r.candle1_infertile);
      const c2 = toNum(r.candle2_dead);
      const hd = toNum(r.hatcher_dead);
      const ch = toNum(r.hatched_chicks);
      const netC1 = Math.max(0, eggs - c1);
      const netC2 = Math.max(0, netC1 - c2);
      let error: string | null = null;
      if (c1 < 0 || c2 < 0 || hd < 0 || ch < 0) error = "لا يمكن إدخال أرقام سالبة";
      else if (c1 > eggs) error = "عدد البيض اللايح في الكشف الأول لا يمكن أن يكون أكبر من عدد البيض الداخل";
      else if (c2 > netC1) error = "عدد اللايح في الكشف الثاني لا يمكن أن يكون أكبر من صافي البيض بعد الكشف الأول";
      else if (ch + hd > netC2) error = "عدد الكتاكيت + نافق الهاتشر لا يمكن أن يتجاوز صافي البيض بعد الكشف الثاني";
      map[r.id] = { netC1, netC2, error };
    }
    return map;
  }, [drafts]);

  const totals = useMemo(() => {
    return Object.values(drafts).reduce(
      (acc, r) => {
        const c = computed[r.id] || { netC1: 0, netC2: 0, error: null };
        acc.eggs += toNum(r.total_eggs);
        acc.c1 += toNum(r.candle1_infertile);
        acc.netC1 += c.netC1;
        acc.c2 += toNum(r.candle2_dead);
        acc.netC2 += c.netC2;
        acc.hd += toNum(r.hatcher_dead);
        acc.chicks += toNum(r.hatched_chicks);
        return acc;
      },
      { eggs: 0, c1: 0, netC1: 0, c2: 0, netC2: 0, hd: 0, chicks: 0 }
    );
  }, [drafts, computed]);

  const firstError = Object.values(computed).find((c) => c.error)?.error || null;

  const [confirmClose, setConfirmClose] = useState(false);

  const anyResultsEntered = useMemo(
    () =>
      Object.values(drafts).some(
        (r) =>
          toNum(r.hatched_chicks) > 0 ||
          toNum(r.hatcher_dead) > 0 ||
          toNum(r.candle1_infertile) > 0 ||
          toNum(r.candle2_dead) > 0,
      ),
    [drafts],
  );

  const persistRows = async (closing: boolean) => {
    const rows = Object.values(drafts);
    for (const r of rows) {
      const eggs = toNum(r.total_eggs);
      const c1 = toNum(r.candle1_infertile);
      const netC1 = Math.max(0, eggs - c1);
      const payload: any = {
        candle1_infertile: c1,
        candle1_fertile: netC1,
        candle2_dead: toNum(r.candle2_dead),
        hatcher_dead: toNum(r.hatcher_dead),
        hatched_chicks: toNum(r.hatched_chicks),
        notes: r.notes || null,
        updated_at: new Date().toISOString(),
      };
      if (closing) {
        payload.exit_date = exitDate;
        payload.status = "completed";
      }
      const { error } = await supabase.from("hatch_batches").update(payload).eq("id", r.id);
      if (error) throw error;
    }
    // Best-effort audit log (RLS may restrict; ignore failures)
    try {
      const { data: u } = await supabase.auth.getUser();
      const actor_id = u?.user?.id;
      const actor_name = (u?.user?.user_metadata as any)?.full_name || u?.user?.email || null;
      const auditRows = rows.map((r) => ({
        batch_id: r.id,
        batch_number: r.batch_number,
        operational_batch_no: group.op_number,
        customer_name: r.customer_name,
        actor_id,
        actor_name,
        changes: { action: closing ? "close_hatching_batch" : "save_hatching_results" },
        reason: closing ? "إقفال الدفعة بعد اكتمال النتائج" : "حفظ مرحلي لنتائج الفقس",
      }));
      await supabase.from("hatch_batch_edit_audit" as any).insert(auditRows);
    } catch {
      /* audit best-effort */
    }
  };

  const validateAll = (): string | null => {
    for (const r of Object.values(drafts)) {
      const e = computed[r.id]?.error;
      if (e) return `${r.customer_name}: ${e}`;
    }
    return null;
  };

  const handleSave = async () => {
    const err = validateAll();
    if (err) { toast.error(err); return; }
    setSaving(true);
    try {
      await persistRows(false);
      toast.success(`تم حفظ النتائج لـ ${Object.keys(drafts).length} عميل — الدفعة لا تزال مفتوحة للتعديل`);
      onSaved?.();
      onClose();
    } catch (e: any) {
      console.error(e);
      toast.error("فشل حفظ النتائج: " + (e?.message || "خطأ غير معروف"));
    } finally {
      setSaving(false);
    }
  };

  const handleClose = async () => {
    const err = validateAll();
    if (err) { toast.error(err); setConfirmClose(false); return; }
    if (!anyResultsEntered) {
      toast.error("لا يمكن إقفال الدفعة قبل إدخال نتائج الفقس");
      setConfirmClose(false);
      return;
    }
    setSaving(true);
    try {
      await persistRows(true);
      toast.success("تم إقفال الدفعة نهائيًا");
      onSaved?.();
      onClose();
    } catch (e: any) {
      console.error(e);
      toast.error("فشل إقفال الدفعة: " + (e?.message || "خطأ غير معروف"));
    } finally {
      setSaving(false);
      setConfirmClose(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-[95vw] md:max-w-6xl max-h-[92vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            إدخال نتائج الفقس — {group.op_number}
            <Badge className="bg-purple-500 text-white">في الهاتشر</Badge>
            <Badge variant="outline">{group.customers.length} عميل</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="rounded-md border bg-amber-50 dark:bg-amber-950/30 border-amber-300 p-3 text-xs text-amber-900 dark:text-amber-200 space-y-1">
          <div>• <b>صافي بعد ك1</b> = عدد البيض − لايح الكشف الأول. <b>صافي بعد ك2</b> = صافي ك1 − لايح/نافق الكشف الثاني.</div>
          <div>• عدد الكتاكيت + نافق الهاتشر يجب أن لا يتجاوزا صافي بعد ك2.</div>
          <div>• لن يتم تعديل خزنة المعمل ولا تسجيل أي حركة مالية ولا تحصيل تلقائي.</div>
        </div>

        <div className="flex items-end gap-3 mt-3">
          <div>
            <label className="text-xs text-muted-foreground">تاريخ الخروج / الفقس</label>
            <Input
              type="date"
              value={exitDate}
              onChange={(e) => setExitDate(e.target.value)}
              className="w-[180px]"
            />
          </div>
          <div className="text-xs text-muted-foreground">
            الماكينة: <b>{group.machine || "—"}</b> • تاريخ الدخول:{" "}
            <b>{group.entry_date || "—"}</b>
          </div>
        </div>

        {firstError && (
          <div className="mt-2 flex items-center gap-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">
            <AlertCircle className="w-4 h-4" /> {firstError}
          </div>
        )}

        <Card className="mt-3 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>العميل</TableHead>
                <TableHead>رقم الدفعة</TableHead>
                <TableHead>عدد البيض</TableHead>
                <TableHead>لايح (ك1)</TableHead>
                <TableHead className="bg-emerald-50 dark:bg-emerald-950/30">صافي بعد ك1</TableHead>
                <TableHead>لايح/نافق (ك2)</TableHead>
                <TableHead className="bg-emerald-50 dark:bg-emerald-950/30">صافي بعد ك2</TableHead>
                <TableHead>نافق هاتشر</TableHead>
                <TableHead className="text-primary">عدد الكتاكيت ★</TableHead>
                <TableHead>ملاحظات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.values(drafts).map((r) => {
                const c = computed[r.id] || { netC1: 0, netC2: 0, error: null };
                const hasError = !!c.error;
                return (
                  <TableRow key={r.id} className={hasError ? "bg-rose-50/50 dark:bg-rose-950/20" : ""}>
                    <TableCell className="text-xs font-medium">{r.customer_name}</TableCell>
                    <TableCell className="text-xs font-mono">{r.batch_number}</TableCell>
                    <TableCell className="text-xs font-bold">{r.total_eggs}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0}
                        max={r.total_eggs}
                        value={r.candle1_infertile}
                        onChange={(e) => update(r.id, "candle1_infertile", e.target.value)}
                        className="w-20 h-8"
                      />
                    </TableCell>
                    <TableCell className="bg-emerald-50/60 dark:bg-emerald-950/20 font-bold text-emerald-700 dark:text-emerald-400">
                      {c.netC1}
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0}
                        max={c.netC1}
                        value={r.candle2_dead}
                        onChange={(e) => update(r.id, "candle2_dead", e.target.value)}
                        className="w-20 h-8"
                      />
                    </TableCell>
                    <TableCell className="bg-emerald-50/60 dark:bg-emerald-950/20 font-bold text-emerald-700 dark:text-emerald-400">
                      {c.netC2}
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0}
                        max={c.netC2}
                        value={r.hatcher_dead}
                        onChange={(e) => update(r.id, "hatcher_dead", e.target.value)}
                        className="w-20 h-8"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0}
                        max={c.netC2}
                        value={r.hatched_chicks}
                        onChange={(e) => update(r.id, "hatched_chicks", e.target.value)}
                        className="w-24 h-8 font-bold border-primary"
                      />
                    </TableCell>
                    <TableCell>
                      <Textarea
                        value={r.notes}
                        onChange={(e) => update(r.id, "notes", e.target.value)}
                        className="min-h-[36px] text-xs"
                        rows={1}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>

        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mt-3 text-xs">
          <Card className="p-2"><div className="text-muted-foreground">إجمالي البيض</div><div className="font-bold">{totals.eggs}</div></Card>
          <Card className="p-2"><div className="text-muted-foreground">لايح ك1</div><div className="font-bold">{totals.c1}</div></Card>
          <Card className="p-2 border-emerald-300 border-2"><div className="text-muted-foreground">صافي بعد ك1</div><div className="font-bold text-emerald-700">{totals.netC1}</div></Card>
          <Card className="p-2"><div className="text-muted-foreground">لايح/نافق ك2</div><div className="font-bold">{totals.c2}</div></Card>
          <Card className="p-2 border-emerald-300 border-2"><div className="text-muted-foreground">صافي بعد ك2</div><div className="font-bold text-emerald-700">{totals.netC2}</div></Card>
          <Card className="p-2 border-primary border-2"><div className="text-muted-foreground">إجمالي الكتاكيت</div><div className="font-bold text-primary">{totals.chicks}</div></Card>
        </div>

        <DialogFooter className="gap-2 mt-3 flex-wrap">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            إلغاء
          </Button>
          <Button onClick={handleSave} disabled={saving || !!firstError}>
            {saving ? (
              <Loader2 className="w-4 h-4 ml-1 animate-spin" />
            ) : (
              <Save className="w-4 h-4 ml-1" />
            )}
            حفظ النتائج
          </Button>
          <Button
            variant="destructive"
            onClick={() => setConfirmClose(true)}
            disabled={saving || !!firstError || !anyResultsEntered}
            title={!anyResultsEntered ? "أدخل نتائج الفقس أولًا" : undefined}
          >
            <Lock className="w-4 h-4 ml-1" />
            إقفال الدفعة
          </Button>
        </DialogFooter>

        <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
          <AlertDialogContent dir="rtl">
            <AlertDialogHeader>
              <AlertDialogTitle>تأكيد إقفال الدفعة</AlertDialogTitle>
              <AlertDialogDescription>
                هل أنت متأكد من إقفال الدفعة؟ بعد الإقفال لن يمكن تعديل نتائج الفقس إلا بصلاحية إدارية.
                سيتم حفظ النتائج الحالية وتسجيل تاريخ الخروج: <b>{exitDate}</b>.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={saving}>إلغاء</AlertDialogCancel>
              <AlertDialogAction onClick={handleClose} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <Lock className="w-4 h-4 ml-1" />}
                نعم، إقفال الدفعة
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
};

export default HatchResultsEntryDialog;
