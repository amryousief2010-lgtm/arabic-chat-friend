import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Factory, ShoppingCart, Package, AlertTriangle, CheckCircle2, Clock, XCircle,
  TrendingUp, Boxes, Send, Beef, Loader2,
} from "lucide-react";
import { BarChart, Bar, LineChart, Line, ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell, Legend } from "recharts";

const fmt = (n: any) => Number(n || 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 });
const PURPLE = "#7c3aed"; const ORANGE = "#ea580c"; const GREEN = "#10b981"; const RED = "#ef4444"; const BLUE = "#3b82f6";
const COLORS = [PURPLE, ORANGE, GREEN, BLUE, RED, "#06b6d4", "#f59e0b", "#8b5cf6"];

type Item = { id: string; name: string; unit: string; current_stock: number; avg_cost: number; kind: string; low_stock_threshold: number };
type Purchase = { id: string; invoice_no: string | null; purchase_date: string; supplier: string | null; total_amount: number; status: string; invoice_type: string; created_at: string };
type Invoice = { id: string; invoice_no: string | null; product_name: string; finished_qty: number; unit: string; status: string; raw_cost: number; spice_cost: number; packaging_cost: number; total_manufacturing_cost: number; materials_total_cost: number; unit_cost: number | null; created_at: string; destination_kind: string };
type Move = { id: string; item_kind: string; item_name: string; direction: string; quantity: number; unit_cost: number; reason: string; ref_table: string; created_at: string };

