import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  ShoppingCart,
  DollarSign,
  CheckCircle2,
  Users,
  UserPlus,
  Repeat,
  Gift,
  XCircle,
  MapPin,
  Megaphone,
  ShieldAlert,
  TrendingUp,
  Wallet,
  Loader2,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
} from "recharts";

import {
  aggregateByArea,
  aggregateBySource,
  aggregateProducts,
  computeKPIs,
  dailySeries,
  detectNewCustomers,
  fetchExpensesInRange,
  fetchOrderItemsForOrders,
  fetchOrdersInRange,
  isCancelledOrder,
  isGiftOrder,
  last3MonthsRange,
  thisMonthRange,
  thisWeekRange,
  todayRange,
  type DateRange,

  type MarketingKPIs,
  fetchMarketingDashboardSummary,
} from "@/lib/socialMediaAnalytics";
import { ZodexUnregisteredCard } from "@/components/marketing/ZodexUnregisteredCard";
import { ZodexSyncButton } from "@/components/warehouses/ZodexSyncButton";
import { Skeleton } from "@/components/ui/skeleton";

const COLORS = ["#8b5cf6", "#f97316", "#0ea5e9", "#10b981", "#f43f5e", "#facc15", "#6366f1", "#14b8a6"];

type Preset = "today" | "week" | "month" | "3m" | "custom";

const fmt = (n: number) => n.toLocaleString("ar-EG", { maximumFractionDigits: 0 });
const fmtMoney = (n: number) => `${fmt(n)} ج.م`;

