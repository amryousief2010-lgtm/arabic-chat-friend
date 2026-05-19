import { useState, useEffect } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { FileSpreadsheet, Upload, Loader2, CheckCircle2, AlertTriangle, History } from "lucide-react";

type ParsedRow = {
  date: string; // YYYY-MM-DD
  moderator: string;
  phone: string;
  value: number;
  status: string; // raw arabic status text
};

type Aggregates = {
  total_rows: number;
  total_value: number;
  delivered_count: number;
  delivered_value: number;
  cancelled_count: number;
  pending_count: number;
  per_moderator: Record<string, { rows: number; value: number }>;
  per_day: Record<string, { rows: number; value: number }>;
};

const norm = (s: any) => String(s ?? "").trim();
const normalizeStatus = (raw: string): "delivered" | "cancelled" | "pending" => {
  const s = raw.trim();
  if (!s) return "pending";
  if (/تم|مكتمل|مسلم|تسليم/.test(s)) return "delivered";
  if (/ملغ|الغ|cancel/i.test(s)) return "cancelled";
  return "pending";
};

const empty = (): Aggregates => ({
  total_rows: 0,
  total_value: 0,
  delivered_count: 0,
  delivered_value: 0,
  cancelled_count: 0,
  pending_count: 0,
  per_moderator: {},
  per_day: {},
});

function aggregate(rows: ParsedRow[]): Aggregates {
  const a = empty();
  for (const r of rows) {
    const st = normalizeStatus(r.status);
    a.total_rows += 1;
    a.total_value += r.value;
    if (st === "delivered") { a.delivered_count += 1; a.delivered_value += r.value; }
    else if (st === "cancelled") a.cancelled_count += 1;
    else a.pending_count += 1;

    const mod = r.moderator || "غير محدد";
    a.per_moderator[mod] = a.per_moderator[mod] || { rows: 0, value: 0 };
    a.per_moderator[mod].rows += 1;
    a.per_moderator[mod].value += r.value;

    const d = r.date;
    a.per_day[d] = a.per_day[d] || { rows: 0, value: 0 };
    a.per_day[d].rows += 1;
    a.per_day[d].value += r.value;
  }
  return a;
}

function findHeaderRow(sheet: any[][]): { headerIdx: number; cols: Record<string, number> } {
  // search first 10 rows for arabic keywords
  const keys = {
    date: ["تاريخ", "Timestamp", "التاريخ"],
    moderator: ["الموظفة", "موديراتور", "الموظف", "اسم الموظف"],
    phone: ["تليفون", "هاتف", "موبايل", "رقم"],
    value: ["قيمة الاوردر بدون شحن", "بدون شحن", "قيمة الاوردر", "قيمة الطلب", "السعر"],
    status: ["حالة", "الحالة", "Status"],
  };
  for (let i = 0; i < Math.min(sheet.length, 15); i++) {
    const row = sheet[i] || [];
    const cols: Record<string, number> = {};
    row.forEach((cell, idx) => {
      const c = norm(cell);
      for (const [k, arr] of Object.entries(keys)) {
        if (cols[k] !== undefined) continue;
        if (arr.some((kw) => c.includes(kw))) cols[k] = idx;
      }
    });
    if (cols.date !== undefined && cols.moderator !== undefined && cols.value !== undefined) {
      return { headerIdx: i, cols };
    }
  }
  throw new Error("لم أتمكن من التعرف على رؤوس الأعمدة في الملف. تأكد من وجود: تاريخ، الموظفة، قيمة الاوردر بدون شحن، الحالة.");
}

function toISODate(v: any): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    // Excel serial date
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    const mm = String(d.m).padStart(2, "0");
    const dd = String(d.d).padStart(2, "0");
    return `${d.y}-${mm}-${dd}`;
  }
  const s = String(v).trim();
  // Try common formats
  const m1 = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m1) return `${m1[1]}-${m1[2].padStart(2,"0")}-${m1[3].padStart(2,"0")}`;
  const m2 = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m2) return `${m2[3]}-${m2[2].padStart(2,"0")}-${m2[1].padStart(2,"0")}`;
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const mm = String(d.getMonth() + 1).padStart(2,"0");
    const dd = String(d.getDate()).padStart(2,"0");
    return `${d.getFullYear()}-${mm}-${dd}`;
  }
  return null;
}

