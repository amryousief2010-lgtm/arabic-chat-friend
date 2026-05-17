import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Wheat, Package, ClipboardList, ShieldCheck, AlertTriangle,
  TrendingUp, TrendingDown, Factory, ArrowLeft, RefreshCw,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const orderStatusLabels: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  draft: { label: "مسودة", variant: "secondary" },
  issued: { label: "صرف خامات", variant: "default" },
  mixing: { label: "خلط/تشغيل", variant: "default" },
  packed: { label: "تعبئة", variant: "default" },
  qc_pending: { label: "بانتظار الجودة", variant: "secondary" },
  approved: { label: "معتمدة", variant: "outline" },
  needs_review: { label: "تحتاج مراجعة", variant: "destructive" },
  rejected: { label: "مرفوضة", variant: "destructive" },
  posted: { label: "مرحّلة", variant: "outline" },
};

const qcLabels: Record<string, { label: string; cls: string }> = {
  pass: { label: "مقبولة", cls: "text-success" },
  fail: { label: "مرفوضة", cls: "text-destructive" },
  needs_review: { label: "تحتاج مراجعة", cls: "text-warning" },
};

const fmt = (n: number, d = 2) =>
  (Number.isFinite(n) ? n : 0).toLocaleString("en-GB", { maximumFractionDigits: d });

