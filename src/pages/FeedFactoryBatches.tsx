import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, Wheat } from "lucide-react";

const STATUSES = ["draft", "under_review", "approved", "closed", "cancelled"] as const;

export default function FeedFactoryBatches() {
  const [tab, setTab] = useState<typeof STATUSES[number]>("draft");
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [openDetail, setOpenDetail] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    // map "draft" => 'draft' or legacy 'planned'
    const filter = tab === "draft" ? ["draft", "planned"] : [tab];
    const { data, error } = await supabase
      .from("feed_production_batches")
      .select("*").in("status", filter).order("created_at", { ascending: false }).limit(200);
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
        <Wheat className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">دفعات مصنع الأعلاف</h1>
          <p className="text-sm text-muted-foreground">سير العمل: مسودة ← مراجعة ← اعتماد ← إغلاق — فاتورة 164 تبقى needs_review حتى يتم اعتمادها لاحقًا</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>{STATUSES.map(s => <TabsTrigger key={s} value={s}>{s}</TabsTrigger>)}</TabsList>
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
                          <div className="font-medium">{b.batch_number}</div>
                          <div className="text-xs text-muted-foreground">
                            مخطط {b.target_quantity} كجم • فعلي {b.actual_quantity ?? "—"}
                            {b.cost_per_kg && ` • تكلفة/كجم ${Number(b.cost_per_kg).toFixed(2)}`}
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
                <div><b>الحالة:</b> <Badge>{openDetail.status}</Badge></div>
                <div><b>تاريخ:</b> {openDetail.production_date}</div>
                <div><b>مخطط:</b> {openDetail.target_quantity} كجم</div>
                <div><b>فعلي:</b> {openDetail.actual_quantity ?? "—"} كجم</div>
                <div><b>إجمالي التكلفة:</b> {Number(openDetail.total_cost || 0).toFixed(2)}</div>
                <div><b>تكلفة/كجم:</b> {openDetail.cost_per_kg ? Number(openDetail.cost_per_kg).toFixed(4) : "—"}</div>
              </div>
            </div>
          )}
          <DialogFooter className="flex-wrap gap-2">
            {["draft", "planned"].includes(openDetail?.status) && (
              <Button disabled={busy} onClick={() => act("feed_batch_submit_review", { p_batch_id: openDetail.id })}>إرسال للمراجعة</Button>
            )}
            {openDetail?.status === "under_review" && (
              <Button disabled={busy} onClick={() => act("feed_batch_approve", { p_batch_id: openDetail.id, p_override_negative: false })}>اعتماد</Button>
            )}
            {openDetail?.status === "approved" && (
              <Button disabled={busy} onClick={() => act("feed_batch_close", { p_batch_id: openDetail.id })}>إغلاق + ترحيل للمخزون</Button>
            )}
            {openDetail && !["closed", "cancelled"].includes(openDetail.status) && (
              <Button variant="destructive" disabled={busy} onClick={() => {
                const r = prompt("سبب الإلغاء"); if (!r) return;
                act("feed_batch_cancel", { p_batch_id: openDetail.id, p_reason: r });
              }}>إلغاء الدفعة</Button>
            )}
            <Button variant="outline" onClick={() => setOpenDetail(null)}>إغلاق</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