export default function ExcelComparison() {
  const [period, setPeriod] = useState("2026-05");
  const [filename, setFilename] = useState<string>("");
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [excelAgg, setExcelAgg] = useState<Aggregates | null>(null);
  const [systemAgg, setSystemAgg] = useState<Aggregates | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [auditLog, setAuditLog] = useState<any[]>([]);

  useEffect(() => { loadHistory(); loadAudit(); }, [period]);

  async function loadHistory() {
    const { data } = await supabase
      .from("excel_snapshots")
      .select("id, filename, uploaded_at, total_rows, total_value")
      .eq("period", period)
      .order("uploaded_at", { ascending: false })
      .limit(10);
    setHistory(data || []);
  }
  async function loadAudit() {
    const { data } = await supabase
      .from("import_audit_log")
      .select("id, action, performed_at, source_file, rows_affected, details")
      .eq("target_period", period)
      .order("performed_at", { ascending: false })
      .limit(20);
    setAuditLog(data || []);
  }

  async function loadSystemAggregates() {
    // Fetch in batches of 1000 to avoid limits
    const [y, m] = period.split("-").map(Number);
    const start = new Date(Date.UTC(y, m - 1, 1)).toISOString();
    const end = new Date(Date.UTC(y, m, 1)).toISOString();
    let all: any[] = [];
    let from = 0;
    const size = 1000;
    while (true) {
      const { data, error } = await supabase
        .from("orders")
        .select("subtotal,total,status,moderator,created_at")
        .gte("created_at", start)
        .lt("created_at", end)
        .range(from, from + size - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      all = all.concat(data);
      if (data.length < size) break;
      from += size;
    }
    const rows: ParsedRow[] = all.map((o: any) => ({
      date: String(o.created_at).slice(0, 10),
      moderator: o.moderator || "غير محدد",
      phone: "",
      value: Number(o.subtotal || 0),
      status: o.status === "delivered" ? "تم" : o.status === "cancelled" ? "ملغي" : "قيد التوصيل",
    }));
    setSystemAgg(aggregate(rows));
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: false });
      // Prefer "Form Responses 1" if exists
      const sheetName = wb.SheetNames.find((n) => /Form|Responses|Sheet1/i.test(n)) || wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: "" });
      const { headerIdx, cols } = findHeaderRow(json as any[][]);
      const out: ParsedRow[] = [];
      for (let i = headerIdx + 1; i < json.length; i++) {
        const r: any = json[i];
        if (!r || r.every((c: any) => c === "" || c == null)) continue;
        const date = toISODate(r[cols.date]);
        if (!date) continue;
        if (!date.startsWith(period)) continue;
        const valRaw = r[cols.value];
        const val = typeof valRaw === "number" ? valRaw : parseFloat(String(valRaw).replace(/[^0-9.-]/g, ""));
        out.push({
          date,
          moderator: norm(r[cols.moderator]),
          phone: norm(cols.phone !== undefined ? r[cols.phone] : ""),
          value: isNaN(val) ? 0 : val,
          status: cols.status !== undefined ? norm(r[cols.status]) : "",
        });
      }
      if (out.length === 0) {
        toast.error(`لم يتم العثور على أي صفوف للفترة ${period} في الملف`);
        setParsedRows([]); setExcelAgg(null);
      } else {
        setParsedRows(out);
        setExcelAgg(aggregate(out));
        setFilename(file.name);
        await loadSystemAggregates();
        toast.success(`تم قراءة ${out.length} صفًا من الملف`);
      }
    } catch (err: any) {
      toast.error(err.message || "فشل قراءة الملف");
    } finally {
      setLoading(false);
    }
  }

  async function saveSnapshotAndCompare() {
    if (!excelAgg) return;
    setSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const payload = {
        period,
        filename,
        uploaded_by: userData.user?.id,
        total_rows: excelAgg.total_rows,
        total_value: excelAgg.total_value,
        delivered_count: excelAgg.delivered_count,
        delivered_value: excelAgg.delivered_value,
        cancelled_count: excelAgg.cancelled_count,
        pending_count: excelAgg.pending_count,
        per_moderator: excelAgg.per_moderator,
        per_day: excelAgg.per_day,
        raw_rows: parsedRows.slice(0, 5000), // cap
      };
      const { data, error } = await supabase.from("excel_snapshots").insert(payload).select("id").single();
      if (error) throw error;
      // Trigger compare to also generate any new alerts (already done by db trigger, but call to read result)
      const { data: cmp, error: cmpErr } = await supabase.rpc("compare_period_to_snapshot", { p_snapshot_id: data.id, p_raise_alert: false });
      if (cmpErr) throw cmpErr;
      const diff: any = cmp;
      if (diff?.has_diff) {
        toast.warning("تم حفظ الـ snapshot — توجد فروقات بين النظام والملف ✋");
      } else {
        toast.success("✅ النظام مطابق تمامًا للملف");
      }
      loadHistory(); loadAudit();
    } catch (err: any) {
      toast.error(err.message || "فشل الحفظ");
    } finally {
      setSaving(false);
    }
  }

  const diffOf = (a?: number, b?: number) => (a ?? 0) - (b ?? 0);

  return (
    <DashboardLayout>
      <Header title="مقارنة Excel بالنظام" description="رفع ملف Excel ومقارنته لحظيًا بأرقام النظام مع تنبيه عند وجود فروقات" />
      <div className="container mx-auto p-4 md:p-6 space-y-6" dir="rtl">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><FileSpreadsheet className="w-5 h-5" /> رفع ملف Excel</CardTitle>
            <CardDescription>
              يتم احتساب <strong>قيمة الاوردر بدون شحن</strong> من ملف Excel ومقارنتها مباشرة بـ <code>subtotal</code> في النظام (المنتجات فقط — بدون رسوم التوصيل).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <Label>الفترة (YYYY-MM)</Label>
                <Input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="2026-05" />
              </div>
              <div className="md:col-span-2">
                <Label>ملف Excel</Label>
                <Input type="file" accept=".xlsx,.xls" onChange={handleFile} disabled={loading} />
              </div>
            </div>
            {loading && <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="animate-spin w-4 h-4" /> جاري قراءة الملف...</div>}
            {excelAgg && (
              <Button onClick={saveSnapshotAndCompare} disabled={saving}>
                {saving ? <Loader2 className="animate-spin w-4 h-4 ms-2" /> : <Upload className="w-4 h-4 ms-2" />}
                حفظ Snapshot وتشغيل الفحص التلقائي
              </Button>
            )}
          </CardContent>
        </Card>

        {excelAgg && systemAgg && (
          <Card>
            <CardHeader>
              <CardTitle>مقارنة الإجماليات — {period}</CardTitle>
              <CardDescription>الفروق المسلطة بالأحمر تعني اختلاف بين الملف والنظام</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>المؤشر</TableHead>
                      <TableHead>Excel</TableHead>
                      <TableHead>النظام</TableHead>
                      <TableHead>الفرق</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[
                      ["إجمالي الطلبات", excelAgg.total_rows, systemAgg.total_rows],
                      ["إجمالي القيمة (بدون شحن)", Math.round(excelAgg.total_value), Math.round(systemAgg.total_value)],
                      ["طلبات تم تسليمها", excelAgg.delivered_count, systemAgg.delivered_count],
                      ["قيمة المُسلَّمة", Math.round(excelAgg.delivered_value), Math.round(systemAgg.delivered_value)],
                      ["طلبات ملغية", excelAgg.cancelled_count, systemAgg.cancelled_count],
                      ["طلبات قيد التوصيل", excelAgg.pending_count, systemAgg.pending_count],
                    ].map(([label, e, s]: any) => {
                      const d = (s as number) - (e as number);
                      return (
                        <TableRow key={label}>
                          <TableCell>{label}</TableCell>
                          <TableCell className="font-mono">{e.toLocaleString()}</TableCell>
                          <TableCell className="font-mono">{s.toLocaleString()}</TableCell>
                          <TableCell className={`font-mono ${d === 0 ? "text-green-600" : "text-destructive font-bold"}`}>
                            {d > 0 ? "+" : ""}{d.toLocaleString()}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        {excelAgg && systemAgg && (
          <Card>
            <CardHeader><CardTitle>المقارنة لكل موظفة</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الموظفة</TableHead>
                      <TableHead>طلبات Excel</TableHead>
                      <TableHead>طلبات النظام</TableHead>
                      <TableHead>فرق العدد</TableHead>
                      <TableHead>قيمة Excel</TableHead>
                      <TableHead>قيمة النظام</TableHead>
                      <TableHead>فرق القيمة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Array.from(new Set([...Object.keys(excelAgg.per_moderator), ...Object.keys(systemAgg.per_moderator)]))
                      .sort()
                      .map((mod) => {
                        const e = excelAgg.per_moderator[mod] || { rows: 0, value: 0 };
                        const s = systemAgg.per_moderator[mod] || { rows: 0, value: 0 };
                        const dr = s.rows - e.rows;
                        const dv = Math.round(s.value - e.value);
                        return (
                          <TableRow key={mod}>
                            <TableCell className="font-medium">{mod}</TableCell>
                            <TableCell className="font-mono">{e.rows}</TableCell>
                            <TableCell className="font-mono">{s.rows}</TableCell>
                            <TableCell className={`font-mono ${dr === 0 ? "text-green-600" : "text-destructive font-bold"}`}>{dr > 0 ? "+" : ""}{dr}</TableCell>
                            <TableCell className="font-mono">{Math.round(e.value).toLocaleString()}</TableCell>
                            <TableCell className="font-mono">{Math.round(s.value).toLocaleString()}</TableCell>
                            <TableCell className={`font-mono ${dv === 0 ? "text-green-600" : "text-destructive font-bold"}`}>{dv > 0 ? "+" : ""}{dv.toLocaleString()}</TableCell>
                          </TableRow>
                        );
                      })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><History className="w-5 h-5" /> سجل التدقيق — {period}</CardTitle>
            <CardDescription>كل عمليات الاستيراد والمزامنة لهذه الفترة</CardDescription>
          </CardHeader>
          <CardContent>
            {auditLog.length === 0 ? (
              <p className="text-muted-foreground text-sm">لا توجد سجلات بعد</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>التاريخ</TableHead>
                      <TableHead>العملية</TableHead>
                      <TableHead>الملف</TableHead>
                      <TableHead>الصفوف</TableHead>
                      <TableHead>تفاصيل</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {auditLog.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="text-sm">{new Date(a.performed_at).toLocaleString("ar-EG")}</TableCell>
                        <TableCell><Badge variant="outline">{a.action}</Badge></TableCell>
                        <TableCell className="text-xs">{a.source_file || "-"}</TableCell>
                        <TableCell className="font-mono">{a.rows_affected || 0}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{JSON.stringify(a.details || {})}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
