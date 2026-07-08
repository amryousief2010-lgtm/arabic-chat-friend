import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import {
  RefreshCw, Loader2, Link2, ExternalLink, ArrowLeft, PackageX,
  AlertTriangle, Info, Wrench, Download, CheckCircle2, XCircle,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { ar } from "date-fns/locale";
import {
  ZODEX_INTEGRATION_START, AGOUZA_WAREHOUSE_ID, NO_BILL_MIN_AGE_HOURS,
  NON_SHIPPABLE_STATUSES,
  scoreCandidate, classifyLinkIssue,
  type MissingBill, type OrderCandidate, type ScoredCandidate, type LinkIssue,
} from "@/lib/zodexClassify";

interface OrderRow {
  id: string;
  order_number: string;
  status: string;
  shipping_bill_no: string | null;
  shipping_company: string | null;
  source_warehouse_id: string | null;
  fulfillment_type: string | null;
  total: number | null;
  created_at: string;
  customers?: { name: string | null; phone: string | null } | null;
}

interface BillWithClassification {
  bill: MissingBill & { zodex_status: string | null };
  bestCandidate: ScoredCandidate | null;
  issue: LinkIssue | null;
  // "orphan" = no candidate found at all (score all < 20)
  isOrphan: boolean;
}

async function findCandidatesForBill(bill: MissingBill): Promise<ScoredCandidate[]> {
  const phone = (bill.customer_phone || "").replace(/\D+/g, "").slice(-9);
  const cod = Number(bill.cod_amount || 0);

  const orClauses: string[] = [];
  if (phone) {
    orClauses.push(`phone.ilike.%${phone}`);
    orClauses.push(`phone2.ilike.%${phone}`);
  }
  if (bill.customer_name) {
    const nm = bill.customer_name.trim().slice(0, 20).replace(/[%,]/g, " ");
    if (nm) orClauses.push(`name.ilike.%${nm}%`);
  }

  let customerIds: string[] = [];
  if (orClauses.length) {
    const { data: custs } = await supabase
      .from("customers")
      .select("id")
      .or(orClauses.join(","))
      .limit(50);
    customerIds = (custs || []).map((c: any) => c.id);
  }

  let query = supabase.from("orders")
    .select("id, order_number, total, created_at, moderator, shipping_bill_no, status, customer:customers(name, phone, phone2)")
    .is("shipping_bill_no", null)
    .order("created_at", { ascending: false })
    .limit(40);

  if (customerIds.length) {
    query = query.in("customer_id", customerIds);
  } else if (cod > 0) {
    query = query.gte("total", cod - 5).lte("total", cod + 5);
  } else {
    return [];
  }

  const { data: orders } = await query;
  return (orders || [])
    .map((o: any) => scoreCandidate(bill, o as OrderCandidate))
    .filter((c) => c.score >= 20)
    .sort((a, b) => b.score - a.score);
}

// pLimit-like helper without deps
async function mapWithLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

interface ZodexBillDetails {
  bill_no: string;
  receiver_name: string | null;
  phone: string | null;
  phone2: string | null;
  region: string | null;
  sub_region: string | null;
  address: string | null;
  cod_amount: number | null;
  status: string | null;
  shipment_date: string | null;
  sender: string | null;
  moderator_name: string | null;
  task_type: string | null;
  notes: string | null;
}

const SHIPPING_FEE = 110; // Zodex adds 110 EGP on non-box orders

function normPhoneCmp(v?: string | null) {
  return (v || "").replace(/\D+/g, "").replace(/^20/, "").slice(-11);
}
function normArabic(v?: string | null) {
  return (v || "")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export default function ZodexReview() {
  const [tab, setTab] = useState("orphan-bills");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [classified, setClassified] = useState<BillWithClassification[]>([]);
  const [noBillOrders, setNoBillOrders] = useState<OrderRow[]>([]);
  const [search, setSearch] = useState("");
  const [fixingId, setFixingId] = useState<string | null>(null);
  const [detailsById, setDetailsById] = useState<Record<string, ZodexBillDetails>>({});
  const [detailsErrById, setDetailsErrById] = useState<Record<string, string>>({});
  const [fetchingId, setFetchingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const minAge = new Date(Date.now() - NO_BILL_MIN_AGE_HOURS * 3600 * 1000).toISOString();

      // 1) Zodex bills pending
      const billsRes = await supabase
        .from("zodex_missing_orders")
        .select("id, bill_no, customer_name, customer_phone, cod_amount, moderator_name, shipment_date, first_seen_at, zodex_status")
        .eq("status", "pending")
        .order("shipment_date", { ascending: false })
        .limit(300);

      if (billsRes.error) throw billsRes.error;
      const bills = (billsRes.data || []) as (MissingBill & { zodex_status: string | null })[];

      // Duplicate bill_no map
      const billNoCount = new Map<string, number>();
      for (const b of bills) {
        billNoCount.set(b.bill_no, (billNoCount.get(b.bill_no) || 0) + 1);
      }

      // 2) Orders that should be on Zodex but have no bill
      // Criteria: after integration cutover, no bill, delivery fulfillment,
      // from Agouza warehouse OR shipping_company mentions zodex,
      // status not cancelled/draft/returned, older than 24h.
      const noBillRes = await supabase
        .from("orders")
        .select("id, order_number, status, shipping_bill_no, shipping_company, source_warehouse_id, fulfillment_type, total, created_at, customers(name, phone)")
        .is("shipping_bill_no", null)
        .gte("created_at", ZODEX_INTEGRATION_START)
        .lte("created_at", minAge)
        .eq("fulfillment_type", "delivery")
        .order("created_at", { ascending: false })
        .limit(500);

      if (noBillRes.error) throw noBillRes.error;

      const filteredNoBill = ((noBillRes.data || []) as any[]).filter((o) => {
        if (NON_SHIPPABLE_STATUSES.has(o.status)) return false;
        // Exclude private courier and other explicit non-zodex companies
        const sc = (o.shipping_company || "").trim();
        if (sc === "مندوب خاص") return false;
        const scLower = sc.toLowerCase();
        if (sc && !/zodex|زودكس/i.test(sc)) {
          // Explicit other shipping company (Bosta, العاصمة...) → not our concern
          return false;
        }
        // At this point sc is either empty or references zodex.
        // Include only Agouza warehouse orders (that's where Zodex ships from) OR explicit zodex.
        if (/zodex|زودكس/i.test(sc)) return true;
        return o.source_warehouse_id === AGOUZA_WAREHOUSE_ID;
      }) as OrderRow[];

      setNoBillOrders(filteredNoBill);

      // 3) Classify each bill (best candidate + link issue)
      const classifiedList = await mapWithLimit(bills, 6, async (b): Promise<BillWithClassification> => {
        const cands = await findCandidatesForBill(b);
        const best = cands[0] || null;
        const dupCount = billNoCount.get(b.bill_no) || 0;
        const issue = classifyLinkIssue(b, best, dupCount);
        return {
          bill: b,
          bestCandidate: best,
          issue,
          isOrphan: !best,
        };
      });

      setClassified(classifiedList);
    } catch (e: any) {
      toast.error(`فشل التحميل: ${e.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const runSync = async () => {
    setSyncing(true);
    try {
      const [ship, del] = await Promise.all([
        supabase.functions.invoke("sync-zodex-shipments", { body: { max_pages: 8 } }),
        supabase.functions.invoke("sync-zodex-deliveries", { body: { lookback_days: 14, max_pages: 5 } }),
      ]);
      const linked = (ship.data as any)?.stats?.linked ?? 0;
      const delivered = (del.data as any)?.delivered_matched ?? 0;
      toast.success(`تمت المزامنة — ربط ${linked} بوليصة • ${delivered} تسليم`);
      await load();
    } catch (e: any) {
      toast.error(`فشلت المزامنة: ${e.message || e}`);
    } finally {
      setSyncing(false);
    }
  };

  const orphanBills = useMemo(
    () => classified.filter((c) => c.isOrphan),
    [classified],
  );
  const linkIssues = useMemo(
    () => classified.filter((c) => c.issue !== null),
    [classified],
  );

  const q = search.trim().toLowerCase();
  const filterBills = (list: BillWithClassification[]) =>
    !q ? list : list.filter((c) =>
      [c.bill.bill_no, c.bill.customer_name, c.bill.customer_phone, c.bill.moderator_name]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q)),
    );
  const filteredOrders = !q ? noBillOrders : noBillOrders.filter((o) =>
    o.order_number?.toLowerCase().includes(q) ||
    (o.customers?.name || "").toLowerCase().includes(q) ||
    (o.customers?.phone || "").includes(search.trim()),
  );

  const doFix = async (item: BillWithClassification) => {
    if (!item.bestCandidate) return;
    setFixingId(item.bill.id);
    try {
      const { data, error } = await supabase.rpc("link_zodex_bill_to_order", {
        p_bill_no: item.bill.bill_no,
        p_order_id: item.bestCandidate.id,
        p_missing_id: item.bill.id,
        p_match_score: item.bestCandidate.score,
        p_match_reason: `[إصلاح ربط] ${item.bestCandidate.reasons.join(" • ")}`,
      });
      if (error) throw error;
      const res = data as any;
      if (res && res.ok === false) throw new Error(res.error || "فشل الإصلاح");
      toast.success(`تم ربط ${item.bill.bill_no} بالأوردر ${item.bestCandidate.order_number}`);
      // Optimistic removal
      setClassified((s) => s.filter((c) => c.bill.id !== item.bill.id));
    } catch (e: any) {
      toast.error(`فشل الإصلاح: ${e.message || e}`);
    } finally {
      setFixingId(null);
    }
  };

  const fetchZodexDetails = async (item: BillWithClassification) => {
    setFetchingId(item.bill.id);
    setDetailsErrById((s) => ({ ...s, [item.bill.id]: "" }));
    setExpandedId(item.bill.id);
    try {
      const { data, error } = await supabase.functions.invoke("zodex-bill-details", {
        body: { bill_no: item.bill.bill_no },
      });
      if (error) throw error;
      const res = data as any;
      if (!res?.success) throw new Error(res?.error || "فشل جلب البيانات");
      setDetailsById((s) => ({ ...s, [item.bill.id]: res.details }));
    } catch (e: any) {
      const msg = e?.message || String(e);
      setDetailsErrById((s) => ({ ...s, [item.bill.id]: msg }));
      toast.error(`فشل جلب بيانات زودكس: ${msg}`);
    } finally {
      setFetchingId(null);
    }
  };

  return (
    <div dir="rtl" className="container mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link to="/modules/warehouses">
                <ArrowLeft className="h-4 w-4 ml-1" />
                رجوع
              </Link>
            </Button>
            <h1 className="text-2xl font-bold">مراجعة زودكس</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            فرق حقيقية بين نظامنا وزودكس — بوالص مفقودة عندنا، أوردرات مفقودة على زودكس، ومشاكل ربط تحتاج إصلاح.
          </p>
        </div>
        <Button onClick={runSync} disabled={syncing} className="gap-1">
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          مزامنة الآن
        </Button>
      </div>

      <Alert className="border-primary/30 bg-primary/5">
        <Info className="h-4 w-4 text-primary" />
        <AlertTitle className="text-primary">هدف الشاشة</AlertTitle>
        <AlertDescription className="text-sm">
          مش قائمة بوالص للربط اليدوي — دي أداة مراجعة توضح فقط الحالات اللي محتاجة تدخل: بوالص مش عندنا، أوردرات مش على زودكس، أو الاتنين موجودين لكن الربط فشل لسبب واضح.
        </AlertDescription>
      </Alert>

      <Input
        placeholder="ابحث برقم بوليصة / أوردر / اسم / موبايل"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-md"
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="orphan-bills" className="gap-2">
            <PackageX className="h-4 w-4" />
            بوالص زودكس مش عندنا
            <Badge variant="secondary" className="mr-1">{orphanBills.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="no-bill-orders" className="gap-2">
            <PackageX className="h-4 w-4" />
            أوردرات عندنا مش على زودكس
            <Badge variant="secondary" className="mr-1">{noBillOrders.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="link-issues" className="gap-2">
            <AlertTriangle className="h-4 w-4" />
            مشاكل الربط
            <Badge variant="destructive" className="mr-1">{linkIssues.length}</Badge>
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Orphan bills — nothing matches in our system */}
        <TabsContent value="orphan-bills">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">بوالص على زودكس بدون أي أوردر مطابق عندنا</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                يعني الأوردر غالبًا اتسجل يدويًا على زودكس ومش موجود في النظام أصلًا — يحتاج إنشاء أوردر مقابل.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
              ) : filterBills(orphanBills).length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  {orphanBills.length === 0 ? "مفيش بوالص يتيمة ✔" : "لا توجد نتائج"}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>رقم البوليصة</TableHead>
                      <TableHead>العميل</TableHead>
                      <TableHead>الموبايل</TableHead>
                      <TableHead>COD</TableHead>
                      <TableHead>الموديريتور</TableHead>
                      <TableHead>تاريخ الشحن</TableHead>
                      <TableHead>زودكس</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filterBills(orphanBills).map((c) => (
                      <TableRow key={c.bill.id}>
                        <TableCell className="font-mono text-xs" dir="ltr">
                          <a
                            href={`https://zodex-eg.com/admin-area/shippings.php?action=details&waybill=${c.bill.bill_no}`}
                            target="_blank" rel="noreferrer"
                            className="inline-flex items-center gap-1 text-primary hover:underline"
                            title="فتح تفاصيل البوليصة على زودكس"
                          >
                            {c.bill.bill_no}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </TableCell>
                        <TableCell>{c.bill.customer_name || "—"}</TableCell>
                        <TableCell className="font-mono text-xs" dir="ltr">{c.bill.customer_phone || "—"}</TableCell>
                        <TableCell>{c.bill.cod_amount ? `${Number(c.bill.cod_amount).toLocaleString("ar-EG")} ج` : "—"}</TableCell>
                        <TableCell className="text-xs">{c.bill.moderator_name || "—"}</TableCell>
                        <TableCell className="text-xs">
                          {c.bill.shipment_date ? format(new Date(c.bill.shipment_date), "yyyy-MM-dd") : "—"}
                        </TableCell>
                        <TableCell>
                          <a
                            href={`https://zodex-eg.com/admin-area/shippings.php?action=details&waybill=${c.bill.bill_no}`}
                            target="_blank" rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                          >
                            فتح <ExternalLink className="h-3 w-3" />
                          </a>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 2: Orders that should be on Zodex but have no bill */}
        <TabsContent value="no-bill-orders">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                أوردرات مخزن العجوزة/زودكس بدون بوليصة (أقدم من {NO_BILL_MIN_AGE_HOURS} ساعة)
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                أوردرات المفروض تشحن عبر زودكس لكن مفيش بوليصة مقابلة على موقع زودكس — يحتاج تسجيلها يدويًا على زودكس.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
              ) : filteredOrders.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  {noBillOrders.length === 0 ? "كل أوردرات زودكس متسجلة ✔" : "لا توجد نتائج"}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>رقم الأوردر</TableHead>
                      <TableHead>العميل</TableHead>
                      <TableHead>الموبايل</TableHead>
                      <TableHead>الإجمالي</TableHead>
                      <TableHead>الحالة</TableHead>
                      <TableHead>عمر الأوردر</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredOrders.map((o) => (
                      <TableRow key={o.id}>
                        <TableCell className="font-mono text-xs">{o.order_number}</TableCell>
                        <TableCell>{o.customers?.name || "—"}</TableCell>
                        <TableCell className="font-mono text-xs" dir="ltr">{o.customers?.phone || "—"}</TableCell>
                        <TableCell>{Number(o.total || 0).toLocaleString("ar-EG")} ج</TableCell>
                        <TableCell><Badge variant="outline">{o.status}</Badge></TableCell>
                        <TableCell className="text-xs">
                          {formatDistanceToNow(new Date(o.created_at), { locale: ar, addSuffix: true })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 3: Link issues */}
        <TabsContent value="link-issues">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">مشاكل الربط بين البوليصة والأوردر</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                الاتنين موجودين — البوليصة على زودكس والأوردر عندنا — لكن الربط فشل. راجع السبب واصلحه من الجذر.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
              ) : filterBills(linkIssues).length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  {linkIssues.length === 0 ? "مفيش مشاكل ربط ✔" : "لا توجد نتائج"}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>البوليصة</TableHead>
                      <TableHead>الأوردر المطابق</TableHead>
                      <TableHead>السبب</TableHead>
                      <TableHead>التفاصيل</TableHead>
                      <TableHead>إجراء</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filterBills(linkIssues).map((c) => {
                      const zd = detailsById[c.bill.id];
                      const zErr = detailsErrById[c.bill.id];
                      const isExpanded = expandedId === c.bill.id;
                      // Post-fetch scoring vs bestCandidate using +110 rule
                      const cand = c.bestCandidate;
                      const cmp = zd && cand ? (() => {
                        const zp = normPhoneCmp(zd.phone);
                        const zp2 = normPhoneCmp(zd.phone2);
                        const cp = normPhoneCmp(cand.customer?.phone);
                        const cp2 = normPhoneCmp(cand.customer?.phone2);
                        const phoneMatch = !!zp && (zp === cp || zp === cp2 || zp2 === cp || zp2 === cp2);
                        const zn = normArabic(zd.receiver_name);
                        const cn = normArabic(cand.customer?.name);
                        const nameMatch = !!zn && !!cn && (zn === cn || zn.includes(cn) || cn.includes(zn));
                        const cod = Number(zd.cod_amount || 0);
                        const total = Number(cand.total || 0);
                        const raw = Math.abs(cod - total);
                        const ship = Math.abs(cod - total - SHIPPING_FEE);
                        const amountMatch = cod > 0 && total > 0 && (raw < 0.5 || ship < 0.5);
                        const amountViaShipping = amountMatch && ship < raw;
                        const strongMatch = phoneMatch && amountMatch;
                        return { phoneMatch, nameMatch, amountMatch, amountViaShipping, strongMatch, cod, total };
                      })() : null;
                      const canForceFix = !!(cmp?.strongMatch && cand && !cand.shipping_bill_no);

                      return (
                        <Fragment key={c.bill.id}>
                          <TableRow>

                            <TableCell className="font-mono text-xs" dir="ltr">
                              <button
                                onClick={() => (isExpanded ? setExpandedId(null) : fetchZodexDetails(c))}
                                className="inline-flex items-center gap-1 text-primary hover:underline"
                                title="اسحب تفاصيل البوليصة من زودكس تلقائيًا"
                              >
                                {c.bill.bill_no}
                                {fetchingId === c.bill.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Download className="h-3 w-3" />
                                )}
                              </button>
                              <a
                                href={`https://zodex-eg.com/admin-area/shippings.php?action=details&waybill=${c.bill.bill_no}`}
                                target="_blank" rel="noreferrer"
                                className="inline-flex items-center gap-1 text-muted-foreground hover:underline text-[10px] mr-2"
                                title="فتح على زودكس"
                              >
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            </TableCell>
                            <TableCell className="text-xs">
                              {cand ? (
                                <div>
                                  <Link
                                    to={`/orders/${cand.id}`}
                                    target="_blank"
                                    className="font-mono text-primary hover:underline inline-flex items-center gap-1"
                                    title="فتح تفاصيل الأوردر عندنا"
                                  >
                                    {cand.order_number}
                                    <ExternalLink className="h-3 w-3" />
                                  </Link>
                                  <div className="text-muted-foreground mt-0.5">
                                    {cand.customer?.name} • {Number(cand.total || 0).toLocaleString("ar-EG")} ج
                                  </div>
                                </div>
                              ) : "—"}
                            </TableCell>
                            <TableCell>
                              <Badge variant={c.issue?.fixable || canForceFix ? "default" : "destructive"}>
                                {c.issue?.label}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-xs">
                              {c.issue?.detail}
                            </TableCell>
                            <TableCell>
                              {c.issue?.fixable || canForceFix ? (
                                <Button
                                  size="sm"
                                  onClick={() => doFix(c)}
                                  disabled={fixingId === c.bill.id}
                                  className="gap-1"
                                >
                                  {fixingId === c.bill.id ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Wrench className="h-3.5 w-3.5" />
                                  )}
                                  إصلاح الربط
                                </Button>
                              ) : (
                                <span className="text-xs text-muted-foreground">اسحب زودكس للتأكيد</span>
                              )}
                            </TableCell>
                          </TableRow>
                          {isExpanded && (
                            <TableRow key={`${c.bill.id}-details`}>
                              <TableCell colSpan={5} className="bg-muted/30">
                                {fetchingId === c.bill.id ? (
                                  <div className="flex items-center gap-2 text-sm p-2">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    جاري جلب تفاصيل البوليصة من زودكس...
                                  </div>
                                ) : zErr ? (
                                  <div className="p-2 space-y-2">
                                    <Alert variant="destructive">
                                      <AlertTriangle className="h-4 w-4" />
                                      <AlertTitle>فشل جلب البيانات من زودكس</AlertTitle>
                                      <AlertDescription className="text-xs">{zErr}</AlertDescription>
                                    </Alert>
                                    <Button size="sm" variant="outline" onClick={() => fetchZodexDetails(c)}>
                                      <RefreshCw className="h-3.5 w-3.5 ml-1" />
                                      إعادة جلب بيانات زودكس
                                    </Button>
                                  </div>
                                ) : zd ? (
                                  <div className="grid md:grid-cols-2 gap-3 p-2">
                                    <div className="rounded border bg-background p-3 text-xs space-y-1">
                                      <div className="font-semibold text-sm mb-2 flex items-center gap-2">
                                        <Download className="h-4 w-4" /> بيانات زودكس
                                      </div>
                                      <div><span className="text-muted-foreground">الاسم:</span> {zd.receiver_name || "—"}</div>
                                      <div dir="ltr"><span className="text-muted-foreground">الموبايل:</span> {zd.phone || "—"}{zd.phone2 ? ` / ${zd.phone2}` : ""}</div>
                                      <div><span className="text-muted-foreground">المنطقة:</span> {[zd.region, zd.sub_region].filter(Boolean).join(" — ") || "—"}</div>
                                      <div><span className="text-muted-foreground">القيمة:</span> {zd.cod_amount != null ? `${Number(zd.cod_amount).toLocaleString("ar-EG")} ج` : "—"}</div>
                                      <div><span className="text-muted-foreground">الحالة:</span> {zd.status || "—"}</div>
                                      <div><span className="text-muted-foreground">التاريخ:</span> {zd.shipment_date || "—"}</div>
                                      {zd.sender && <div><span className="text-muted-foreground">الراسل:</span> {zd.sender}</div>}
                                      {zd.task_type && <div><span className="text-muted-foreground">نوع التاسك:</span> {zd.task_type}</div>}
                                    </div>
                                    <div className="rounded border bg-background p-3 text-xs space-y-1">
                                      <div className="font-semibold text-sm mb-2">مقارنة مع الأوردر {cand?.order_number}</div>
                                      {cmp ? (
                                        <>
                                          <div className="flex items-center gap-2">
                                            {cmp.phoneMatch ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-destructive" />}
                                            <span>الموبايل {cmp.phoneMatch ? "مطابق" : "مختلف"}</span>
                                          </div>
                                          <div className="flex items-center gap-2">
                                            {cmp.nameMatch ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-muted-foreground" />}
                                            <span>الاسم {cmp.nameMatch ? "مطابق" : "مختلف"}</span>
                                          </div>
                                          <div className="flex items-center gap-2">
                                            {cmp.amountMatch ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-destructive" />}
                                            <span>
                                              القيمة {cmp.amountMatch ? "مطابقة" : "مختلفة"}
                                              {cmp.amountViaShipping && " (بعد إضافة 110 ج شحن زودكس)"}
                                            </span>
                                          </div>
                                          <div className="text-muted-foreground pt-1 border-t mt-2">
                                            زودكس: {cmp.cod.toLocaleString("ar-EG")} ج • الأوردر: {cmp.total.toLocaleString("ar-EG")} ج
                                            {cmp.amountViaShipping && ` • ${cmp.total.toLocaleString("ar-EG")} + 110 = ${(cmp.total + SHIPPING_FEE).toLocaleString("ar-EG")}`}
                                          </div>
                                          {cmp.strongMatch && (
                                            <Alert className="mt-2">
                                              <CheckCircle2 className="h-4 w-4" />
                                              <AlertDescription className="text-xs">
                                                التطابق قوي — اضغط "إصلاح الربط" لحفظ البوليصة داخل الأوردر.
                                              </AlertDescription>
                                            </Alert>
                                          )}
                                        </>
                                      ) : (
                                        <div className="text-muted-foreground">مفيش أوردر مرشح للمقارنة.</div>
                                      )}
                                    </div>
                                  </div>
                                ) : null}
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
