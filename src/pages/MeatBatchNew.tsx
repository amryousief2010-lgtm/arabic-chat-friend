import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { Loader2, Factory, AlertTriangle, ShieldAlert } from "lucide-react";

export default function MeatBatchNew() {
  const nav = useNavigate();
  const [products, setProducts] = useState<any[]>([]);
  const [productCode, setProductCode] = useState("");
  const [qty, setQty] = useState<number>(1);
  const [plan, setPlan] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from("meat_factory_products")
      .select("product_code,name_ar,barcode,is_active")
      .eq("is_active", true).not("barcode", "is", null)
      .order("name_ar").then(({ data }) => setProducts(data || []));
  }, []);

  const runPlan = async () => {
    if (!productCode || qty <= 0) return;
    setLoading(true);
    const { data, error } = await supabase.rpc("fd_plan_meat_batch" as any, {
      p_product_code: productCode, p_planned_qty: qty,
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    setPlan(data);
  };

  const save = async () => {
    if (!productCode || qty <= 0) return;
    if (plan?.blockers?.length) return toast.error("لا يمكن الحفظ — يوجد عوائق");
    setSaving(true);
    const { data, error } = await supabase.rpc("fd_create_meat_batch_draft" as any, {
      p_product_code: productCode, p_planned_qty: qty,
      p_production_date: new Date().toISOString().slice(0, 10),
      p_notes: null, p_label: null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("تم إنشاء الدفعة كمسودة");
    nav("/meat-factory/batches");
  };

  const blockers = plan?.blockers || [];
  const warnings = plan?.warnings || [];

  return (
    <div dir="rtl" className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex items-center gap-3">
        <Factory className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">دفعة لحوم جديدة</h1>
          <p className="text-sm text-muted-foreground">المنتجات غير النشطة أو بدون باركود محجوبة تلقائياً</p>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>البيانات الأساسية</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>المنتج</Label>
            <Select value={productCode} onValueChange={setProductCode}>
              <SelectTrigger><SelectValue placeholder="اختر المنتج" /></SelectTrigger>
              <SelectContent>
                {products.map(p => (
                  <SelectItem key={p.product_code} value={p.product_code}>
                    {p.name_ar} ({p.product_code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>الكمية المخططة</Label>
            <Input type="number" min={0} step="0.01" value={qty} onChange={e => setQty(Number(e.target.value))} />
          </div>
          <Button onClick={runPlan} disabled={loading || !productCode}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "حساب المتطلبات والتكلفة"}
          </Button>
        </CardContent>
      </Card>

      {plan && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>المتطلبات (BOM v{plan.bom_version})</span>
              <Badge>تكلفة/وحدة ≈ {Number(plan.cost_per_unit_estimate || 0).toFixed(2)}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {blockers.length > 0 && (
              <Alert variant="destructive">
                <ShieldAlert className="h-4 w-4" />
                <AlertDescription>
                  <div className="font-semibold mb-1">عوائق ({blockers.length}):</div>
                  <ul className="text-sm list-disc pr-5">
                    {blockers.map((b: any, i: number) => <li key={i}>{b.code}{b.material_code ? ` — ${b.material_code}` : ""}</li>)}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            {warnings.length > 0 && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <div className="font-semibold mb-1">تحذيرات ({warnings.length}):</div>
                  <ul className="text-sm list-disc pr-5">
                    {warnings.map((w: any, i: number) => (
                      <li key={i}>
                        {w.code} — {w.material_code}
                        {w.required != null && ` (مطلوب ${Number(w.required).toFixed(2)}, متاح ${Number(w.available).toFixed(2)})`}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            <div className="border rounded">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="p-2 text-right">المادة</th>
                    <th className="p-2">مطلوب</th><th className="p-2">متاح</th>
                    <th className="p-2">تكلفة/وحدة</th><th className="p-2">إجمالي</th><th className="p-2">مربوط</th>
                  </tr>
                </thead>
                <tbody>
                  {(plan.items || []).map((it: any, i: number) => (
                    <tr key={i} className="border-t">
                      <td className="p-2 text-right">{it.material_name_ar} <span className="text-xs text-muted-foreground">({it.material_code})</span></td>
                      <td className="p-2 text-center">{Number(it.required_qty).toFixed(2)} {it.unit}</td>
                      <td className={`p-2 text-center ${it.required_qty > it.available_stock ? "text-red-600 font-semibold" : ""}`}>{Number(it.available_stock).toFixed(2)}</td>
                      <td className={`p-2 text-center ${it.unit_cost === 0 ? "text-orange-600" : ""}`}>{Number(it.unit_cost).toFixed(2)}</td>
                      <td className="p-2 text-center">{Number(it.line_cost).toFixed(2)}</td>
                      <td className="p-2 text-center">{it.linked ? "✓" : "—"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t font-semibold bg-muted/40">
                    <td className="p-2 text-right" colSpan={4}>إجمالي تكلفة المواد</td>
                    <td className="p-2 text-center" colSpan={2}>{Number(plan.total_cost_estimate || 0).toFixed(2)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="flex gap-2">
              <Button onClick={save} disabled={saving || blockers.length > 0}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "حفظ كمسودة"}
              </Button>
              <Button variant="outline" onClick={() => nav("/meat-factory/batches")}>إلغاء</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
