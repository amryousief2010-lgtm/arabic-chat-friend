import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Phone, Copy, ExternalLink, MapPin, Truck, Eye, RotateCcw, Filter, ShoppingCart, TrendingUp, Clock,
} from "lucide-react";
import { toast } from "sonner";
import { formatDate } from "@/lib/dateFormat";
import { summarizeOrderItems } from "@/lib/orderItemSummary";
import { governorateId, governorateLabel } from "@/lib/governorates";
import { ModeratorConfig, matchesModeratorGroup, normalizeAr } from "@/constants/moderators";
import { cairoTodayStartUTC, cairoMonthStartUTC, currentCairoYearMonth, toCairoDateString } from "@/lib/cairoDate";

// عرض موحّد لملخص توصيل الأوردرات — للعرض فقط (لا تعديل على أي بيانات).
// يُستخدم في: صفحة "ملخص توصيل الأوردرات" لكل مسوقة، وصفحة "مراجعة أوردرات هاجر" لنورا.

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

const MASS = ["كجم", "كيلو", "كيلوجرام", "kg", "جم", "جرام", "g"];
const fmtQty = (q: number, unit?: string | null) => {
  const isMass = MASS.includes((unit || "").trim().toLowerCase());
  const n = q % 1 === 0 ? String(q) : String(+q.toFixed(2));
  return isMass ? `${n} ك` : unit ? `${n} ${unit}` : n;
};

const normalize = (s: string) => normalizeAr(String(s || "").toLowerCase());

interface OrderRow {
  id: string;
  order_number: string;
  status: string;
  total: number;
  created_at: string;
  moderator: string | null;
  shipping_company: string | null;
  shipping_bill_no: string | null;
  fulfillment_type: string | null;
  source_warehouse_id: string | null;
  source_warehouse_name: string | null;
  customer_name: string;
  customer_phone: string;
  customer_phone2: string | null;
  governorate: string | null;
  items: { id: string; product_id: string | null; product_name: string; quantity: number; unit_price: number; total_price: number; unit: string | null; offer_name: string | null }[];
}

const deliveryChannel = (o: OrderRow): string => {
  const wh = o.source_warehouse_name || "";
  if (wh) {
    const prefix = o.fulfillment_type === "pickup" ? "استلام: " : o.fulfillment_type === "delivery" ? "توصيل: " : "";
    return `${prefix}${wh}`;
  }
  if (o.shipping_company) return o.shipping_company;
  return "غير محدد";
};

