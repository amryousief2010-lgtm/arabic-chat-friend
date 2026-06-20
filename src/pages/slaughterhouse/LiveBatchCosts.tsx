import { useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Drumstick, Skull, Calculator, RefreshCw, Wheat, Beef, Coins } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { OstrichFeedConsumptionDialog } from "@/components/slaughterhouse/OstrichFeedConsumptionDialog";
import { LiveBatchMortalityDialog } from "@/components/slaughterhouse/LiveBatchMortalityDialog";
import { OpeningCostDialog } from "@/components/slaughterhouse/OpeningCostDialog";

const fmt = (n: number) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });

export default function LiveBatchCosts() {
  const qc = useQueryClient();
  const [feedOpen, setFeedOpen] = useState(false);
  const [mortOpen, setMortOpen] = useState(false);
  const [openingOpen, setOpeningOpen] = useState(false);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);

  const receiptsQ = useQuery({
    queryKey: ["sl_live_receipts_cost"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("slaughter_live_receipts" as any)
        .select("*")
        .order("receipt_date", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data as any[]) || [];
    },
  });

  const invQ = useQuery({
    queryKey: ["sl_feed_inv_for_cons"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("slaughterhouse_feed_inventory" as any)
        .select("id, feed_name, current_kg, last_unit_cost")
        .order("feed_name");
      if (error) throw error;
      return (data as any[]) || [];
    },
  });

  const slaughterQ = useQuery({
    queryKey: ["sl_batches_for_alloc"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("slaughter_batches" as any)
        .select("id, batch_number, slaughter_date, live_receipt_id, birds_slaughtered, total_meat_kg, status, cost_allocation_done, cost_per_kg_meat, total_allocatable_cost")
        .order("slaughter_date", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data as any[]) || [];
    },
  });

  const allReceipts = receiptsQ.data || [];
  const receipts = allReceipts.filter(
    (r) => !r.archived && !r.excluded_from_costing && r.source_type !== 'opening_balance'
  );
  const archivedReceipts = allReceipts.filter(
    (r) => r.archived || r.excluded_from_costing || r.source_type === 'opening_balance'
  );
  const inv = invQ.data || [];
  const slaughterBatches = slaughterQ.data || [];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["sl_live_receipts_cost"] });
    qc.invalidateQueries({ queryKey: ["sl_feed_inv_for_cons"] });
    qc.invalidateQueries({ queryKey: ["sl_batches_for_alloc"] });
  };

  const activeBatch = useMemo(
    () => receipts.find((r) => r.id === activeBatchId) || null,
    [receipts, activeBatchId],
  );

  const totals = useMemo(() => {
    return receipts.reduce(
      (acc, r) => {
        acc.original += Number(r.bird_count || 0);
        acc.alive += Number(r.current_alive_count || 0);
        acc.dead += Number(r.mortality_count || 0);
        acc.feed += Number(r.feed_cost_loaded || 0);
        acc.mort += Number(r.mortality_cost_loaded || 0);
        acc.total += Number(r.total_batch_cost || 0);
        return acc;
      },
      { original: 0, alive: 0, dead: 0, feed: 0, mort: 0, total: 0 },
    );
  }, [receipts]);

  const allocate = async (batchId: string) => {
    try {
      const { data, error } = await supabase.rpc("recompute_slaughter_batch_cost" as any, {
        p_slaughter_batch_id: batchId,
      });
      if (error) throw error;
      const res = data as any;
      toast.success(`تمت إعادة الحساب — تكلفة الكيلو: ${fmt(res?.cost_per_kg || 0)} ج.م`);
      refresh();
    } catch (e: any) {
      toast.error(e.message || "فشل إعادة حساب التكلفة");
    }
  };

  const allocationsQ = useQuery({
    queryKey: ["slaughter_cost_allocations_log"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("slaughter_cost_allocations" as any)
        .select("id, event_type, event_date, total_cost, status, notes, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data as any[]) || [];
    },
  });
  const allocations = allocationsQ.data || [];

  return (
    <DashboardLayout>
      <div dir="rtl" className="p-4 md:p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <Beef className="h-7 w-7 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">تكلفة النعام الجاهز للدبح</h1>
              <p className="text-sm text-muted-foreground">
                تكلفة النعام الأصلية + علف المجزر + تكلفة النافق = التكلفة الفعلية للدفعة
              </p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={refresh}>
              <RefreshCw className="h-4 w-4 ml-1" />
              تحديث
            </Button>
            <Button onClick={() => { setActiveBatchId(null); setFeedOpen(true); }} className="bg-orange-600 hover:bg-orange-700">
              <Wheat className="h-4 w-4 ml-1" />
              صرف علف للنعام
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs">عدد النعام الأصلي</CardTitle></CardHeader>
            <CardContent><div className="text-xl font-bold">{fmt(totals.original)}</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs">النعام الحي</CardTitle></CardHeader>
            <CardContent><div className="text-xl font-bold text-emerald-700">{fmt(totals.alive)}</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs">إجمالي النافق</CardTitle></CardHeader>
            <CardContent><div className="text-xl font-bold text-destructive">{fmt(totals.dead)}</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs">تكلفة العلف المحملة</CardTitle></CardHeader>
            <CardContent><div className="text-xl font-bold text-orange-700">{fmt(totals.feed)} ج.م</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs">تكلفة النافق المحملة</CardTitle></CardHeader>
            <CardContent><div className="text-xl font-bold text-destructive">{fmt(totals.mort)} ج.م</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-xs">إجمالي تكلفة الدفعات</CardTitle></CardHeader>
            <CardContent><div className="text-xl font-bold text-primary">{fmt(totals.total)} ج.م</div></CardContent></Card>
        </div>

        <Tabs defaultValue="batches" dir="rtl">
          <TabsList>
            <TabsTrigger value="batches">دفعات النعام الحي</TabsTrigger>
            <TabsTrigger value="slaughter">دفعات الذبح — التكلفة</TabsTrigger>
            <TabsTrigger value="alloc_log">سجل توزيع التكاليف</TabsTrigger>
            <TabsTrigger value="archived">الأرشيف ({archivedReceipts.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="batches">
            <Card>
              <CardHeader><CardTitle className="text-base">الدفعات وتكلفتها الفعلية</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الدفعة</TableHead>
                      <TableHead>التاريخ</TableHead>
                      <TableHead>الأصلي</TableHead>
                      <TableHead>الحي</TableHead>
                      <TableHead>النافق</TableHead>
                      <TableHead>تكلفة النعام</TableHead>
                      <TableHead>تكلفة العلف</TableHead>
                      <TableHead>تكلفة النافق</TableHead>
                      <TableHead>إجمالي التكلفة</TableHead>
                      <TableHead>تكلفة النعامة</TableHead>
                      <TableHead>إجراءات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {receipts.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.receipt_number}</TableCell>
                        <TableCell className="text-xs">{r.receipt_date}</TableCell>
                        <TableCell>{r.bird_count}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Badge variant={r.status === 'ready_for_slaughter' ? 'default' : 'secondary'}>
                              {r.current_alive_count ?? r.bird_count}
                            </Badge>
                            {r.status === 'ready_for_slaughter' && (
                              <Badge className="bg-emerald-600 text-[10px]">جاهزة</Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{r.mortality_count > 0 ? <Badge variant="destructive">{r.mortality_count}</Badge> : 0}</TableCell>
                        <TableCell>{fmt(r.total_cost)}</TableCell>
                        <TableCell className="text-orange-700">{fmt(r.feed_cost_loaded)}</TableCell>
                        <TableCell className="text-destructive">{fmt(r.mortality_cost_loaded)}</TableCell>
                        <TableCell className="font-bold">{fmt(r.total_batch_cost)}</TableCell>
                        <TableCell className="font-bold text-primary">{fmt(r.cost_per_bird_current)}</TableCell>
                        <TableCell>
                          <div className="flex gap-1 flex-wrap">
                            <Button
                              size="sm"
                              variant={r.status === 'ready_for_slaughter' ? 'outline' : 'default'}
                              className={r.status === 'ready_for_slaughter' ? '' : 'bg-emerald-600 hover:bg-emerald-700'}
                              onClick={async () => {
                                const newStatus = r.status === 'ready_for_slaughter' ? 'in_holding' : 'ready_for_slaughter';
                                const { error } = await supabase
                                  .from('slaughter_live_receipts' as any)
                                  .update({ status: newStatus })
                                  .eq('id', r.id);
                                if (error) { toast.error(error.message); return; }
                                toast.success(newStatus === 'ready_for_slaughter' ? 'تم تعليم الدفعة كجاهزة للدبح' : 'تم إلغاء حالة الجاهزية');
                                refresh();
                              }}
                            >
                              {r.status === 'ready_for_slaughter' ? 'إلغاء الجاهزية' : 'علِّم جاهزة للدبح'}
                            </Button>
                            <Button size="sm" variant="secondary" onClick={() => { setActiveBatchId(r.id); setOpeningOpen(true); }}>
                              <Coins className="h-3 w-3 ml-1" />
                              {Number(r.opening_cost_total || 0) > 0 ? "تعديل افتتاحية" : "تكلفة افتتاحية"}
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => { setActiveBatchId(r.id); setFeedOpen(true); }}>
                              <Wheat className="h-3 w-3 ml-1" />علف
                            </Button>
                            <Button size="sm" variant="destructive" onClick={() => { setActiveBatchId(r.id); setMortOpen(true); }}>
                              <Skull className="h-3 w-3 ml-1" />نفوق
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!receipts.length && (
                      <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground">لا توجد دفعات</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="slaughter">
            <Card>
              <CardHeader><CardTitle className="text-base">دفعات الذبح — معاينة وتوزيع التكلفة على المنتجات</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>دفعة الذبح</TableHead>
                      <TableHead>التاريخ</TableHead>
                      <TableHead>عدد النعام</TableHead>
                      <TableHead>كيلو الناتج</TableHead>
                      <TableHead>دفعة المصدر</TableHead>
                      <TableHead>تكلفة النعامة</TableHead>
                      <TableHead>إجمالي تكلفة الدبح</TableHead>
                      <TableHead>تكلفة الكيلو</TableHead>
                      <TableHead>الحالة</TableHead>
                      <TableHead>إجراء</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {slaughterBatches.map((b) => {
                      const live = receipts.find((r) => r.id === b.live_receipt_id);
                      const cpb = Number(live?.cost_per_bird_current || 0);
                      const previewBirdsCost = cpb * Number(b.birds_slaughtered || 0);
                      return (
                        <TableRow key={b.id}>
                          <TableCell className="font-medium">{b.batch_number}</TableCell>
                          <TableCell className="text-xs">{b.slaughter_date}</TableCell>
                          <TableCell>{b.birds_slaughtered}</TableCell>
                          <TableCell>{fmt(b.total_meat_kg)} كجم</TableCell>
                          <TableCell className="text-xs">{live?.receipt_number || "—"}</TableCell>
                          <TableCell>{fmt(cpb)}</TableCell>
                          <TableCell className="font-bold">{fmt(b.total_allocatable_cost || previewBirdsCost)}</TableCell>
                          <TableCell className="font-bold text-primary">{fmt(b.cost_per_kg_meat)}</TableCell>
                          <TableCell>
                            {b.cost_allocation_done
                              ? <Badge variant="default">موزعة</Badge>
                              : <Badge variant="secondary">في الانتظار</Badge>}
                          </TableCell>
                          <TableCell>
                            <Button size="sm" variant="outline" onClick={() => allocate(b.id)} disabled={!b.live_receipt_id}>
                              <Calculator className="h-3 w-3 ml-1" />
                              إعادة حساب التكلفة
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {!slaughterBatches.length && (
                      <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground">لا توجد دفعات ذبح</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="alloc_log">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">سجل توزيع تكاليف نعام الدبح (تلقائي)</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  كل صرف علف أو نافق يتوزع تلقائيًا على دفعات النعام الجاهزة بالتناسب مع عدد النعام الحي. الأحداث بحالة <Badge variant="secondary">pending</Badge> هي أحداث تكلفة لم تجد دفعات جاهزة وقت تسجيلها.
                </p>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>التاريخ</TableHead>
                      <TableHead>النوع</TableHead>
                      <TableHead>إجمالي التكلفة</TableHead>
                      <TableHead>الحالة</TableHead>
                      <TableHead>ملاحظة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allocations.map((a: any) => (
                      <TableRow key={a.id}>
                        <TableCell className="text-xs">{a.event_date}</TableCell>
                        <TableCell>
                          {a.event_type === 'feed' ? <Badge className="bg-orange-600">صرف علف</Badge>
                            : a.event_type === 'mortality' ? <Badge variant="destructive">نافق</Badge>
                            : <Badge variant="outline">{a.event_type}</Badge>}
                        </TableCell>
                        <TableCell className="font-medium">{fmt(a.total_cost)} ج.م</TableCell>
                        <TableCell>
                          {a.status === 'allocated' ? <Badge variant="default">موزعة</Badge>
                            : a.status === 'pending' ? <Badge variant="secondary">بانتظار التوزيع</Badge>
                            : <Badge variant="outline">ملغية</Badge>}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{a.notes || '—'}</TableCell>
                      </TableRow>
                    ))}
                    {!allocations.length && (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">لا توجد عمليات توزيع بعد</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="archived">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">دفعات مؤرشفة / مستبعدة من التكلفة</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  هذه الدفعات (افتتاحية أو مستبعدة) لا تدخل في توزيع تكلفة العلف أو النافق، ولا تظهر ضمن الجاهزة للدبح.
                </p>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الدفعة</TableHead>
                      <TableHead>التاريخ</TableHead>
                      <TableHead>الأصلي</TableHead>
                      <TableHead>الحي</TableHead>
                      <TableHead>السبب</TableHead>
                      <TableHead>الحالة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {archivedReceipts.map((r) => (
                      <TableRow key={r.id} className="opacity-70">
                        <TableCell className="font-medium">{r.receipt_number}</TableCell>
                        <TableCell className="text-xs">{r.receipt_date}</TableCell>
                        <TableCell>{r.bird_count}</TableCell>
                        <TableCell>{r.current_alive_count ?? r.bird_count}</TableCell>
                        <TableCell className="text-xs">
                          {r.archive_reason || (r.source_type === 'opening_balance' ? 'دفعة افتتاحية' : '—')}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">مستبعدة من التكلفة</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!archivedReceipts.length && (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">لا توجد دفعات مؤرشفة</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <OstrichFeedConsumptionDialog
        open={feedOpen}
        onOpenChange={setFeedOpen}
        liveBatches={receipts as any}
        feedInventory={inv as any}
        defaultLiveBatchId={activeBatchId || undefined}
        onSaved={refresh}
      />
      <LiveBatchMortalityDialog
        open={mortOpen}
        onOpenChange={setMortOpen}
        liveBatch={activeBatch as any}
        onSaved={refresh}
      />
      <OpeningCostDialog
        open={openingOpen}
        onOpenChange={setOpeningOpen}
        batch={activeBatch as any}
        onSaved={refresh}
      />
    </DashboardLayout>
  );
}
