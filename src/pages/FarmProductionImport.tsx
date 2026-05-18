import { useState, useMemo, useCallback } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, XCircle, Info, Loader2 } from "lucide-react";
import { toast } from "sonner";

type DbField = "family_number" | "production_date" | "egg_count" | "notes";

const DB_FIELDS: { key: DbField; label: string; required: boolean }[] = [
  { key: "family_number", label: "رقم الأسرة", required: true },
  { key: "production_date", label: "تاريخ الإنتاج", required: true },
  { key: "egg_count", label: "عدد البيض", required: true },
  { key: "notes", label: "ملاحظات", required: false },
];

const AUTO_MAP: Record<DbField, string[]> = {
  family_number: ["رقم الاسرة", "رقم الأسرة", "الأسرة", "الاسرة", "family", "family_number", "family no", "اسرة"],
  production_date: ["التاريخ", "تاريخ الإنتاج", "تاريخ", "date", "production_date", "yyyy-mm-dd"],
  egg_count: ["عدد البيض", "البيض", "الانتاج", "الإنتاج", "egg", "eggs", "egg_count", "count"],
  notes: ["ملاحظات", "ملاحظة", "notes", "note", "comment"],
};

type LogEvent = { ts: string; type: "info" | "success" | "warn" | "error"; message: string };

type ParsedRow = Record<string, any>;

type MappedRow = {
  rowIndex: number;
  family_number: string;
  production_date: string;
  egg_count: number;
  notes: string | null;
  errors: string[];
  matchedFamilyId?: string | null;
  isDuplicate?: boolean;
};

function autoDetectMapping(headers: string[]): Record<DbField, string | ""> {
  const out: Record<DbField, string | ""> = { family_number: "", production_date: "", egg_count: "", notes: "" };
  for (const f of DB_FIELDS) {
    const candidates = AUTO_MAP[f.key];
    const found = headers.find((h) =>
      candidates.some((c) => h.toString().trim().toLowerCase().includes(c.toLowerCase()))
    );
    if (found) out[f.key] = found;
  }
  return out;
}

