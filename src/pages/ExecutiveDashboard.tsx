import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity, AlertTriangle, ArrowLeft, Beef, Bird, Egg, FlaskConical,
  Package, Factory, Warehouse, Wallet, TrendingUp, RefreshCw,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Navigate } from "react-router-dom";

type Range = "today" | "week" | "month" | "year" | "custom";

function rangeBounds(r: Range, fromStr?: string, toStr?: string): { from: string; to: string } {
  const now = new Date();
  const to = new Date();
  let from = new Date();
  if (r === "today") from.setHours(0, 0, 0, 0);
  else if (r === "week") { const d = now.getDay(); from = new Date(now); from.setDate(now.getDate() - d); from.setHours(0,0,0,0); }
  else if (r === "month") from = new Date(now.getFullYear(), now.getMonth(), 1);
  else if (r === "year") from = new Date(now.getFullYear(), 0, 1);
  else if (r === "custom" && fromStr && toStr) {
    return { from: new Date(fromStr).toISOString(), to: new Date(toStr).toISOString() };
  }
  return { from: from.toISOString(), to: to.toISOString() };
}

const fmt = (n: any, decimals = 0) => {
  const v = Number(n ?? 0);
  if (!isFinite(v)) return "0";
  return v.toLocaleString("ar-EG", { maximumFractionDigits: decimals });
};
const fmtMoney = (n: any) => `${fmt(n, 2)} ج.م`;

