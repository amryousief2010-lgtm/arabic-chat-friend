import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload } from "lucide-react";
import { parseCsv, type RowIssue } from "@/lib/chatManagement/csvImport";

/** رفع CSV يدوي: تحليل في المتصفح ← تحقق ← معاينة ← استيراد عبر الدالة. لا يُرسل شيء قبل الضغط على «استيراد». */
export function CsvImportCard<T>(props: {
  title: string; description: string; columnsHint: string;
  map: (t: string[][]) => { rows: T[]; issues: RowIssue[]; missingColumns: string[] };
  preview: (r: T) => string[]; previewHeaders: string[];
  onImport: (rows: T[]) => Promise<string | null>;
}) {
  const [res, setRes] = useState<{ rows: T[]; issues: RowIssue[]; missingColumns: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const onFile = async (f: File | undefined) => {
    setMsg(null); if (!f) return;
    if (f.size > 5_000_000) { setMsg("الملف أكبر من 5 ميجا"); return; }
    setRes(props.map(parseCsv(await f.text())));
  };
  return (
    <Card>
      <CardHeader><CardTitle>{props.title}</CardTitle><CardDescription>{props.description}</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">{props.columnsHint}</p>
        <input type="file" accept=".csv,text/csv" aria-label="ملف CSV" onChange={(e) => onFile(e.target.files?.[0])} className="text-sm" />
        {res?.missingColumns.length ? <p role="alert" className="text-sm text-[#F37346]">أعمدة ناقصة: {res.missingColumns.join("، ")}</p> : null}
        {res && !res.missingColumns.length && (
          <>
            <p className="text-sm">صالح: <b>{res.rows.length}</b> — مرفوض: <b className="text-[#F37346]">{res.issues.length}</b></p>
            {res.issues.length > 0 && (
              <ul className="max-h-32 overflow-auto text-xs text-[#F37346]">
                {res.issues.slice(0, 50).map((i) => <li key={i.row}>سطر {i.row}: {i.reason}</li>)}
              </ul>)}
            <div className="max-h-64 overflow-auto rounded border">
              <table className="w-full text-xs"><thead className="bg-muted"><tr>{props.previewHeaders.map((h) => <th key={h} className="p-1 text-right">{h}</th>)}</tr></thead>
                <tbody>{res.rows.slice(0, 50).map((r, i) => <tr key={i} className="border-t">{props.preview(r).map((c, j) => <td key={j} className="p-1">{c}</td>)}</tr>)}</tbody></table>
            </div>
            <Button disabled={busy || !res.rows.length} className="bg-[#A4288A] hover:bg-[#662D8C] text-white"
              onClick={async () => { setBusy(true); const m = await props.onImport(res.rows); setBusy(false); setMsg(m); if (m) setRes(null); }}>
              <Upload className="h-4 w-4 ml-1" />استيراد {res.rows.length} سطر
            </Button>
          </>)}
        {msg && <p role="status" className="text-sm">{msg}</p>}
      </CardContent>
    </Card>
  );
}