const KPI = ({ icon: Icon, label, value, sub, color, to }: any) => {
  const inner = (
    <Card className="hover:shadow-lg transition-shadow cursor-pointer">
      <CardContent className="pt-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-2xl font-bold mt-1" style={{ color }}>{value}</div>
            {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
          </div>
          <div className="p-2 rounded-lg" style={{ background: `${color}15` }}>
            <Icon className="w-5 h-5" style={{ color }} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
};

export default function MeatFactoryOverviewDashboard() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<Item[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [moves, setMoves] = useState<Move[]>([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [it, pu, inv, mv] = await Promise.all([
        supabase.from("meat_factory_raw_items" as any).select("id,name,unit,current_stock,avg_cost,kind,low_stock_threshold").order("name"),
        supabase.from("meat_factory_purchases" as any).select("id,invoice_no,purchase_date,supplier,total_amount,status,invoice_type,created_at").order("created_at", { ascending: false }).limit(500),
        supabase.from("meat_manufacturing_invoices" as any).select("id,invoice_no,product_name,finished_qty,unit,status,raw_cost,spice_cost,packaging_cost,total_manufacturing_cost,materials_total_cost,unit_cost,created_at,destination_kind").order("created_at", { ascending: false }).limit(500),
        supabase.from("meat_factory_inventory_moves" as any).select("id,item_kind,item_name,direction,quantity,unit_cost,reason,ref_table,created_at").order("created_at", { ascending: false }).limit(200),
      ]);
      setItems((it.data as any) || []);
      setPurchases((pu.data as any) || []);
      setInvoices((inv.data as any) || []);
      setMoves((mv.data as any) || []);
      setLoading(false);
    })();
  }, []);

  const k = useMemo(() => {
    const purchaseTotal = purchases.filter(p => p.status === "approved").reduce((s,p) => s + Number(p.total_amount||0), 0);
    const packPurchases = purchases.filter(p => p.status === "approved" && (p.invoice_type === "packaging")).reduce((s,p) => s + Number(p.total_amount||0), 0);
    const mfgCount = invoices.length;
    const producedQty = invoices.filter(i => i.status !== "draft" && i.status !== "rejected" && i.status !== "cancelled").reduce((s,i) => s + Number(i.finished_qty||0), 0);
    const mfgCost = invoices.filter(i => i.status !== "draft").reduce((s,i) => s + Number(i.total_manufacturing_cost||0), 0);
    const approved = invoices.filter(i => i.status === "approved" || i.status === "transferred").length;
    const pending = invoices.filter(i => i.status === "draft").length;
    const rejected = invoices.filter(i => i.status === "rejected").length;
    const transferred = invoices.filter(i => i.status === "transferred").length;
    return { purchaseTotal, packPurchases, mfgCount, producedQty, mfgCost, approved, pending, rejected, transferred };
  }, [purchases, invoices]);

  const lowStockRaw = useMemo(() => items.filter(i => (i.kind === "raw" || i.kind === "spice") && i.current_stock <= (i.low_stock_threshold || 0)).slice(0, 8), [items]);
  const lowStockPack = useMemo(() => items.filter(i => i.kind === "packaging" && i.current_stock <= (i.low_stock_threshold || 0)).slice(0, 8), [items]);

  const dailyChart = useMemo(() => {
    const days: Record<string, { date: string; cost: number; qty: number; count: number }> = {};
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0,10);
      days[d] = { date: d.slice(5), cost: 0, qty: 0, count: 0 };
    }
    for (const inv of invoices) {
      if (inv.status === "draft" || inv.status === "rejected" || inv.status === "cancelled") continue;
      const d = (inv.created_at || "").slice(0,10);
      if (days[d]) {
        days[d].cost += Number(inv.total_manufacturing_cost || 0);
        days[d].qty += Number(inv.finished_qty || 0);
        days[d].count += 1;
      }
    }
    return Object.values(days);
  }, [invoices]);

  const consumptionByKind = useMemo(() => {
    const acc: Record<string, number> = { raw: 0, spice: 0, packaging: 0 };
    for (const m of moves) {
      if (m.direction !== "OUT" || m.ref_table !== "meat_manufacturing_invoices") continue;
      acc[m.item_kind || "raw"] = (acc[m.item_kind || "raw"] || 0) + Number(m.quantity || 0);
    }
    return [
      { name: "خامات", value: acc.raw, fill: PURPLE },
      { name: "بهارات", value: acc.spice, fill: ORANGE },
      { name: "تغليف", value: acc.packaging, fill: BLUE },
    ].filter(x => x.value > 0);
  }, [moves]);

  const topProducts = useMemo(() => {
    const acc: Record<string, { name: string; qty: number; cost: number }> = {};
    for (const i of invoices) {
      if (i.status === "draft" || i.status === "rejected" || i.status === "cancelled") continue;
      const k = i.product_name;
      if (!acc[k]) acc[k] = { name: k, qty: 0, cost: 0 };
      acc[k].qty += Number(i.finished_qty || 0);
      acc[k].cost += Number(i.total_manufacturing_cost || 0);
    }
    return Object.values(acc).sort((a,b) => b.qty - a.qty).slice(0, 6);
  }, [invoices]);

  if (loading) {
    return (
      <DashboardLayout>
        <div className="p-8 text-center"><Loader2 className="w-8 h-8 animate-spin mx-auto text-purple-600" /></div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6" dir="rtl">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-gradient-to-br from-purple-600 to-orange-500 text-white">
              <Factory className="w-7 h-7" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">لوحة تحكم مصنع اللحوم</h1>
              <p className="text-sm text-muted-foreground">نظرة شاملة على المشتريات والتصنيع والمخزون والتوريد</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline"><Link to="/meat-factory/purchase-invoices"><ShoppingCart className="w-4 h-4 ml-1" />فاتورة مشتريات</Link></Button>
            <Button asChild className="bg-purple-600 hover:bg-purple-700"><Link to="/meat-factory/manufacturing"><Factory className="w-4 h-4 ml-1" />فاتورة تصنيع</Link></Button>
          </div>
        </div>

        {/* Smart Alerts */}
        {(k.pending > 0 || lowStockRaw.length > 0 || lowStockPack.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {k.pending > 0 && (
              <Card className="border-amber-300 bg-amber-50/60 dark:bg-amber-950/30">
                <CardContent className="pt-4 flex items-center gap-3">
                  <Clock className="w-6 h-6 text-amber-600" />
                  <div className="text-sm">
                    <div className="font-bold text-amber-700">{k.pending} فاتورة تصنيع بانتظار الاعتماد</div>
                    <Link to="/meat-factory/manufacturing" className="text-xs underline">مراجعة</Link>
                  </div>
                </CardContent>
              </Card>
            )}
            {lowStockRaw.length > 0 && (
              <Card className="border-red-300 bg-red-50/60 dark:bg-red-950/30">
                <CardContent className="pt-4 flex items-center gap-3">
                  <AlertTriangle className="w-6 h-6 text-red-600" />
                  <div className="text-sm">
                    <div className="font-bold text-red-700">{lowStockRaw.length} صنف خامات/بهارات تحت حد التنبيه</div>
                    <div className="text-xs">{lowStockRaw.slice(0,3).map(x => x.name).join("، ")}{lowStockRaw.length > 3 ? "…" : ""}</div>
                  </div>
                </CardContent>
              </Card>
            )}
            {lowStockPack.length > 0 && (
              <Card className="border-orange-300 bg-orange-50/60 dark:bg-orange-950/30">
                <CardContent className="pt-4 flex items-center gap-3">
                  <Package className="w-6 h-6 text-orange-600" />
                  <div className="text-sm">
                    <div className="font-bold text-orange-700">{lowStockPack.length} صنف تغليف تحت حد التنبيه</div>
                    <div className="text-xs">{lowStockPack.slice(0,3).map(x => x.name).join("، ")}{lowStockPack.length > 3 ? "…" : ""}</div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <KPI icon={ShoppingCart} label="إجمالي مشتريات الخامات" value={`${fmt(k.purchaseTotal)} ج`} color={PURPLE} to="/meat-factory/purchase-invoices" />
          <KPI icon={Package} label="مشتريات التغليف" value={`${fmt(k.packPurchases)} ج`} color={ORANGE} to="/meat-factory/purchase-invoices" />
          <KPI icon={Factory} label="فواتير التصنيع" value={fmt(k.mfgCount)} sub={`${fmt(k.approved)} معتمدة`} color={BLUE} to="/meat-factory/manufacturing" />
          <KPI icon={Beef} label="إجمالي المنتجات المصنعة" value={fmt(k.producedQty)} sub="كجم/عبوة" color={GREEN} />
          <KPI icon={TrendingUp} label="إجمالي تكلفة التصنيع" value={`${fmt(k.mfgCost)} ج`} color={PURPLE} />
          <KPI icon={CheckCircle2} label="المعتمدة" value={fmt(k.approved)} color={GREEN} />
          <KPI icon={Clock} label="بانتظار الاعتماد" value={fmt(k.pending)} color="#f59e0b" />
          <KPI icon={XCircle} label="المرفوضة" value={fmt(k.rejected)} color={RED} />
          <KPI icon={Send} label="الموردة للمخزن الرئيسي" value={fmt(k.transferred)} color={BLUE} />
          <KPI icon={Boxes} label="إجمالي أصناف المخزن" value={fmt(items.length)} sub={`${items.filter(i=>i.kind==='packaging').length} تغليف`} color={ORANGE} />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader><CardTitle className="text-base">إنتاج آخر 14 يوم</CardTitle><CardDescription>الكمية وتكلفة التصنيع اليومية</CardDescription></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={dailyChart}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="qty" name="الكمية" stroke={PURPLE} strokeWidth={2} />
                  <Line type="monotone" dataKey="cost" name="التكلفة" stroke={ORANGE} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">توزيع استهلاك الخامات</CardTitle><CardDescription>خامات / بهارات / تغليف</CardDescription></CardHeader>
            <CardContent>
              {consumptionByKind.length === 0 ? (
                <div className="text-center text-muted-foreground py-12">لا توجد بيانات استهلاك بعد</div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={consumptionByKind} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, value }) => `${name}: ${fmt(value)}`}>
                      {consumptionByKind.map((e, i) => <Cell key={i} fill={e.fill} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader><CardTitle className="text-base">أكثر المنتجات تصنيعًا</CardTitle></CardHeader>
            <CardContent>
              {topProducts.length === 0 ? (
                <div className="text-center text-muted-foreground py-12">لا توجد منتجات بعد</div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={topProducts}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="qty" name="الكمية" fill={PURPLE} />
                    <Bar dataKey="cost" name="التكلفة" fill={ORANGE} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Latest ops */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card>
            <CardHeader><CardTitle className="text-base">آخر فواتير المشتريات</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {purchases.slice(0,5).map(p => (
                <div key={p.id} className="flex items-center justify-between text-sm border-b pb-2 last:border-0">
                  <div>
                    <div className="font-medium">{p.supplier || "—"}</div>
                    <div className="text-xs text-muted-foreground">{p.purchase_date} · {p.invoice_no || "مسودة"}</div>
                  </div>
                  <div className="text-left">
                    <div className="font-bold">{fmt(p.total_amount)}</div>
                    <Badge variant={p.status === "approved" ? "default" : "outline"} className="text-xs">{p.status}</Badge>
                  </div>
                </div>
              ))}
              {purchases.length === 0 && <div className="text-center text-muted-foreground py-4 text-sm">لا توجد</div>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">آخر فواتير التصنيع</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {invoices.slice(0,5).map(inv => (
                <div key={inv.id} className="flex items-center justify-between text-sm border-b pb-2 last:border-0">
                  <div>
                    <div className="font-medium">{inv.product_name}</div>
                    <div className="text-xs text-muted-foreground">{fmt(inv.finished_qty)} {inv.unit} · {inv.invoice_no}</div>
                  </div>
                  <Badge variant={inv.status === "approved" || inv.status === "transferred" ? "default" : "outline"} className="text-xs">{inv.status}</Badge>
                </div>
              ))}
              {invoices.length === 0 && <div className="text-center text-muted-foreground py-4 text-sm">لا توجد</div>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">آخر حركات المخزون</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {moves.slice(0,5).map(m => (
                <div key={m.id} className="flex items-center justify-between text-sm border-b pb-2 last:border-0">
                  <div>
                    <div className="font-medium">{m.item_name}</div>
                    <div className="text-xs text-muted-foreground">{m.reason}</div>
                  </div>
                  <div className="text-left">
                    <Badge variant={m.direction === "IN" ? "default" : "destructive"} className="text-xs">{m.direction === "IN" ? "وارد" : "صرف"}</Badge>
                    <div className="font-medium mt-1">{fmt(m.quantity)}</div>
                  </div>
                </div>
              ))}
              {moves.length === 0 && <div className="text-center text-muted-foreground py-4 text-sm">لا توجد</div>}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
