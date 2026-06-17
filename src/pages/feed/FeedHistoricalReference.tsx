import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { safeParseExcel } from "@/lib/safeExcel";
import { toast } from "sonner";
import { AlertTriangle, Upload, CheckCircle2, FileSpreadsheet, Loader2, Printer, Download } from "lucide-react";
import { openPrintWindow } from "@/lib/printPdf";

type Row = {
  id?: string;
  reference_id: string;
  record_type: "purchase" | "external_sale" | "internal_sale";
  feed_type?: string | null;
  sale_type?: string | null;
  destination?: string | null;
  voucher_date?: string | null;
  voucher_no?: string | null;
  document_no?: string | null;
  voucher_type?: string | null;
  description?: string | null;
  counterparty?: string | null;
  amount: number;
  currency?: string | null;
  source_file?: string | null;
  notes?: string | null;
};

const fmt = (n: number) => new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 2 }).format(n || 0);

function toISO(v: any): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

const num = (v: any) => {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return isFinite(n) ? n : 0;
};
const txt = (v: any) => (v == null ? null : String(v).trim() || null);

export default function FeedHistoricalReference() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>("all");
  const [parsing, setParsing] = useState(false);
  const [staged, setStaged] = useState<Row[]>([]);
  const [stagedName, setStagedName] = useState("");
  const [importing, setImporting] = useState(false);
  const [systemTotals, setSystemTotals] = useState({ purchases: 0, externalSales: 0, internalMotherFarm: 0 });

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("feed_historical_reference")
      .select("*")
      .order("voucher_date", { ascending: true })
      .limit(2000);
    if (error) toast.error(error.message);
    else setRows((data as any) ?? []);
    setLoading(false);
  };

  const loadSystemTotals = async () => {
    const { data: p } = await supabase
      .from("feed_raw_purchases")
      .select("total_amount, invoice_date")
      .gte("invoice_date", "2026-01-01");
    const purchases = (p ?? []).reduce((s: number, r: any) => s + Number(r.total_amount || 0), 0);
    const { data: s } = await supabase
      .from("feed_sales")
      .select("total_amount, total_cost, destination_type, sale_date")
      .gte("sale_date", "2026-01-01");
    let externalSales = 0;
    let internalMotherFarm = 0;
    for (const r of (s ?? []) as any[]) {
      if (r.destination_type === "mother_farm_feed_store") {
        internalMotherFarm += Number(r.total_cost || r.total_amount || 0);
      } else if (!r.destination_type || r.destination_type === "external_customer") {
        externalSales += Number(r.total_amount || 0);
      }
    }
    setSystemTotals({ purchases, externalSales, internalMotherFarm });
  };

  useEffect(() => {
    load();
    loadSystemTotals();
  }, []);

  const onFile = async (file: File) => {
    setParsing(true);
    try {
      const buf = await file.arrayBuffer();
      const XLSX = await import("xlsx");
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const out: Row[] = [];
      for (const sheetName of wb.SheetNames) {
        const ws = wb.Sheets[sheetName];
        const arr: any[] = XLSX.utils.sheet_to_json(ws, { defval: null });
        for (const r of arr) {
          const refId = txt(r.reference_id);
          if (!refId) continue;
          const rtRaw = txt(r.record_type) || "";
          const rt: Row["record_type"] | null =
            rtRaw === "purchase" || rtRaw === "external_sale" || rtRaw === "internal_sale"
              ? (rtRaw as any)
              : null;
          if (!rt) continue;
          const amount = num(r.amount ?? r.total_amount);
          if (rt === "internal_sale" && amount <= 0) continue; // skip placeholder internal-sale rows with no amount
          out.push({
            reference_id: refId,
            record_type: rt,
            feed_type: txt(r.feed_type),
            sale_type: txt(r.sale_type),
            destination: txt(r.destination),
            voucher_date: toISO(r.voucher_date ?? r.period_or_date),
            voucher_no: txt(r.voucher_no),
            document_no: txt(r.document_no),
            voucher_type: txt(r.voucher_type),
            description: txt(r.description ?? r.notes),
            counterparty: txt(r.counterparty_account ?? r.customer_account),
            amount,
            currency: txt(r.currency) || "EGP",
            source_file: txt(r.source_file),
            notes: txt(r.notes),
          });
        }
      }
      setStaged(out);
      setStagedName(file.name);
      toast.success(`تم تحليل ${out.length} صف من الملف`);
    } catch (e: any) {
      toast.error(e.message || "فشل تحليل الملف");
    } finally {
      setParsing(false);
    }
  };

  const stagedSummary = useMemo(() => {
    const s = { p: 0, pAmt: 0, pF: 0, pFAmt: 0, pL: 0, pLAmt: 0, e: 0, eAmt: 0, i: 0, iAmt: 0 };
    for (const r of staged) {
      if (r.record_type === "purchase") {
        s.p++;
        s.pAmt += r.amount;
        if (r.feed_type === "تسمين") { s.pF++; s.pFAmt += r.amount; }
        if (r.feed_type === "بياض") { s.pL++; s.pLAmt += r.amount; }
      } else if (r.record_type === "external_sale") {
        s.e++;
        s.eAmt += r.amount;
      } else {
        s.i++;
        s.iAmt += r.amount;
      }
    }
    return s;
  }, [staged]);

  const commit = async () => {
    if (!staged.length) return;
    setImporting(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      // dedupe with existing
      const ids = staged.map((r) => r.reference_id);
      const { data: existing } = await supabase
        .from("feed_historical_reference")
        .select("reference_id")
        .in("reference_id", ids);
      const have = new Set((existing ?? []).map((r: any) => r.reference_id));
      const toInsert = staged
        .filter((r) => !have.has(r.reference_id))
        .map((r) => ({
          ...r,
          is_historical_reference: true,
          affects_inventory: false,
          affects_treasury: false,
          affects_avg_cost: false,
          affects_debt: false,
          source_system: "المحتسب",
          imported_by: u.user?.id ?? null,
        }));
      const skipped = staged.length - toInsert.length;
      if (toInsert.length) {
        // batch in chunks of 500
        for (let i = 0; i < toInsert.length; i += 500) {
          const { error } = await supabase
            .from("feed_historical_reference")
            .insert(toInsert.slice(i, i + 500) as any);
          if (error) throw error;
        }
      }
      toast.success(`تم استيراد ${toInsert.length} صف${skipped ? ` — تم تجاهل ${skipped} مكرر` : ""}`);
      setStaged([]);
      setStagedName("");
      await load();
    } catch (e: any) {
      toast.error(e.message || "فشل الاستيراد");
    } finally {
      setImporting(false);
    }
  };

  const totals = useMemo(() => {
    const t = { purchaseFattening: 0, purchaseLayer: 0, purchaseAll: 0, externalSales: 0, internal: 0 };
    for (const r of rows) {
      if (r.record_type === "purchase") {
        t.purchaseAll += Number(r.amount);
        if (r.feed_type === "تسمين") t.purchaseFattening += Number(r.amount);
        if (r.feed_type === "بياض") t.purchaseLayer += Number(r.amount);
      } else if (r.record_type === "external_sale") {
        t.externalSales += Number(r.amount);
      } else {
        t.internal += Number(r.amount);
      }
    }
    return t;
  }, [rows]);

  const filtered = useMemo(
    () => (filterType === "all" ? rows : rows.filter((r) => r.record_type === filterType)),
    [rows, filterType]
  );

  return (
    <DashboardLayout>
      <div dir="rtl" className="space-y-4 p-4">
        <div>
          <h1 className="text-2xl font-bold">بيانات مرجعية تاريخية — مصنع العلف (المحتسب)</h1>
          <p className="text-muted-foreground text-sm">
            استيراد ومطابقة فقط — لا يؤثر على المخزون أو الخزن أو متوسط التكلفة.
          </p>
        </div>

        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>مرجعي فقط</AlertTitle>
          <AlertDescription>
            جميع الصفوف المدخلة هنا مرجعية للمقارنة مع برنامج المحتسب — لا تنشئ حركات مخزون، ولا حركات خزنة، ولا تعدّل
            متوسط التكلفة أو المديونيات.
          </AlertDescription>
        </Alert>

        <Tabs defaultValue="import" className="w-full">
          <TabsList>
            <TabsTrigger value="import">استيراد</TabsTrigger>
            <TabsTrigger value="data">البيانات المرجعية</TabsTrigger>
            <TabsTrigger value="reconcile">مطابقة مع المحتسب</TabsTrigger>
          </TabsList>

          <TabsContent value="import" className="space-y-3">
            <Card>
              <CardHeader>
                <CardTitle>رفع ملف Excel المرجعي</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Input
                  type="file"
                  accept=".xlsx,.xls"
                  disabled={parsing || importing}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onFile(f);
                  }}
                />
                {parsing && (
                  <div className="text-sm text-muted-foreground flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> جاري التحليل…
                  </div>
                )}

                {staged.length > 0 && (
                  <div className="space-y-3">
                    <div className="rounded-md border p-3 bg-muted/30 text-sm flex items-center gap-2">
                      <FileSpreadsheet className="h-4 w-4" />
                      {stagedName} — {staged.length} صف جاهز للاعتماد
                    </div>
                    <div className="grid md:grid-cols-3 gap-3 text-sm">
                      <Card>
                        <CardHeader className="pb-1"><CardTitle className="text-sm">مشتريات علف تسمين</CardTitle></CardHeader>
                        <CardContent><div>{stagedSummary.pF} صف</div><div className="font-bold">{fmt(stagedSummary.pFAmt)} ج.م</div></CardContent>
                      </Card>
                      <Card>
                        <CardHeader className="pb-1"><CardTitle className="text-sm">مشتريات علف بياض</CardTitle></CardHeader>
                        <CardContent><div>{stagedSummary.pL} صف</div><div className="font-bold">{fmt(stagedSummary.pLAmt)} ج.م</div></CardContent>
                      </Card>
                      <Card>
                        <CardHeader className="pb-1"><CardTitle className="text-sm">مبيعات خارجية</CardTitle></CardHeader>
                        <CardContent><div>{stagedSummary.e} صف</div><div className="font-bold">{fmt(stagedSummary.eAmt)} ج.م</div></CardContent>
                      </Card>
                    </div>
                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        هذه البيانات مرجعية فقط — لن تؤثر على الجرد أو الخزن أو متوسط التكلفة أو المديونيات.
                      </AlertDescription>
                    </Alert>
                    <div className="flex gap-2">
                      <Button onClick={commit} disabled={importing}>
                        {importing ? <Loader2 className="h-4 w-4 ml-1 animate-spin" /> : <CheckCircle2 className="h-4 w-4 ml-1" />}
                        اعتماد الاستيراد المرجعي
                      </Button>
                      <Button variant="outline" onClick={() => { setStaged([]); setStagedName(""); }} disabled={importing}>
                        إلغاء
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="data" className="space-y-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>الصفوف المرجعية</CardTitle>
                <div className="flex items-center gap-2">
                  <Select value={filterType} onValueChange={setFilterType}>
                    <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">الكل</SelectItem>
                      <SelectItem value="purchase">مشتريات خامات</SelectItem>
                      <SelectItem value="external_sale">مبيعات خارجية</SelectItem>
                      <SelectItem value="internal_sale">مبيعات داخلية (الأمهات)</SelectItem>
                    </SelectContent>
                  </Select>
                  <Badge variant="secondary">مرجعي — لا يؤثر على المخزون أو الخزنة</Badge>
                </div>
              </CardHeader>
              <CardContent>
                {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : (
                  <div className="max-h-[60vh] overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>التاريخ</TableHead>
                          <TableHead>النوع</TableHead>
                          <TableHead>نوع العلف</TableHead>
                          <TableHead>سند</TableHead>
                          <TableHead>الطرف</TableHead>
                          <TableHead className="text-left">المبلغ</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filtered.map((r) => (
                          <TableRow key={r.id || r.reference_id}>
                            <TableCell>{r.voucher_date ?? "-"}</TableCell>
                            <TableCell>
                              <Badge variant="outline">
                                {r.record_type === "purchase" ? "شراء" : r.record_type === "external_sale" ? "بيع خارجي" : "بيع داخلي"}
                              </Badge>
                            </TableCell>
                            <TableCell>{r.feed_type ?? "-"}</TableCell>
                            <TableCell>{r.voucher_no ?? "-"}</TableCell>
                            <TableCell className="max-w-[280px] truncate">{r.counterparty ?? r.destination ?? "-"}</TableCell>
                            <TableCell className="text-left font-mono">{fmt(Number(r.amount))}</TableCell>
                          </TableRow>
                        ))}
                        {filtered.length === 0 && (
                          <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">لا توجد بيانات</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="reconcile" className="space-y-3">
            <Card>
              <CardHeader><CardTitle>مطابقة مصنع العلف مع المحتسب</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>البند</TableHead>
                      <TableHead className="text-left">المحتسب (مرجعي)</TableHead>
                      <TableHead className="text-left">السيستم (تشغيلي)</TableHead>
                      <TableHead className="text-left">الفرق</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell>مشتريات خامات علف تسمين</TableCell>
                      <TableCell className="text-left font-mono">{fmt(totals.purchaseFattening)}</TableCell>
                      <TableCell className="text-left font-mono text-muted-foreground">—</TableCell>
                      <TableCell className="text-left font-mono">—</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>مشتريات خامات علف بياض</TableCell>
                      <TableCell className="text-left font-mono">{fmt(totals.purchaseLayer)}</TableCell>
                      <TableCell className="text-left font-mono text-muted-foreground">—</TableCell>
                      <TableCell className="text-left font-mono">—</TableCell>
                    </TableRow>
                    <TableRow className="font-semibold">
                      <TableCell>إجمالي مشتريات خامات العلف</TableCell>
                      <TableCell className="text-left font-mono">{fmt(totals.purchaseAll)}</TableCell>
                      <TableCell className="text-left font-mono">{fmt(systemTotals.purchases)}</TableCell>
                      <TableCell className="text-left font-mono">{fmt(totals.purchaseAll - systemTotals.purchases)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>إجمالي مبيعات الأعلاف الخارجية</TableCell>
                      <TableCell className="text-left font-mono">{fmt(totals.externalSales)}</TableCell>
                      <TableCell className="text-left font-mono">{fmt(systemTotals.externalSales)}</TableCell>
                      <TableCell className="text-left font-mono">{fmt(totals.externalSales - systemTotals.externalSales)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>المبيعات الداخلية — مزرعة الأمهات</TableCell>
                      <TableCell className="text-left font-mono">{fmt(totals.internal)}</TableCell>
                      <TableCell className="text-left font-mono text-muted-foreground">—</TableCell>
                      <TableCell className="text-left font-mono">—</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
                <div className="mt-3 text-xs text-muted-foreground">
                  بيانات المحتسب مرجعية فقط ولم تنشئ أي حركة مخزون أو خزنة. مقارنات السيستم هنا تستند إلى
                  <span className="font-mono mx-1">feed_raw_purchases.total_amount</span>
                  و
                  <span className="font-mono mx-1">feed_sales.total_amount</span>
                  منذ 2026-01-01.
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
