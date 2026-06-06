import { useEffect, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Loader2, Upload, FileSpreadsheet, CheckCircle2, XCircle, AlertTriangle, Trash2, PlayCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { parseHatcheryWorkbook, type ParsedRow, type ParseSummary } from "@/lib/hatcheryImportParser";

const SHEET_LABEL: Record<string, string> = {
  customers: "عملاء المعمل",
  batches: "دفعات المعمل",
  production: "إنتاج الأمهات",
  shipments: "نقل البيض للمعمل",
  chick_movements: "حركة الكتاكيت",
};

export default function HatcheryImport() {
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [summary, setSummary] = useState<ParseSummary | null>(null);
  const [parsing, setParsing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [committing, setCommitting] = useState<string | null>(null);
  const [runs, setRuns] = useState<any[]>([]);

  const loadRuns = async () => {
    const { data } = await supabase
      .from("import_staging_runs")
      .select("*")
      .eq("import_type", "hatchery_workbook")
      .order("created_at", { ascending: false })
      .limit(30);
    setRuns(data ?? []);
  };
  useEffect(() => { loadRuns(); }, []);

  const onParse = async (f: File) => {
    setParsing(true);
    try {
      const buf = await f.arrayBuffer();
      const { rows, summary } = parseHatcheryWorkbook(buf);
      setRows(rows);
      setSummary(summary);
      setFile(f);
      toast.success(`تم تحليل ${rows.length.toLocaleString("ar-EG")} صف`);
    } catch (e: any) {
      toast.error(e.message || "فشل تحليل الملف");
    } finally { setParsing(false); }
  };

  const onUploadToStaging = async () => {
    if (!rows || !file) return;
    setUploading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const validation = {
        summary,
        rowsPerSheet: rows.reduce((a: Record<string, number>, r) => {
          a[r._sheet] = (a[r._sheet] || 0) + 1; return a;
        }, {}),
      };
      const { data: run, error } = await supabase
        .from("import_staging_runs")
        .insert({
          import_type: "hatchery_workbook",
          source_filename: file.name,
          status: "previewing",
          total_rows: rows.length,
          valid_rows: rows.filter(r => r.errors.length === 0).length,
          error_rows: rows.filter(r => r.errors.length > 0).length,
          validation_summary: validation as any,
          uploaded_by: u.user?.id,
        })
        .select().single();
      if (error) throw error;

      // chunk insert
      const chunk = 500;
      for (let i = 0; i < rows.length; i += chunk) {
        const slice = rows.slice(i, i + chunk).map((r, idx) => ({
          run_id: run.id,
          row_number: i + idx + 1,
          raw_data: { sheet: r._sheet, key: r._key, source_row: r._row } as any,
          parsed_data: r.data as any,
          row_status: r.errors.length ? "errors" : "valid",
          error_message: r.errors.join("؛ ") || null,
        }));
        const { error: e2 } = await supabase.from("import_staging_rows").insert(slice);
        if (e2) throw e2;
      }
      toast.success("تم رفع البيانات إلى Staging");
      setRows(null); setSummary(null); setFile(null);
      await loadRuns();
    } catch (e: any) {
      toast.error(e.message);
    } finally { setUploading(false); }
  };

  const onCommit = async (runId: string) => {
    setCommitting(runId);
    try {
      const { data, error } = await supabase.functions.invoke("hatchery-import-commit", {
        body: { run_id: runId },
      });
      if (error) throw error;
      toast.success(`تم الترحيل: ${JSON.stringify(data?.posted || {})}`);
      await loadRuns();
    } catch (e: any) {
      toast.error(e.message);
    } finally { setCommitting(null); }
  };

  const onCancel = async (runId: string) => {
    if (!confirm("إلغاء هذه الجلسة وحذف صفوف Staging؟")) return;
    await supabase.from("import_staging_rows").delete().eq("run_id", runId);
    await supabase.from("import_staging_runs")
      .update({ status: "cancelled" }).eq("id", runId);
    toast.success("تم الإلغاء");
    await loadRuns();
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 p-4 max-w-7xl mx-auto" dir="rtl">
        <div>
          <h1 className="text-2xl font-bold">استيراد ملف معمل التفريخ ومزرعة الأمهات</h1>
          <p className="text-muted-foreground text-sm mt-1">
            رفع → معاينة → اعتماد → ترحيل. لا تُكتب بيانات إنتاجية إلا بعد الاعتماد.
          </p>
        </div>

        {/* Step 1: Upload */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="w-5 h-5" /> 1) رفع ملف Excel
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              type="file"
              accept=".xlsx,.xls"
              disabled={parsing}
              onChange={(e) => e.target.files?.[0] && onParse(e.target.files[0])}
            />
            {parsing && <div className="text-sm flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> جاري التحليل…</div>}
          </CardContent>
        </Card>

        {/* Step 2: Preview */}
        {summary && rows && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5" /> 2) معاينة قبل الترحيل
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="عملاء" value={summary.customers.total} sub={`داخلي ${summary.customers.internal} / خارجي ${summary.customers.external}`} />
                <Stat label="دفعات المعمل" value={summary.batches.total} sub={`عاصمة ${summary.batches.capital} / عملاء ${summary.batches.external}`} />
                <Stat label="إجمالي البيض الوارد" value={summary.batches.totalEggs} sub={`عاصمة ${summary.batches.capitalEggs} / عملاء ${summary.batches.externalEggs}`} />
                <Stat label="إجمالي الكتاكيت" value={summary.batches.totalChicks} />
                <Stat label="إجمالي الحسابات" value={summary.batches.totalCharge} money />
                <Stat label="إجمالي المستلم" value={summary.batches.totalReceived} money />
                <Stat label="إجمالي المتبقي" value={summary.batches.totalRemaining} money />
                <Stat label="صفوف بها أخطاء" value={summary.errors} warn />
                <Stat label="إنتاج الأمهات" value={summary.production.total} sub={`بيض ${summary.production.totalEggs} • مستقبلي مُتجاهل ${summary.production.futureSkipped}`} />
                <Stat label="نقل البيض" value={summary.shipments.total} sub={`بيض ${summary.shipments.totalEggs} • تالف ${summary.shipments.totalDamaged}`} />
                <Stat label="حركة الكتاكيت" value={summary.chickMovements.total} />
              </div>

              <div className="flex gap-2 pt-2">
                <Button onClick={onUploadToStaging} disabled={uploading}>
                  {uploading ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : <Upload className="w-4 h-4 ml-2" />}
                  حفظ في Staging
                </Button>
                <Button variant="ghost" onClick={() => { setRows(null); setSummary(null); setFile(null); }}>إلغاء</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Runs */}
        <Card>
          <CardHeader>
            <CardTitle>جلسات الاستيراد</CardTitle>
          </CardHeader>
          <CardContent>
            {runs.length === 0 ? (
              <p className="text-sm text-muted-foreground">لا توجد جلسات بعد.</p>
            ) : (
              <div className="space-y-2">
                {runs.map((r) => {
                  const s = r.validation_summary?.summary as ParseSummary | undefined;
                  return (
                    <div key={r.id} className="border rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div>
                          <div className="font-medium">{r.source_filename}</div>
                          <div className="text-xs text-muted-foreground">
                            {new Date(r.created_at).toLocaleString("ar-EG")} • {r.total_rows} صف
                            {r.posted_at ? ` • مُرحَّل في ${new Date(r.posted_at).toLocaleString("ar-EG")}` : ""}
                          </div>
                        </div>
                        <StatusBadge status={r.status} />
                      </div>
                      {s && (
                        <div className="text-xs flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                          <span>عملاء: {s.customers.total}</span>
                          <span>دفعات: {s.batches.total}</span>
                          <span>إنتاج: {s.production.total}</span>
                          <span>نقل: {s.shipments.total}</span>
                          <span>كتاكيت: {s.chickMovements.total}</span>
                        </div>
                      )}
                      {(r.status === "previewing" || r.status === "validated" || r.status === "errors") && (
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => onCommit(r.id)} disabled={committing === r.id}>
                            {committing === r.id ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : <PlayCircle className="w-4 h-4 ml-2" />}
                            اعتماد وترحيل
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => onCancel(r.id)}>
                            <Trash2 className="w-4 h-4 ml-2" /> إلغاء الجلسة
                          </Button>
                        </div>
                      )}
                      {r.status === "posted" && r.validation_summary?.posted && (
                        <pre className="text-xs bg-muted/30 rounded p-2 overflow-auto">
                          {JSON.stringify(r.validation_summary.posted, null, 2)}
                        </pre>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

function Stat({ label, value, sub, money, warn }: { label: string; value: number; sub?: string; money?: boolean; warn?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${warn && value > 0 ? "border-destructive/50 bg-destructive/5" : "bg-muted/20"}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold ${warn && value > 0 ? "text-destructive" : ""}`}>
        {money ? value.toLocaleString("ar-EG", { maximumFractionDigits: 2 }) + " ج.م" : value.toLocaleString("ar-EG")}
      </div>
      {sub && <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; Icon: any }> = {
    previewing: { label: "بانتظار الاعتماد", cls: "bg-amber-100 text-amber-900", Icon: AlertTriangle },
    validated: { label: "بانتظار الاعتماد", cls: "bg-amber-100 text-amber-900", Icon: AlertTriangle },
    errors: { label: "أخطاء", cls: "bg-destructive/10 text-destructive", Icon: XCircle },
    posted: { label: "مُرحَّل", cls: "bg-emerald-100 text-emerald-900", Icon: CheckCircle2 },
    cancelled: { label: "ملغي", cls: "bg-muted text-muted-foreground", Icon: XCircle },
    uploaded: { label: "مرفوع", cls: "bg-blue-100 text-blue-900", Icon: Upload },
  };
  const m = map[status] || { label: status, cls: "", Icon: AlertTriangle };
  return <Badge variant="outline" className={m.cls}><m.Icon className="w-3 h-3 ml-1" />{m.label}</Badge>;
}