function Kpi({ label, value, hint, tone = "default" }: { label: string; value: string | number; hint?: string; tone?: "default" | "primary" | "success" | "warning" | "destructive" }) {
  const toneCls = {
    default: "text-foreground",
    primary: "text-primary",
    success: "text-emerald-600",
    warning: "text-amber-600",
    destructive: "text-destructive",
  }[tone];
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className={`text-lg font-bold ${toneCls}`}>{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}

function SectionCard({
  title, icon: Icon, color, detailsPath, children,
}: {
  title: string; icon: any; color: string; detailsPath: string; children: React.ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <Card className="border-t-4" style={{ borderTopColor: color }}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-5 w-5" style={{ color }} />
          {title}
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={() => navigate(detailsPath)}>
          عرض التفاصيل <ArrowLeft className="h-4 w-4 mr-1" />
        </Button>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default function ExecutiveDashboard() {
  const { isGeneralManager, isExecutiveManager, loading: authLoading } = useAuth();
  const [range, setRange] = useState<Range>("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const bounds = useMemo(() => rangeBounds(range, customFrom, customTo), [range, customFrom, customTo]);

  const { data, isLoading, refetch, isFetching, error } = useQuery({
    queryKey: ["exec-summary", bounds.from, bounds.to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("executive_dashboard_summary" as any, {
        p_from: bounds.from, p_to: bounds.to,
      });
      if (error) throw error;
      return data as any;
    },
    staleTime: 60_000,
    enabled: !authLoading && (isGeneralManager || isExecutiveManager),
  });

  if (authLoading) return <div className="p-6"><Skeleton className="h-96 w-full" /></div>;
  if (!isGeneralManager && !isExecutiveManager) return <Navigate to="/" replace />;

  const s = data || {};

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-primary" />
            لوحة تحكم المدير التنفيذي
          </h1>
          <p className="text-sm text-muted-foreground">ملخص شامل لكل أقسام الشركة في شاشة واحدة</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 ml-1 ${isFetching ? "animate-spin" : ""}`} /> تحديث
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-3 flex flex-wrap items-center gap-2">
          {([
            ["today","اليوم"],["week","الأسبوع"],["month","الشهر"],["year","السنة"],["custom","من-إلى"],
          ] as [Range,string][]).map(([k,l]) => (
            <Button key={k} size="sm" variant={range===k?"default":"outline"} onClick={() => setRange(k)}>{l}</Button>
          ))}
          {range === "custom" && (
            <div className="flex gap-2 items-center">
              <input type="date" value={customFrom} onChange={e=>setCustomFrom(e.target.value)} className="border rounded px-2 py-1 text-sm bg-background" />
              <span>—</span>
              <input type="date" value={customTo} onChange={e=>setCustomTo(e.target.value)} className="border rounded px-2 py-1 text-sm bg-background" />
            </div>
          )}
        </CardContent>
      </Card>

      {error && (
        <Card className="border-destructive">
          <CardContent className="p-4 text-destructive text-sm">
            تعذر تحميل البيانات: {(error as Error).message}
          </CardContent>
        </Card>
      )}

      {/* Alerts */}
      {Array.isArray(s.alerts) && s.alerts.length > 0 && (
        <Card className="border-amber-400/50 bg-amber-50/40 dark:bg-amber-950/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-5 w-5 text-amber-600" /> التنبيهات ({s.alerts.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {s.alerts.slice(0, 20).map((a: any, i: number) => (
                <Badge key={i} variant={a.level === "destructive" ? "destructive" : "secondary"}>
                  {a.message}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-56 w-full" />)}
        </div>
      ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* مزرعة الأمهات */}
        <SectionCard title="مزرعة الأمهات" icon={Egg} color="#f59e0b" detailsPath="/farm">
          <div className="grid grid-cols-2 gap-2">
            <Kpi label="بيض اليوم" value={fmt(s.mother_farm?.eggs_today)} tone="primary" />
            <Kpi label="بيض الأسبوع" value={fmt(s.mother_farm?.eggs_week)} />
            <Kpi label="بيض الشهر" value={fmt(s.mother_farm?.eggs_month)} />
            <Kpi label="منقول للتفريخ (شهر)" value={fmt(s.mother_farm?.shipped_month)} />
            <Kpi label="أعلى ملعب" value={s.mother_farm?.top_family?.family_number ? `#${s.mother_farm.top_family.family_number}` : "—"} hint={`${fmt(s.mother_farm?.top_family?.eggs)} بيضة`} tone="success" />
            <Kpi label="أقل ملعب" value={s.mother_farm?.low_family?.family_number ? `#${s.mother_farm.low_family.family_number}` : "—"} hint={`${fmt(s.mother_farm?.low_family?.eggs)} بيضة`} tone="warning" />
            <Kpi label="هالك الشهر" value={fmt(s.mother_farm?.waste_month)} tone="destructive" />
            <Kpi label="نسبة الهالك" value={`${fmt(s.mother_farm?.waste_pct, 2)}%`} />
          </div>
        </SectionCard>

        {/* معمل التفريخ */}
        <SectionCard title="معمل التفريخ" icon={FlaskConical} color="#06b6d4" detailsPath="/hatchery">
          <div className="grid grid-cols-2 gap-2">
            <Kpi label="عملاء نشطون" value={fmt(s.hatchery?.customers)} />
            <Kpi label="دفعات حالية" value={fmt(s.hatchery?.current_batches)} tone="primary" />
            <Kpi label="بيض داخل الشهر" value={fmt(s.hatchery?.eggs_in_month)} />
            <Kpi label="بيض داخل الماكينات" value={fmt(s.hatchery?.eggs_in_machine)} />
            <Kpi label="أقرب فقس" value={s.hatchery?.next_hatch?.batch_number || "—"} hint={s.hatchery?.next_hatch?.date ? new Date(s.hatchery.next_hatch.date).toLocaleDateString("ar-EG") : ""} tone="success" />
            <Kpi label="نسبة إخصاب (العاصمة)" value={`${fmt(s.hatchery?.capital_fert_pct, 2)}%`} />
            <Kpi label="كتاكيت العاصمة (شهر)" value={fmt(s.hatchery?.capital_chicks_month)} tone="primary" />
            <Kpi label="كتاكيت العاصمة (سنة)" value={fmt(s.hatchery?.capital_chicks_year)} />
          </div>
        </SectionCard>

        {/* التحضين والتسمين */}
        <SectionCard title="التحضين والتسمين" icon={Bird} color="#10b981" detailsPath="/modules/brooding">
          <div className="grid grid-cols-2 gap-2">
            <Kpi label="إجمالي الطيور" value={fmt(s.brooding?.total_birds)} tone="primary" />
            <Kpi label="قيمة التكلفة" value={fmtMoney(s.brooding?.cost_value)} />
            <Kpi label="القيمة السوقية" value={fmtMoney(s.brooding?.market_value)} tone="success" />
            <Kpi label="الربح المتوقع" value={fmtMoney(s.brooding?.expected_profit)} tone={Number(s.brooding?.expected_profit) >= 0 ? "success" : "destructive"} />
            <Kpi label="نافق الشهر" value={fmt(s.brooding?.mortality_month)} tone="destructive" />
            <Kpi label="نسبة النافق" value={`${fmt(s.brooding?.mortality_pct, 2)}%`} />
            <Kpi label="رصيد العلف (كجم)" value={fmt(s.brooding?.feed_stock_kg, 1)} />
            <Kpi label="تكلفة علف الشهر" value={fmtMoney(s.brooding?.feed_issued_cost_month)} />
            {s.brooding?.next_slaughter?.batch_number && (
              <Kpi label="أقرب للمجزر" value={s.brooding.next_slaughter.batch_number} hint={s.brooding.next_slaughter.date ? new Date(s.brooding.next_slaughter.date).toLocaleDateString("ar-EG") : ""} />
            )}
          </div>
        </SectionCard>

        {/* مصنع الأعلاف */}
        <SectionCard title="مصنع الأعلاف" icon={Factory} color="#8b5cf6" detailsPath="/modules/feed-factory">
          <div className="grid grid-cols-2 gap-2">
            <Kpi label="مخزون العلف (كجم)" value={fmt(s.feed_factory?.stock_kg, 1)} />
            <Kpi label="قيمة المخزون" value={fmtMoney(s.feed_factory?.stock_value)} />
            <Kpi label="مبيعات اليوم" value={fmtMoney(s.feed_factory?.sales_today)} tone="primary" />
            <Kpi label="مبيعات الشهر" value={fmtMoney(s.feed_factory?.sales_month)} tone="primary" />
            <Kpi label="مشتريات اليوم" value={fmtMoney(s.feed_factory?.purchases_today)} />
            <Kpi label="مشتريات الشهر" value={fmtMoney(s.feed_factory?.purchases_month)} />
            <Kpi label="مرتجعات الشهر" value={fmtMoney(s.feed_factory?.returns_month)} tone="warning" />
            <Kpi label="رصيد الخزنة" value={fmtMoney(s.feed_factory?.treasury_balance)} tone={Number(s.feed_factory?.treasury_balance) >= 0 ? "success" : "destructive"} />
            <Kpi label="ربح الشهر" value={fmtMoney(s.feed_factory?.profit_month)} tone="success" />
            <Kpi label="منتجات تحت الحد" value={fmt(s.feed_factory?.low_stock_count)} tone="warning" />
          </div>
        </SectionCard>

        {/* مصنع اللحوم */}
        <SectionCard title="مصنع اللحوم" icon={Beef} color="#dc2626" detailsPath="/modules/meat-factory/operations">
          <div className="grid grid-cols-2 gap-2">
            <Kpi label="قيمة الخامات" value={fmtMoney(s.meat_factory?.raw_value)} />
            <Kpi label="قيمة التغليف" value={fmtMoney(s.meat_factory?.packaging_value)} />
            <Kpi label="قيمة المنتجات الجاهزة" value={fmtMoney(s.meat_factory?.finished_value)} tone="primary" />
            <Kpi label="مبيعات اليوم" value={fmtMoney(s.meat_factory?.sales_today)} />
            <Kpi label="مبيعات الشهر" value={fmtMoney(s.meat_factory?.sales_month)} tone="primary" />
            <Kpi label="ربح الشهر" value={fmtMoney(s.meat_factory?.profit_month)} tone="success" />
            <Kpi label="مشتريات خامات (شهر)" value={fmtMoney(s.meat_factory?.raw_purch_month)} />
            <Kpi label="مشتريات تغليف (شهر)" value={fmtMoney(s.meat_factory?.pack_purch_month)} />
            <Kpi label="مرتجعات الشهر" value={fmtMoney(s.meat_factory?.returns_month)} tone="warning" />
            <Kpi label="رصيد الخزنة" value={fmtMoney(s.meat_factory?.treasury_balance)} tone={Number(s.meat_factory?.treasury_balance) >= 0 ? "success" : "destructive"} />
            <Kpi label="منتجات تحت الحد" value={fmt(s.meat_factory?.low_stock_count)} tone="warning" />
          </div>
          {Array.isArray(s.meat_factory?.last_manufacturing) && s.meat_factory.last_manufacturing.length > 0 && (
            <div className="mt-3 text-xs">
              <div className="text-muted-foreground mb-1">آخر أوامر التصنيع:</div>
              <div className="flex flex-wrap gap-1">
                {s.meat_factory.last_manufacturing.map((m: any, i: number) => (
                  <Badge key={i} variant="outline">{m.invoice_no} — {fmt(m.qty,1)} كجم</Badge>
                ))}
              </div>
            </div>
          )}
        </SectionCard>

        {/* المخزن الرئيسي */}
        <SectionCard title="المخزن الرئيسي" icon={Warehouse} color="#0ea5e9" detailsPath="/inventory">
          <div className="grid grid-cols-2 gap-2">
            <Kpi label="قيمة المخزون" value={fmtMoney(s.main_warehouse?.inventory_value)} tone="primary" />
            <Kpi label="وارد اليوم" value={fmt(s.main_warehouse?.in_today)} tone="success" />
            <Kpi label="صادر اليوم" value={fmt(s.main_warehouse?.out_today)} tone="warning" />
            <Kpi label="تحويلات اليوم" value={fmt(s.main_warehouse?.transfers_today)} />
            <Kpi label="تحت الحد الأدنى" value={fmt(s.main_warehouse?.low_stock_count)} tone="destructive" />
            <Kpi label="محجوز" value={fmt(s.main_warehouse?.reserved_qty)} />
          </div>
        </SectionCard>

        {/* المبيعات العامة */}
        <SectionCard title="المبيعات العامة" icon={Package} color="#ec4899" detailsPath="/orders">
          <div className="grid grid-cols-2 gap-2">
            <Kpi label="مبيعات اليوم" value={fmtMoney(s.sales?.sales_today)} tone="primary" />
            <Kpi label="طلبات اليوم" value={fmt(s.sales?.orders_today)} />
            <Kpi label="مبيعات الشهر" value={fmtMoney(s.sales?.sales_month)} tone="primary" />
            <Kpi label="طلبات الشهر" value={fmt(s.sales?.orders_month)} />
            <Kpi label="مبيعات السنة" value={fmtMoney(s.sales?.sales_year)} tone="success" />
            <Kpi label="مبيعات الفترة" value={fmtMoney(s.sales?.sales_range)} />
            <Kpi label="أعلى منتج" value={s.sales?.top_product?.name || "—"} hint={`${fmt(s.sales?.top_product?.qty)} وحدة`} />
            <Kpi label="أعلى قناة" value={s.sales?.top_source?.name || "—"} hint={`${fmt(s.sales?.top_source?.count)} طلب`} />
          </div>
        </SectionCard>

        {/* الخزن */}
        <SectionCard title="الخزن" icon={Wallet} color="#16a34a" detailsPath="/financial-reports">
          <div className="grid grid-cols-2 gap-2">
            <Kpi label="خزنة الأعلاف" value={fmtMoney(s.treasuries?.feed_factory)} tone={Number(s.treasuries?.feed_factory) >= 0 ? "success" : "destructive"} />
            <Kpi label="خزنة اللحوم" value={fmtMoney(s.treasuries?.meat_factory)} tone={Number(s.treasuries?.meat_factory) >= 0 ? "success" : "destructive"} />
            <Kpi label="إجمالي النقد" value={fmtMoney(s.treasuries?.total_cash)} tone="primary" />
            <Kpi label="داخل اليوم" value={fmtMoney(s.treasuries?.in_today)} tone="success" />
            <Kpi label="خارج اليوم" value={fmtMoney(s.treasuries?.out_today)} tone="warning" />
          </div>
        </SectionCard>
      </div>
      )}

      <div className="text-[11px] text-muted-foreground text-center pt-2 flex items-center justify-center gap-1">
        <Activity className="h-3 w-3" />
        آخر تحديث: {s.generated_at ? new Date(s.generated_at).toLocaleString("ar-EG") : "—"}
      </div>
    </div>
  );
}
