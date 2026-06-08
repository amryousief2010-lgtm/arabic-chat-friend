import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, CheckCircle2, RefreshCw, Database } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

const fmt = (n: number) => Number(n || 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 });

const WAREHOUSES = [
  { v: "feed_factory", l: "مخزن مصنع العلف" },
  { v: "brooding", l: "مخزن علف حضانات التسمين" },
  { v: "slaughterhouse", l: "مخزن علف المجزر" },
];

export default function FeedOpeningBalances() {
  const { user, roles } = useAuth() as any;
  const isOverride = (roles || []).some((r: string) => ["general_manager", "executive_manager"].includes(r));
  const canApprove = (roles || []).some((r: string) => ["general_manager", "executive_manager", "feed_factory_manager", "accountant", "financial_manager"].includes(r));

  const [rows, setRows] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    warehouse_type: "feed_factory",
    feed_product_id: "",
    feed_name: "",
    quantity_kg: "",
    unit_cost: "",
    effective_date: new Date().toISOString().slice(0, 10),
    reason: "",
    is_override: false,
    override_reason: "",
  });

  const load = async () => {
    setLoading(true);
    const [r, p] = await Promise.all([
      supabase.from("feed_opening_balances" as any).select("*").order("created_at", { ascending: false }),
      supabase.from("feed_products").select("id, name, latest_unit_cost").is("archived_at", null).order("name"),
    ]);
    setRows((r.data as any[]) || []);
    setProducts((p.data as any[]) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    const product = products.find((p) => p.id === form.feed_product_id);
    if (form.warehouse_type === "feed_factory" || form.warehouse_type === "slaughterhouse") {
      if (!product) { toast.error("اختر الصنف من قائمة منتجات مصنع العلف"); return; }
    } else if (!form.feed_name.trim()) {
      toast.error("اكتب اسم الصنف"); return;
    }
    if (!form.quantity_kg || Number(form.quantity_kg) < 0) { toast.error("كمية غير صحيحة"); return; }
    if (!form.reason.trim() || form.reason.trim().length < 5) { toast.error("اذكر سبب الرصيد الافتتاحي"); return; }
    if (form.is_override && form.override_reason.trim().length < 5) { toast.error("اذكر سبب التجاوز"); return; }

    const { error } = await supabase.from("feed_opening_balances" as any).insert({
      warehouse_type: form.warehouse_type,
      feed_product_id: form.feed_product_id || null,
      feed_name: product?.name || form.feed_name,
      quantity_kg: Number(form.quantity_kg),
      unit_cost: Number(form.unit_cost || 0),
      effective_date: form.effective_date,
      reason: form.reason,
      is_override: form.is_override,
      override_reason: form.is_override ? form.override_reason : null,
      created_by: user?.id || null,
      status: "pending",
    });
    if (error) { toast.error(error.message); return; }
    toast.success("تم تسجيل الرصيد — بانتظار الاعتماد");
    setOpen(false);
    setForm({ ...form, feed_product_id: "", feed_name: "", quantity_kg: "", unit_cost: "", reason: "", override_reason: "", is_override: false });
    load();
  };

  const approve = async (id: string) => {
    const { error } = await supabase.from("feed_opening_balances" as any).update({
      status: "approved",
      approved_by: user?.id,
      approved_at: new Date().toISOString(),
    }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("تم اعتماد الرصيد الافتتاحي + تطبيقه في المخزن");
    load();
  };

  const reject = async (id: string) => {
    const { error } = await supabase.from("feed_opening_balances" as any).update({ status: "rejected" }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("تم الرفض");
    load();
  };

  const needsProductSelect = form.warehouse_type === "feed_factory" || form.warehouse_type === "slaughterhouse";

  return (
    <DashboardLayout>
      <div dir="rtl" className="p-4 md:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Database className="h-7 w-7 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">الأرصدة الافتتاحية لمخازن العلف</h1>
              <p className="text-sm text-muted-foreground">اعتماد رصيد بدء التشغيل بعد انتهاء اختبار النظام</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={loading}><RefreshCw className="h-4 w-4" /></Button>
            <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4 ml-1" /> رصيد افتتاحي جديد</Button>
          </div>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">السجل الكامل</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>المخزن</TableHead>
                  <TableHead>الصنف</TableHead>
                  <TableHead>الكمية (كجم)</TableHead>
                  <TableHead>التكلفة/كجم</TableHead>
                  <TableHead>القيمة</TableHead>
                  <TableHead>السبب</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>إجراء</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.effective_date}</TableCell>
                    <TableCell>{WAREHOUSES.find((w) => w.v === r.warehouse_type)?.l}</TableCell>
                    <TableCell>{r.feed_name} {r.is_override && <Badge variant="outline" className="text-xs bg-amber-500/10 mr-1">تجاوز</Badge>}</TableCell>
                    <TableCell className="font-bold">{fmt(r.quantity_kg)}</TableCell>
                    <TableCell>{fmt(r.unit_cost)}</TableCell>
                    <TableCell>{fmt(r.total_value)} ج.م</TableCell>
                    <TableCell className="text-xs max-w-xs truncate" title={r.reason}>{r.reason}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={
                        r.status === "approved" ? "bg-emerald-500/10 text-emerald-700" :
                        r.status === "rejected" ? "bg-rose-500/10 text-rose-700" :
                        "bg-amber-500/10 text-amber-700"
                      }>{r.status}</Badge>
                    </TableCell>
                    <TableCell>
                      {canApprove && r.status === "pending" && (
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => approve(r.id)}><CheckCircle2 className="h-4 w-4 text-emerald-600" /></Button>
                          <Button size="sm" variant="ghost" onClick={() => reject(r.id)}>✕</Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">لا يوجد أرصدة افتتاحية بعد</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent dir="rtl">
            <DialogHeader><DialogTitle>تسجيل رصيد افتتاحي</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>المخزن</Label>
                <Select value={form.warehouse_type} onValueChange={(v) => setForm({ ...form, warehouse_type: v, feed_product_id: "", feed_name: "" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {WAREHOUSES.map((w) => <SelectItem key={w.v} value={w.v}>{w.l}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {needsProductSelect ? (
                <div>
                  <Label>الصنف</Label>
                  <Select value={form.feed_product_id} onValueChange={(v) => {
                    const p = products.find((x) => x.id === v);
                    setForm({ ...form, feed_product_id: v, feed_name: p?.name || "", unit_cost: form.unit_cost || String(p?.latest_unit_cost || "") });
                  }}>
                    <SelectTrigger><SelectValue placeholder="اختر الصنف" /></SelectTrigger>
                    <SelectContent>
                      {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div>
                  <Label>اسم الصنف</Label>
                  <Input value={form.feed_name} onChange={(e) => setForm({ ...form, feed_name: e.target.value })} placeholder="مثل: علف كتاكيت نعام" />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>الكمية (كجم)</Label>
                  <Input type="number" step="0.001" value={form.quantity_kg} onChange={(e) => setForm({ ...form, quantity_kg: e.target.value })} />
                </div>
                <div>
                  <Label>تكلفة/كجم</Label>
                  <Input type="number" step="0.0001" value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: e.target.value })} />
                </div>
              </div>
              <div>
                <Label>تاريخ السريان</Label>
                <Input type="date" value={form.effective_date} onChange={(e) => setForm({ ...form, effective_date: e.target.value })} />
              </div>
              <div>
                <Label>السبب</Label>
                <Textarea rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="رصيد افتتاحي بعد انتهاء اختبار النظام" />
              </div>
              {isOverride && (
                <div className="border rounded p-2 bg-amber-500/5">
                  <div className="flex items-center gap-2">
                    <Checkbox id="ov" checked={form.is_override} onCheckedChange={(c) => setForm({ ...form, is_override: !!c })} />
                    <Label htmlFor="ov" className="cursor-pointer">تجاوز قاعدة منع التكرار (مدير عام/تنفيذي)</Label>
                  </div>
                  {form.is_override && (
                    <Textarea className="mt-2" rows={2} placeholder="سبب التجاوز" value={form.override_reason} onChange={(e) => setForm({ ...form, override_reason: e.target.value })} />
                  )}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
              <Button onClick={save}>حفظ</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
