import { useEffect, useMemo, useState } from "react";
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
import { toast } from "sonner";
import {
  RefreshCw, Loader2, Link2, ExternalLink, AlertTriangle, PackageX, ArrowLeft,
} from "lucide-react";
import { RelinkBillDialog } from "@/components/warehouses/RelinkBillDialog";
import { formatDistanceToNow } from "date-fns";
import { ar } from "date-fns/locale";

// Only orders after main-warehouse cutover are expected to have Zodex bills.
const MAIN_WAREHOUSE_START = "2026-07-01T00:00:00+02:00";
const NO_BILL_MIN_AGE_HOURS = 24;

interface OrderRow {
  id: string;
  order_number: string;
  status: string;
  shipping_bill_no: string | null;
  total: number | null;
  created_at: string;
  customer_id: string | null;
  customers?: { name: string | null; phone: string | null } | null;
}

interface MissingRow {
  id: string;
  bill_no: string;
  customer_name: string | null;
  customer_phone: string | null;
  cod_amount: number | null;
  zodex_status: string | null;
  first_seen_at: string;
}

export default function ZodexIncompleteOrders() {
  const [tab, setTab] = useState("no-bill");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [noBillOrders, setNoBillOrders] = useState<OrderRow[]>([]);
  const [missingRows, setMissingRows] = useState<MissingRow[]>([]);
  const [relinkOrder, setRelinkOrder] = useState<OrderRow | null>(null);
  const [search, setSearch] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const minAge = new Date(Date.now() - NO_BILL_MIN_AGE_HOURS * 3600 * 1000).toISOString();

      const [noBillRes, missingRes] = await Promise.all([
        supabase
          .from("orders")
          .select("id, order_number, status, shipping_bill_no, total, created_at, customer_id, customers(name, phone)")
          .is("shipping_bill_no", null)
          .gte("created_at", MAIN_WAREHOUSE_START)
          .lte("created_at", minAge)
          .not("status", "in", "(cancelled,ملغى,ملغي)")
          .order("created_at", { ascending: false })
          .limit(500),
        supabase
          .from("zodex_missing_orders")
          .select("id, bill_no, customer_name, customer_phone, cod_amount, zodex_status, first_seen_at")
          .eq("status", "pending")
          .order("first_seen_at", { ascending: false })
          .limit(500),
      ]);

      if (noBillRes.error) throw noBillRes.error;
      if (missingRes.error) throw missingRes.error;

      setNoBillOrders((noBillRes.data as any) || []);
      setMissingRows((missingRes.data as any) || []);
    } catch (e: any) {
      toast.error(`فشل التحميل: ${e.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const runSync = async () => {
    setSyncing(true);
    try {
      const [ship, del] = await Promise.all([
        supabase.functions.invoke("sync-zodex-shipments", { body: { max_pages: 8 } }),
        supabase.functions.invoke("sync-zodex-deliveries", { body: { lookback_days: 14, max_pages: 5 } }),
      ]);
      const linked = (ship.data as any)?.stats?.linked ?? 0;
      const delivered = (del.data as any)?.delivered_matched ?? 0;
      toast.success(`تمت المزامنة — ربط ${linked} بوليصة جديدة • ${delivered} تسليم`);
      await load();
    } catch (e: any) {
      toast.error(`فشلت المزامنة: ${e.message || e}`);
    } finally {
      setSyncing(false);
    }
  };

  const filteredNoBill = useMemo(() => {
    const q = search.trim();
    if (!q) return noBillOrders;
    const qq = q.toLowerCase();
    return noBillOrders.filter((o) =>
      o.order_number?.toLowerCase().includes(qq) ||
      (o.customers?.name || "").toLowerCase().includes(qq) ||
      (o.customers?.phone || "").includes(q),
    );
  }, [noBillOrders, search]);

  const filteredMissing = useMemo(() => {
    const q = search.trim();
    if (!q) return missingRows;
    const qq = q.toLowerCase();
    return missingRows.filter((m) =>
      m.bill_no?.toLowerCase().includes(qq) ||
      (m.customer_name || "").toLowerCase().includes(qq) ||
      (m.customer_phone || "").includes(q),
    );
  }, [missingRows, search]);

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
            <h1 className="text-2xl font-bold">أوردرات زودكس غير مكتملة</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            متابعة الأوردرات اللي لسه مالهاش بوليصة على زودكس، والبوالص اللي فشل ربطها بأوردر عندنا.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={runSync} disabled={syncing} className="gap-1">
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            مزامنة الآن
          </Button>
          <Button asChild variant="outline">
            <Link to="/modules/warehouses/zodex-missing">
              الأوردرات المفقودة
              <ExternalLink className="h-4 w-4 mr-1" />
            </Link>
          </Button>
        </div>
      </div>

      <Card className="border-amber-200 bg-amber-50/40">
        <CardContent className="p-3 text-sm text-amber-900 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <div>
            تكامل زودكس <b>قراءة فقط</b> (بيسحب البوالص من موقع زودكس). لو أوردر مفيهوش بوليصة معناه إما لسه ماتسجلش يدوي على زودكس، أو المطابقة فشلت (مثلاً موبايل مختلف / مبلغ COD مختلف). استخدم زرار «ربط يدوي» لو الرقم متوفر.
          </div>
        </CardContent>
      </Card>

      <div>
        <Input
          placeholder="ابحث برقم الأوردر / اسم العميل / الموبايل / رقم البوليصة"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
        />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="no-bill" className="gap-2">
            <PackageX className="h-4 w-4" />
            بدون بوليصة
            <Badge variant="secondary" className="mr-1">{noBillOrders.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="failed-link" className="gap-2">
            <Link2 className="h-4 w-4" />
            بوالص بدون أوردر
            <Badge variant="secondary" className="mr-1">{missingRows.length}</Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="no-bill">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                أوردرات عدى عليها أكتر من {NO_BILL_MIN_AGE_HOURS} ساعة بدون بوليصة زودكس
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-8 text-center text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                </div>
              ) : filteredNoBill.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  {noBillOrders.length === 0 ? "كل الأوردرات ليها بوليصة ✔" : "لا توجد نتائج للبحث"}
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
                      <TableHead>إجراءات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredNoBill.map((o) => (
                      <TableRow key={o.id}>
                        <TableCell className="font-mono text-xs">{o.order_number}</TableCell>
                        <TableCell>{o.customers?.name || "—"}</TableCell>
                        <TableCell className="font-mono text-xs" dir="ltr">
                          {o.customers?.phone || "—"}
                        </TableCell>
                        <TableCell>{Number(o.total || 0).toLocaleString("ar-EG")} ج</TableCell>
                        <TableCell>
                          <Badge variant="outline">{o.status}</Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {formatDistanceToNow(new Date(o.created_at), { locale: ar, addSuffix: true })}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setRelinkOrder(o)}
                            className="gap-1"
                          >
                            <Link2 className="h-3.5 w-3.5" />
                            ربط بوليصة
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="failed-link">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                بوالص ظهرت على زودكس ومقدرناش نلاقيلها أوردر عندنا
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-8 text-center text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                </div>
              ) : filteredMissing.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  لا توجد بوالص معلقة ✔
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>رقم البوليصة</TableHead>
                      <TableHead>العميل</TableHead>
                      <TableHead>الموبايل</TableHead>
                      <TableHead>COD</TableHead>
                      <TableHead>حالة زودكس</TableHead>
                      <TableHead>أول ظهور</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredMissing.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell className="font-mono text-xs" dir="ltr">{m.bill_no}</TableCell>
                        <TableCell>{m.customer_name || "—"}</TableCell>
                        <TableCell className="font-mono text-xs" dir="ltr">
                          {m.customer_phone || "—"}
                        </TableCell>
                        <TableCell>
                          {m.cod_amount ? `${Number(m.cod_amount).toLocaleString("ar-EG")} ج` : "—"}
                        </TableCell>
                        <TableCell className="text-xs">{m.zodex_status || "—"}</TableCell>
                        <TableCell className="text-xs">
                          {formatDistanceToNow(new Date(m.first_seen_at), { locale: ar, addSuffix: true })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <div className="p-3 border-t bg-muted/30 text-xs text-muted-foreground text-center">
                للحل التفصيلي (اقتراح أوردر مطابق يدويًا)، افتح صفحة{" "}
                <Link to="/modules/warehouses/zodex-missing" className="text-primary underline">
                  الأوردرات المفقودة
                </Link>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {relinkOrder && (
        <RelinkBillDialog
          open={!!relinkOrder}
          onOpenChange={(v) => !v && setRelinkOrder(null)}
          order={relinkOrder}
          onLinked={load}
        />
      )}
    </div>
  );
}
