import { useState } from "react";
import * as XLSX from "xlsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Upload, FileSpreadsheet, Download, AlertTriangle, CheckCircle2 } from "lucide-react";
import { validateBarcode } from "@/lib/printProductLabel";

interface Product {
  id: string;
  name: string;
  barcode: string | null;
}

interface Row {
  name: string;
  barcode: string;
  matchedId?: string;
  matchedName?: string;
  status: "match" | "no-match" | "unchanged" | "invalid";
  invalidReason?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
  onDone: () => void;
}

const normalize = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

const BarcodeImportDialog = ({ open, onOpenChange, products, onDone }: Props) => {
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);

  const reset = () => setRows([]);

  const handleFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      if (!json.length) {
        toast.error("الملف فارغ");
        return;
      }

      // Try to find the name & barcode columns automatically
      const nameKeys = ["name", "اسم", "الاسم", "اسم المنتج", "product", "functional name arabic", "functional name english"];
      const barcodeKeys = ["barcode", "الباركود", "كود", "code", "ean", "gtin"];
      const sample = json[0];
      const keys = Object.keys(sample);
      const nameKey = keys.find((k) => nameKeys.some((n) => normalize(k).includes(normalize(n)))) || keys[0];
      const barcodeKey = keys.find((k) => barcodeKeys.some((n) => normalize(k).includes(normalize(n)))) || keys[keys.length - 1];

      const parsed: Row[] = json
        .map((r) => {
          const name = String(r[nameKey] ?? "").trim();
          const barcode = String(r[barcodeKey] ?? "").replace(/\D/g, "");
          if (!name || !barcode) return null;

          const target = products.find(
            (p) => normalize(p.name) === normalize(name) || normalize(p.name).includes(normalize(name)) || normalize(name).includes(normalize(p.name))
          );

          let status: Row["status"] = "no-match";
          if (target) status = target.barcode === barcode ? "unchanged" : "match";

          return {
            name,
            barcode,
            matchedId: target?.id,
            matchedName: target?.name,
            status,
          } as Row;
        })
        .filter(Boolean) as Row[];

      setRows(parsed);
      toast.success(`تم تحليل ${parsed.length} صفًا من الملف`);
    } catch (e: any) {
      console.error(e);
      toast.error("تعذّر قراءة الملف");
    }
  };

  const handleSave = async () => {
    const toUpdate = rows.filter((r) => r.status === "match" && r.matchedId);
    if (!toUpdate.length) {
      toast.error("لا توجد تحديثات للحفظ");
      return;
    }
    setSaving(true);
    let ok = 0;
    let fail = 0;
    for (const r of toUpdate) {
      const { error } = await supabase
        .from("products")
        .update({ barcode: r.barcode })
        .eq("id", r.matchedId!);
      if (error) fail++;
      else ok++;
    }
    setSaving(false);
    if (ok) toast.success(`تم تحديث ${ok} منتجًا`);
    if (fail) toast.error(`${fail} صفًا فشل في التحديث`);
    onDone();
    reset();
    onOpenChange(false);
  };

  const stats = {
    match: rows.filter((r) => r.status === "match").length,
    unchanged: rows.filter((r) => r.status === "unchanged").length,
    nomatch: rows.filter((r) => r.status === "no-match").length,
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>استيراد الباركودات من ملف</DialogTitle>
          <DialogDescription>
            ارفع ملف CSV / Excel يحتوي على عمود لاسم المنتج وعمود للباركود. سيتم مطابقة المنتجات تلقائيًا وتحديث الأكواد دفعة واحدة.
          </DialogDescription>
        </DialogHeader>

        {!rows.length ? (
          <label className="flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-lg p-10 cursor-pointer hover:bg-muted/40">
            <FileSpreadsheet className="w-10 h-10 text-muted-foreground" />
            <div className="text-sm">اضغط لاختيار ملف .xlsx أو .csv</div>
            <Input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
          </label>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="default">سيتم تحديث: {stats.match}</Badge>
              <Badge variant="secondary">بدون تغيير: {stats.unchanged}</Badge>
              <Badge variant="destructive">غير مطابق: {stats.nomatch}</Badge>
            </div>
            <div className="max-h-[400px] overflow-auto border rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <th className="p-2 text-right">اسم الملف</th>
                    <th className="p-2 text-right">الباركود</th>
                    <th className="p-2 text-right">المطابق في النظام</th>
                    <th className="p-2 text-right">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="p-2">{r.name}</td>
                      <td className="p-2 font-mono text-xs" dir="ltr">{r.barcode}</td>
                      <td className="p-2 text-muted-foreground">{r.matchedName || "—"}</td>
                      <td className="p-2">
                        {r.status === "match" && <Badge>سيُحدّث</Badge>}
                        {r.status === "unchanged" && <Badge variant="secondary">بدون تغيير</Badge>}
                        {r.status === "no-match" && <Badge variant="destructive">غير مطابق</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <DialogFooter>
          {rows.length > 0 && (
            <Button variant="outline" onClick={reset} disabled={saving}>
              إعادة التحميل
            </Button>
          )}
          <Button onClick={handleSave} disabled={saving || stats.match === 0}>
            <Upload className="w-4 h-4 ml-2" />
            {saving ? "جارٍ الحفظ..." : `حفظ التحديثات (${stats.match})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BarcodeImportDialog;
