import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Phone, Filter, RotateCcw, ShoppingCart, TrendingUp, Clock } from "lucide-react";
import { toast } from "sonner";
import { formatDate } from "@/lib/dateFormat";
import { governorateId, governorateLabel } from "@/lib/governorates";
import { ModeratorConfig, matchesModeratorGroup, normalizeAr } from "@/constants/moderators";
import { cairoTodayStartUTC, cairoMonthStartUTC, currentCairoYearMonth } from "@/lib/cairoDate";

// ملخص توصيل الأوردرات — جدول مختصر للعرض فقط.
// ممنوع هنا: المحتويات/المنتجات/الكميات/البوكسات/رقم البوليصة.

const statusColors: Record<string, string> = {
  pending: "bg-warning text-warning-foreground",
  processing: "bg-primary text-primary-foreground",
  shipped: "bg-chart-4 text-primary-foreground",
  delivered: "bg-success text-success-foreground",
  cancelled: "bg-destructive text-destructive-foreground",
};

const statusLabels: Record<string, string> = {
  pending: "قيد الانتظار",
  processing: "جاري التجهيز",
  shipped: "تم الشحن",
  delivered: "تم التوصيل",
  cancelled: "مرتجع",
};

const NEEDS_FOLLOWUP = ["pending", "processing", "shipped"];

const normalize = (s: string) => normalizeAr(String(s || "").toLowerCase());

interface OrderRow {
  id: string;
  order_number: string;
  status: string;
  total: number;
  created_at: string;
  moderator: string | null;
  shipping_company: string | null;
  fulfillment_type: string | null;
  source_warehouse_id: string | null;
  source_warehouse_name: string | null;
  customer_name: string;
  customer_phone: string;
  customer_phone2: string | null;
  governorate: string | null;
}

// شركة الشحن / جهة التوصيل المسجلة فعلياً على الأوردر (بدون إنشاء حقل جديد).
const shippingLabel = (o: OrderRow): string => {
  const wh = normalize(o.source_warehouse_name || "");
  if (wh.includes(normalize("العجوزة"))) return "العجوزة";
  const comp = (o.shipping_company || "").trim();
  if (comp) {
    if (normalize(comp).includes(normalize("مندوب خاص"))) return "مندوب خاص";
    return comp;
  }
  if (o.source_warehouse_name) return o.source_warehouse_name;
  return "غير محدد";
};

type PeriodKey = "today" | "last7" | "month" | "prev_month" | "last2" | "custom";

export interface DeliverySummaryProps {
  /** own = أوردرات المسوقة الحالية فقط | group = مجموعة مسوقة محددة (مراجعة) */
  mode: "own" | "group";
  moderator?: ModeratorConfig;
  /** userId used when no moderator config matched (own mode) */
  userId?: string;
  badgeLabel?: string;
  readOnlyNote?: string;
}

