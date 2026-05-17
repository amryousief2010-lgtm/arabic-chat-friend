import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowRight, Play, CheckCircle2, XCircle, Activity, Package2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { formatDateTime } from "@/lib/dateFormat";

const statusLabels: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  planned: { label: "مخططة", variant: "secondary" },
  in_progress: { label: "قيد التنفيذ", variant: "default" },
  completed: { label: "مكتملة", variant: "outline" },
  cancelled: { label: "ملغاة", variant: "destructive" },
};

const BatchTracking = () => {
  const { id } = useParams<{ id: string }>();
  const { canManageFeedFactory, user } = useAuth();
  const { toast } = useToast();
  const [batch, setBatch] = useState<any>(null);
  const [consumption, setConsumption] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    const [b, c, e] = await Promise.all([
      supabase.from("feed_production_batches").select("*, recipe:feed_recipes(name, feed_type, batch_size, unit, items:feed_recipe_items(*, raw_material:feed_raw_materials(*)))").eq("id", id).single(),
      supabase.from("feed_batch_consumption").select("*, raw_material:feed_raw_materials(name, unit)").eq("batch_id", id),
      supabase.from("feed_batch_events").select("*").eq("batch_id", id).order("created_at", { ascending: false }),
    ]);
    if (b.data) setBatch(b.data);
    if (c.data) setConsumption(c.data);
    if (e.data) setEvents(e.data);
    setLoading(false);
  };

  useEffect(() => { load(); }, [id]);

  const logEvent = async (event_type: string, from_status: string | null, to_status: string | null, details: any = {}) => {
    await supabase.from("feed_batch_events").insert({
      batch_id: id, event_type, from_status, to_status, details, performed_by: user?.id,
    });
  };

  const startBatch = async () => {
    const recipe = batch.recipe;
    if (!recipe?.items?.length) { toast({ title: "لا توجد بنود", variant: "destructive" }); return; }
    const scale = batch.target_quantity / recipe.batch_size;
    let totalCost = 0;
    const cons = recipe.items.map((i: any) => {
      const qty = i.quantity * scale;
      const cost = qty * (i.raw_material?.unit_cost || 0);
      totalCost += cost;
      return { batch_id: id, raw_material_id: i.raw_material_id, quantity: qty, unit_cost: i.raw_material?.unit_cost || 0, total_cost: cost };
    });
    for (const c of cons) {
      const { data: mat } = await supabase.from("feed_raw_materials").select("stock,name,unit").eq("id", c.raw_material_id).single();
      if (!mat || Number(mat.stock) < c.quantity) {
        toast({ title: "مخزون غير كافٍ", description: `${mat?.name}: متاح ${mat?.stock}`, variant: "destructive" });
        return;
      }
    }
    await supabase.from("feed_batch_consumption").insert(cons);
    for (const c of cons) {
      const { data: mat } = await supabase.from("feed_raw_materials").select("stock").eq("id", c.raw_material_id).single();
      if (mat) await supabase.from("feed_raw_materials").update({ stock: Number(mat.stock) - c.quantity }).eq("id", c.raw_material_id);
    }
    await supabase.from("feed_production_batches").update({ status: "in_progress", started_at: new Date().toISOString(), total_cost: totalCost }).eq("id", id);
    await logEvent("status_change", batch.status, "in_progress", { total_cost: totalCost, items_consumed: cons.length });
    toast({ title: "تم بدء الإنتاج" });
    load();
  };

  const completeBatch = async () => {
    const actual = window.prompt("الكمية الفعلية المنتجة:", String(batch.target_quantity));
    if (!actual) return;
    const a = Number(actual);
    if (isNaN(a) || a <= 0) return;
    await supabase.from("feed_production_batches").update({ status: "completed", actual_quantity: a, completed_at: new Date().toISOString() }).eq("id", id);
    await logEvent("status_change", batch.status, "completed", { actual_quantity: a });
    toast({ title: "تم إكمال الدفعة" });
    load();
  };

  const cancelBatch = async () => {
    if (!window.confirm("هل تريد إلغاء الدفعة؟")) return;
    await supabase.from("feed_production_batches").update({ status: "cancelled" }).eq("id", id);
    await logEvent("status_change", batch.status, "cancelled", {});
    toast({ title: "تم الإلغاء" });
    load();
  };

  if (loading) return <DashboardLayout><div className="text-center py-16 text-muted-foreground">جارٍ التحميل...</div></DashboardLayout>;
  if (!batch) return <DashboardLayout><div className="text-center py-16">الدفعة غير موجودة</div></DashboardLayout>;

  const totalConsumed = consumption.reduce((s, c) => s + Number(c.quantity), 0);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3 flex-wrap">
          <Link to="/modules/feed-factory"><Button variant="ghost" size="sm"><ArrowRight className="w-4 h-4 ml-1" />رجوع</Button></Link>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-foreground">دفعة {batch.batch_number}</h1>
            <p className="text-sm text-muted-foreground">{batch.recipe?.name} · {batch.recipe?.feed_type}</p>
          </div>
          <Badge variant={statusLabels[batch.status]?.variant} className="text-base px-4 py-1">{statusLabels[batch.status]?.label}</Badge>
        </div>

        {canManageFeedFactory && (
          <div className="flex gap-2 flex-wrap">
            {batch.status === "planned" && (<>
              <Button onClick={startBatch}><Play className="w-4 h-4 ml-2" />بدء الإنتاج</Button>
              <Button variant="outline" onClick={cancelBatch}><XCircle className="w-4 h-4 ml-2" />إلغاء</Button>
            </>)}
            {batch.status === "in_progress" && (
              <Button onClick={completeBatch}><CheckCircle2 className="w-4 h-4 ml-2" />إكمال الدفعة</Button>
            )}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-4">
          <Card><CardHeader className="pb-2"><CardDescription>الكمية المستهدفة</CardDescription><CardTitle className="text-2xl">{batch.target_quantity} {batch.recipe?.unit}</CardTitle></CardHeader></Card>
          <Card><CardHeader className="pb-2"><CardDescription>الكمية الفعلية</CardDescription><CardTitle className="text-2xl">{batch.actual_quantity || "—"}</CardTitle></CardHeader></Card>
          <Card><CardHeader className="pb-2"><CardDescription>التكلفة الإجمالية</CardDescription><CardTitle className="text-2xl">{Number(batch.total_cost).toFixed(2)}</CardTitle></CardHeader></Card>
          <Card><CardHeader className="pb-2"><CardDescription>المواد المستهلكة</CardDescription><CardTitle className="text-2xl">{totalConsumed.toFixed(2)}</CardTitle></CardHeader></Card>
        </div>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Package2 className="w-5 h-5" />استهلاك المواد الخام</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>
                <TableHead>المادة</TableHead><TableHead>الكمية المخصومة</TableHead><TableHead>الوحدة</TableHead><TableHead>سعر الوحدة</TableHead><TableHead>التكلفة</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {consumption.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">لم يتم خصم مواد بعد</TableCell></TableRow>
                ) : consumption.map(c => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.raw_material?.name}</TableCell>
                    <TableCell>{Number(c.quantity).toFixed(2)}</TableCell>
                    <TableCell>{c.raw_material?.unit}</TableCell>
                    <TableCell>{Number(c.unit_cost).toFixed(2)}</TableCell>
                    <TableCell>{Number(c.total_cost).toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Activity className="w-5 h-5" />سجل الأحداث</CardTitle></CardHeader>
          <CardContent>
            {events.length === 0 ? (
              <p className="text-center text-muted-foreground py-6">لا توجد أحداث بعد</p>
            ) : (
              <ol className="space-y-3 border-r-2 border-border pr-4">
                {events.map(ev => (
                  <li key={ev.id} className="relative">
                    <div className="absolute -right-[1.4rem] top-1 w-3 h-3 rounded-full bg-primary" />
                    <div className="flex flex-wrap items-center gap-2">
                      {ev.from_status && <Badge variant="outline">{statusLabels[ev.from_status]?.label || ev.from_status}</Badge>}
                      <span className="text-xs">←</span>
                      {ev.to_status && <Badge variant={statusLabels[ev.to_status]?.variant}>{statusLabels[ev.to_status]?.label || ev.to_status}</Badge>}
                      <span className="text-xs text-muted-foreground mr-auto">{formatDateTime(ev.created_at)}</span>
                    </div>
                    {ev.details && Object.keys(ev.details).length > 0 && (
                      <pre className="text-xs bg-muted/40 rounded p-2 mt-1 whitespace-pre-wrap">{JSON.stringify(ev.details, null, 2)}</pre>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default BatchTracking;
