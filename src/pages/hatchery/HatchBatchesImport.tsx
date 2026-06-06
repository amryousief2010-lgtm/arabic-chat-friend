import { useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Loader2, Upload, FileSpreadsheet, Database, AlertTriangle } from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

// ---------- helpers ----------
const num = (v: any): number => {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return isFinite(v) ? v : 0;
  const s = String(v).trim();
  if (!s || s.startsWith("#")) return 0;
  const n = Number(s.replace(/,/g, ""));
  return isFinite(n) ? n : 0;
};
const txt = (v: any): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s || s.startsWith("#")) return null;
  return s;
};
const toISODate = (v: any): string | null => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  if (!s || s.startsWith("#")) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
};
const isCapital = (name: string) => {
  const n = name.replace(/\s+/g, "");
  return n.includes("العاصمة") || n.includes("عاصمة");
};

const SHEET_NAME = "دفعات المعمل";

interface ParsedBatch {
  rowNumber: number;
  external_id: string | null;
  customer_name: string;
  is_capital: boolean;
  batch_seq: number;
  receive_date: string;
  received_eggs: number;
  damaged: number;
  net_eggs: number;
  entry_date: string | null;
  machine: string | null;
  candle1_date: string | null;
  candle1_infertile: number;
  candle1_fertile: number;
  candle2_date: string | null;
  candle2_dead: number;
  exit_date: string | null;
  hatcher_dead: number;
  hatched_chicks: number;
  notes: string | null;
  charge_total: number;
  received_money: number;
  remaining: number;
  dedup_key: string;
  errors: string[];
}

interface Summary {
  total: number;
  capital: number;
  external: number;
  totalEggs: number;
  capitalEggs: number;
  externalEggs: number;
  totalDamaged: number;
  totalNet: number;
  totalChicks: number;
  capitalChicks: number;
  externalChicks: number;
  totalCharge: number;
  totalReceived: number;
  totalRemaining: number;
  errorRows: number;
}

function parseSheet(buf: ArrayBuffer): { rows: ParsedBatch[]; summary: Summary } {
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const ws = wb.Sheets[SHEET_NAME];
  if (!ws) throw new Error(`لم يتم العثور على شيت "${SHEET_NAME}" في الملف`);
  const sheet = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as any[][];

  const rows: ParsedBatch[] = [];
  const summary: Summary = {
    total: 0, capital: 0, external: 0,
    totalEggs: 0, capitalEggs: 0, externalEggs: 0,
    totalDamaged: 0, totalNet: 0,
    totalChicks: 0, capitalChicks: 0, externalChicks: 0,
    totalCharge: 0, totalReceived: 0, totalRemaining: 0,
    errorRows: 0,
  };

  for (let i = 3; i < sheet.length; i++) {
    const r = sheet[i] || [];
    const customer_name = txt(r[1]);
    const batchNum = r[3];
    const receive_date = toISODate(r[4]);
    if (!customer_name || batchNum === null || batchNum === undefined || !receive_date) continue;

    const cap = isCapital(customer_name);
    const external_id = txt(r[0]);
    const batch_seq = num(batchNum);
    const received_eggs = num(r[5]);
    const damaged = num(r[6]);
    const net_eggs = num(r[7]);
    const hatched_chicks = num(r[18]);
    const charge_total = num(r[26]);
    const received_money = num(r[27]);
    const remaining = num(r[28]);

    const errors: string[] = [];
    if (received_eggs <= 0) errors.push("إجمالي البيض الوارد صفر");

    const dedup_key = external_id
      ? `EXT:${external_id}`
      : `${customer_name}|${batch_seq}|${receive_date}`;

    const row: ParsedBatch = {
      rowNumber: i + 1,
      external_id,
      customer_name,
      is_capital: cap,
      batch_seq,
      receive_date,
      received_eggs,
      damaged,
      net_eggs,
      entry_date: toISODate(r[8]),
      machine: txt(r[9]),
      candle1_date: toISODate(r[10]),
      candle1_infertile: num(r[11]),
      candle1_fertile: num(r[12]),
      candle2_date: toISODate(r[13]),
      candle2_dead: num(r[14]),
      exit_date: toISODate(r[16]),
      hatcher_dead: num(r[17]),
      hatched_chicks,
      notes: txt(r[22]),
      charge_total,
      received_money,
      remaining,
      dedup_key,
      errors,
    };
    rows.push(row);

    summary.total++;
    summary.totalEggs += received_eggs;
    summary.totalDamaged += damaged;
    summary.totalNet += net_eggs;
    summary.totalChicks += hatched_chicks;
    summary.totalCharge += charge_total;
    summary.totalReceived += received_money;
    summary.totalRemaining += remaining;
    if (cap) {
      summary.capital++;
      summary.capitalEggs += received_eggs;
      summary.capitalChicks += hatched_chicks;
    } else {
      summary.external++;
      summary.externalEggs += received_eggs;
      summary.externalChicks += hatched_chicks;
    }
    if (errors.length) summary.errorRows++;
  }
  return { rows, summary };
}

