import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Drumstick } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const ALL_BATCHES = "__ALL_ACTIVE__";
const fmt = (n: number) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 3 });

type LiveBatch = {
  id: string;
  receipt_number: string;
  receipt_date: string;
  bird_count: number;
  current_alive_count: number;
  cost_per_bird_current: number;
};

type FeedInv = { id: string; feed_name: string; current_kg: number; last_unit_cost: number };

type DistMode = "proportional" | "per_bird";

export function OstrichFeedConsumptionDialog({
  open,
  onOpenChange,
  liveBatches,
  feedInventory,
  defaultLiveBatchId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  liveBatches: LiveBatch[];
  feedInventory: FeedInv[];
  defaultLiveBatchId?: string;
  onSaved?: () => void;
}) {
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [liveBatchId, setLiveBatchId] = useState<string>("");
  const [feedId, setFeedId] = useState<string>("");
  const [qty, setQty] = useState<number>(0);
  const [distMode, setDistMode] = useState<DistMode>("proportional");
  const [responsible, setResponsible] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDate(new Date().toISOString().slice(0, 10));
      setLiveBatchId(defaultLiveBatchId || "");
      setFeedId("");
      setQty(0);
      setDistMode("proportional");
      setResponsible("");
      setNotes("");
    }
  }, [open, defaultLiveBatchId]);

  const feed = useMemo(() => feedInventory.find((f) => f.id === feedId), [feedInventory, feedId]);
  const activeBatches = useMemo(
    () => liveBatches.filter((b) => Number(b.current_alive_count ?? b.bird_count ?? 0) > 0),
    [liveBatches]
  );
  const totalAliveAll = useMemo(
    () => activeBatches.reduce((s, b) => s + Number(b.current_alive_count || b.bird_count || 0), 0),
    [activeBatches]
  );
  const isBulk = liveBatchId === ALL_BATCHES;
  const singleBatch = useMemo(() => liveBatches.find((b) => b.id === liveBatchId), [liveBatches, liveBatchId]);

  const available = Number(feed?.current_kg || 0);
  const unitCost = Number(feed?.last_unit_cost || 0);

  // Compute total qty to be deducted & per-batch allocation
  const { totalQty, allocations } = useMemo(() => {
    if (!isBulk) {
      return {
        totalQty: qty,
        allocations: singleBatch
          ? [{ batch: singleBatch, alive: Number(singleBatch.current_alive_count || singleBatch.bird_count || 0), qty }]
          : [],
      };
    }
    if (totalAliveAll <= 0 || qty <= 0) return { totalQty: 0, allocations: [] };

    if (distMode === "per_bird") {
      const rows = activeBatches.map((b) => {
        const alive = Number(b.current_alive_count || b.bird_count || 0);
        return { batch: b, alive, qty: +(alive * qty).toFixed(3) };
      });
      const tot = rows.reduce((s, r) => s + r.qty, 0);
      return { totalQty: +tot.toFixed(3), allocations: rows };
    }

    // proportional: qty is total, split by alive share
    const rows = activeBatches.map((b) => {
      const alive = Number(b.current_alive_count || b.bird_count || 0);
      return { batch: b, alive, qty: +((qty * alive) / totalAliveAll).toFixed(3) };
    });
    // fix rounding drift on last row
    const drift = +(qty - rows.reduce((s, r) => s + r.qty, 0)).toFixed(3);
    if (rows.length && drift !== 0) rows[rows.length - 1].qty = +(rows[rows.length - 1].qty + drift).toFixed(3);
    return { totalQty: qty, allocations: rows };
  }, [isBulk, distMode, qty, activeBatches, totalAliveAll, singleBatch]);

  const totalCost = totalQty * unitCost;
  const exceedsStock = totalQty > available;

  const save = async () => {
    if (saving) return;
    if (!liveBatchId) return toast.error("اختر دفعة النعام");
    if (!feedId) return toast.error("اختر نوع العلف");
    if (!qty || qty <= 0) return toast.error("ادخل كمية صحيحة");
    if (isBulk && allocations.length === 0) return toast.error("لا توجد دفعات قائمة للصرف عليها");
    if (exceedsStock) return toast.error("كمية العلف المطلوبة أكبر من المخزون المتاح.");

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const feedName = feed?.feed_name || "";

      if (!isBulk) {
        const reference_id = `slaughter_feed_consumption_${liveBatchId.slice(0, 8)}_${date}_${feedId.slice(0, 8)}_${qty}`;
        const { error } = await supabase.from("slaughter_ostrich_feed_consumption" as any).insert({
          consumption_date: date,
          live_batch_id: liveBatchId,
          feed_inventory_id: feedId,
          feed_name: feedName,
          quantity_kg: qty,
          birds_count_at_time: singleBatch?.current_alive_count || singleBatch?.bird_count || 0,
          unit_cost: unitCost,
          total_cost: qty * unitCost,
          responsible_user_id: user?.id,
          notes,
          reference_id,
          created_by: user?.id,
        });
        if (error) {
          if (error.message?.includes("duplicate key") || error.message?.includes("unique")) {
            toast.error("تم تسجيل هذه الحركة من قبل");
          } else throw error;
          return;
        }
        toast.success(`تم صرف ${fmt(qty)} كجم — تكلفة ${fmt(qty * unitCost)} ج.م`);
      } else {
        // Bulk: one record per batch, shared group id
        const groupId = `BULK-${date}-${feedId.slice(0, 8)}-${Date.now().toString(36)}`;
        const bulkNote = `صرف جماعي على كل الدفعات القائمة (${allocations.length} دفعة) — ${notes || ""}`.trim();
        const rows = allocations
          .filter((a) => a.qty > 0)
          .map((a) => ({
            consumption_date: date,
            live_batch_id: a.batch.id,
            feed_inventory_id: feedId,
            feed_name: feedName,
            quantity_kg: a.qty,
            birds_count_at_time: a.alive,
            unit_cost: unitCost,
            total_cost: +(a.qty * unitCost).toFixed(3),
            responsible_user_id: user?.id,
            notes: bulkNote,
            reference_id: `${groupId}_${a.batch.id.slice(0, 8)}`,
            created_by: user?.id,
          }));
        if (rows.length === 0) {
          toast.error("لا يوجد ما يمكن صرفه");
          return;
        }
        const { error } = await supabase.from("slaughter_ostrich_feed_consumption" as any).insert(rows);
        if (error) throw error;
        toast.success(`صرف جماعي: ${fmt(totalQty)} كجم على ${rows.length} دفعة — تكلفة ${fmt(totalCost)} ج.م`);
      }

      onOpenChange(false);
      onSaved?.();
    } catch (e: any) {
      toast.error(e.message || "فشل الحفظ");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Drumstick className="h-5 w-5 text-orange-600" />
            صرف علف للنعام (محمّل على دفعة)
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>التاريخ</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <Label>دفعة النعام</Label>
            <Select value={liveBatchId} onValueChange={setLiveBatchId}>
              <SelectTrigger><SelectValue placeholder="اختر الدفعة" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_BATCHES} className="font-bold text-orange-700">
                  🗂️ كل الدفعات القائمة ({activeBatches.length} دفعة — {totalAliveAll} نعامة)
                </SelectItem>
                {activeBatches.length === 0 && (
                  <div className="p-2 text-xs text-muted-foreground text-center">
                    لا توجد دفعات نعام حي متاحة للصرف
                  </div>
                )}
                {activeBatches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.receipt_number} — حي: {b.current_alive_count || b.bird_count}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isBulk && (
              <div className="mt-1 text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded p-2">
                سيتم صرف العلف على <b>{activeBatches.length}</b> دفعة بإجمالي <b>{totalAliveAll}</b> نعامة قائمة
              </div>
            )}
          </div>

          {isBulk && (
            <div className="col-span-2">
              <Label>طريقة التوزيع</Label>
              <Select value={distMode} onValueChange={(v) => setDistMode(v as DistMode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="proportional">توزيع حسب عدد النعام في كل دفعة (الكمية = الإجمالي)</SelectItem>
                  <SelectItem value="per_bird">كمية ثابتة لكل نعامة (الكمية × عدد النعام)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <Label>نوع العلف</Label>
            <Select value={feedId} onValueChange={setFeedId}>
              <SelectTrigger><SelectValue placeholder="اختر العلف" /></SelectTrigger>
              <SelectContent>
                {feedInventory.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.feed_name} (متاح: {fmt(f.current_kg)} كجم)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>
              {isBulk && distMode === "per_bird" ? "الكمية لكل نعامة (كجم)" : "الكمية (كجم)"}
            </Label>
            <Input type="number" step="0.01" value={qty || ""} onChange={(e) => setQty(Number(e.target.value))} />
          </div>
          <div className="col-span-2">
            <Label>المسؤول عن الصرف</Label>
            <Input value={responsible} onChange={(e) => setResponsible(e.target.value)} placeholder="اسم المسؤول (اختياري)" />
          </div>
          <div className="col-span-2">
            <Label>ملاحظات</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>

          {feed && qty > 0 && (
            <div className="col-span-2 rounded-md border bg-muted/40 p-3 text-sm space-y-1">
              <div>سعر الكيلو: <b>{fmt(unitCost)}</b> ج.م</div>
              <div>إجمالي الكمية المصروفة: <b>{fmt(totalQty)}</b> كجم</div>
              <div>إجمالي تكلفة العلف: <b className="text-orange-700">{fmt(totalCost)}</b> ج.م</div>
              <div>
                الرصيد قبل: {fmt(available)} كجم — الرصيد بعد:{" "}
                <b className={exceedsStock ? "text-destructive" : ""}>{fmt(available - totalQty)}</b> كجم
              </div>
              {exceedsStock && (
                <div className="text-destructive font-bold">كمية العلف المطلوبة أكبر من المخزون المتاح.</div>
              )}
            </div>
          )}

          {isBulk && qty > 0 && allocations.length > 0 && (
            <div className="col-span-2 rounded-md border">
              <div className="bg-orange-50 px-3 py-2 text-sm font-bold border-b">معاينة توزيع الصرف</div>
              <div className="max-h-64 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/60">
                    <tr>
                      <th className="p-2 text-right">كود الدفعة</th>
                      <th className="p-2 text-center">النعام القائم</th>
                      <th className="p-2 text-center">كمية العلف (كجم)</th>
                      <th className="p-2 text-center">التكلفة (ج.م)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allocations.map((a) => (
                      <tr key={a.batch.id} className="border-t">
                        <td className="p-2">{a.batch.receipt_number}</td>
                        <td className="p-2 text-center">{a.alive}</td>
                        <td className="p-2 text-center">{fmt(a.qty)}</td>
                        <td className="p-2 text-center">{fmt(a.qty * unitCost)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-muted/40 font-bold">
                    <tr className="border-t">
                      <td className="p-2">الإجمالي</td>
                      <td className="p-2 text-center">{totalAliveAll}</td>
                      <td className="p-2 text-center">{fmt(totalQty)}</td>
                      <td className="p-2 text-center">{fmt(totalCost)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            onClick={save}
            disabled={saving || !liveBatchId || !feedId || qty <= 0 || exceedsStock || (isBulk && allocations.length === 0)}
            className="bg-orange-600 hover:bg-orange-700"
          >
            {saving ? "جاري الحفظ..." : isBulk ? `حفظ الصرف الجماعي (${allocations.length} دفعة)` : "حفظ الصرف"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default OstrichFeedConsumptionDialog;
