import { useState } from "react";
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
import { Save, Loader2 } from "lucide-react";

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
  candle1_infertile: number;
  candle1_fertile: number;
  candle2_dead: number;
  hatcher_dead: number;
  hatched_chicks: number;
  notes: string;
};

const toNum = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Per-customer hatch results entry for an operational batch currently in the hatcher.
 * Saves only the result fields (candle/hatcher dead counts, hatched chicks, notes),
 * sets exit_date = today and status = 'completed'. Does NOT touch the treasury,
 * does NOT create any financial transactions, does NOT auto-collect from customers.
 */
const HatchResultsEntryDialog = ({ group, onClose, onSaved }: Props) => {
  const today = new Date().toISOString().slice(0, 10);
  const [exitDate, setExitDate] = useState(today);
  const [saving, setSaving] = useState(false);
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
        candle1_fertile: raw.candle1_fertile ?? 0,
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

  const totals = Object.values(drafts).reduce(
    (acc, r) => {
      acc.eggs += toNum(r.total_eggs);
      acc.chicks += toNum(r.hatched_chicks);
      acc.c2_dead += toNum(r.candle2_dead);
      acc.h_dead += toNum(r.hatcher_dead);
      return acc;
    },
    { eggs: 0, chicks: 0, c2_dead: 0, h_dead: 0 }
  );

  const handleSave = async () => {
    setSaving(true);
    try {
      const rows = Object.values(drafts);
      for (const r of rows) {
        const { error } = await supabase
          .from("hatch_batches")
          .update({
            candle2_dead: toNum(r.candle2_dead),
            hatcher_dead: toNum(r.hatcher_dead),
            hatched_chicks: toNum(r.hatched_chicks),
            notes: r.notes || null,
            exit_date: exitDate,
            status: "completed",
            updated_at: new Date().toISOString(),
          } as any)
          .eq("id", r.id);
        if (error) throw error;
      }
      toast.success(`تم حفظ نتائج ${rows.length} عميل — الدفعة الآن مكتملة (فقست)`);
      onSaved?.();
      onClose();
    } catch (e: any) {
      console.error(e);
      toast.error("فشل حفظ النتائج: " + (e?.message || "خطأ غير معروف"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            إدخال نتائج الفقس — {group.op_number}
            <Badge className="bg-purple-500 text-white">في الهاتشر</Badge>
            <Badge variant="outline">{group.customers.length} عميل</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="rounded-md border bg-amber-50 dark:bg-amber-950/30 border-amber-300 p-3 text-xs text-amber-900 dark:text-amber-200 space-y-1">
          <div>• يتم حفظ نتائج الفقس لكل عميل داخل الدفعة فقط.</div>
          <div>• <b>لن يتم تعديل خزنة المعمل ولا تسجيل أي حركة مالية ولا تحصيل تلقائي.</b></div>
          <div>• العملاء الخارجيون يظلون كـ "واجب تحصيل" يدوي لاحقًا من خزنة المعمل.</div>
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

        <Card className="mt-3 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>العميل</TableHead>
                <TableHead>رقم الدفعة</TableHead>
                <TableHead>عدد البيض</TableHead>
                <TableHead>لايح (ك1)</TableHead>
                <TableHead>مخصب (ك1)</TableHead>
                <TableHead>نافق كشف 2</TableHead>
                <TableHead>نافق هاتشر</TableHead>
                <TableHead className="text-primary">عدد الكتاكيت ★</TableHead>
                <TableHead>ملاحظات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.values(drafts).map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs font-medium">{r.customer_name}</TableCell>
                  <TableCell className="text-xs font-mono">{r.batch_number}</TableCell>
                  <TableCell className="text-xs">{r.total_eggs}</TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      value={r.candle1_infertile}
                      onChange={(e) => update(r.id, "candle1_infertile", e.target.value)}
                      className="w-20 h-8"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      value={r.candle1_fertile}
                      onChange={(e) => update(r.id, "candle1_fertile", e.target.value)}
                      className="w-20 h-8"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      value={r.candle2_dead}
                      onChange={(e) => update(r.id, "candle2_dead", e.target.value)}
                      className="w-20 h-8"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      value={r.hatcher_dead}
                      onChange={(e) => update(r.id, "hatcher_dead", e.target.value)}
                      className="w-20 h-8"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
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
              ))}
            </TableBody>
          </Table>
        </Card>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 text-xs">
          <Card className="p-2">
            <div className="text-muted-foreground">إجمالي البيض</div>
            <div className="font-bold">{totals.eggs}</div>
          </Card>
          <Card className="p-2">
            <div className="text-muted-foreground">نافق كشف 2</div>
            <div className="font-bold">{totals.c2_dead}</div>
          </Card>
          <Card className="p-2">
            <div className="text-muted-foreground">نافق هاتشر</div>
            <div className="font-bold">{totals.h_dead}</div>
          </Card>
          <Card className="p-2 border-primary border-2">
            <div className="text-muted-foreground">إجمالي الكتاكيت</div>
            <div className="font-bold text-primary">{totals.chicks}</div>
          </Card>
        </div>

        <DialogFooter className="gap-2 mt-3">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            إلغاء
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="w-4 h-4 ml-1 animate-spin" />
            ) : (
              <Save className="w-4 h-4 ml-1" />
            )}
            حفظ النتائج وإقفال الدفعة
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default HatchResultsEntryDialog;
