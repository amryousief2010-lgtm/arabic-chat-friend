import { useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, ShieldAlert, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { safeParseExcel, SafeExcelError } from "@/lib/safeExcel";
import {
  parseMayRebuildWorkbook,
  type ParsedRow,
} from "@/lib/mayRebuildParser";

type RebuildResult = {
  excelRow: number;
  customerName: string;
  customerPhone: string;
  orderId: string | null;
  orderNumber: string | null;
  matched: boolean;
  rebuilt: boolean;
  itemsBefore: number;
  itemsAfter: number;
  validation: { ok: boolean; reason?: string };
  error?: string;
};

const ItemBadges = ({ row }: { row: ParsedRow }) => (
  <div className="flex flex-wrap gap-1">
    {row.items.length === 0 && (
      <Badge variant="destructive">لا توجد منتجات</Badge>
    )}
    {row.items.map((it, i) => (
      <Badge
        key={i}
        variant={it.ambiguous ? "outline" : "secondary"}
        className="font-mono text-[11px]"
        title={`عمود Excel: ${it.sourceColumn} | قيمة خام: ${it.excelRawValue}${it.isHalfKgApplied ? " (×0.5)" : ""}`}
      >
        {it.productName.trim()} · {it.quantity}
      </Badge>
    ))}
  </div>
);

export default function RebuildMayOrders() {
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [applying, setApplying] = useState(false);
  const [results, setResults] = useState<RebuildResult[]>([]);
  const [updateMetadata, setUpdateMetadata] = useState(true);
  const [skipManualReview, setSkipManualReview] = useState(true);
  const [tab, setTab] = useState("preview");

  const handleFile = async (f: File) => {
    setFile(f);
    setRows([]);
    setResults([]);
    setParsing(true);
    try {
      const { workbook } = await safeParseExcel(f);
      const parsed = await parseMayRebuildWorkbook(workbook);
      setRows(parsed);
      toast.success(`تم قراءة ${parsed.length} صف لمايو 2026 للبنات الأربعة`);
    } catch (e) {
      const msg = e instanceof SafeExcelError ? e.message : (e as Error).message;
      toast.error(`فشل قراءة الملف: ${msg}`);
    } finally {
      setParsing(false);
    }
  };

  const stats = useMemo(() => {
    const totalItems = rows.reduce((s, r) => s + r.items.length, 0);
    const totalValue = rows.reduce((s, r) => s + (r.orderValue || 0), 0);
    const review = rows.filter((r) => r.needsManualReview).length;
    return { total: rows.length, totalItems, totalValue, review };
  }, [rows]);

  const runRebuild = async (dryRun: boolean) => {
    if (!rows.length) {
      toast.error("ارفع ملف Excel أولاً");
      return;
    }
    const payloadRows = (skipManualReview ? rows.filter((r) => !r.needsManualReview) : rows).map((r) => ({
      excelRow: r.excelRow,
      timestamp: r.timestamp,
      moderator: r.moderator,
      customerName: r.customerName,
      customerPhone: r.customerPhone,
      shippingCompany: r.shippingCompany,
      source: r.source,
      offerName: r.offerName,
      orderValue: r.orderValue,
      items: r.items,
    }));
    if (!payloadRows.length) {
      toast.error("لا توجد صفوف صالحة للتنفيذ");
      return;
    }

    setApplying(true);
    setResults([]);
    try {
      const all: RebuildResult[] = [];
      const CHUNK = 200;
      for (let i = 0; i < payloadRows.length; i += CHUNK) {
        const slice = payloadRows.slice(i, i + CHUNK);
        const { data, error } = await supabase.functions.invoke("rebuild-may-orders", {
          body: {
            rows: slice,
            sourceFile: file?.name ?? "may-rebuild.xlsx",
            options: { dryRun, updateMetadata, matchToleranceMinutes: 15 },
          },
        });
        if (error) throw error;
        if (data?.results) all.push(...data.results);
      }
      setResults(all);
      setTab("results");
      const okCount = all.filter((r) => r.validation.ok).length;
      const failCount = all.length - okCount;
      if (dryRun) {
        toast.success(`فحص تجريبي اكتمل: ${okCount} مطابق، ${failCount} يحتاج مراجعة`);
      } else {
        toast.success(`تم إعادة بناء ${all.filter((r) => r.rebuilt).length} طلب — ${okCount} ناجح ${failCount} فشل`);
      }
    } catch (e) {
      toast.error("فشل التنفيذ: " + (e as Error).message);
    } finally {
      setApplying(false);
    }
  };

  const resultStats = useMemo(() => {
    if (!results.length) return null;
    return {
      total: results.length,
      matched: results.filter((r) => r.matched).length,
      rebuilt: results.filter((r) => r.rebuilt).length,
      ok: results.filter((r) => r.validation.ok).length,
      failed: results.filter((r) => !r.validation.ok).length,
      unmatched: results.filter((r) => !r.matched).length,
    };
  }, [results]);

  return (
    <DashboardLayout>
      <Header
        title="إعادة بناء طلبات مايو 2026"
        subtitle="مطابقة دقيقة لأعمدة منتجات Excel — يتجاهل العرض والملاحظات"
      />

      <Alert className="mb-4">
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>هذه العملية تعدّل بيانات حقيقية</AlertTitle>
        <AlertDescription className="space-y-1 text-sm">
          <p>سيتم حذف <strong>order_items</strong> الحالية لكل طلب مطابق وإعادة إنشائها من أعمدة Excel فقط.</p>
          <p>اسم العرض وحقل الملاحظات <strong>لا</strong> يُستخدمان لتوليد المنتجات. كل عمود منتج غير فارغ = منتج واحد.</p>
          <p>قاعدة النصف كيلو: قيمة 1 = 0.5 كجم، 2 = 1 كجم، 4 = 2 كجم (للمنتجات الموزونة فقط).</p>
        </AlertDescription>
      </Alert>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            ١. ارفع ملف Excel (Form Responses 1)
          </CardTitle>
          <CardDescription>الصفوف خارج مايو 2026 أو خارج البنات الأربعة سيتم تجاهلها تلقائياً.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          {parsing && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> جاري قراءة الملف…
            </div>
          )}
          {rows.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
              <div className="rounded-md border p-2"><span className="text-muted-foreground">صفوف:</span> <strong>{stats.total}</strong></div>
              <div className="rounded-md border p-2"><span className="text-muted-foreground">منتجات:</span> <strong>{stats.totalItems}</strong></div>
              <div className="rounded-md border p-2"><span className="text-muted-foreground">إجمالي القيمة:</span> <strong>{stats.totalValue.toLocaleString()} ج</strong></div>
              <div className="rounded-md border p-2"><span className="text-muted-foreground">يحتاج مراجعة:</span> <strong className="text-amber-600">{stats.review}</strong></div>
            </div>
          )}
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>٢. خيارات التنفيذ</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label className="font-semibold">تحديث بيانات الشحن / المصدر / الموديراتور</Label>
                <p className="text-xs text-muted-foreground">يحدّث shipping_company و source و moderator من Excel</p>
              </div>
              <Switch checked={updateMetadata} onCheckedChange={setUpdateMetadata} />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label className="font-semibold">تخطّي الصفوف التي تحتاج مراجعة يدوية</Label>
                <p className="text-xs text-muted-foreground">صفوف بدون منتجات أو بأعمدة غامضة (فخدة/نص نعامة/نعامة صندوق)</p>
              </div>
              <Switch checked={skipManualReview} onCheckedChange={setSkipManualReview} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={applying} onClick={() => runRebuild(true)}>
                {applying ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : null}
                فحص تجريبي (Dry-run) فقط
              </Button>
              <Button variant="destructive" disabled={applying} onClick={() => runRebuild(false)}>
                {applying ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Upload className="h-4 w-4 ml-2" />}
                تنفيذ إعادة البناء فعلياً
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {rows.length > 0 && (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="preview">معاينة Excel ({rows.length})</TabsTrigger>
            <TabsTrigger value="results" disabled={!results.length}>
              نتائج التنفيذ {resultStats ? `(${resultStats.ok}/${resultStats.total})` : ""}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="preview">
            <Card>
              <CardContent className="p-0">
                <ScrollArea className="h-[600px]">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background z-10">
                      <TableRow>
                        <TableHead>صف</TableHead>
                        <TableHead>الموديراتور</TableHead>
                        <TableHead>العميل</TableHead>
                        <TableHead>الهاتف</TableHead>
                        <TableHead>القيمة</TableHead>
                        <TableHead>العرض</TableHead>
                        <TableHead className="min-w-[400px]">منتجات Excel (المصدر النهائي)</TableHead>
                        <TableHead>الحالة</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r) => (
                        <TableRow key={r.excelRow}>
                          <TableCell className="font-mono">{r.excelRow}</TableCell>
                          <TableCell>{r.moderator}</TableCell>
                          <TableCell>{r.customerName}</TableCell>
                          <TableCell className="font-mono">{r.customerPhone}</TableCell>
                          <TableCell>{r.orderValue.toLocaleString()}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{r.offerName}</TableCell>
                          <TableCell><ItemBadges row={r} /></TableCell>
                          <TableCell>
                            {r.needsManualReview ? (
                              <Badge variant="outline" className="border-amber-500 text-amber-700">
                                <AlertTriangle className="h-3 w-3 ml-1" />
                                مراجعة
                              </Badge>
                            ) : (
                              <Badge variant="secondary">
                                <CheckCircle2 className="h-3 w-3 ml-1" />
                                جاهز
                              </Badge>
                            )}
                            {r.reviewReason && (
                              <p className="text-[10px] text-muted-foreground mt-1">{r.reviewReason}</p>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="results">
            {resultStats && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3 text-sm">
                <div className="rounded-md border p-2"><span className="text-muted-foreground">الكل:</span> <strong>{resultStats.total}</strong></div>
                <div className="rounded-md border p-2"><span className="text-muted-foreground">مطابق:</span> <strong>{resultStats.matched}</strong></div>
                <div className="rounded-md border p-2"><span className="text-muted-foreground">معاد بناؤه:</span> <strong>{resultStats.rebuilt}</strong></div>
                <div className="rounded-md border p-2 bg-emerald-50"><span className="text-muted-foreground">ناجح:</span> <strong className="text-emerald-700">{resultStats.ok}</strong></div>
                <div className="rounded-md border p-2 bg-rose-50"><span className="text-muted-foreground">فشل:</span> <strong className="text-rose-700">{resultStats.failed}</strong></div>
              </div>
            )}
            <Card>
              <CardContent className="p-0">
                <ScrollArea className="h-[600px]">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background z-10">
                      <TableRow>
                        <TableHead>صف</TableHead>
                        <TableHead>العميل</TableHead>
                        <TableHead>الهاتف</TableHead>
                        <TableHead>رقم الطلب</TableHead>
                        <TableHead>قبل → بعد</TableHead>
                        <TableHead>الحالة</TableHead>
                        <TableHead>السبب</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {results.map((r) => (
                        <TableRow key={r.excelRow}>
                          <TableCell className="font-mono">{r.excelRow}</TableCell>
                          <TableCell>{r.customerName}</TableCell>
                          <TableCell className="font-mono">{r.customerPhone}</TableCell>
                          <TableCell className="font-mono text-xs">{r.orderNumber ?? "—"}</TableCell>
                          <TableCell className="text-xs">{r.itemsBefore} → {r.itemsAfter}</TableCell>
                          <TableCell>
                            {!r.matched ? (
                              <Badge variant="outline" className="border-amber-500 text-amber-700">غير مطابق</Badge>
                            ) : r.validation.ok ? (
                              <Badge className="bg-emerald-600 hover:bg-emerald-700">ناجح</Badge>
                            ) : (
                              <Badge variant="destructive">فشل التحقق</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[300px]">
                            {r.validation.reason ?? "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </DashboardLayout>
  );
}