export default function DeliverySummary({ mode, moderator, userId, badgeLabel, readOnlyNote }: DeliverySummaryProps) {
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<OrderRow[]>([]);

  const emptyFilters = {
    period: "month" as PeriodKey,
    from: "",
    to: "",
    status: "all",
    governorate: "all",
    channel: "all",
    q: "",
  };
  const [draft, setDraft] = useState(emptyFilters);
  const [applied, setApplied] = useState(emptyFilters);

  const range = useMemo(() => {
    const now = new Date();
    const { year, monthIndex0 } = currentCairoYearMonth(now);
    switch (applied.period) {
      case "today":
        return { from: cairoTodayStartUTC(now), to: now };
      case "last7":
        return { from: new Date(cairoTodayStartUTC(now).getTime() - 6 * 86400000), to: now };
      case "prev_month": {
        const m = monthIndex0 === 0 ? 11 : monthIndex0 - 1;
        const y = monthIndex0 === 0 ? year - 1 : year;
        return { from: cairoMonthStartUTC(y, m), to: cairoMonthStartUTC(year, monthIndex0) };
      }
      case "last2": {
        const m = monthIndex0 === 0 ? 11 : monthIndex0 - 1;
        const y = monthIndex0 === 0 ? year - 1 : year;
        return { from: cairoMonthStartUTC(y, m), to: now };
      }
      case "custom": {
        const from = applied.from ? new Date(`${applied.from}T00:00:00+03:00`) : cairoMonthStartUTC(year, monthIndex0);
        const to = applied.to ? new Date(`${applied.to}T23:59:59+03:00`) : now;
        return { from, to };
      }
      default:
        return { from: cairoMonthStartUTC(year, monthIndex0), to: now };
    }
  }, [applied.period, applied.from, applied.to]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      // فلترة على مستوى الاستعلام: أوردرات المسوقة فقط
      let query = supabase
        .from("orders")
        .select(
          "id, order_number, status, total, created_at, moderator, shipping_company, fulfillment_type, source_warehouse_id, created_by, customers(name, phone, phone2, governorate)",
        )
        .gte("created_at", range.from.toISOString())
        .lte("created_at", range.to.toISOString())
        .order("created_at", { ascending: false })
        .limit(1000);

      if (moderator) {
        const ors = moderator.aliases.map((a) => `moderator.ilike.%${a}%`);
        if (mode === "own" && userId) ors.push(`created_by.eq.${userId}`);
        query = query.or(ors.join(","));
      } else if (userId) {
        query = query.eq("created_by", userId);
      }

      const { data, error } = await query;
      if (error) {
        if (!cancelled) { toast.error("تعذّر تحميل الأوردرات"); setLoading(false); }
        return;
      }
      let rows = (data || []) as any[];
      if (moderator) {
        rows = rows.filter((o) =>
          matchesModeratorGroup(o.moderator, moderator.canonicalModerator) ||
          (mode === "own" && !o.moderator && o.created_by === userId),
        );
      }

      const whIds = Array.from(new Set(rows.map((o) => o.source_warehouse_id).filter(Boolean)));
      const whMap: Record<string, string> = {};
      if (whIds.length) {
        const { data: whs } = await supabase.from("warehouses").select("id, name").in("id", whIds as string[]);
        (whs || []).forEach((w: any) => { whMap[w.id] = w.name; });
      }

      const mapped: OrderRow[] = rows.map((o: any) => ({
        id: o.id,
        order_number: o.order_number,
        status: o.status,
        total: Number(o.total || 0),
        created_at: o.created_at,
        moderator: o.moderator,
        shipping_company: o.shipping_company,
        fulfillment_type: o.fulfillment_type,
        source_warehouse_id: o.source_warehouse_id,
        source_warehouse_name: o.source_warehouse_id ? whMap[o.source_warehouse_id] || null : null,
        customer_name: o.customers?.name || "—",
        customer_phone: o.customers?.phone || "",
        customer_phone2: o.customers?.phone2 || null,
        governorate: o.customers?.governorate || null,
      }));

      if (!cancelled) { setOrders(mapped); setLoading(false); }
    };
    load();
    return () => { cancelled = true; };
  }, [range.from, range.to, moderator, mode, userId]);

  const channels = useMemo(() => {
    const set = new Set<string>();
    orders.forEach((o) => set.add(shippingLabel(o)));
    return Array.from(set).sort();
  }, [orders]);

  const govOptions = useMemo(() => {
    const map = new Map<string, string>();
    orders.forEach((o) => {
      const raw = (o.governorate || "").trim();
      if (!raw) return;
      const id = governorateId(raw);
      map.set(id || `raw:${raw}`, governorateLabel(raw) || raw);
    });
    return Array.from(map.entries());
  }, [orders]);

  const visible = useMemo(() => {
    const q = normalize(applied.q);
    return orders.filter((o) => {
      if (applied.status !== "all" && o.status !== applied.status) return false;
      if (applied.governorate !== "all") {
        const key = applied.governorate.startsWith("raw:")
          ? (o.governorate || "").trim() === applied.governorate.slice(4)
          : governorateId(o.governorate || "") === applied.governorate;
        if (!key) return false;
      }
      if (applied.channel !== "all" && shippingLabel(o) !== applied.channel) return false;
      if (!q) return true;
      const digits = applied.q.replace(/\D/g, "");
      return (
        normalize(o.order_number).includes(q) ||
        normalize(o.customer_name).includes(q) ||
        (!!digits && ((o.customer_phone || "").includes(digits) || (o.customer_phone2 || "").includes(digits)))
      );
    });
  }, [orders, applied]);

  const totalValue = visible.reduce((s, o) => s + o.total, 0);
  const followUp = visible.filter((o) => NEEDS_FOLLOWUP.includes(o.status)).length;

  return (
    <div dir="rtl" className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><ShoppingCart className="w-3.5 h-3.5" /> عدد الأوردرات</div>
          <div className="text-2xl font-bold">{visible.length}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><TrendingUp className="w-3.5 h-3.5" /> إجمالي القيمة</div>
          <div className="text-2xl font-bold text-primary">{totalValue.toLocaleString()} ج.م</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> تحتاج متابعة</div>
          <div className="text-2xl font-bold text-warning">{followUp}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">{badgeLabel ? "العرض" : "المسوقة"}</div>
          <div className="text-sm font-semibold mt-1">{badgeLabel || moderator?.displayName || "—"}</div>
          {readOnlyNote && <div className="text-[11px] text-muted-foreground mt-1">{readOnlyNote}</div>}
        </CardContent></Card>
      </div>

      {/* الفلاتر */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs">الفترة</Label>
              <Select value={draft.period} onValueChange={(v) => setDraft({ ...draft, period: v as PeriodKey })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">اليوم</SelectItem>
                  <SelectItem value="last7">آخر 7 أيام</SelectItem>
                  <SelectItem value="month">الشهر الحالي</SelectItem>
                  <SelectItem value="prev_month">الشهر السابق</SelectItem>
                  <SelectItem value="last2">آخر شهرين</SelectItem>
                  <SelectItem value="custom">فترة مخصصة</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {draft.period === "custom" && (
              <>
                <div>
                  <Label className="text-xs">من تاريخ</Label>
                  <Input type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">إلى تاريخ</Label>
                  <Input type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
                </div>
              </>
            )}
            <div>
              <Label className="text-xs">الحالة</Label>
              <Select value={draft.status} onValueChange={(v) => setDraft({ ...draft, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الحالات</SelectItem>
                  {Object.entries(statusLabels).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">المحافظة</Label>
              <Select value={draft.governorate} onValueChange={(v) => setDraft({ ...draft, governorate: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل المحافظات</SelectItem>
                  {govOptions.map(([id, label]) => <SelectItem key={id} value={id}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">شركة الشحن</Label>
              <Select value={draft.channel} onValueChange={(v) => setDraft({ ...draft, channel: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {channels.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">بحث (رقم الأوردر / العميل / الهاتف)</Label>
              <Input value={draft.q} onChange={(e) => setDraft({ ...draft, q: e.target.value })} placeholder="اكتب للبحث" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setApplied(draft)}><Filter className="w-4 h-4 ml-1" /> تطبيق الفلاتر</Button>
            <Button size="sm" variant="outline" onClick={() => { setDraft(emptyFilters); setApplied(emptyFilters); }}>
              <RotateCcw className="w-4 h-4 ml-1" /> مسح الفلاتر
            </Button>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : visible.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">لا توجد أوردرات مطابقة للفلاتر</CardContent></Card>
      ) : (
        <>
          {/* موبايل: بطاقة مختصرة بعرض الشاشة */}
          <div className="space-y-3 md:hidden">
            {visible.map((o) => (
              <Card key={o.id} className={NEEDS_FOLLOWUP.includes(o.status) ? "border-warning/60" : ""}>
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Link to={`/orders/${o.id}`} className="font-mono text-xs font-semibold text-primary break-all">
                      {o.order_number}
                    </Link>
                    <Badge className={statusColors[o.status] || ""}>{statusLabels[o.status] || o.status}</Badge>
                  </div>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="font-semibold text-sm">{o.customer_name}</span>
                    {o.customer_phone && (
                      <a href={`tel:${o.customer_phone}`} className="inline-flex items-center gap-1 text-primary text-sm font-mono" dir="ltr">
                        <Phone className="w-3.5 h-3.5" /> {o.customer_phone}
                      </a>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-bold text-primary">{o.total.toLocaleString()} ج.م</span>
                    <span className="text-xs text-muted-foreground">{formatDate(o.created_at)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">شركة الشحن: {shippingLabel(o)}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* ديسكتوب: جدول مختصر */}
          <Card className="hidden md:block">
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>رقم الأوردر</TableHead>
                    <TableHead>العميل</TableHead>
                    <TableHead>الهاتف</TableHead>
                    <TableHead>الإجمالي</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>شركة الشحن</TableHead>
                    <TableHead>التاريخ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((o) => (
                    <TableRow key={o.id} className={NEEDS_FOLLOWUP.includes(o.status) ? "bg-warning/5" : ""}>
                      <TableCell className="py-2 font-mono text-xs">
                        <Link to={`/orders/${o.id}`} className="text-primary hover:underline">{o.order_number}</Link>
                      </TableCell>
                      <TableCell className="py-2 font-semibold">{o.customer_name}</TableCell>
                      <TableCell className="py-2">
                        {o.customer_phone ? (
                          <a href={`tel:${o.customer_phone}`} className="font-mono text-xs text-primary" dir="ltr">{o.customer_phone}</a>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="py-2 font-bold text-primary">{o.total.toLocaleString()}</TableCell>
                      <TableCell className="py-2"><Badge className={statusColors[o.status] || ""}>{statusLabels[o.status] || o.status}</Badge></TableCell>
                      <TableCell className="py-2 text-xs">{shippingLabel(o)}</TableCell>
                      <TableCell className="py-2 text-xs text-muted-foreground">{formatDate(o.created_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
