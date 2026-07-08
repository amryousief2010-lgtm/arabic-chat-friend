import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { normalizePhone } from "@/lib/normalizePhone";
import { exportCSV } from "@/lib/csvExport";
import { toast } from "sonner";
import { MessageCircle, Download, Copy, Filter, Users, PhoneCall } from "lucide-react";

// Keywords that mark a customer as opted-out from WhatsApp marketing.
const OPT_OUT_PATTERNS = [
  /لا\s*ترسل/i,
  /لا\s*تراسل/i,
  /رفض\s*الرسائل/i,
  /رفض\s*واتساب/i,
  /opt.?out/i,
  /unsubscribe/i,
  /do.?not.?contact/i,
  /no.?whatsapp/i,
];

const isOptedOut = (notes?: string | null) => {
  if (!notes) return false;
  return OPT_OUT_PATTERNS.some((rx) => rx.test(notes));
};

// Convert an Egyptian local number (01xxxxxxxxx) to WhatsApp international +20.
const toWhatsAppIntl = (localPhone: string): string => {
  const n = normalizePhone(localPhone);
  if (/^01\d{9}$/.test(n)) return `+20${n.slice(1)}`;
  if (/^\+/.test(n)) return n;
  return n;
};

type Row = {
  customerId: string;
  name: string;
  phone: string;
  whatsapp: string;
  governorate: string;
  area: string;
  lastOrderDate: string;
  ordersCount: number;
  totalSpent: number;
  lastProduct: string;
  status: string;
  source: string;
  notes: string;
};

async function fetchAll<T = any>(builder: () => any, pageSize = 1000): Promise<T[]> {
  let all: T[] = [];
  let page = 0;
  while (true) {
    const { data, error } = await builder().range(page * pageSize, (page + 1) * pageSize - 1);
    if (error) throw error;
    const chunk = (data || []) as T[];
    all = all.concat(chunk);
    if (chunk.length < pageSize) break;
    page++;
  }
  return all;
}