export default function FeedDashboard() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<any[]>([]);
  const [materials, setMaterials] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [qcChecks, setQcChecks] = useState<any[]>([]);

  const fetchAll = async () => {
    setLoading(true);
    const [p, m, o, b, q] = await Promise.all([
      supabase.from("feed_products").select("*").is("archived_at", null),
      supabase.from("feed_raw_materials").select("*").eq("is_active", true),
      supabase.from("feed_production_orders").select("*, feed_product:feed_products(name, feed_code)").order("created_at", { ascending: false }).limit(200),
      supabase.from("feed_invoice_batches").select("*, feed_product:feed_products(name, feed_code)").order("created_at", { ascending: false }).limit(200),
      supabase.from("feed_qc_checks").select("*").order("decided_at", { ascending: false }).limit(200),
    ]);
    if (p.error || m.error || o.error || b.error || q.error) {
      toast({ title: "خطأ في تحميل البيانات", description: p.error?.message || m.error?.message || o.error?.message || b.error?.message || q.error?.message, variant: "destructive" });
    }
    setProducts(p.data || []);
    setMaterials(m.data || []);
    setOrders(o.data || []);
    setBatches(b.data || []);
    setQcChecks(q.data || []);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  // KPIs
  const activeOrders = orders.filter(o => !["approved", "posted", "rejected"].includes(o.status)).length;
  const reviewBatches = batches.filter(b => b.status === "needs_review").length;
  const lowStockMats = materials.filter((m: any) => m.stock <= (m.low_stock_threshold || 0)).length;
  const totalFinishedStock = products.reduce((s, p) => s + Number(p.current_stock || 0), 0);
  const totalInputCost = batches.reduce((s, b) => s + Number(b.input_cost || 0) + Number(b.operating_cost || 0), 0);
  const totalOutputKg = batches.reduce((s, b) => s + Number(b.output_qty_kg || 0), 0);
  const avgUnitCost = totalOutputKg > 0 ? totalInputCost / totalOutputKg : 0;
  const qcPass = qcChecks.filter(q => q.result === "pass").length;
  const qcReview = qcChecks.filter(q => q.result === "needs_review").length;
  const qcFail = qcChecks.filter(q => q.result === "fail").length;
  const qcRate = qcChecks.length > 0 ? (qcPass / qcChecks.length) * 100 : 0;
  const avgVariancePct = batches.length > 0
    ? batches.reduce((s, b) => s + Math.abs(Number(b.qty_variance_pct || 0)), 0) / batches.length
    : 0;

  const recentOrders = orders.slice(0, 6);
  const recentReviewBatches = batches.filter(b => b.status === "needs_review").slice(0, 5);
  const topProducts = [...products].sort((a, b) => Number(b.current_stock) - Number(a.current_stock)).slice(0, 5);

  return (
    <DashboardLayout>
      <div className="space-y-6" dir="rtl">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Factory className="w-7 h-7 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-foreground">لوحة مصنع الأعلاف</h1>
              <p className="text-muted-foreground mt-1">ملخص الإنتاج والخامات والجودة والتكلفة</p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={fetchAll} disabled={loading}>
              <RefreshCw className={`w-4 h-4 ml-2 ${loading ? "animate-spin" : ""}`} />تحديث
            </Button>
            <Link to="/modules/feed-factory/orders"><Button size="sm" variant="outline">الأوامر</Button></Link>
            <Link to="/modules/feed-factory/issues"><Button size="sm" variant="outline">الصرف</Button></Link>
            <Link to="/modules/feed-factory/recipes"><Button size="sm" variant="outline">الوصفات</Button></Link>
            <Link to="/modules/feed-factory">
              <Button size="sm"><ArrowLeft className="w-4 h-4 ml-2" />إدارة المصنع</Button>
            </Link>
          </div>
        </div>

        {/* KPIs - Row 1: Production */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
              <CardDescription>أوامر إنتاج نشطة</CardDescription>
              <ClipboardList className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{activeOrders}</div>
              <p className="text-xs text-muted-foreground mt-1">من إجمالي {orders.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
              <CardDescription>إجمالي الإنتاج (كجم)</CardDescription>
              <Wheat className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{fmt(totalOutputKg, 0)}</div>
              <p className="text-xs text-muted-foreground mt-1">من {batches.length} دفعة</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
              <CardDescription>منتج تام (مخزون)</CardDescription>
              <Package className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{fmt(totalFinishedStock, 0)}</div>
              <p className="text-xs text-muted-foreground mt-1">عبر {products.length} منتج</p>
            </CardContent>
          </Card>
          <Card className={lowStockMats > 0 ? "border-destructive/50" : ""}>
            <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
              <CardDescription>خامات منخفضة</CardDescription>
              <AlertTriangle className={`w-4 h-4 ${lowStockMats > 0 ? "text-destructive" : "text-muted-foreground"}`} />
            </CardHeader>
            <CardContent>
              <div className={`text-3xl font-bold ${lowStockMats > 0 ? "text-destructive" : ""}`}>{lowStockMats}</div>
              <p className="text-xs text-muted-foreground mt-1">من {materials.length} مادة نشطة</p>
            </CardContent>
          </Card>
        </div>

        {/* KPIs - Row 2: Quality & Cost */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
              <CardDescription>نسبة قبول الجودة</CardDescription>
              <ShieldCheck className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-success">{fmt(qcRate, 1)}%</div>
              <p className="text-xs text-muted-foreground mt-1">{qcPass} مقبولة / {qcChecks.length} فحص</p>
            </CardContent>
          </Card>
          <Card className={reviewBatches > 0 ? "border-warning/50" : ""}>
            <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
              <CardDescription>دفعات تحتاج مراجعة</CardDescription>
              <AlertTriangle className={`w-4 h-4 ${reviewBatches > 0 ? "text-warning" : "text-muted-foreground"}`} />
            </CardHeader>
            <CardContent>
              <div className={`text-3xl font-bold ${reviewBatches > 0 ? "text-warning" : ""}`}>{reviewBatches}</div>
              <p className="text-xs text-muted-foreground mt-1">فروقات وزن &gt; 1%</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
              <CardDescription>متوسط تكلفة الكجم</CardDescription>
              <TrendingDown className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{fmt(avgUnitCost, 2)}</div>
              <p className="text-xs text-muted-foreground mt-1">ج.م / كجم منتج تام</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
              <CardDescription>متوسط فرق الوزن</CardDescription>
              <TrendingUp className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{fmt(avgVariancePct, 2)}%</div>
              <p className="text-xs text-muted-foreground mt-1">انحراف داخل/خارج</p>
            </CardContent>
          </Card>
        </div>

        {/* QC Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">توزيع نتائج الجودة</CardTitle>
            <CardDescription>إجمالي {qcChecks.length} فحص</CardDescription>
          </CardHeader>
          <CardContent>
            {qcChecks.length === 0 ? (
              <p className="text-sm text-muted-foreground">لا توجد فحوصات جودة بعد</p>
            ) : (
              <div className="space-y-3">
                {[
                  { key: "pass", count: qcPass, color: "bg-success" },
                  { key: "needs_review", count: qcReview, color: "bg-warning" },
                  { key: "fail", count: qcFail, color: "bg-destructive" },
                ].map(row => {
                  const pct = (row.count / qcChecks.length) * 100;
                  return (
                    <div key={row.key}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className={qcLabels[row.key].cls}>{qcLabels[row.key].label}</span>
                        <span className="text-muted-foreground">{row.count} ({fmt(pct, 1)}%)</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div className={`h-full ${row.color} transition-all`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Orders + Review Batches */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">أحدث أوامر الإنتاج</CardTitle>
              <CardDescription>آخر 6 أوامر</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>رقم الأمر</TableHead>
                    <TableHead>المنتج</TableHead>
                    <TableHead>المستهدف</TableHead>
                    <TableHead>الحالة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentOrders.length === 0 ? (
                    <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">لا توجد أوامر</TableCell></TableRow>
                  ) : recentOrders.map(o => (
                    <TableRow key={o.id}>
                      <TableCell className="font-mono text-xs">{o.order_no}</TableCell>
                      <TableCell className="text-sm">{o.feed_product?.name || "—"}</TableCell>
                      <TableCell className="text-sm">{fmt(Number(o.target_output_kg), 0)} كجم</TableCell>
                      <TableCell>
                        <Badge variant={orderStatusLabels[o.status]?.variant || "outline"}>
                          {orderStatusLabels[o.status]?.label || o.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className={recentReviewBatches.length > 0 ? "border-warning/30" : ""}>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-warning" />
                دفعات تحتاج مراجعة
              </CardTitle>
              <CardDescription>فرق وزن &gt; 1% بين المدخل والمنتج</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الدفعة</TableHead>
                    <TableHead>المنتج</TableHead>
                    <TableHead>الفرق</TableHead>
                    <TableHead>تكلفة/كجم</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentReviewBatches.length === 0 ? (
                    <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">لا توجد دفعات للمراجعة</TableCell></TableRow>
                  ) : recentReviewBatches.map(b => (
                    <TableRow key={b.id}>
                      <TableCell className="font-mono text-xs">{b.batch_no}</TableCell>
                      <TableCell className="text-sm">{b.feed_product?.name || "—"}</TableCell>
                      <TableCell className="text-sm text-warning">
                        {fmt(Number(b.qty_variance_kg), 1)} كجم ({fmt(Number(b.qty_variance_pct), 2)}%)
                      </TableCell>
                      <TableCell className="text-sm">{fmt(Number(b.unit_cost_calc), 2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        {/* Top products by stock */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">المنتجات حسب المخزون التام</CardTitle>
            <CardDescription>أعلى 5 منتجات</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الكود</TableHead>
                  <TableHead>المنتج</TableHead>
                  <TableHead>المرحلة</TableHead>
                  <TableHead>المخزون (كجم)</TableHead>
                  <TableHead>آخر تكلفة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topProducts.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">لا توجد منتجات</TableCell></TableRow>
                ) : topProducts.map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{p.feed_code}</TableCell>
                    <TableCell className="text-sm">{p.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{p.stage || "—"}</TableCell>
                    <TableCell className="text-sm">{fmt(Number(p.current_stock), 0)}</TableCell>
                    <TableCell className="text-sm">{fmt(Number(p.latest_unit_cost), 2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