const isShippingCompany = (o: OrderRow) =>
  !!o.shipping_company && !normalize(o.shipping_company).includes(normalize("مندوب خاص"));

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
  const [selected, setSelected] = useState<OrderRow | null>(null);

  // فلاتر (draft يُطبَّق عند الضغط على "تطبيق الفلاتر")
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
      // فلترة على مستوى الاستعلام: أوردرات المسوقة فقط (أو مجموعة المراجعة)
      let query = supabase
        .from("orders")
        .select(
          "id, order_number, status, total, created_at, moderator, shipping_company, shipping_bill_no, fulfillment_type, source_warehouse_id, created_by, customers(name, phone, phone2, governorate)",
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
      // تأكيد على مستوى التطبيق أيضاً (طبقة ثانية فوق فلترة الاستعلام)
      if (moderator) {
        rows = rows.filter((o) =>
          matchesModeratorGroup(o.moderator, moderator.canonicalModerator) ||
          (mode === "own" && !o.moderator && o.created_by === userId),
        );
      }

      const ids = rows.map((o) => o.id);
      const itemsByOrder: Record<string, any[]> = {};
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200);
        if (!chunk.length) break;
        const { data: its } = await supabase
          .from("order_items")
          .select("id, order_id, product_id, product_name, quantity, unit_price, total_price, offer_name")
          .in("order_id", chunk);
        (its || []).forEach((it: any) => {
          (itemsByOrder[it.order_id] ||= []).push(it);
        });
      }

      const productIds = Array.from(new Set(Object.values(itemsByOrder).flat().map((it: any) => it.product_id).filter(Boolean)));
      const unitsMap: Record<string, string> = {};
      for (let i = 0; i < productIds.length; i += 200) {
        const { data: prods } = await supabase.from("products").select("id, unit").in("id", productIds.slice(i, i + 200) as string[]);
        (prods || []).forEach((p: any) => { unitsMap[p.id] = p.unit; });
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
        shipping_bill_no: o.shipping_bill_no,
        fulfillment_type: o.fulfillment_type,
        source_warehouse_id: o.source_warehouse_id,
        source_warehouse_name: o.source_warehouse_id ? whMap[o.source_warehouse_id] || null : null,
        customer_name: o.customers?.name || "—",
        customer_phone: o.customers?.phone || "",
        customer_phone2: o.customers?.phone2 || null,
        governorate: o.customers?.governorate || null,
        items: (itemsByOrder[o.id] || []).map((it: any) => ({
          id: it.id,
          product_id: it.product_id ?? null,
          product_name: it.product_name,
          quantity: Number(it.quantity),
          unit_price: Number(it.unit_price),
          total_price: Number(it.total_price),
          unit: (it.product_id && unitsMap[it.product_id]) || "كجم",
          offer_name: it.offer_name ?? null,
        })),
      }));

      if (!cancelled) { setOrders(mapped); setLoading(false); }
    };
    load();
    return () => { cancelled = true; };
  }, [range.from, range.to, moderator, mode, userId]);

  const channels = useMemo(() => {
    const set = new Set<string>();
    orders.forEach((o) => set.add(deliveryChannel(o)));
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
      if (applied.channel !== "all" && deliveryChannel(o) !== applied.channel) return false;
      if (!q) return true;
      const digits = applied.q.replace(/\D/g, "");
      return (
        normalize(o.order_number).includes(q) ||
        normalize(o.customer_name).includes(q) ||
        normalize(o.shipping_bill_no || "").includes(q) ||
        (!!digits && ((o.customer_phone || "").includes(digits) || (o.customer_phone2 || "").includes(digits)))
      );
    });
  }, [orders, applied]);

  const totalValue = visible.reduce((s, o) => s + o.total, 0);
  const followUp = visible.filter((o) => NEEDS_FOLLOWUP.includes(o.status)).length;

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("تم النسخ");
    } catch { toast.error("تعذّر النسخ"); }
  };

  const trackUrl = (o: OrderRow) =>
    o.shipping_bill_no && normalize(o.shipping_company || "").includes("زودكس")
      ? `https://zodex-eg.com/admin-area/shippings.php?action=details&waybill=${o.shipping_bill_no}`
      : null;

  const ItemsSummary = ({ o, className }: { o: OrderRow; className?: string }) => {
    const summary = summarizeOrderItems(o.items);
    if (!summary.length) return null;
    return (
      <div className={`flex flex-wrap gap-1 ${className || ""}`}>
        {summary.map((s) => (
          <Badge key={s.key} variant="secondary" className="text-[11px] font-normal">
            {fmtQty(s.quantity, s.unit)} {s.product_name}
          </Badge>
        ))}
      </div>
    );
  };

  const BillCell = ({ o, mobile }: { o: OrderRow; mobile?: boolean }) => {
    if (!isShippingCompany(o)) {
      return mobile ? null : <span className="text-muted-foreground text-xs">لا توجد بوليصة</span>;
    }
    if (!o.shipping_bill_no) {
      return <span className="text-xs text-destructive">لم تُسجّل البوليصة</span>;
    }
    const url = trackUrl(o);
    return (
      <div className="flex items-center gap-1 flex-wrap" dir="ltr">
        <span className="font-mono text-xs select-all">{o.shipping_bill_no}</span>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => copy(o.shipping_bill_no!)} title="نسخ">
          <Copy className="w-3.5 h-3.5" />
        </Button>
        {url && (
          <a href={url} target="_blank" rel="noreferrer" title="تتبع الشحنة">
            <Button size="icon" variant="ghost" className="h-7 w-7"><ExternalLink className="w-3.5 h-3.5" /></Button>
          </a>
        )}
      </div>
    );
  };

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
              <Label className="text-xs">شركة الشحن / جهة التوصيل</Label>
              <Select value={draft.channel} onValueChange={(v) => setDraft({ ...draft, channel: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {channels.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">بحث (رقم الأوردر / العميل / الهاتف / البوليصة)</Label>
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
          {/* موبايل: بطاقات رأسية */}
          <div className="space-y-3 md:hidden">
            {visible.map((o) => (
              <Card key={o.id} className={NEEDS_FOLLOWUP.includes(o.status) ? "border-warning/60" : ""}>
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold break-all">{o.order_number}</span>
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
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground flex-wrap">
                    <span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {o.governorate || "—"}</span>
                    <span className="inline-flex items-center gap-1"><Truck className="w-3.5 h-3.5" /> {deliveryChannel(o)}</span>
                  </div>
                  {isShippingCompany(o) && <BillCell o={o} mobile />}
                  <ItemsSummary o={o} />
                  <Button size="sm" variant="outline" className="w-full" onClick={() => setSelected(o)}>
                    <Eye className="w-4 h-4 ml-1" /> عرض التفاصيل
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* ديسكتوب: جدول */}
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
                    <TableHead>المحافظة</TableHead>
                    <TableHead>شركة الشحن / جهة التوصيل</TableHead>
                    <TableHead>رقم البوليصة</TableHead>
                    <TableHead>التاريخ</TableHead>
                    <TableHead>المحتويات</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((o) => (
                    <TableRow key={o.id} className={NEEDS_FOLLOWUP.includes(o.status) ? "bg-warning/5" : ""}>
                      <TableCell className="font-mono text-xs">{o.order_number}</TableCell>
                      <TableCell className="font-semibold">{o.customer_name}</TableCell>
                      <TableCell>
                        {o.customer_phone ? (
                          <a href={`tel:${o.customer_phone}`} className="font-mono text-xs text-primary" dir="ltr">{o.customer_phone}</a>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="font-bold text-primary">{o.total.toLocaleString()}</TableCell>
                      <TableCell><Badge className={statusColors[o.status] || ""}>{statusLabels[o.status] || o.status}</Badge></TableCell>
                      <TableCell className="text-xs">{o.governorate || "—"}</TableCell>
                      <TableCell className="text-xs">{deliveryChannel(o)}</TableCell>
                      <TableCell><BillCell o={o} /></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDate(o.created_at)}</TableCell>
                      <TableCell className="max-w-[240px]"><ItemsSummary o={o} /></TableCell>
                      <TableCell>
                        <Button size="sm" variant="outline" onClick={() => setSelected(o)}>
                          <Eye className="w-3.5 h-3.5 ml-1" /> التفاصيل
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      {/* تفاصيل الأوردر — الأسطر منفصلة بأسعارها الأصلية بدون أي دمج */}
      <Dialog open={!!selected} onOpenChange={(v) => !v && setSelected(null)}>
        <DialogContent dir="rtl" className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-mono text-sm">{selected?.order_number}</DialogTitle></DialogHeader>
          {selected && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-muted-foreground">العميل: </span>{selected.customer_name}</div>
                <div dir="ltr" className="text-right"><a href={`tel:${selected.customer_phone}`} className="text-primary font-mono">{selected.customer_phone}</a></div>
                <div><span className="text-muted-foreground">المحافظة: </span>{selected.governorate || "—"}</div>
                <div><span className="text-muted-foreground">التوصيل: </span>{deliveryChannel(selected)}</div>
                <div><span className="text-muted-foreground">التاريخ: </span>{formatDate(selected.created_at)}</div>
                <div><Badge className={statusColors[selected.status] || ""}>{statusLabels[selected.status] || selected.status}</Badge></div>
              </div>
              {isShippingCompany(selected) && <div className="flex items-center gap-2"><span className="text-muted-foreground text-xs">رقم البوليصة:</span><BillCell o={selected} /></div>}
              <div className="border rounded-lg divide-y">
                {selected.items.map((it) => (
                  <div key={it.id} className="p-2 flex items-center justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{it.product_name}</div>
                      {it.offer_name && <div className="text-[11px] text-muted-foreground">{it.offer_name}</div>}
                    </div>
                    <div className="text-left whitespace-nowrap">
                      <div>{fmtQty(it.quantity, it.unit)} × {it.unit_price.toLocaleString()}</div>
                      <div className="font-semibold">{it.total_price.toLocaleString()} ج.م</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between font-bold">
                <span>إجمالي الأوردر</span>
                <span className="text-primary">{selected.total.toLocaleString()} ج.م</span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
