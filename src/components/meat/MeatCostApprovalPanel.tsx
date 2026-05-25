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
import { Coins, CheckCircle2, AlertTriangle, TrendingUp, Factory, PackageCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from "recharts";

type Batch = any;
type Warehouse = { id: string; name: string };

const COST_APPROVER_ROLES = ['general_manager','executive_manager','accountant','cost_accountant','financial_manager'];

const fmt = (v: any, d = 2) => v == null ? "—" : Number(v).toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });

export const MeatCostApprovalPanel = ({ onChanged }: { onChanged?: () => void }) => {
  const { role } = useAuth();
  const canApprove = !!role && COST_APPROVER_ROLES.includes(role);

  const [batches, setBatches] = useState<Batch[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [negStock, setNegStock] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [target, setTarget] = useState<Batch | null>(null);
  const [warehouseId, setWarehouseId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [approving, setApproving] = useState(false);

  // Edit fields when opening a batch detail
  const [editForm, setEditForm] = useState({ other_expenses: 0, byproduct_value: 0, approved_output_qty: 0 });

  const fetchAll = async () => {
    setLoading(true);
    const [b, w, n] = await Promise.all([
      supabase.from("meat_factory_batches" as any).select("*").order("production_date", { ascending: false }),
      supabase.from("warehouses").select("id,name").order("name"),
      supabase.from("data_quality_tasks" as any).select("*").eq("module", "meat").eq("status", "open").order("created_at", { ascending: false }).limit(50),
    ]);
    setBatches((b.data as any) || []);
    setWarehouses((w.data as any) || []);
    setNegStock((n.data as any) || []);
    setLoading(false);
  };
  useEffect(() => { fetchAll(); }, []);

  const pendingApproval = useMemo(
    () => batches.filter((b: any) => b.quality_status === "passed" && !b.cost_approved_at),
    [batches]
  );
  const approved = useMemo(
    () => batches.filter((b: any) => b.cost_approved_at),
    [batches]
  );

  // KPIs
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
  const monthBatches = batches.filter((b: any) => new Date(b.production_date) >= monthStart);
  const monthOutput = monthBatches.reduce((s, b: any) => s + Number(b.actual_qty || b.planned_qty || 0), 0);
  const avgUnitCost = approved.length
    ? approved.reduce((s, b: any) => s + Number(b.unit_cost || 0), 0) / approved.length : 0;

  // Top 5 highest unit cost products
  const topCost = useMemo(() => {
    const map = new Map<string, { name: string; total: number; count: number }>();
    approved.forEach((b: any) => {
      const k = b.product_name_ar || b.product_code;
      const cur = map.get(k) || { name: k, total: 0, count: 0 };
      cur.total += Number(b.unit_cost || 0); cur.count += 1;
      map.set(k, cur);
    });
    return Array.from(map.values())
      .map(v => ({ name: v.name, avg: v.total / v.count }))
      .sort((a, b) => b.avg - a.avg).slice(0, 5);
  }, [approved]);

  const openApprove = (b: Batch) => {
    setTarget(b);
    setEditForm({
      other_expenses: Number(b.other_expenses || 0),
      byproduct_value: Number(b.byproduct_value || 0),
      approved_output_qty: Number(b.approved_output_qty || b.actual_qty || b.planned_qty || 0),
    });
    setWarehouseId(warehouses[0]?.id || "");
    setNotes("");
  };

  const submit = async () => {
    if (!target) return;
    if (!warehouseId) { toast.error("اختر المخزن"); return; }
    if (!editForm.approved_output_qty || editForm.approved_output_qty <= 0) {
      toast.error("الكمية المعتمدة يجب أن تكون أكبر من صفر"); return;
    }
    setApproving(true);
    // 1) Persist editable cost fields on batch
    const { error: upErr } = await supabase.from("meat_factory_batches" as any)
      .update({
        other_expenses: editForm.other_expenses,
        byproduct_value: editForm.byproduct_value,
        approved_output_qty: editForm.approved_output_qty,
      })
      .eq("id", target.id);
    if (upErr) { setApproving(false); toast.error("فشل التحديث: " + upErr.message); return; }

    // 2) Call approval RPC
    const { error } = await supabase.rpc("approve_meat_batch_cost" as any, {
      p_batch_id: target.id, p_warehouse_id: warehouseId, p_notes: notes || null,
    });
    setApproving(false);
    if (error) { toast.error("فشل الاعتماد: " + error.message); return; }
    toast.success("✅ تم اعتماد التكلفة وترحيل المنتج للمخزون");
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
          <div className="text-2xl font-bold mt-1">{fmt(avgUnitCost, 1)}</div>
          <div className="text-xs text-muted-foreground">ج.م</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-center justify-between"><Coins className="w-5 h-5 text-purple-600" /><span className="text-xs text-muted-foreground">بانتظار الاعتماد</span></div>
          <div className="text-2xl font-bold mt-1">{pendingApproval.length}</div>
          <div className="text-xs text-muted-foreground">دفعة</div>
        </CardContent></Card>
      </div>

      {/* Top cost chart */}
      {topCost.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">أعلى المنتجات تكلفة (متوسط ج/كجم)</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topCost}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="avg" fill="hsl(var(--primary))">
                  {topCost.map((_, i) => <Cell key={i} fill={`hsl(${(i * 60) % 360} 70% 55%)`} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Negative stock alerts */}
      {negStock.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2 text-destructive">
            <AlertTriangle className="w-4 h-4" /> نواقص وأرصدة سالبة ({negStock.length})
          </CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>النوع</TableHead><TableHead>المرجع</TableHead><TableHead>الوصف</TableHead><TableHead>الخطورة</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {negStock.map((t: any) => (
                  <TableRow key={t.id}>
                    <TableCell>{t.task_type}</TableCell>
                    <TableCell className="font-mono text-xs">{t.reference}</TableCell>
                    <TableCell>{t.description}</TableCell>
                    <TableCell><Badge variant={t.severity === 'high' ? 'destructive' : 'secondary'}>{t.severity}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Pending approval list */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2">
          <Coins className="w-4 h-4" /> دفعات بانتظار اعتماد التكلفة ({pendingApproval.length})
        </CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {!canApprove && (
            <Alert className="mb-3">
              <AlertTitle>عرض فقط</AlertTitle>
              <AlertDescription>اعتماد التكلفة متاح للمحاسب / المدير المالي / الإدارة العليا فقط.</AlertDescription>
            </Alert>
          )}
          <Table>
            <TableHeader><TableRow>
              <TableHead>الدفعة</TableHead><TableHead>المنتج</TableHead><TableHead>الكمية</TableHead>
              <TableHead>مواد</TableHead><TableHead>عمالة</TableHead><TableHead>تغليف</TableHead>
              <TableHead>إجمالي مبدئي</TableHead><TableHead>إجراء</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {pendingApproval.map((b: any) => (
                <TableRow key={b.id}>
                  <TableCell className="font-mono text-xs">{b.batch_number}</TableCell>
                  <TableCell>{b.product_name_ar}</TableCell>
                  <TableCell>{fmt(b.actual_qty || b.planned_qty, 1)} {b.unit}</TableCell>
                  <TableCell>{fmt(b.materials_cost, 0)}</TableCell>
                  <TableCell>{fmt(b.labor_cost, 0)}</TableCell>
                  <TableCell>{fmt(b.packaging_cost, 0)}</TableCell>
                  <TableCell className="font-semibold">{fmt(b.total_cost, 0)} ج</TableCell>
                  <TableCell>
                    <Button size="sm" disabled={!canApprove} onClick={() => openApprove(b)}>
                      <CheckCircle2 className="w-4 h-4 ml-1" /> اعتماد
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!pendingApproval.length && (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">
                  لا توجد دفعات بانتظار الاعتماد.
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Approve dialog */}
      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>اعتماد تكلفة الدفعة {target?.batch_number}</DialogTitle></DialogHeader>
          {target && (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">
                المنتج: <span className="font-semibold text-foreground">{target.product_name_ar}</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>الكمية المعتمدة ({target.unit})</Label>
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
                  <Label>مخزن استلام المنتج التام</Label>
                  <Select value={warehouseId} onValueChange={setWarehouseId}>
                    <SelectTrigger><SelectValue placeholder="اختر..." /></SelectTrigger>
                    <SelectContent>
                      {warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Alert>
                <AlertTitle>صيغة التكلفة</AlertTitle>
                <AlertDescription className="text-xs">
                  (مواد {fmt(target.materials_cost,0)} + عمالة {fmt(target.labor_cost,0)} + مصاريف {fmt(editForm.other_expenses,0)} + تغليف {fmt(target.packaging_cost,0)} − ناتج ثانوي {fmt(editForm.byproduct_value,0)}) ÷ {editForm.approved_output_qty} {target.unit}
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
              {approving ? "جارٍ الاعتماد..." : "اعتماد وترحيل للمخزون"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MeatCostApprovalPanel;