export default function SocialMediaMarketingDashboard() {
  const [preset, setPreset] = useState<Preset>("month");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [loadDetails, setLoadDetails] = useState<boolean>(false);
  const [loadProducts, setLoadProducts] = useState<boolean>(false);

  const range: DateRange = useMemo(() => {
    if (preset === "today") return todayRange();
    if (preset === "week") return thisWeekRange();
    if (preset === "month") return thisMonthRange();
    if (preset === "custom" && customFrom && customTo) {
      return { from: new Date(customFrom).toISOString(), to: new Date(customTo + "T23:59:59").toISOString() };
    }
    return last3MonthsRange();
  }, [preset, customFrom, customTo]);

  // Initial mobile load: one light RPC only. Detailed rows/charts load on demand.
  const summaryQuery = useQuery({
    queryKey: ["mkt-dash-summary", range.from, range.to],
    queryFn: () => fetchMarketingDashboardSummary(range, false),
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Cached detailed fetches — disabled until the user asks for analytics/tables
  const ordersQuery = useQuery({
    queryKey: ["mkt-dash-orders", range.from, range.to],
    queryFn: () => fetchOrdersInRange(range),
    enabled: loadDetails,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const expensesQuery = useQuery({
    queryKey: ["mkt-dash-expenses", range.from, range.to],
    queryFn: () => fetchExpensesInRange(range),
    enabled: loadDetails,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const orders = ordersQuery.data ?? [];
  const expenses = expensesQuery.data ?? [];

  const orderIds = useMemo(() => orders.map((o) => o.id), [orders]);
  const custIds = useMemo(
    () => Array.from(new Set(orders.map((o) => o.customer_id).filter(Boolean) as string[])),
    [orders],
  );

  // Heavy queries — only fetch when data is needed
  const itemsQuery = useQuery({
    queryKey: ["mkt-dash-items", range.from, range.to, orderIds.length],
    queryFn: () => fetchOrderItemsForOrders(orderIds),
    enabled: loadDetails && loadProducts && orderIds.length > 0,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const newCustQuery = useQuery({
    queryKey: ["mkt-dash-new-cust", range.from, custIds.length],
    queryFn: () => detectNewCustomers(custIds, range),
    enabled: loadDetails && custIds.length > 0,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const items = itemsQuery.data ?? [];
  const newCustIds = newCustQuery.data ?? new Set<string>();
  const loading = summaryQuery.isLoading;


  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [areaFilter, setAreaFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [campaignFilter, setCampaignFilter] = useState<string>("all");
  const [productFilter, setProductFilter] = useState<string>("all");

  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      if (statusFilter !== "all" && o.status !== statusFilter) return false;
      if (areaFilter !== "all") {
        const a = (o.customer_governorate || "غير محدد").trim();
        if (a !== areaFilter) return false;
      }
      if (sourceFilter !== "all") {
        const src = (o.customer_source || o.source || "غير محدد").trim();
        if (src !== sourceFilter) return false;
      }
      if (channelFilter !== "all" && (o.customer_channel || "غير محدد").trim() !== channelFilter) return false;
      if (campaignFilter !== "all" && ((o as any).customer_campaign || "غير محدد").trim() !== campaignFilter) return false;
      return true;
    });
  }, [orders, statusFilter, areaFilter, sourceFilter, channelFilter, campaignFilter]);

  const approvedExpense = useMemo(() => expenses.filter((e) => e.is_approved).reduce((s, e) => s + e.amount, 0), [expenses]);
  const pendingExpense = useMemo(() => expenses.filter((e) => !e.is_approved).reduce((s, e) => s + e.amount, 0), [expenses]);

  const summary = summaryQuery.data;
  const kpis: MarketingKPIs = useMemo(() => {
    if (loadDetails && orders.length > 0) {
      return computeKPIs(filteredOrders, approvedExpense, pendingExpense, newCustIds);
    }
    const totalOrdersValue = Number(summary?.total_sales || 0);
    const approved = Number(summary?.approved_expenses || 0);
    const pending = Number(summary?.pending_expenses || 0);
    const cost5pct = totalOrdersValue * 0.05;
    const cost6pct = totalOrdersValue * 0.06;
    const actualRatio = totalOrdersValue > 0 ? (approved / totalOrdersValue) * 100 : null;
    const budgetStatus: MarketingKPIs["budgetStatus"] = actualRatio === null
      ? "no_sales"
      : actualRatio <= 5
        ? "safe"
        : actualRatio <= 6
          ? "warning"
          : "danger";
    return {
      totalOrders: Number(summary?.total_orders || 0),
      totalOrdersValue,
      deliveredOrders: Number(summary?.delivered_orders || 0),
      deliveredValue: Number(summary?.delivered_sales || 0),
      cancelledOrders: Number(summary?.cancelled_orders || 0),
      giftOrders: Number(summary?.gift_orders || 0),
      giftOriginalValue: Number(summary?.gift_original_value || 0),
      avgOrderValue: Number(summary?.avg_order_value || 0),
      newCustomers: Number(summary?.new_customers_count || 0),
      repeatCustomers: Number(summary?.repeat_customers_count || 0),
      topSource: summary?.top_source?.key ? {
        key: String(summary.top_source.key),
        count: Number(summary.top_source.count || 0),
        value: Number(summary.top_source.value || 0),
      } : null,
      topArea: summary?.top_area?.key ? {
        key: String(summary.top_area.key),
        count: Number(summary.top_area.count || 0),
        value: Number(summary.top_area.value || 0),
      } : null,
      approvedExpenses: approved,
      pendingExpenses: pending,
      totalExpensesAll: approved + pending,
      cost5pct,
      cost6pct,
      actualRatio,
      budgetStatus,
      budgetRemaining5: cost5pct - approved,
      budgetRemaining6: cost6pct - approved,
    };
  }, [loadDetails, orders.length, filteredOrders, approvedExpense, pendingExpense, newCustIds, summary]);

  const sourceAgg = useMemo(() => aggregateBySource(filteredOrders), [filteredOrders]);
  const areaAgg = useMemo(() => aggregateByArea(filteredOrders), [filteredOrders]);
  const ordersById = useMemo(() => new Map(filteredOrders.map((o) => [o.id, o])), [filteredOrders]);
  const filteredItems = useMemo(() => {
    return items.filter((it) => {
      if (!ordersById.has(it.order_id)) return false;
      if (productFilter !== "all" && it.product_name !== productFilter) return false;
      return true;
    });
  }, [items, ordersById, productFilter]);
  const productAgg = useMemo(() => aggregateProducts(filteredItems, ordersById), [filteredItems, ordersById]);
  const daily = useMemo(() => dailySeries(filteredOrders), [filteredOrders]);

  const uniqueSources = useMemo(
    () => Array.from(new Set(orders.map((o) => (o.customer_source || o.source || "غير محدد").trim()))),
    [orders],
  );
  const uniqueAreas = useMemo(
    () => Array.from(new Set(orders.map((o) => (o.customer_governorate || "غير محدد").trim()))),
    [orders],
  );
  const uniqueStatuses = useMemo(() => Array.from(new Set(orders.map((o) => o.status))), [orders]);
  const uniqueChannels = useMemo(
    () => Array.from(new Set(orders.map((o) => (o.customer_channel || "غير محدد").trim()))),
    [orders],
  );
  const uniqueCampaigns = useMemo(
    () => Array.from(new Set(orders.map((o: any) => (o.customer_campaign || "غير محدد").trim()))),
    [orders],
  );
  const uniqueProducts = useMemo(
    () => Array.from(new Set(items.map((i) => i.product_name))).sort(),
    [items],
  );

  return (
    <DashboardLayout>
      <div className="space-y-4 p-4" dir="rtl">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Megaphone className="h-6 w-6 text-purple-600" />
            <h1 className="text-2xl font-bold">لوحة التسويق والمبيعات</h1>
          </div>
          <div className="flex items-center gap-2">
            {loading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
            <ZodexSyncButton />
          </div>
        </div>

        {/* Filters */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">الفلاتر</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <div>
              <Label>الفترة</Label>
              <Select value={preset} onValueChange={(v) => setPreset(v as Preset)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">اليوم</SelectItem>
                  <SelectItem value="week">هذا الأسبوع</SelectItem>
                  <SelectItem value="month">هذا الشهر</SelectItem>
                  <SelectItem value="3m">آخر 3 شهور</SelectItem>
                  <SelectItem value="custom">فترة مخصصة</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {preset === "custom" && (
              <>
                <div>
                  <Label>من</Label>
                  <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
                </div>
                <div>
                  <Label>إلى</Label>
                  <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
                </div>
              </>
            )}
            <div>
              <Label>المصدر</Label>
              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل المصادر</SelectItem>
                  {uniqueSources.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>المحافظة</Label>
              <Select value={areaFilter} onValueChange={setAreaFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل المحافظات</SelectItem>
                  {uniqueAreas.map((a) => (<SelectItem key={a} value={a}>{a}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>الحالة</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الحالات</SelectItem>
                  {uniqueStatuses.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>قناة التواصل</Label>
              <Select value={channelFilter} onValueChange={setChannelFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل القنوات</SelectItem>
                  {uniqueChannels.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>الحملة</Label>
              <Select value={campaignFilter} onValueChange={setCampaignFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الحملات</SelectItem>
                  {uniqueCampaigns.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>المنتج</Label>
              <Select value={productFilter} onValueChange={setProductFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل المنتجات</SelectItem>
                  {uniqueProducts.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {loading && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Card key={i}><CardContent className="p-4 space-y-2"><Skeleton className="h-3 w-20" /><Skeleton className="h-7 w-24" /></CardContent></Card>
            ))}
          </div>
        )}

        {pendingExpense > 0 && (
          <Alert className="border-amber-500 bg-amber-50">
            <ShieldAlert className="h-4 w-4 text-amber-600" />
            <AlertTitle className="text-amber-800">مصروفات قيد المراجعة</AlertTitle>
            <AlertDescription className="text-amber-700">
              يوجد مصروفات سوشيال ميديا قيد المراجعة بقيمة {fmtMoney(pendingExpense)}، وهذه المصروفات لا تدخل في النسبة الرسمية إلا بعد اعتمادها.
            </AlertDescription>
          </Alert>
        )}


        {/* KPI cards */}
        {!loading && <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard icon={ShoppingCart} title="إجمالي الطلبات" value={fmt(kpis.totalOrders)} color="text-purple-600" />
          <KpiCard icon={DollarSign} title="قيمة الطلبات" value={fmtMoney(kpis.totalOrdersValue)} color="text-orange-600" />
          <KpiCard icon={CheckCircle2} title="مبيعات منفذة (Delivered)" value={fmtMoney(kpis.deliveredValue)} sub={`${fmt(kpis.deliveredOrders)} أوردر`} color="text-green-600" />
          <KpiCard icon={TrendingUp} title="متوسط قيمة الأوردر" value={fmtMoney(kpis.avgOrderValue)} color="text-blue-600" />

          <KpiCard icon={UserPlus} title="عملاء جدد" value={fmt(kpis.newCustomers)} color="text-emerald-600" />
          <KpiCard icon={Repeat} title="عملاء متكررون" value={fmt(kpis.repeatCustomers)} color="text-cyan-600" />
          <KpiCard icon={Gift} title="طلبات مجانية" value={fmt(kpis.giftOrders)} sub={`قيمتها ${fmtMoney(kpis.giftOriginalValue)}`} color="text-pink-600" />
          <KpiCard icon={XCircle} title="طلبات ملغاة" value={fmt(kpis.cancelledOrders)} color="text-red-600" />

          <KpiCard icon={Megaphone} title="أعلى مصدر" value={kpis.topSource?.key || "—"} sub={kpis.topSource ? fmtMoney(kpis.topSource.value) : ""} color="text-indigo-600" />
          <KpiCard icon={MapPin} title="أعلى منطقة" value={kpis.topArea?.key || "—"} sub={kpis.topArea ? fmtMoney(kpis.topArea.value) : ""} color="text-teal-600" />
          <KpiCard icon={Wallet} title="مصروفات معتمدة" value={fmtMoney(kpis.approvedExpenses)} color="text-slate-700" />
          <KpiCard icon={ShieldAlert} title="مصروفات قيد المراجعة" value={fmtMoney(kpis.pendingExpenses)} color="text-amber-600" />
        </div>}

        {/* Zodex bills registered externally but missing in our system */}
        <ZodexUnregisteredCard />

        {/* Budget status */}
        <BudgetStatusCard kpis={kpis} />

        <Card>
          <CardContent className="p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <div className="font-semibold">تفاصيل التحليلات والجداول</div>
              <div className="text-sm text-muted-foreground">يتم تحميل الشارتات والجداول التفصيلية عند الطلب فقط لتسريع فتح الموبايل.</div>
            </div>
            <Button onClick={() => setLoadDetails(true)} disabled={loadDetails || ordersQuery.isFetching} className="w-full md:w-auto">
              {ordersQuery.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {loadDetails ? "تم تحميل التفاصيل" : "عرض التفاصيل"}
            </Button>
          </CardContent>
        </Card>


        {loadDetails && (
          <>
            {/* Daily chart */}
            <Card>
              <CardHeader><CardTitle>تطور المبيعات اليومي</CardTitle></CardHeader>
              <CardContent style={{ height: 300 }}>
                <ResponsiveContainer>
                  <LineChart data={daily}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="left" />
                    <YAxis yAxisId="right" orientation="right" />
                    <Tooltip />
                    <Legend />
                    <Line yAxisId="left" type="monotone" dataKey="orders" stroke="#8b5cf6" name="عدد الطلبات" />
                    <Line yAxisId="right" type="monotone" dataKey="revenue" stroke="#f97316" name="قيمة المبيعات" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Sources + Areas charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader><CardTitle>مصادر العملاء (قيمة المبيعات)</CardTitle></CardHeader>
            <CardContent style={{ height: 300 }}>
              <ResponsiveContainer>
                <BarChart data={sourceAgg.slice(0, 10)}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="revenue" fill="#8b5cf6" name="المبيعات" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>توزيع الطلبات حسب المصدر</CardTitle></CardHeader>
            <CardContent style={{ height: 300 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={sourceAgg.slice(0, 8)} dataKey="orders" nameKey="label" outerRadius={100} label>
                    {sourceAgg.slice(0, 8).map((_, i) => (<Cell key={i} fill={COLORS[i % COLORS.length]} />))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
            </div>

            {/* Sources table */}
            <Card>
          <CardHeader><CardTitle>أداء قنوات التواصل ومصادر العملاء</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المصدر</TableHead>
                  <TableHead className="text-center">عدد الطلبات</TableHead>
                  <TableHead className="text-center">إجمالي المبيعات</TableHead>
                  <TableHead className="text-center">متوسط قيمة الأوردر</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sourceAgg.map((r) => (
                  <TableRow key={r.label}>
                    <TableCell>{r.label}</TableCell>
                    <TableCell className="text-center">{fmt(r.orders)}</TableCell>
                    <TableCell className="text-center">{fmtMoney(r.revenue)}</TableCell>
                    <TableCell className="text-center">{fmtMoney(r.avg)}</TableCell>
                  </TableRow>
                ))}
                {sourceAgg.length === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">لا توجد بيانات</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
            </Card>

            {/* Areas */}
            <Card>
          <CardHeader><CardTitle>توزيع المبيعات حسب المناطق (Top 10)</CardTitle></CardHeader>
          <CardContent>
            <div style={{ height: 280 }} className="mb-3">
              <ResponsiveContainer>
                <BarChart data={areaAgg.slice(0, 10)}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="area" tick={{ fontSize: 10 }} />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="revenue" fill="#0ea5e9" name="المبيعات" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المحافظة / المنطقة</TableHead>
                  <TableHead className="text-center">عدد الطلبات</TableHead>
                  <TableHead className="text-center">إجمالي المبيعات</TableHead>
                  <TableHead className="text-center">متوسط قيمة الأوردر</TableHead>
                  <TableHead className="text-center">أكثر مصدر</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {areaAgg.slice(0, 20).map((r) => (
                  <TableRow key={r.area}>
                    <TableCell>{r.area}</TableCell>
                    <TableCell className="text-center">{fmt(r.orders)}</TableCell>
                    <TableCell className="text-center">{fmtMoney(r.revenue)}</TableCell>
                    <TableCell className="text-center">{fmtMoney(r.avg)}</TableCell>
                    <TableCell className="text-center">{r.topSource}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
            </Card>
          </>
        )}

        {/* Products */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle>أداء المنتجات تسويقيًا (Top 20)</CardTitle>
            {!loadProducts && (
              <Button size="sm" variant="outline" onClick={() => { setLoadDetails(true); setLoadProducts(true); }}>
                عرض التفاصيل
              </Button>
            )}
            {loadProducts && itemsQuery.isFetching && (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </CardHeader>
          <CardContent>
            {!loadProducts ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                اضغط "عرض التفاصيل" لتحميل بيانات المنتجات (تحسين للأداء على الموبايل).
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>المنتج</TableHead>
                    <TableHead className="text-center">الكمية</TableHead>
                    <TableHead className="text-center">الإيرادات</TableHead>
                    <TableHead className="text-center">عدد الأوردرات</TableHead>
                    <TableHead className="text-center">متوسط السعر</TableHead>
                    <TableHead className="text-center">أعلى مصدر</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {productAgg.slice(0, 20).map((r) => (
                    <TableRow key={r.name}>
                      <TableCell>{r.name}</TableCell>
                      <TableCell className="text-center">{fmt(r.qty)}</TableCell>
                      <TableCell className="text-center">{fmtMoney(r.revenue)}</TableCell>
                      <TableCell className="text-center">{fmt(r.ordersCount)}</TableCell>
                      <TableCell className="text-center">{fmtMoney(r.avgPrice)}</TableCell>
                      <TableCell className="text-center">{r.topSource}</TableCell>
                    </TableRow>
                  ))}
                  {productAgg.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">لا توجد بيانات</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}


function KpiCard({ icon: Icon, title, value, sub, color }: any) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs text-muted-foreground">{title}</div>
            <div className={`text-xl font-bold mt-1 ${color || ""}`}>{value}</div>
            {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
          </div>
          <Icon className={`h-8 w-8 ${color || "text-muted-foreground"} opacity-40`} />
        </div>
      </CardContent>
    </Card>
  );
}

function BudgetStatusCard({ kpis }: { kpis: MarketingKPIs }) {
  const cfg = {
    safe: { color: "bg-green-500", label: "آمن", badge: "bg-green-100 text-green-800 border-green-300", msg: "المصروف داخل الحد المستهدف 5%." },
    warning: { color: "bg-orange-500", label: "تحذير", badge: "bg-orange-100 text-orange-800 border-orange-300", msg: "المصروف تجاوز 5% لكنه ما زال داخل الحد الأقصى 6%." },
    danger: { color: "bg-red-500", label: "خطر", badge: "bg-red-100 text-red-800 border-red-300", msg: "مصروفات السوشيال تجاوزت الحد الأقصى 6% وتحتاج مراجعة الإدارة." },
    no_sales: { color: "bg-gray-400", label: "—", badge: "bg-gray-100 text-gray-800 border-gray-300", msg: "لا توجد مبيعات كافية لحساب النسبة." },
  }[kpis.budgetStatus];
  const pct = kpis.actualRatio !== null ? Math.min(kpis.actualRatio, 10) : 0;
  const pctOfBar = (pct / 6) * 100;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>نسبة مصروفات السوشيال من المبيعات</span>
          <Badge className={cfg.badge} variant="outline">{cfg.label}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert className={kpis.budgetStatus === "danger" ? "border-red-300" : kpis.budgetStatus === "warning" ? "border-orange-300" : ""}>
          <AlertTitle className="text-lg">
            {kpis.actualRatio !== null ? `النسبة الحالية: ${kpis.actualRatio.toFixed(2)}%` : "—"}
          </AlertTitle>
          <AlertDescription>{cfg.msg}</AlertDescription>
        </Alert>

        <div className="relative">
          <div className="h-4 bg-gray-100 rounded overflow-hidden">
            <div className={`h-full ${cfg.color} transition-all`} style={{ width: `${Math.min(pctOfBar, 100)}%` }} />
          </div>
          <div className="relative h-4 mt-1">
            <div className="absolute top-0 h-full border-r-2 border-green-600" style={{ right: `${100 - (5 / 6) * 100}%` }}>
              <span className="absolute -top-4 text-[10px] text-green-700 font-bold">5%</span>
            </div>
            <div className="absolute top-0 h-full border-r-2 border-red-600" style={{ right: "0%" }}>
              <span className="absolute -top-4 text-[10px] text-red-700 font-bold">6%</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div className="p-3 rounded bg-muted/40">
            <div className="text-xs text-muted-foreground">مصروفات معتمدة</div>
            <div className="font-bold text-lg">{fmtMoney(kpis.approvedExpenses)}</div>
          </div>
          <div className="p-3 rounded bg-amber-50">
            <div className="text-xs text-muted-foreground">قيد المراجعة (لا يحسب)</div>
            <div className="font-bold text-lg text-amber-700">{fmtMoney(kpis.pendingExpenses)}</div>
          </div>
          <div className="p-3 rounded bg-green-50">
            <div className="text-xs text-muted-foreground">حد 5% المستهدف</div>
            <div className="font-bold text-lg text-green-700">{fmtMoney(kpis.cost5pct)}</div>
            <div className="text-xs mt-1">
              {kpis.budgetRemaining5 >= 0
                ? `المتبقي: ${fmtMoney(kpis.budgetRemaining5)}`
                : `تجاوز: ${fmtMoney(-kpis.budgetRemaining5)}`}
            </div>
          </div>
          <div className="p-3 rounded bg-red-50">
            <div className="text-xs text-muted-foreground">حد 6% الأقصى</div>
            <div className="font-bold text-lg text-red-700">{fmtMoney(kpis.cost6pct)}</div>
            <div className="text-xs mt-1">
              {kpis.budgetRemaining6 >= 0
                ? `المتبقي: ${fmtMoney(kpis.budgetRemaining6)}`
                : `تجاوز: ${fmtMoney(-kpis.budgetRemaining6)}`}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
