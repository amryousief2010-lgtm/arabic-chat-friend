import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { Upload, FileCheck2, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

type ImportType = "products" | "meat_stock" | "feed_stock" | "packaging" | "meat_invoices" | "feed_invoices" | "meat_bom" | "feed_bom";

const TYPE_LABELS: Record<ImportType, string> = {
  products: "كتالوج المنتجات",
  meat_stock: "جرد مصنع اللحوم",
  feed_stock: "جرد مصنع الأعلاف",
  packaging: "مواد التعبئة والتغليف",
  meat_invoices: "فواتير تصنيع اللحوم",
  feed_invoices: "فواتير تصنيع الأعلاف",
  meat_bom: "وصفات اللحوم (BOM)",
  feed_bom: "تركيبات الأعلاف (BOM)",
};

export default function ImportWizard() {
  const [runs, setRuns] = useState<any[]>([]);
  const [type, setType] = useState<ImportType>("products");
  const [filename, setFilename] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadRuns = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("import_staging_runs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) toast.error(error.message);
    else setRuns(data ?? []);
    setLoading(false);
  };

  useEffect(() => { loadRuns(); }, []);

  const onFile = async (f: File) => {
    setFilename(f.name);
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(ws, { defval: null });
    setRows(json);
    toast.success(`تم تحليل ${json.length} صف من الملف`);
  };

  const upload = async () => {
    if (!rows.length) return toast.error("لا يوجد بيانات للرفع");
    setUploading(true);
    try {
      const { data: user } = await supabase.auth.getUser();
      const { data: run, error } = await supabase
        .from("import_staging_runs")
        .insert({
          import_type: type,
          source_filename: filename,
          total_rows: rows.length,
          uploaded_by: user.user?.id,
          status: "uploaded",
        })
        .select()
        .single();
      if (error) throw error;

      const chunks: any[][] = [];
      for (let i = 0; i < rows.length; i += 500) chunks.push(rows.slice(i, i + 500));
      let n = 0;
      for (const c of chunks) {
        const payload = c.map((r, idx) => ({
          run_id: run.id,
          row_number: n + idx + 1,
          raw_data: r,
          row_status: "pending",
        }));
        const { error: e2 } = await supabase.from("import_staging_rows").insert(payload);
        if (e2) throw e2;
        n += c.length;
      }
      toast.success(`تم رفع ${n} صف إلى المعاينة`);
      setRows([]);
      setFilename("");
      await loadRuns();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-4 p-4">
        <div>
          <h1 className="text-2xl font-bold">معالج الاستيراد المرحلي</h1>
          <p className="text-muted-foreground text-sm">
            رفع → معاينة → تحقق → اعتماد → ترحيل. لا تُكتب أي بيانات إنتاج مباشرة بدون اعتماد.
          </p>
        </div>

        <Card>
          <CardHeader><CardTitle>رفع ملف جديد</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid md:grid-cols-3 gap-3">
              <div>
                <label className="text-sm mb-1 block">نوع الاستيراد</label>
                <Select value={type} onValueChange={(v) => setType(v as ImportType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(TYPE_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-2">
                <label className="text-sm mb-1 block">ملف Excel</label>
                <Input type="file" accept=".xlsx,.xls" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
              </div>
            </div>
            {rows.length > 0 && (
              <div className="flex items-center justify-between gap-3 rounded-md border p-3 bg-muted/30">
                <div className="text-sm">
                  <FileCheck2 className="inline w-4 h-4 ml-1" />
                  {filename} — {rows.length} صف جاهز للرفع إلى المعاينة
                </div>
                <Button onClick={upload} disabled={uploading}>
                  {uploading ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <Upload className="w-4 h-4 ml-1" />}
                  رفع إلى المعاينة
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>جلسات الاستيراد السابقة</CardTitle></CardHeader>
          <CardContent>
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : runs.length === 0 ? (
              <div className="text-sm text-muted-foreground">لا توجد جلسات استيراد بعد.</div>
            ) : (
              <div className="space-y-2">
                {runs.map((r) => (
                  <div key={r.id} className="flex items-center justify-between border rounded p-2 text-sm">
                    <div className="flex-1">
                      <div className="font-medium">{TYPE_LABELS[r.import_type as ImportType]} • {r.source_filename}</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(r.created_at).toLocaleString("ar-EG")} • {r.total_rows} صف
                      </div>
                    </div>
                    <Badge variant={r.status === "posted" ? "default" : r.status === "errors" ? "destructive" : "secondary"}>
                      {r.status === "uploaded" && <Upload className="w-3 h-3 ml-1" />}
                      {r.status === "errors" && <AlertTriangle className="w-3 h-3 ml-1" />}
                      {r.status === "posted" && <CheckCircle2 className="w-3 h-3 ml-1" />}
                      {r.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