interface ImportReport {
  inserted: number;
  updated: number;
  duplicate: number;
  errors: number;
  errorDetails: { row: number; key: string; message: string }[];
  inserted_preview: { id: string; batch_number: string; customer: string; receive_date: string; received_eggs: number; hatched_chicks: number }[];
  logId: string | null;
}

export default function HatchBatchesImport() {
  const { user, roles } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<ParsedBatch[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);

  const onParse = async (f: File) => {
    setParsing(true);
    setReport(null);
    try {
      const buf = await f.arrayBuffer();
      const { rows, summary } = parseSheet(buf);
      setRows(rows);
      setSummary(summary);
      setFile(f);
      toast.success(`تم تحليل ${rows.length} دفعة`);
    } catch (e: any) {
      toast.error(e.message || "فشل التحليل");
    } finally { setParsing(false); }
  };

  const reset = () => {
    setRows(null); setSummary(null); setFile(null); setReport(null);
  };

  const onImport = async () => {
    if (!rows || !file || !summary) return;
    setImporting(true);
    setReport(null);
    try {
      // 1) Ensure customers exist
      const distinctNames = Array.from(new Set(rows.map(r => r.customer_name)));
      const { data: existingCustomers, error: ec } = await supabase
        .from("hatch_customers").select("id,name,customer_type")
        .in("name", distinctNames);
      if (ec) throw ec;
      const custByName = new Map<string, { id: string; type: string }>();
      (existingCustomers ?? []).forEach(c => custByName.set(c.name, { id: c.id, type: c.customer_type }));

      const toCreate = distinctNames
        .filter(n => !custByName.has(n))
        .map(n => ({ name: n, customer_type: isCapital(n) ? "internal" : "external" }));
      if (toCreate.length) {
        const { data: created, error: cc } = await supabase
          .from("hatch_customers").insert(toCreate).select("id,name,customer_type");
        if (cc) throw cc;
        (created ?? []).forEach(c => custByName.set(c.name, { id: c.id, type: c.customer_type }));
      }

      // 2) Existing batch_numbers for dedup
      const keys = rows.map(r => r.dedup_key);
      const { data: existingBatches, error: eb } = await supabase
        .from("hatch_batches").select("id,batch_number").in("batch_number", keys);
      if (eb) throw eb;
      const existingByKey = new Map<string, string>();
      (existingBatches ?? []).forEach(b => existingByKey.set(b.batch_number, b.id));

      // 3) Build insert/update payloads
      const toInsert: any[] = [];
      const toUpdate: { id: string; payload: any }[] = [];
      let duplicate = 0;
      const errorDetails: ImportReport["errorDetails"] = [];

      const seenKeys = new Set<string>();
      for (const r of rows) {
        if (r.errors.length) {
          errorDetails.push({ row: r.rowNumber, key: r.dedup_key, message: r.errors.join("؛ ") });
          continue;
        }
        if (seenKeys.has(r.dedup_key)) {
          duplicate++;
          continue;
        }
        seenKeys.add(r.dedup_key);

        const cust = custByName.get(r.customer_name);
        const payload: any = {
          batch_number: r.dedup_key,
          customer_id: cust?.id ?? null,
          receive_date: r.receive_date,
          received_eggs: r.received_eggs,
          net_eggs: r.net_eggs || (r.received_eggs - r.damaged),
          entry_date: r.entry_date,
          machine: r.machine,
          candle1_date: r.candle1_date,
          candle1_fertile: r.candle1_fertile,
          candle1_infertile: r.candle1_infertile,
          candle2_date: r.candle2_date,
          candle2_dead: r.candle2_dead,
          exit_date: r.exit_date,
          hatched_chicks: r.hatched_chicks,
          hatcher_dead: r.hatcher_dead,
          notes: r.notes,
          status: r.exit_date ? "completed" : "pending",
          created_by: user?.id ?? null,
        };
        const existingId = existingByKey.get(r.dedup_key);
        if (existingId) {
          toUpdate.push({ id: existingId, payload });
        } else {
          toInsert.push(payload);
        }
      }

      // 4) Insert in chunks
      const insertedRows: any[] = [];
      const chunk = 200;
      for (let i = 0; i < toInsert.length; i += chunk) {
        const slice = toInsert.slice(i, i + chunk);
        const { data, error } = await supabase
          .from("hatch_batches").insert(slice)
          .select("id,batch_number,customer_id,receive_date,received_eggs,hatched_chicks");
        if (error) {
          // record error and continue
          slice.forEach(s => errorDetails.push({ row: 0, key: s.batch_number, message: error.message }));
        } else {
          insertedRows.push(...(data ?? []));
        }
      }

      // 5) Updates one by one (small count expected)
      let updated = 0;
      for (const u of toUpdate) {
        const { error } = await supabase
          .from("hatch_batches").update(u.payload).eq("id", u.id);
        if (error) {
          errorDetails.push({ row: 0, key: u.payload.batch_number, message: error.message });
        } else {
          updated++;
        }
      }

      const inserted = insertedRows.length;
      const errors = errorDetails.length;

      // 6) Audit log
      const { data: logRow } = await supabase
        .from("hatch_batch_import_log")
        .insert({
          imported_by: user?.id ?? null,
          imported_by_name: user?.email ?? null,
          source_filename: file.name,
          total_rows: rows.length,
          inserted_count: inserted,
          updated_count: updated,
          duplicate_count: duplicate,
          error_count: errors,
          summary: summary as any,
          errors: errorDetails.slice(0, 100) as any,
        })
        .select("id").single();

      // 7) preview of first 10 inserted (resolve customer names)
      const custById = new Map<string, string>();
      custByName.forEach((v, name) => custById.set(v.id, name));
      const inserted_preview = insertedRows.slice(0, 10).map(r => ({
        id: r.id,
        batch_number: r.batch_number,
        customer: r.customer_id ? (custById.get(r.customer_id) ?? "—") : "—",
        receive_date: r.receive_date,
        received_eggs: r.received_eggs,
        hatched_chicks: r.hatched_chicks ?? 0,
      }));

      setReport({
        inserted, updated, duplicate, errors,
        errorDetails: errorDetails.slice(0, 50),
        inserted_preview,
        logId: logRow?.id ?? null,
      });
      toast.success(`تم الاستيراد: ${inserted} مدخل • ${updated} محدث • ${duplicate} مكرر`);
    } catch (e: any) {
      console.error("[HatchBatchesImport] failed", e);
      toast.error(`فشل الاستيراد: ${e.message ?? "خطأ غير معروف"}`, { duration: 10000 });
    } finally { setImporting(false); }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 p-4 max-w-7xl mx-auto" dir="rtl">
        <div>
          <h1 className="text-2xl font-bold">استيراد دفعات المعمل فقط</h1>
          <p className="text-muted-foreground text-sm mt-1">
            يقرأ شيت "دفعات المعمل" فقط من ملف Excel ويُدخل البيانات في جدول <code>hatch_batches</code> مع منع التكرار.
            لا يتم استيراد باقي الشيتات ولا يتم إنشاء أي حركات خزنة.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Upload className="w-5 h-5" /> 1) رفع ملف Excel</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input type="file" accept=".xlsx,.xls" disabled={parsing}
              onChange={(e) => e.target.files?.[0] && onParse(e.target.files[0])} />
            {parsing && <div className="text-sm flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> جاري التحليل…</div>}
          </CardContent>
        </Card>

        {summary && rows && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><FileSpreadsheet className="w-5 h-5" /> 2) معاينة دفعات المعمل</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="إجمالي الدفعات" value={summary.total} sub={`عاصمة ${summary.capital} / عملاء ${summary.external}`} />
                <Stat label="دفعات العاصمة" value={summary.capital} />
                <Stat label="دفعات العملاء" value={summary.external} />
                <Stat label="إجمالي البيض الوارد" value={summary.totalEggs} sub={`عاصمة ${summary.capitalEggs} / عملاء ${summary.externalEggs}`} />
                <Stat label="بيض العاصمة" value={summary.capitalEggs} />
                <Stat label="بيض العملاء" value={summary.externalEggs} />
                <Stat label="التالف" value={summary.totalDamaged} />
                <Stat label="صافي البيض" value={summary.totalNet} />
                <Stat label="إجمالي الكتاكيت" value={summary.totalChicks} sub={`عاصمة ${summary.capitalChicks} / عملاء ${summary.externalChicks}`} />
                <Stat label="كتاكيت العاصمة" value={summary.capitalChicks} />
                <Stat label="كتاكيت العملاء" value={summary.externalChicks} />
                <Stat label="إجمالي الحسابات" value={summary.totalCharge} money />
                <Stat label="المستلم" value={summary.totalReceived} money />
                <Stat label="المتبقي" value={summary.totalRemaining} money />
                <Stat label="صفوف بها أخطاء" value={summary.errorRows} warn />
              </div>
              <div className="flex gap-2 pt-2">
                <Button onClick={onImport} disabled={importing} size="lg">
                  {importing ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : <Database className="w-4 h-4 ml-2" />}
                  استيراد دفعات المعمل فقط
                </Button>
                <Button variant="ghost" onClick={reset}>إلغاء</Button>
              </div>
              <p className="text-xs text-muted-foreground">
                منع التكرار: ID الموجود في Excel إن وُجد، وإلا (اسم العميل + رقم الدفعة + تاريخ الوارد).
              </p>
            </CardContent>
          </Card>
        )}

        {report && (
          <Card>
            <CardHeader>
              <CardTitle>3) نتيجة الاستيراد</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="تم إدخالها" value={report.inserted} />
                <Stat label="تم تحديثها" value={report.updated} />
                <Stat label="مكررة (تم تجاهلها)" value={report.duplicate} />
                <Stat label="أخطاء" value={report.errors} warn />
              </div>
              {report.logId && (
                <div className="text-xs text-muted-foreground">
                  رقم سجل الاستيراد (Audit Log): <code>{report.logId}</code>
                </div>
              )}
              {report.inserted_preview.length > 0 && (
                <div>
                  <div className="font-medium text-sm mb-2">أول 10 دفعات تم إدخالها</div>
                  <div className="overflow-x-auto border rounded">
                    <table className="text-xs w-full">
                      <thead className="bg-muted/40">
                        <tr>
                          <th className="p-2 text-right">رقم الدفعة</th>
                          <th className="p-2 text-right">العميل</th>
                          <th className="p-2 text-right">تاريخ الوارد</th>
                          <th className="p-2 text-right">البيض</th>
                          <th className="p-2 text-right">الكتاكيت</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.inserted_preview.map(r => (
                          <tr key={r.id} className="border-t">
                            <td className="p-2">{r.batch_number}</td>
                            <td className="p-2">{r.customer}</td>
                            <td className="p-2">{r.receive_date}</td>
                            <td className="p-2">{r.received_eggs.toLocaleString("ar-EG")}</td>
                            <td className="p-2">{r.hatched_chicks.toLocaleString("ar-EG")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {report.errorDetails.length > 0 && (
                <div>
                  <div className="font-medium text-sm mb-2 flex items-center gap-1 text-destructive">
                    <AlertTriangle className="w-4 h-4" /> تفاصيل الأخطاء (أول 50)
                  </div>
                  <div className="text-xs space-y-1 max-h-64 overflow-auto border rounded p-2">
                    {report.errorDetails.map((e, i) => (
                      <div key={i}>صف {e.row || "—"} • {e.key} → {e.message}</div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
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
