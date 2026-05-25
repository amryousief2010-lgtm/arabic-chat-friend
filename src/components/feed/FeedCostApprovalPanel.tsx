import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Coins, CheckCircle2, AlertTriangle, TrendingUp, Factory, PackageCheck, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from "recharts";
import { FeedVarianceBanner } from "./FeedVarianceBanner";
import { FeedQualityReviewDialog } from "./FeedQualityReviewDialog";

const COST_APPROVER_ROLES = ['general_manager','executive_manager','accountant','financial_manager','feed_factory_manager'];
const FEED_WAREHOUSES = ['مخزن أعلاف وأدوية', 'مخزن المصنع', 'مخزن المزرعة'];

const fmt = (v: any, d = 2) => v == null ? "—" : Number(v).toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });

export const FeedCostApprovalPanel = ({ onChanged }: { onChanged?: () => void }) => {
  const { role } = useAuth();
  const canApprove = !!role && COST_APPROVER_ROLES.includes(role);

  const [batches, setBatches] = useState<any[]>([]);
  const [products, setProducts] = useState<Record<string, any>>({});
  const [qcByBatch, setQcByBatch] = useState<Record<string, string>>({});
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [target, setTarget] = useState<any | null>(null);
  const [destination, setDestination] = useState<string>(FEED_WAREHOUSES[0]);
  const [notes, setNotes] = useState("");
  const [approving, setApproving] = useState(false);
  const [editForm, setEditForm] = useState({ other_expenses: 0, byproduct_value: 0, approved_output_qty: 0 });

  const [qcTarget, setQcTarget] = useState<any | null>(null);

  const fetchAll = async () => {
    setLoading(true);
    const [b, p, q, a] = await Promise.all([
      supabase.from("feed_invoice_batches" as any).select("*").order("invoice_date", { ascending: false }).limit(200),
      supabase.from("feed_products" as any).select("id,name,feed_code"),
      supabase.from("feed_qc_checks" as any).select("batch_id,result").order("decided_at", { ascending: false }),
      supabase.from("data_quality_tasks" as any).select("*").eq("module", "feed").eq("status", "open").order("created_at", { ascending: false }).limit(50),
    ]);
    setBatches((b.data as any) || []);
    const pMap: Record<string, any> = {};
    ((p.data as any) || []).forEach((x: any) => { pMap[x.id] = x; });
    setProducts(pMap);
    const qMap: Record<string, string> = {};
    ((q.data as any) || []).forEach((x: any) => { if (!qMap[x.batch_id]) qMap[x.batch_id] = x.result; });
    setQcByBatch(qMap);
    setAlerts((a.data as any) || []);
    setLoading(false);
  };
  useEffect(() => { fetchAll(); }, []);

  const pendingApproval = useMemo(
    () => batches.filter(b => !b.posted_to_inventory && qcByBatch[b.id] === "passed"),
    [batches, qcByBatch]
  );
  const pendingQc = useMemo(
    () => batches.filter(b => !b.posted_to_inventory && !qcByBatch[b.id]),
    [batches, qcByBatch]
  );
  const approved = useMemo(() => batches.filter(b => b.posted_to_inventory), [batches]);

  // KPIs
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
  const monthBatches = batches.filter(b => b.invoice_date && new Date(b.invoice_date) >= monthStart);
  const monthOutput = monthBatches.reduce((s, b: any) => s + Number(b.output_qty_kg || 0), 0);
  const avgUnitCost = approved.length
    ? approved.reduce((s, b: any) => s + Number(b.final_unit_cost || b.unit_cost_calc || 0), 0) / approved.length : 0;

  const costPerProduct = useMemo(() => {
    const map = new Map<string, { name: string; total: number; count: number }>();
    approved.forEach((b: any) => {
      const k = products[b.feed_product_id]?.name || b.feed_product_id;
      const cur = map.get(k) || { name: k, total: 0, count: 0 };
      cur.total += Number(b.final_unit_cost || b.unit_cost_calc || 0); cur.count += 1;
      map.set(k, cur);
    });
    return Array.from(map.values()).map(v => ({ name: v.name, avg: v.total / v.count }))
      .sort((a, b) => b.avg - a.avg).slice(0, 6);
  }, [approved, products]);

  const openApprove = (b: any) => {
    setTarget(b);
    setEditForm({
      other_expenses: Number(b.other_expenses || 0),
      byproduct_value: Number(b.byproduct_value || 0),
      approved_output_qty: Number(b.approved_output_qty || b.output_qty_kg || 0),
    });
    setDestination(b.destination_warehouse || b.warehouse_name || FEED_WAREHOUSES[0]);
    setNotes("");
  };

  const submit = async () => {
    if (!target) return;
    if (!editForm.approved_output_qty || editForm.approved_output_qty <= 0) {
      toast.error("الكمية المعتمدة يجب أن تكون أكبر من صفر"); return;
    }
    setApproving(true);
    const { error: upErr } = await supabase.from("feed_invoice_batches" as any)
      .update({
        other_expenses: editForm.other_expenses,
        byproduct_value: editForm.byproduct_value,
      })
      .eq("id", target.id);
    if (upErr) { setApproving(false); toast.error("فشل التحديث: " + upErr.message); return; }

    // Recompute packaging cost first
    await supabase.rpc("recompute_feed_batch_cost" as any, { p_batch: target.id });

    const { error } = await supabase.rpc("approve_feed_batch_cost" as any, {
      p_batch: target.id,
      p_final_qty: editForm.approved_output_qty,
      p_destination: destination,
      p_notes: notes || null,
    });
    setApproving(false);
    if (error) { toast.error("فشل الاعتماد: " + error.message); return; }
    toast.success("✅ تم اعتماد التكلفة وترحيل العلف للمخزن");
    setTarget(null);
    await fetchAll();
    onChanged?.();
  };

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4">
          <div className="flex items-center justify-between"><Factory className="w-5 h-5 text-primary" /><span className="text-xs text-muted-foreground">هذا الشهر</span></div>
          <div className="text-2xl font-bold mt-1">{monthBatches.length}</div>
          <div className="text-xs text-muted-foreground">دفعات</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center justify-between"><PackageCheck className="w-5 h-5 text-green-600" /><span className="text-xs text-muted-foreground">إنتاج الشهر</span></div>
          <div className="text-2xl font-bold mt-1">{fmt(monthOutput, 0)}</div>
          <div className="text-xs text-muted-foreground">كجم</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center justify-between"><TrendingUp className="w-5 h-5 text-orange-600" /><span className="text-xs text-muted-foreground">متوسط تكلفة/كجم</span></div>
          <div className="text-2xl font-bold mt-1">{fmt(avgUnitCost, 2)}</div>
          <div className="text-xs text-muted-foreground">ج.م</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center justify-between"><Coins className="w-5 h-5 text-purple-600" /><span className="text-xs text-muted-foreground">بانتظار الاعتماد</span></div>
          <div className="text-2xl font-bold mt-1">{pendingApproval.length}</div>
          <div className="text-xs text-muted-foreground">دفعة</div>
        </CardContent></Card>
      </div>

      {costPerProduct.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">تكلفة الكيلو حسب نوع العلف (متوسط)</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={costPerProduct}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="avg" fill="hsl(var(--primary))">
                  {costPerProduct.map((_, i) => <Cell key={i} fill={`hsl(${(i * 50) % 360} 70% 55%)`} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {alerts.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2 text-destructive">
            <AlertTriangle className="w-4 h-4" /> تنبيهات جودة البيانات ({alerts.length})
          </CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>النوع</TableHead><TableHead>الوصف</TableHead><TableHead>الخطورة</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {alerts.slice(0, 20).map((t: any) => (
                  <TableRow key={t.id}>
                    <TableCell>{t.task_type}</TableCell>
                    <TableCell className="text-xs">{t.description}</TableCell>
                    <TableCell><Badge variant={t.severity === 'high' ? 'destructive' : 'secondary'}>{t.severity}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Batches awaiting QC */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="w-4 h-4" /> دفعات بانتظار فحص الجودة ({pendingQc.length})
        </CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>الدفعة</TableHead><TableHead>المنتج</TableHead><TableHead>الكمية</TableHead>
              <TableHead>تكلفة/كجم</TableHead><TableHead>الحالة</TableHead><TableHead>إجراء</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {pendingQc.map((b: any) => (
                <TableRow key={b.id}>
                  <TableCell className="font-mono text-xs">{b.batch_no}</TableCell>
                  <TableCell>{products[b.feed_product_id]?.name || "—"}</TableCell>
                  <TableCell>{fmt(b.output_qty_kg, 0)} كجم</TableCell>
                  <TableCell>{fmt(b.unit_cost_calc, 2)}</TableCell>
                  <TableCell>
                    {b.needs_review
                      ? <Badge variant="destructive">مراجعة</Badge>
                      : <Badge variant="secondary">{b.status}</Badge>}
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" onClick={() => setQcTarget(b)}>
                      <ShieldCheck className="w-4 h-4 ml-1" /> فحص الجودة
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!pendingQc.length && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                  لا توجد دفعات بانتظار فحص الجودة.
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pending approval */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2">
          <Coins className="w-4 h-4" /> دفعات بانتظار اعتماد التكلفة ({pendingApproval.length})
        </CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {!canApprove && (
            <Alert className="mb-3">
              <AlertTitle>عرض فقط</AlertTitle>
              <AlertDescription>اعتماد التكلفة متاح للمحاسب / المدير المالي / مدير المصنع / الإدارة العليا فقط.</AlertDescription>
            </Alert>
          )}
          <Table>
            <TableHeader><TableRow>
              <TableHead>الدفعة</TableHead><TableHead>المنتج</TableHead><TableHead>كمية المخرجات</TableHead>
              <TableHead>مدخلات</TableHead><TableHead>تشغيل</TableHead><TableHead>تعبئة</TableHead>
              <TableHead>تكلفة/كجم</TableHead><TableHead>الحالة</TableHead><TableHead>إجراء</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {pendingApproval.map((b: any) => (
                <TableRow key={b.id} className={b.needs_review ? "bg-yellow-50 dark:bg-yellow-950/20" : ""}>
                  <TableCell className="font-mono text-xs">{b.batch_no}</TableCell>
                  <TableCell>{products[b.feed_product_id]?.name || "—"}</TableCell>
                  <TableCell>{fmt(b.output_qty_kg, 0)} كجم</TableCell>
                  <TableCell>{fmt(b.input_cost, 0)}</TableCell>
                  <TableCell>{fmt(b.operating_cost, 0)}</TableCell>
                  <TableCell>{fmt(b.packaging_cost, 0)}</TableCell>
                  <TableCell className="font-semibold">{fmt(b.final_unit_cost || b.unit_cost_calc, 2)}</TableCell>
                  <TableCell>
                    {b.needs_review
                      ? <Badge variant="destructive">مراجعة</Badge>
                      : <Badge variant="default">جاهزة</Badge>}
                  </TableCell>
                  <TableCell>
                    <Button size="sm" disabled={!canApprove} onClick={() => openApprove(b)}>
                      <CheckCircle2 className="w-4 h-4 ml-1" /> اعتماد
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!pendingApproval.length && (
                <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">
                  لا توجد دفعات بانتظار الاعتماد. (تأكد من اجتياز فحص الجودة أولاً.)
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* QC dialog */}
      <FeedQualityReviewDialog
        open={!!qcTarget}
        batchId={qcTarget?.id || null}
        batchNumber={qcTarget?.batch_no}
        onClose={() => setQcTarget(null)}
        onDone={fetchAll}
      />

      {/* Approve dialog */}
      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>اعتماد تكلفة الدفعة {target?.batch_no}</DialogTitle></DialogHeader>
          {target && (
            <div className="space-y-3">
              {target.needs_review && <FeedVarianceBanner reason={target.review_reason} />}
              <div className="text-sm text-muted-foreground">
                المنتج: <span className="font-semibold text-foreground">{products[target.feed_product_id]?.name}</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>الكمية المعتمدة (كجم)</Label>
                  <Input type="number" step="0.1" min={0}
                    value={editForm.approved_output_qty}
                    onChange={e => setEditForm(f => ({ ...f, approved_output_qty: parseFloat(e.target.value) || 0 }))} />
                </div>
                <div>
                  <Label>مصاريف أخرى (ج)</Label>
                  <Input type="number" step="0.01" min={0}
                    value={editForm.other_expenses}
                    onChange={e => setEditForm(f => ({ ...f, other_expenses: parseFloat(e.target.value) || 0 }))} />
                </div>
                <div>
                  <Label>قيمة ناتج ثانوي (ج)</Label>
                  <Input type="number" step="0.01" min={0}
                    value={editForm.byproduct_value}
                    onChange={e => setEditForm(f => ({ ...f, byproduct_value: parseFloat(e.target.value) || 0 }))} />
                </div>
                <div>
                  <Label>مخزن استلام العلف</Label>
                  <Select value={destination} onValueChange={setDestination}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {FEED_WAREHOUSES.map(w => <SelectItem key={w} value={w}>{w}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Alert>
                <AlertTitle>صيغة التكلفة</AlertTitle>
                <AlertDescription className="text-xs">
                  (مدخلات {fmt(target.input_cost,0)} + تشغيل {fmt(target.operating_cost,0)} + مصاريف {fmt(editForm.other_expenses,0)} + تعبئة {fmt(target.packaging_cost,0)} − ناتج ثانوي {fmt(editForm.byproduct_value,0)}) ÷ {editForm.approved_output_qty} كجم
                </AlertDescription>
              </Alert>

              <div>
                <Label>ملاحظات الاعتماد</Label>
                <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>إلغاء</Button>
            <Button onClick={submit} disabled={approving || !canApprove}>
              {approving ? "جارٍ الاعتماد..." : "اعتماد وترحيل للمخزن"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default FeedCostApprovalPanel;