function parseExcelDate(v: any): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (m) {
    let [_, a, b, y] = m;
    if (y.length === 2) y = "20" + y;
    return `${y}-${b.padStart(2, "0")}-${a.padStart(2, "0")}`;
  }
  const m2 = s.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
  if (m2) {
    const [_, y, mo, d] = m2;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

export default function FarmProductionImport() {
  const [fileName, setFileName] = useState("");
  const [sheets, setSheets] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState("");
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<ParsedRow[]>([]);
  const [mapping, setMapping] = useState<Record<DbField, string | "">>({ family_number: "", production_date: "", egg_count: "", notes: "" });
  const [families, setFamilies] = useState<Map<string, string>>(new Map());
  const [existingKeys, setExistingKeys] = useState<Set<string>>(new Set());
  const [validated, setValidated] = useState<MappedRow[]>([]);
  const [progress, setProgress] = useState(0);
  const [log, setLog] = useState<LogEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<"upload" | "map" | "preview" | "done">("upload");

  const addLog = useCallback((type: LogEvent["type"], message: string) => {
    setLog((prev) => [...prev, { ts: new Date().toLocaleTimeString("ar-EG"), type, message }]);
  }, []);

  const handleFile = async (file: File) => {
    setBusy(true);
    setLog([]);
    setProgress(5);
    addLog("info", `جاري قراءة الملف: ${file.name}`);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: false });
      setWorkbook(wb);
      setSheets(wb.SheetNames);
      setFileName(file.name);
      setActiveSheet(wb.SheetNames[0]);
      loadSheet(wb, wb.SheetNames[0]);
      setStep("map");
      addLog("success", `تم قراءة الملف، عدد الأوراق: ${wb.SheetNames.length}`);
    } catch (e: any) {
      addLog("error", `فشل قراءة الملف: ${e.message}`);
      toast.error("فشل قراءة الملف");
    } finally {
      setProgress(20);
      setBusy(false);
    }
  };

  const loadSheet = (wb: XLSX.WorkBook, sheetName: string) => {
    const ws = wb.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json<ParsedRow>(ws, { defval: "", raw: true });
    if (!json.length) {
      addLog("warn", `الورقة "${sheetName}" فارغة`);
      setHeaders([]); setRawRows([]); return;
    }
    const hdrs = Object.keys(json[0]);
    setHeaders(hdrs);
    setRawRows(json);
    const auto = autoDetectMapping(hdrs);
    setMapping(auto);
    addLog("info", `الورقة "${sheetName}": ${json.length} صف، ${hdrs.length} عمود`);
    const matched = (Object.keys(auto) as DbField[]).filter((k) => auto[k]).length;
    addLog("success", `تم الربط التلقائي لـ ${matched}/${DB_FIELDS.length} حقول`);
  };

  const onSheetChange = (s: string) => {
    if (!workbook) return;
    setActiveSheet(s);
    loadSheet(workbook, s);
  };

  const missingRequired = useMemo(
    () => DB_FIELDS.filter((f) => f.required && !mapping[f.key]).map((f) => f.label),
    [mapping]
  );

  const runValidation = async () => {
    if (missingRequired.length) {
      toast.error(`أعمدة مطلوبة غير مربوطة: ${missingRequired.join("، ")}`);
      return;
    }
    setBusy(true); setProgress(30);
    addLog("info", "جاري جلب أسر المزرعة من قاعدة البيانات...");
    const { data: fam, error: famErr } = await supabase.from("farm_families").select("id, family_number");
    if (famErr) { addLog("error", `فشل جلب الأسر: ${famErr.message}`); setBusy(false); return; }
    const famMap = new Map<string, string>();
    (fam || []).forEach((f) => famMap.set(String(f.family_number).trim(), f.id));
    setFamilies(famMap);
    addLog("success", `تم جلب ${famMap.size} أسرة`);

    setProgress(50);
    addLog("info", "جاري التحقق من السجلات الموجودة لمنع التكرار...");
    const { data: existing, error: exErr } = await supabase
      .from("farm_egg_production")
      .select("family_id, production_date")
      .limit(10000);
    if (exErr) { addLog("warn", `تعذر فحص التكرار: ${exErr.message}`); }
    const keys = new Set<string>();
    (existing || []).forEach((r) => keys.add(`${r.family_id}|${r.production_date}`));
    setExistingKeys(keys);
    addLog("info", `سجلات حالية للمقارنة: ${keys.size}`);

    setProgress(70);
    addLog("info", "جاري التحقق من الصفوف ومطابقة الأسر...");
    const out: MappedRow[] = [];
    let errCount = 0, dupCount = 0, unmatchedCount = 0;
    rawRows.forEach((row, i) => {
      const errors: string[] = [];
      const famVal = String(row[mapping.family_number] ?? "").trim();
      const dateVal = parseExcelDate(row[mapping.production_date]);
      const eggRaw = row[mapping.egg_count];
      const eggNum = Number(String(eggRaw).replace(/[,\s]/g, ""));
      const notesVal = mapping.notes ? String(row[mapping.notes] ?? "").trim() : "";
      if (!famVal) errors.push("رقم الأسرة فارغ");
      if (!dateVal) errors.push("تاريخ غير صالح");
      if (isNaN(eggNum) || eggNum < 0) errors.push("عدد البيض غير صالح");
      const matchedId = famMap.get(famVal);
      if (famVal && !matchedId) { errors.push("أسرة غير مسجلة"); unmatchedCount++; }
      const dupKey = matchedId && dateVal ? `${matchedId}|${dateVal}` : "";
      const isDup = dupKey ? keys.has(dupKey) : false;
      if (isDup) dupCount++;
      if (errors.length) errCount++;
      out.push({
        rowIndex: i + 2,
        family_number: famVal,
        production_date: dateVal || "",
        egg_count: isNaN(eggNum) ? 0 : eggNum,
        notes: notesVal || null,
        errors,
        matchedFamilyId: matchedId || null,
        isDuplicate: isDup,
      });
    });
    setValidated(out);
    setProgress(100);
    addLog(errCount ? "warn" : "success", `انتهى التحقق: ${out.length} صف، ${errCount} خطأ، ${dupCount} مكرر، ${unmatchedCount} أسرة غير مطابقة`);
    setStep("preview");
    setBusy(false);
  };

  const validRows = useMemo(() => validated.filter((r) => !r.errors.length && !r.isDuplicate), [validated]);
  const errorRows = useMemo(() => validated.filter((r) => r.errors.length), [validated]);
  const dupRows = useMemo(() => validated.filter((r) => r.isDuplicate && !r.errors.length), [validated]);

  const runImport = async () => {
    if (!validRows.length) { toast.error("لا توجد صفوف صالحة للإدراج"); return; }
    setBusy(true); setProgress(0);
    addLog("info", `بدء إدراج ${validRows.length} سجل...`);
    const batchSize = 200;
    let inserted = 0;
    for (let i = 0; i < validRows.length; i += batchSize) {
      const chunk = validRows.slice(i, i + batchSize).map((r) => ({
        family_id: r.matchedFamilyId!,
        production_date: r.production_date,
        egg_count: r.egg_count,
        notes: r.notes,
      }));
      const { error } = await supabase.from("farm_egg_production").insert(chunk);
      if (error) {
        addLog("error", `فشل دفعة ${i / batchSize + 1}: ${error.message}`);
        toast.error("فشل الإدراج");
        setBusy(false);
        return;
      }
      inserted += chunk.length;
      setProgress(Math.round((inserted / validRows.length) * 100));
      addLog("success", `تم إدراج ${inserted}/${validRows.length}`);
    }
    addLog("success", `اكتمل الاستيراد: ${inserted} سجل`);
    toast.success(`تم استيراد ${inserted} سجل بنجاح`);
    setStep("done");
    setBusy(false);
  };

  const reset = () => {
    setFileName(""); setSheets([]); setActiveSheet(""); setWorkbook(null);
    setHeaders([]); setRawRows([]); setValidated([]); setLog([]); setProgress(0); setStep("upload");
  };

  return (
    <div className="container mx-auto p-4 space-y-4" dir="rtl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileSpreadsheet className="h-7 w-7 text-primary" />
            استيراد سجل إنتاج مزرعة الأمهات
          </h1>
          <p className="text-muted-foreground text-sm mt-1">رفع ملف Excel، ربط الأعمدة، التحقق، والمعاينة قبل الإدراج.</p>
        </div>
        {step !== "upload" && (
          <Button variant="outline" onClick={reset}>استيراد ملف جديد</Button>
        )}
      </div>

      <div className="flex gap-2 flex-wrap">
        {["upload", "map", "preview", "done"].map((s, i) => (
          <Badge key={s} variant={step === s ? "default" : "secondary"} className="text-sm">
            {i + 1}. {s === "upload" ? "رفع الملف" : s === "map" ? "ربط الأعمدة" : s === "preview" ? "المعاينة والتحقق" : "اكتمل"}
          </Badge>
        ))}
      </div>

      {step === "upload" && (
        <Card>
          <CardHeader><CardTitle>1) رفع ملف Excel</CardTitle></CardHeader>
          <CardContent>
            <Label htmlFor="file" className="block border-2 border-dashed rounded-lg p-10 text-center cursor-pointer hover:bg-muted/30 transition">
              <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
              <div className="font-medium">اضغط لاختيار ملف .xlsx أو .xls</div>
              <div className="text-xs text-muted-foreground mt-1">سيتم قراءة الملف محليًا قبل أي اتصال بقاعدة البيانات</div>
              <Input
                id="file" type="file" accept=".xlsx,.xls" className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
            </Label>
          </CardContent>
        </Card>
      )}

      {step === "map" && (
        <div className="grid md:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle>2) ربط أعمدة Excel بحقول قاعدة البيانات</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2 text-sm">
                <FileSpreadsheet className="h-4 w-4" />
                <span className="font-medium">{fileName}</span>
              </div>
              {sheets.length > 1 && (
                <div>
                  <Label>الورقة (Sheet)</Label>
                  <Select value={activeSheet} onValueChange={onSheetChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {sheets.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {DB_FIELDS.map((f) => (
                <div key={f.key} className="grid grid-cols-2 gap-2 items-center">
                  <Label>
                    {f.label} {f.required && <span className="text-destructive">*</span>}
                  </Label>
                  <Select value={mapping[f.key] || "__none__"} onValueChange={(v) => setMapping((m) => ({ ...m, [f.key]: v === "__none__" ? "" : v }))}>
                    <SelectTrigger><SelectValue placeholder="— غير مربوط —" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— غير مربوط —</SelectItem>
                      {headers.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ))}
              {missingRequired.length > 0 && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>أعمدة مطلوبة غير مربوطة</AlertTitle>
                  <AlertDescription>{missingRequired.join("، ")}</AlertDescription>
                </Alert>
              )}
              <Button onClick={runValidation} disabled={busy || !!missingRequired.length} className="w-full">
                {busy ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : null}
                التحقق ومعاينة الصفوف
              </Button>
              {busy && <Progress value={progress} />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>عينة من بيانات الملف ({rawRows.length} صف)</CardTitle></CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px]">
                <Table>
                  <TableHeader>
                    <TableRow>{headers.map((h) => <TableHead key={h}>{h}</TableHead>)}</TableRow>
                  </TableHeader>
                  <TableBody>
                    {rawRows.slice(0, 10).map((r, i) => (
                      <TableRow key={i}>
                        {headers.map((h) => <TableCell key={h} className="text-xs">{String(r[h] ?? "")}</TableCell>)}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      )}

      {step === "preview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">إجمالي الصفوف</div><div className="text-2xl font-bold">{validated.length}</div></CardContent></Card>
            <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">صالحة للإدراج</div><div className="text-2xl font-bold text-emerald-600">{validRows.length}</div></CardContent></Card>
            <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">مكررة</div><div className="text-2xl font-bold text-amber-600">{dupRows.length}</div></CardContent></Card>
            <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">بها أخطاء</div><div className="text-2xl font-bold text-destructive">{errorRows.length}</div></CardContent></Card>
          </div>

          {errorRows.length > 0 && (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertTitle>تقرير الأخطاء ({errorRows.length})</AlertTitle>
              <AlertDescription>
                <ScrollArea className="h-32 mt-2">
                  <ul className="text-xs space-y-1">
                    {errorRows.slice(0, 50).map((r) => (
                      <li key={r.rowIndex}>صف {r.rowIndex} — أسرة "{r.family_number}": {r.errors.join("، ")}</li>
                    ))}
                  </ul>
                </ScrollArea>
              </AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>3) معاينة الصفوف قبل الإدراج</span>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setStep("map")}>رجوع للربط</Button>
                  <Button onClick={runImport} disabled={busy || !validRows.length}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <CheckCircle2 className="h-4 w-4 ml-2" />}
                    تأكيد وإدراج {validRows.length} سجل
                  </Button>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {busy && <Progress value={progress} className="mb-3" />}
              <ScrollArea className="h-[400px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>صف</TableHead>
                      <TableHead>الحالة</TableHead>
                      <TableHead>الأسرة</TableHead>
                      <TableHead>التاريخ</TableHead>
                      <TableHead>البيض</TableHead>
                      <TableHead>ملاحظات</TableHead>
                      <TableHead>ملاحظات النظام</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {validated.slice(0, 200).map((r) => (
                      <TableRow key={r.rowIndex} className={r.errors.length ? "bg-destructive/5" : r.isDuplicate ? "bg-amber-50" : ""}>
                        <TableCell>{r.rowIndex}</TableCell>
                        <TableCell>
                          {r.errors.length ? <Badge variant="destructive">خطأ</Badge>
                            : r.isDuplicate ? <Badge className="bg-amber-500">مكرر</Badge>
                            : <Badge className="bg-emerald-600">صالح</Badge>}
                        </TableCell>
                        <TableCell>{r.family_number} {r.matchedFamilyId && <CheckCircle2 className="inline h-3 w-3 text-emerald-600" />}</TableCell>
                        <TableCell>{r.production_date}</TableCell>
                        <TableCell>{r.egg_count.toLocaleString("ar-EG")}</TableCell>
                        <TableCell className="text-xs">{r.notes}</TableCell>
                        <TableCell className="text-xs text-destructive">{r.errors.join("، ") || (r.isDuplicate ? "موجود سابقًا" : "")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {validated.length > 200 && <div className="text-xs text-muted-foreground p-2 text-center">عرض أول 200 صف فقط في المعاينة</div>}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      )}

      {step === "done" && (
        <Alert>
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <AlertTitle>اكتمل الاستيراد بنجاح</AlertTitle>
          <AlertDescription>تم إدراج {validRows.length} سجل في إنتاج المزرعة.</AlertDescription>
        </Alert>
      )}

      {log.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">سجل أحداث الاستيراد</CardTitle></CardHeader>
          <CardContent>
            <ScrollArea className="h-48">
              <ul className="space-y-1 text-xs font-mono">
                {log.map((l, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-muted-foreground">{l.ts}</span>
                    {l.type === "success" && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 flex-shrink-0 mt-0.5" />}
                    {l.type === "error" && <XCircle className="h-3.5 w-3.5 text-destructive flex-shrink-0 mt-0.5" />}
                    {l.type === "warn" && <AlertCircle className="h-3.5 w-3.5 text-amber-600 flex-shrink-0 mt-0.5" />}
                    {l.type === "info" && <Info className="h-3.5 w-3.5 text-blue-600 flex-shrink-0 mt-0.5" />}
                    <span>{l.message}</span>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
