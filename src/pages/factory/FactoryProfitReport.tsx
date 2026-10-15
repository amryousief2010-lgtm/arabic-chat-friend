import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { paginateUntilDone } from "@/lib/paginateQuery";
import { cairoWallClockToUTC, currentCairoYearMonth, toCairoDateString } from "@/lib/cairoDate";
import {
  OUTLIER_UNIT_COST_EGP,
  buildFactoryProfitReport,
  type FactoryProfitReport,
  type ManufacturingInvoiceRow,
  type MaterialPriceLine,
  type SaleLine,
} from "@/lib/factoryProfitReport";
import { Download, Factory, RefreshCw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

const STATUS_AR: Record<string, string> = {
  approved: "معتمدة",
  transferred: "محوّلة",
  cancelled: "ملغاة",
};

function cairoRangeUtc(fromDate: string, toDate: string) {
  const [fy, fm, fd] = fromDate.split("-").map(Number);
  const [ty, tm, td] = toDate.split("-").map(Number);
  const start = cairoWallClockToUTC(fy, fm - 1, fd, 0, 0, 0);
  const next = new Date(Date.UTC(ty, tm - 1, td));
  next.setUTCDate(next.getUTCDate() + 1);
  const end = cairoWallClockToUTC(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate(), 0, 0, 0);
  return { start: start.toISOString(), end: end.toISOString() };
}

function monthRange(year: number, monthIndex0: number, endDay?: number) {
  const last = new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
  const day = endDay ? Math.min(endDay, last) : last;
  const mm = String(monthIndex0 + 1).padStart(2, "0");
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(day).padStart(2, "0")}` };
}

function money(value: number | null, digits = 0) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

function qty(value: number) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 3, minimumFractionDigits: 0 });
}

export default function FactoryProfitReport() {
  const today = toCairoDateString(new Date());
  const current = currentCairoYearMonth();
  const initial = monthRange(current.year, current.monthIndex0, Number(today.slice(8, 10)));
  const [fromDate, setFromDate] = useState(initial.from);
  const [toDate, setToDate] = useState(initial.to);
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState<ManufacturingInvoiceRow[]>([]);
  const [lines, setLines] = useState<MaterialPriceLine[]>([]);
  const [sales, setSales] = useState<SaleLine[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const invoicesRef = useRef<ManufacturingInvoiceRow[]>([]);
  const linesRef = useRef<MaterialPriceLine[]>([]);

  const loadInvoices = useCallback(async () => {
    const rows = await paginateUntilDone<ManufacturingInvoiceRow & { id: string }>({
      pageSize: 1000,
      maxPages: 10,
      idOf: (row) => row.id,
      fetchPage: async (from, to) => {
        const { data, error } = await supabase
          .from("meat_manufacturing_invoices")
          .select("id, invoice_no, product_name, status, created_at, finished_qty, unit, raw_cost, spice_cost, packaging_cost, extra_cost, total_manufacturing_cost")
          .order("id", { ascending: true })
          .range(from, to);
        if (error) throw error;
        return (data || []).map((row) => ({
          id: row.id,
          invoiceNo: row.invoice_no,
          productName: row.product_name,
          status: row.status,
          createdAt: row.created_at,
          finishedQty: Number(row.finished_qty) || 0,
          unit: row.unit,
          rawCost: Number(row.raw_cost) || 0,
          spiceCost: Number(row.spice_cost) || 0,
          packagingCost: Number(row.packaging_cost) || 0,
          extraCost: Number(row.extra_cost) || 0,
          totalCost: Number(row.total_manufacturing_cost) || 0,
        }));
      },
    });
    const priceLines = await paginateUntilDone<MaterialPriceLine & { id: string }>({
      pageSize: 1000,
      maxPages: 10,
      idOf: (row) => row.id,
      fetchPage: async (from, to) => {
        const { data, error } = await supabase
          .from("meat_manufacturing_invoice_lines")
          .select("id, invoice_id, item_name, kind, unit, unit_cost, quantity, created_at")
          .gte("unit_cost", OUTLIER_UNIT_COST_EGP)
          .order("id", { ascending: true })
          .range(from, to);
        if (error) throw error;
        return (data || []).map((row) => ({
          id: row.id,
          invoiceId: row.invoice_id,
          invoiceNo: "",
          productName: "",
          itemName: row.item_name,
          kind: row.kind,
          unit: row.unit,
          unitCost: Number(row.unit_cost) || 0,
          quantity: Number(row.quantity) || 0,
          createdAt: row.created_at,
          invoiceStatus: "",
        }));
      },
    });
    return { rows, priceLines };
  }, []);

  const loadSales = useCallback(async (from: string, to: string) => {
    const { start, end } = cairoRangeUtc(from, to);
    const orders = await paginateUntilDone<{ id: string; status: string; created_at: string }>({
      pageSize: 1000,
      maxPages: 40,
      idOf: (row) => row.id,
      fetchPage: async (pageFrom, pageTo) => {
        const { data, error } = await supabase
          .from("orders")
          .select("id, status, created_at")
          .neq("status", "cancelled")
          .gte("created_at", start)
          .lt("created_at", end)
          .order("id", { ascending: true })
          .range(pageFrom, pageTo);
        if (error) throw error;
        return data || [];
      },
    });
    const byId = new Map(orders.map((order) => [order.id, order]));
    const saleLines: SaleLine[] = [];
    const ids = orders.map((order) => order.id);
    for (let i = 0; i < ids.length; i += 80) {
      const slice = ids.slice(i, i + 80);
      const { data, error } = await supabase
        .from("order_items")
        .select("order_id, product_id, product_name, offer_name, quantity, unit_price, total_price, is_gift")
        .in("order_id", slice);
      if (error) throw error;
      for (const row of data || []) {
        const order = byId.get(row.order_id);
        if (!order) continue;
        saleLines.push({
          productName: row.product_name,
          productId: row.product_id,
          offerName: row.offer_name,
          quantity: Number(row.quantity) || 0,
          unitPrice: Number(row.unit_price) || 0,
          totalPrice: Number(row.total_price) || 0,
          isGift: !!row.is_gift,
          orderStatus: order.status,
          createdAt: order.created_at,
        });
      }
    }
    return saleLines;
  }, []);

  const refresh = useCallback(async (from: string, to: string) => {
    setLoading(true);
    try {
      const cached = invoicesRef.current;
      const [invoicePack, saleLines] = await Promise.all([
        cached.length ? Promise.resolve({ rows: cached, priceLines: linesRef.current }) : loadInvoices(),
        loadSales(from, to),
      ]);
      if (!cached.length) {
        const statusById = new Map(invoicePack.rows.map((row) => [row.id, row]));
        const priced = invoicePack.priceLines.map((line) => {
          const invoice = statusById.get(line.invoiceId);
          return {
            ...line,
            invoiceNo: invoice?.invoiceNo || "",
            productName: invoice?.productName || "",
            invoiceStatus: invoice?.status || "",
            createdAt: line.createdAt || invoice?.createdAt || "",
          };
        });
        invoicesRef.current = invoicePack.rows;
        linesRef.current = priced;
        setInvoices(invoicePack.rows);
        setLines(priced);
      }
      setSales(saleLines);
    } catch (error) {
      const message = error instanceof Error ? error.message : "تعذّر تحميل ربحية الإنتاج";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [loadInvoices, loadSales]);

  useEffect(() => {
    void refresh(initial.from, initial.to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const report: FactoryProfitReport | null = useMemo(() => {
    if (!invoices.length && loading) return null;
    return buildFactoryProfitReport({ invoices, lines, sales, fromDate, toDate });
  }, [fromDate, invoices, lines, loading, sales, toDate]);

  const selectedRow = report?.rows.find((row) => row.key === selected) || null;

  const applyRange = (from: string, to: string) => {
    setFromDate(from);
    setToDate(to);
    setSelected(null);
    void refresh(from, to);
  };

  const exportExcel = () => {
    if (!report) return;
    const sheet = [...report.rows, ...(report.totals ? [report.totals] : [])].map((row) => ({
      "المنتج": row.label,
      "طن منتج": row.tons,
      "خامات": row.materials,
      "توابل": row.spices,
      "تغليف": row.packaging,
      "تكاليف أخرى": row.extra,
      "إجمالي التكلفة": row.totalCost,
      "تكلفة الطن": row.costPerTon,
      "كجم مباع": row.soldKg,
      "قيمة البيع": row.salesValue,
      "سعر البيع للطن": row.sellPerTon,
      "ربح الطن": row.profitPerTon,
      "هامش %": row.marginPct,
    }));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(sheet), "ربحية الإنتاج");
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(report.outliers.map((row) => ({
      "الخامة": row.itemName,
      "النوع": row.kind,
      "أعلى سعر": row.maxUnitCost,
      "عدد السطور": row.lines,
      "الكمية": row.qtyKg,
      "فواتير": row.invoiceNos.join("، "),
    }))), "أسعار شاذة");
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(report.untransferred.map((row) => ({
      "الفاتورة": row.invoiceNo,
      "المنتج": row.productName,
      "كجم": row.kg,
      "التكلفة": row.totalCost,
      "التاريخ": row.createdAt.slice(0, 10),
    }))), "لم تُحوّل");
    XLSX.writeFile(book, `ربحية-الإنتاج-${fromDate}-${toDate}.xlsx`);
  };

  const previous = current.monthIndex0 === 0
    ? monthRange(current.year - 1, 11)
    : monthRange(current.year, current.monthIndex0 - 1);

  return (
    <DashboardLayout>
      <div dir="rtl" className="space-y-4 p-4 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500 to-orange-500 text-white">
              <Factory className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">ربحية الإنتاج</h1>
              <p className="text-sm text-muted-foreground">
                قراءة فقط للمدير العام والمدير التنفيذي والمدير المالي. التكلفة من فواتير التصنيع غير الملغاة، وسعر البيع من بنود الأوردرات غير الملغاة بما فيها صناديق العروض بسعرها المجمّد، بدون الشحن.
              </p>
            </div>
          </div>
          <Button onClick={exportExcel} disabled={!report} className="bg-gradient-to-l from-purple-600 to-orange-500 text-white">
            <Download className="ml-1 h-4 w-4" /> تصدير Excel
          </Button>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div>
            <Label className="text-xs">من</Label>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-40" />
          </div>
          <div>
            <Label className="text-xs">إلى</Label>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-40" />
          </div>
          <Button variant="outline" disabled={loading} onClick={() => applyRange(fromDate, toDate)}>
            <RefreshCw className="ml-1 h-4 w-4" /> {loading ? "جارٍ التحميل" : "عرض"}
          </Button>
          <Button variant="outline" onClick={() => applyRange(monthRange(current.year, current.monthIndex0).from, today)}>هذا الشهر</Button>
          <Button variant="outline" onClick={() => applyRange(previous.from, previous.to)}>الشهر الماضي</Button>
          <Button variant="outline" onClick={() => applyRange("2026-09-01", "2026-10-31")}>سبتمبر — أكتوبر ٢٠٢٦</Button>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat title="تكلفة الطن" value={money(report?.totals?.costPerTon ?? null)} hint="جنيه / طن" />
          <Stat title="سعر البيع للطن" value={money(report?.totals?.sellPerTon ?? null)} hint="بدون الشحن" />
          <Stat title="ربح الطن" value={money(report?.totals?.profitPerTon ?? null)} hint="مجمل" />
          <Stat title="هامش الربح" value={report?.totals?.marginPct == null ? "—" : `${money(report.totals.marginPct, 1)}%`} hint="على سعر البيع" />
        </div>

        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المنتج</TableHead>
                  <TableHead>طن منتج</TableHead>
                  <TableHead>خامات / كجم</TableHead>
                  <TableHead>توابل / كجم</TableHead>
                  <TableHead>تغليف / كجم</TableHead>
                  <TableHead>أخرى / كجم</TableHead>
                  <TableHead>تكلفة الطن</TableHead>
                  <TableHead>كجم مباع</TableHead>
                  <TableHead>سعر البيع للطن</TableHead>
                  <TableHead>ربح الطن</TableHead>
                  <TableHead>الهامش</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(report?.rows || []).map((row) => (
                  <TableRow key={row.key} className="cursor-pointer" onClick={() => setSelected(row.key === selected ? null : row.key)}>
                    <TableCell className="font-medium">{row.label}</TableCell>
                    <TableCell>{qty(row.tons)}</TableCell>
                    <TableCell>{money(row.kg > 0 ? row.materials / row.kg : null, 1)}</TableCell>
                    <TableCell>{money(row.kg > 0 ? row.spices / row.kg : null, 1)}</TableCell>
                    <TableCell>{money(row.kg > 0 ? row.packaging / row.kg : null, 1)}</TableCell>
                    <TableCell>{money(row.kg > 0 ? row.extra / row.kg : null, 1)}</TableCell>
                    <TableCell>{money(row.costPerTon)}</TableCell>
                    <TableCell>{qty(row.soldKg)}</TableCell>
                    <TableCell>{money(row.sellPerTon)}</TableCell>
                    <TableCell>{money(row.profitPerTon)}</TableCell>
                    <TableCell>{row.marginPct == null ? "—" : `${money(row.marginPct, 1)}%`}</TableCell>
                  </TableRow>
                ))}
                {report?.totals && (
                  <TableRow className="bg-purple-50 font-semibold">
                    <TableCell>{report.totals.label}</TableCell>
                    <TableCell>{qty(report.totals.tons)}</TableCell>
                    <TableCell>{money(report.totals.kg > 0 ? report.totals.materials / report.totals.kg : null, 1)}</TableCell>
                    <TableCell>{money(report.totals.kg > 0 ? report.totals.spices / report.totals.kg : null, 1)}</TableCell>
                    <TableCell>{money(report.totals.kg > 0 ? report.totals.packaging / report.totals.kg : null, 1)}</TableCell>
                    <TableCell>{money(report.totals.kg > 0 ? report.totals.extra / report.totals.kg : null, 1)}</TableCell>
                    <TableCell>{money(report.totals.costPerTon)}</TableCell>
                    <TableCell>{qty(report.totals.soldKg)}</TableCell>
                    <TableCell>{money(report.totals.sellPerTon)}</TableCell>
                    <TableCell>{money(report.totals.profitPerTon)}</TableCell>
                    <TableCell>{report.totals.marginPct == null ? "—" : `${money(report.totals.marginPct, 1)}%`}</TableCell>
                  </TableRow>
                )}
                {!loading && !report?.rows.length && (
                  <TableRow><TableCell colSpan={11}>لا إنتاج ولا مبيعات في هذه الفترة.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <p className="text-xs text-muted-foreground">
          الإجمالي يحسب تكلفة الطن على المنتجات المباعة التي لها إنتاج في الفترة، وسعر البيع على كل الكميات المباعة. اضغط صفًا لعرض فواتيره. الهدايا وسطر «تكلفة الشحن» ورسوم التوصيل خارج السعر.
        </p>

        {selectedRow && (
          <Card>
            <CardContent className="p-4">
              <h2 className="mb-2 font-semibold">فواتير {selectedRow.label}</h2>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الفاتورة</TableHead>
                    <TableHead>التاريخ</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>الكمية كجم</TableHead>
                    <TableHead>التكلفة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedRow.invoices.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell>
                        <Link className="text-purple-700 underline" to={`/meat-factory/manufacturing/${invoice.id}`}>{invoice.invoiceNo}</Link>
                      </TableCell>
                      <TableCell>{invoice.createdAt.slice(0, 10)}</TableCell>
                      <TableCell>{STATUS_AR[invoice.status] || invoice.status}</TableCell>
                      <TableCell>{qty(invoice.kg)}</TableCell>
                      <TableCell>{money(invoice.totalCost)}</TableCell>
                    </TableRow>
                  ))}
                  {!selectedRow.invoices.length && <TableRow><TableCell colSpan={5}>لا فواتير تصنيع في الفترة.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <AlertBlock title="أسعار وحدة شاذة" count={report?.outliers.length || 0} hint={`سعر الكيلو ${OUTLIER_UNIT_COST_EGP.toLocaleString("en-US")} جنيه أو أكثر`}>
            {(report?.outliers || []).map((row) => (
              <li key={row.itemName} className="border-b py-2 text-sm last:border-0">
                <div className="font-medium">{row.itemName} — {money(row.maxUnitCost)} ج/كجم</div>
                <div className="text-muted-foreground">{row.lines} سطر، {qty(row.qtyKg)} كجم. فواتير: {row.invoiceNos.join("، ") || "—"}</div>
              </li>
            ))}
          </AlertBlock>
          <AlertBlock title="فواتير معتمدة لم تُحوَّل للرئيسي" count={report?.untransferred.length || 0} hint={`${qty((report?.untransferred || []).reduce((s, row) => s + row.kg, 0))} كجم`}>
            {(report?.untransferred || []).slice(0, 30).map((row) => (
              <li key={row.id} className="border-b py-2 text-sm last:border-0">
                <Link className="font-medium text-purple-700 underline" to={`/meat-factory/manufacturing/${row.id}`}>{row.invoiceNo}</Link>
                <span className="text-muted-foreground"> — {row.productName} — {qty(row.kg)} كجم — {row.createdAt.slice(0, 10)}</span>
              </li>
            ))}
          </AlertBlock>
        </div>
      </div>
    </DashboardLayout>
  );
}

function Stat({ title, value, hint }: { title: string; value: string; hint: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{title}</div>
        <div className="text-2xl font-bold text-purple-800">{value}</div>
        <div className="text-xs text-orange-700">{hint}</div>
      </CardContent>
    </Card>
  );
}

function AlertBlock({ title, count, hint, children }: { title: string; count: number; hint: string; children: ReactNode }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-1 flex items-center gap-2 font-semibold">
          <TriangleAlert className="h-4 w-4 text-orange-600" />
          {title}
          <Badge variant={count ? "destructive" : "secondary"}>{count}</Badge>
        </div>
        <p className="mb-2 text-xs text-muted-foreground">{hint}</p>
        <ul className="max-h-80 overflow-auto">{count ? children : <li className="text-sm text-muted-foreground">لا شيء</li>}</ul>
      </CardContent>
    </Card>
  );
}
