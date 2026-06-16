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

const fmt = (n: number) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });

type LiveBatch = {
  id: string;
  receipt_number: string;
  receipt_date: string;
  bird_count: number;
  current_alive_count: number;
  cost_per_bird_current: number;
};

type FeedInv = { id: string; feed_name: string; current_kg: number; last_unit_cost: number };

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
  const [responsible, setResponsible] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDate(new Date().toISOString().slice(0, 10));
      setLiveBatchId(defaultLiveBatchId || "");
      setFeedId("");
      setQty(0);
      setResponsible("");
      setNotes("");
    }
  }, [open, defaultLiveBatchId]);

  const feed = useMemo(() => feedInventory.find((f) => f.id === feedId), [feedInventory, feedId]);
  const batch = useMemo(() => liveBatches.find((b) => b.id === liveBatchId), [liveBatches, liveBatchId]);
  const available = Number(feed?.current_kg || 0);
  const unitCost = Number(feed?.last_unit_cost || 0);
  const total = qty * unitCost;

  const save = async () => {
    if (saving) return;
    if (!liveBatchId) return toast.error("اختر دفعة النعام");
    if (!feedId) return toast.error("اختر نوع العلف");
    if (!qty || qty <= 0) return toast.error("ادخل كمية صحيحة");
    if (qty > available) return toast.error(`الرصيد المتاح ${fmt(available)} كجم فقط`);

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const reference_id = `slaughter_feed_consumption_${liveBatchId.slice(0, 8)}_${date}_${feedId.slice(0, 8)}_${qty}`;
      const { error } = await supabase.from("slaughter_ostrich_feed_consumption" as any).insert({
        consumption_date: date,
        live_batch_id: liveBatchId,
        feed_inventory_id: feedId,
        feed_name: feed?.feed_name || "",
        quantity_kg: qty,
        birds_count_at_time: batch?.current_alive_count || batch?.bird_count || 0,
        unit_cost: unitCost,
        total_cost: total,
        responsible_user_id: user?.id,
        notes,
        reference_id,
        created_by: user?.id,
      });
      if (error) {
        if (error.message?.includes("duplicate key") || error.message?.includes("unique")) {
          toast.error("تم تسجيل هذه الحركة من قبل");
        } else {
          throw error;
        }
        return;
      }
      toast.success(`تم صرف ${fmt(qty)} كجم — تكلفة ${fmt(total)} ج.م حُمّلت على الدفعة`);
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
      <DialogContent dir="rtl" className="max-w-lg">
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
                {liveBatches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.receipt_number} — حي: {b.current_alive_count || b.bird_count}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
            <Label>الكمية (كجم)</Label>
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
              <div>إجمالي تكلفة العلف: <b className="text-orange-700">{fmt(total)}</b> ج.م</div>
              <div>الرصيد قبل: {fmt(available)} كجم — الرصيد بعد: <b className={qty > available ? "text-destructive" : ""}>{fmt(available - qty)}</b> كجم</div>
              {batch && (
                <div className="text-xs text-muted-foreground">
                  ستُحمّل هذه التكلفة على دفعة <b>{batch.receipt_number}</b> ({batch.current_alive_count || batch.bird_count} نعامة)
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={saving || !liveBatchId || !feedId || qty <= 0 || qty > available}
                  className="bg-orange-600 hover:bg-orange-700">
            {saving ? "جاري الحفظ..." : "حفظ الصرف"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default OstrichFeedConsumptionDialog;