const WhatsAppCampaigns = () => {
  const [governorate, setGovernorate] = useState<string>("all");
  const [source, setSource] = useState<string>("all");
  const [product, setProduct] = useState<string>("all");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [minOrders, setMinOrders] = useState<string>("");
  const [customerType, setCustomerType] = useState<"all" | "returning" | "new">("all");

  // Customers with notes so we can filter opt-outs.
  const customersQuery = useQuery({
    queryKey: ["wa-customers"],
    queryFn: async () =>
      fetchAll<any>(() =>
        supabase
          .from("customers")
          .select("id,name,phone,governorate,city,area,address,notes,source,total_spent")
          .order("created_at", { ascending: false })
      ),
    staleTime: 5 * 60 * 1000,
  });

  // Orders (needed for last order, count, source, filter by date).
  const ordersQuery = useQuery({
    queryKey: ["wa-orders"],
    queryFn: async () =>
      fetchAll<any>(() =>
        supabase
          .from("orders")
          .select("id,customer_id,created_at,total,source,status")
          .order("created_at", { ascending: false })
      ),
    staleTime: 5 * 60 * 1000,
  });

  // Order items — only the latest per order aggregated per customer.
  const itemsQuery = useQuery({
    queryKey: ["wa-items"],
    queryFn: async () =>
      fetchAll<any>(() =>
        supabase.from("order_items").select("order_id,product_name,created_at")
      ),
    staleTime: 5 * 60 * 1000,
  });

  const isLoading =
    customersQuery.isLoading || ordersQuery.isLoading || itemsQuery.isLoading;

  const { rows, governorates, sources, products } = useMemo(() => {
    const customers = customersQuery.data || [];
    const orders = (ordersQuery.data || []).slice().sort(
      (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    const items = itemsQuery.data || [];

    // Map order_id -> most recent product_name in that order.
    const orderProduct: Record<string, string> = {};
    for (const it of items) {
      if (!orderProduct[it.order_id]) orderProduct[it.order_id] = it.product_name;
    }

    // Group orders per customer.
    const perCustomer: Record<
      string,
      { count: number; total: number; last: any; source: string; lastProduct: string }
    > = {};
    for (const o of orders) {
      if (!o.customer_id) continue;
      const p = perCustomer[o.customer_id] || {
        count: 0, total: 0, last: null, source: "", lastProduct: "",
      };
      p.count += 1;
      p.total += Number(o.total) || 0;
      if (!p.last || new Date(o.created_at) > new Date(p.last.created_at)) {
        p.last = o;
        p.source = o.source || p.source;
        p.lastProduct = orderProduct[o.id] || p.lastProduct;
      }
      perCustomer[o.customer_id] = p;
    }

    const govSet = new Set<string>();
    const srcSet = new Set<string>();
    const prodSet = new Set<string>();

    // Dedupe by normalized phone, keep the row with latest order.
    const byPhone: Record<string, Row> = {};

    for (const c of customers) {
      if (isOptedOut(c.notes)) continue;
      const local = normalizePhone(c.phone);
      if (!local) continue;

      const agg = perCustomer[c.id];
      if (!agg || !agg.last) continue; // only customers with orders

      const gov = c.governorate || c.city || "غير محدد";
      const src = agg.source || c.source || "غير محدد";
      const lastProduct = agg.lastProduct || "";
      govSet.add(gov);
      srcSet.add(src);
      if (lastProduct) prodSet.add(lastProduct);

      const row: Row = {
        customerId: c.id,
        name: c.name || "",
        phone: local,
        whatsapp: toWhatsAppIntl(local),
        governorate: gov,
        area: c.area || c.address || "",
        lastOrderDate: agg.last.created_at,
        ordersCount: agg.count,
        totalSpent: Math.round(agg.total),
        lastProduct,
        status: agg.last.status || "",
        source: src,
        notes: c.notes || "",
      };

      const existing = byPhone[local];
      if (!existing || new Date(row.lastOrderDate) > new Date(existing.lastOrderDate)) {
        byPhone[local] = row;
      } else {
        // keep the earlier row but merge counts / totals from customers sharing a phone
        existing.ordersCount += row.ordersCount;
        existing.totalSpent += row.totalSpent;
      }
    }

    return {
      rows: Object.values(byPhone),
      governorates: Array.from(govSet).sort(),
      sources: Array.from(srcSet).sort(),
      products: Array.from(prodSet).sort(),
    };
  }, [customersQuery.data, ordersQuery.data, itemsQuery.data]);

  const filtered = useMemo(() => {
    const min = parseInt(minOrders, 10);
    const from = fromDate ? new Date(fromDate).getTime() : null;
    const to = toDate ? new Date(toDate).getTime() + 24 * 3600 * 1000 - 1 : null;
    return rows.filter((r) => {
      if (governorate !== "all" && r.governorate !== governorate) return false;
      if (source !== "all" && r.source !== source) return false;
      if (product !== "all" && r.lastProduct !== product) return false;
      if (!isNaN(min) && r.ordersCount < min) return false;
      if (customerType === "returning" && r.ordersCount < 2) return false;
      if (customerType === "new" && r.ordersCount !== 1) return false;
      const t = new Date(r.lastOrderDate).getTime();
      if (from !== null && t < from) return false;
      if (to !== null && t > to) return false;
      return true;
    });
  }, [rows, governorate, source, product, minOrders, customerType, fromDate, toDate]);

  const exportRows = () =>
    filtered.map((r) => ({
      "اسم العميل": r.name,
      "رقم الموبايل": r.phone,
      "واتساب دولي": r.whatsapp,
      "المحافظة": r.governorate,
      "المنطقة / العنوان": r.area,
      "آخر تاريخ طلب": r.lastOrderDate ? new Date(r.lastOrderDate).toLocaleDateString("ar-EG") : "",
      "عدد الطلبات السابقة": r.ordersCount,
      "إجمالي المشتريات": r.totalSpent,
      "آخر منتج تم طلبه": r.lastProduct,
      "مصدر الطلب": r.source,
      "حالة العميل": r.status,
    }));

  const handleExportCSV = () => {
    if (!filtered.length) return toast.warning("لا توجد بيانات للتصدير");
    exportCSV(`whatsapp-customers-${new Date().toISOString().slice(0, 10)}.csv`, exportRows());
    toast.success(`تم تصدير ${filtered.length} عميل`);
  };

  const handleExportExcel = () => {
    if (!filtered.length) return toast.warning("لا توجد بيانات للتصدير");
    const ws = XLSX.utils.json_to_sheet(exportRows());
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "عملاء واتساب");
    XLSX.writeFile(wb, `whatsapp-customers-${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success(`تم تصدير ${filtered.length} عميل`);
  };

  const handleCopyNumbers = async () => {
    if (!filtered.length) return toast.warning("لا توجد أرقام للنسخ");
    const text = filtered.map((r) => r.whatsapp).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`تم نسخ ${filtered.length} رقم`);
    } catch {
      toast.error("تعذّر النسخ");
    }
  };

  const resetFilters = () => {
    setGovernorate("all");
    setSource("all");
    setProduct("all");
    setFromDate("");
    setToDate("");
    setMinOrders("");
    setCustomerType("all");
  };

  return (
    <DashboardLayout>
      <div className="space-y-6" dir="rtl">
        <Header
          title="حملات واتساب"
          subtitle="تصدير أرقام العملاء لحملات واتساب التسويقية (بدون تكرار وبدون العملاء الرافضين للرسائل)"
        />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Filter className="w-5 h-5" /> الفلاتر
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
            <div>
              <Label>المحافظة</Label>
              <Select value={governorate} onValueChange={setGovernorate}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {governorates.map((g) => (
                    <SelectItem key={g} value={g}>{g}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>مصدر الطلب</Label>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {sources.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>المنتج (آخر طلب)</Label>
              <Select value={product} onValueChange={setProduct}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {products.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>نوع العميل</Label>
              <Select value={customerType} onValueChange={(v) => setCustomerType(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="returning">اشترى قبل كده (≥ 2 طلبات)</SelectItem>
                  <SelectItem value="new">جدد (طلب واحد فقط)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>آخر تاريخ طلب من</Label>
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div>
              <Label>آخر تاريخ طلب إلى</Label>
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
            <div>
              <Label>الحد الأدنى لعدد الطلبات</Label>
              <Input
                type="number"
                min={0}
                value={minOrders}
                onChange={(e) => setMinOrders(e.target.value)}
                placeholder="مثال: 3"
              />
            </div>
            <div className="flex items-end">
              <Button variant="outline" onClick={resetFilters} className="w-full">إعادة تعيين</Button>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-3 items-center">
          <Badge variant="secondary" className="text-base py-1 px-3">
            <Users className="w-4 h-4 ml-1 inline" />
            {isLoading ? "..." : `${filtered.length} عميل`}
          </Badge>
          <Button onClick={handleExportExcel} className="gap-2">
            <Download className="w-4 h-4" /> تصدير Excel
          </Button>
          <Button onClick={handleExportCSV} variant="outline" className="gap-2">
            <Download className="w-4 h-4" /> تصدير CSV
          </Button>
          <Button onClick={handleCopyNumbers} variant="outline" className="gap-2">
            <Copy className="w-4 h-4" /> نسخ أرقام واتساب فقط
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageCircle className="w-5 h-5" /> قائمة عملاء واتساب
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>اسم العميل</TableHead>
                  <TableHead>رقم الموبايل</TableHead>
                  <TableHead>واتساب دولي</TableHead>
                  <TableHead>المحافظة</TableHead>
                  <TableHead>المنطقة / العنوان</TableHead>
                  <TableHead>آخر طلب</TableHead>
                  <TableHead>عدد الطلبات</TableHead>
                  <TableHead>إجمالي المشتريات</TableHead>
                  <TableHead>آخر منتج</TableHead>
                  <TableHead>الحالة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={10} className="text-center py-8">جاري التحميل...</TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={10} className="text-center py-8">لا توجد نتائج</TableCell></TableRow>
                ) : (
                  filtered.slice(0, 500).map((r) => (
                    <TableRow key={r.customerId}>
                      <TableCell>{r.name}</TableCell>
                      <TableCell dir="ltr" className="font-mono">{r.phone}</TableCell>
                      <TableCell dir="ltr" className="font-mono">{r.whatsapp}</TableCell>
                      <TableCell>{r.governorate}</TableCell>
                      <TableCell className="max-w-[220px] truncate">{r.area}</TableCell>
                      <TableCell>{r.lastOrderDate ? new Date(r.lastOrderDate).toLocaleDateString("ar-EG") : "-"}</TableCell>
                      <TableCell>{r.ordersCount}</TableCell>
                      <TableCell>{r.totalSpent.toLocaleString("ar-EG")}</TableCell>
                      <TableCell className="max-w-[200px] truncate">{r.lastProduct || "-"}</TableCell>
                      <TableCell>{r.status || "-"}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            {filtered.length > 500 && (
              <div className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                <PhoneCall className="w-3 h-3" />
                يظهر أول 500 صف فقط في المعاينة. التصدير يشمل كل الـ {filtered.length} عميل.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default WhatsAppCampaigns;
