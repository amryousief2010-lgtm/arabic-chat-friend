import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, Factory } from "lucide-react";

type Batch = any;

const STATUSES = ["draft", "under_review", "approved", "closed", "cancelled"] as const;

export default function MeatFactoryBatches() {
  const [tab, setTab] = useState<typeof STATUSES[number]>("draft");
  const [rows, setRows] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [openDetail, setOpenDetail] = useState<Batch | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("meat_factory_batches")
      .select("*").eq("status", tab).order("created_at", { ascending: false }).limit(200);
    if (error) toast.error(error.message);
    setRows(data || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [tab]);

  const act = async (fn: string, args: any) => {
    setBusy(true);
    const { error, data } = await supabase.rpc(fn as any, args);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("تمت العملية"); console.log(fn, data);
    setOpenDetail(null); load();
  };

  return (
    <div dir="rtl" className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Factory className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">دفعات مصنع اللحوم</h1>
          <p className="text-sm text-muted-foreground">سير العمل: مسودة ← مراجعة ← اعتماد ← إغلاق</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          {STATUSES.map(s => <TabsTrigger key={s} value={s}>{s}</TabsTrigger>)}
        </TabsList>
        {STATUSES.map(s => (
          <TabsContent key={s} value={s}>
            <Card>
              <CardHeader><CardTitle>الدفعات — {s}</CardTitle></CardHeader>
              <CardContent>
                {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : rows.length === 0 ? (
                  <div className="text-muted-foreground text-sm">لا توجد دفعات.</div>
                ) : (
                  <div className="space-y-2">
                    {rows.map(b => (
                      <div key={b.id} className="border rounded p-3 flex justify-between items-center">
                        <div>
                          <div className="font-medium">{b.batch_number} — {b.product_name_ar || b.product_code}</div>
                          <div className="text-xs text-muted-foreground">
                            تاريخ {b.production_date} • مخطط {b.planned_qty} {b.unit}
                            {b.bom_version && ` • BOM v${b.bom_version}`}
                            {b.cost_per_unit && ` • تكلفة/وحدة ${Number(b.cost_per_unit).toFixed(2)}`}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge>{b.status}</Badge>
                          <Button size="sm" variant="outline" onClick={() => setOpenDetail(b)}>عرض</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>

      <Dialog open={!!openDetail} onOpenChange={(o) => !o && setOpenDetail(null)}>
        <DialogContent dir="rtl" className="max-w-2xl">
          <DialogHeader><DialogTitle>دفعة {openDetail?.batch_number}</DialogTitle></DialogHeader>
          {openDetail && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><b>المنتج:</b> {openDetail.product_name_ar} ({openDetail.product_code})</div>
                <div><b>الحالة:</b> <Badge>{openDetail.status}</Badge></div>
                <div><b>مخطط:</b> {openDetail.planned_qty} {openDetail.unit}</div>
                <div><b>فعلي:</b> {openDetail.actual_qty ?? "—"} {openDetail.unit}</div>
                <div><b>تكلفة المواد:</b> {Number(openDetail.materials_cost || 0).toFixed(2)}</div>
                <div><b>تكلفة التغليف:</b> {Number(openDetail.packaging_cost || 0).toFixed(2)}</div>
                <div><b>إجمالي التكلفة:</b> {Number(openDetail.total_cost || 0).toFixed(2)}</div>
                <div><b>تكلفة/وحدة:</b> {openDetail.cost_per_unit ? Number(openDetail.cost_per_unit).toFixed(4) : "—"}</div>
              </div>
              {openDetail.cancel_reason && <div className="text-red-700 text-xs">سبب الإلغاء: {openDetail.cancel_reason}</div>}
              {openDetail.override_reason && <div className="text-orange-700 text-xs">override: {openDetail.override_reason}</div>}
            </div>
          )}
          <DialogFooter className="flex-wrap gap-2">
            {openDetail?.status === "draft" && (
              <Button disabled={busy} onClick={() => act("meat_batch_submit_review", { p_batch_id: openDetail.id })}>إرسال للمراجعة</Button>
            )}
            {openDetail?.status === "under_review" && (
              <Button disabled={busy} onClick={() => act("meat_batch_approve", { p_batch_id: openDetail.id, p_override_negative: false })}>اعتماد</Button>
            )}
            {openDetail?.status === "approved" && (
              <Button disabled={busy} onClick={() => act("meat_batch_close", { p_batch_id: openDetail.id })}>إغلاق + ترحيل للمخزون</Button>
            )}
            {openDetail && !["closed", "cancelled"].includes(openDetail.status) && (
              <Button variant="destructive" disabled={busy} onClick={() => {
                const r = prompt("سبب الإلغاء"); if (!r) return;
                act("meat_batch_cancel", { p_batch_id: openDetail.id, p_reason: r });
              }}>إلغاء الدفعة</Button>
            )}
            <Button variant="outline" onClick={() => setOpenDetail(null)}>إغلاق</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
