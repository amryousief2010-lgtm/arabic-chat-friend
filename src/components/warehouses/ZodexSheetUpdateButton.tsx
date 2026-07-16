import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Upload, Loader2, CheckCircle2, FileSpreadsheet, PackageCheck, PackageX, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AGOUZA_WAREHOUSE_ID } from "@/lib/zodexClassify";

type Kind = "delivered" | "returned" | "unknown";

interface Row {
  bill_no: string;
  status: string;
  cod: number;
  shipment_date: string | null;
  kind: Kind;
}

const RETURN_RE = /مرتجع|مرفوض|رفض|راجع|إلغاء|الغاء|ملغى|ملغي/;
const DELIVERED_RE = /تسليم|تم التوصيل|تم التسليم|ناجح|delivered|success/i;

function normalizeBill(s: any) {
  return String(s || "").trim().toUpperCase().replace(/\s+/g, "");
}

function classify(status: string): Kind {
  const s = (status || "").trim();
  if (!s) return "unknown";
  if (RETURN_RE.test(s)) return "returned";
  if (DELIVERED_RE.test(s)) return "delivered";
  return "unknown";
}

interface Props {
  /** If provided, force a specific kind — otherwise auto-detect per row. */
  forceKind?: "delivered" | "returned";
  label?: string;
  variant?: "default" | "outline";
  className?: string;
}

export default function ZodexSheetUpdateButton({ forceKind, label, variant = "outline", className }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [filename, setFilename] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [result, setResult] = useState<{
    delivered: number;
    returned: number;
    not_found: string[];
    skipped: number;
    errors: string[];
  } | null>(null);

  const handleFile = async (file: File) => {
    setLoading(true);
    setFilename(file.name);
    setResult(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw: any[] = XLSX.utils.sheet_to_json(ws, { defval: null });

      const out: Row[] = [];
      for (const r of raw) {
        const bill = normalizeBill(
          r["رقم البوليصة"] ?? r["رقم البوليصه"] ?? r["Bill"] ?? r["bill_no"] ?? "",
        );
        if (!bill.startsWith("ZX")) continue;
        const status = String(
          r["الحالة"] ?? r["حالة الشحنة"] ?? r["حالة"] ?? r["Status"] ?? "",
        );
        const cod = Number(r["COD"] ?? r["مبلغ التحصيل"] ?? r["قيمة التحصيل"] ?? 0) || 0;
        const dateVal = r["تاريخ انشاء الشحنة"] ?? r["التاريخ"] ?? r["تاريخ الشحن"] ?? "";
        const dateStr = dateVal instanceof Date ? dateVal.toISOString() : String(dateVal || "");
        const kind: Kind = forceKind ?? classify(status);
        out.push({
          bill_no: bill,
          status,
          cod,
          shipment_date: dateStr ? dateStr.slice(0, 10) : null,
          kind,
        });
      }

      // Dedupe by bill_no (keep first occurrence)
      const seen = new Set<string>();
      const deduped = out.filter((r) => (seen.has(r.bill_no) ? false : (seen.add(r.bill_no), true)));

      setRows(deduped);
      setOpen(true);
      if (deduped.length === 0) {
        toast.error("مفيش بوالص ZX في الشيت");
      } else {
        toast.success(`تم تحليل ${deduped.length} بوليصة — راجع واعتمد`);
      }
    } catch (e: any) {
      toast.error(e?.message || "فشل قراءة الملف");
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const delivered = rows.filter((r) => r.kind === "delivered");
  const returned = rows.filter((r) => r.kind === "returned");
  const unknown = rows.filter((r) => r.kind === "unknown");

  const doSubmit = async () => {
    setSubmitting(true);
    const res = { delivered: 0, returned: 0, not_found: [] as string[], skipped: 0, errors: [] as string[] };
    try {
      const actionable = rows.filter((r) => r.kind !== "unknown");
      const bills = actionable.map((r) => r.bill_no);

      // Batch fetch matching orders
      const orderByBill = new Map<string, any>();
      const chunk = 400;
      for (let i = 0; i < bills.length; i += chunk) {
        const slice = bills.slice(i, i + chunk);
        const { data, error } = await supabase.from("orders")
          .select("id, order_number, status, source_warehouse_id, delivered_at, notes, shipping_bill_no")
          .in("shipping_bill_no", slice);
        if (error) throw error;
        for (const o of (data || []) as any[]) orderByBill.set(String(o.shipping_bill_no), o);
      }

      for (const row of actionable) {
        const ord = orderByBill.get(row.bill_no);
        if (!ord) { res.not_found.push(row.bill_no); continue; }

        if (row.kind === "delivered") {
          if (ord.status === "delivered") { res.skipped++; continue; }
          const patch: any = {
            status: "delivered",
            collection_status: "collected",
            total_at_delivery: row.cod || undefined,
            zodex_synced_at: new Date().toISOString(),
          };
          if (!ord.delivered_at) patch.delivered_at = row.shipment_date || new Date().toISOString();
          const { error } = await supabase.from("orders").update(patch).eq("id", ord.id);
          if (error) { res.errors.push(`${row.bill_no}: ${error.message}`); continue; }
          res.delivered++;
        } else if (row.kind === "returned") {
          if (ord.status === "cancelled") { res.skipped++; continue; }
          const stamp = new Date().toLocaleString("ar-EG");
          const reason = `مرتجع من زودكس (${row.status || "مرتجع"})`;
          const newNotes = `${ord.notes ? ord.notes + "\n" : ""}[مرتجع - ${stamp}] ${reason}`;
          const { error } = await supabase.from("orders").update({
            status: "cancelled",
            notes: newNotes,
            zodex_synced_at: new Date().toISOString(),
          } as any).eq("id", ord.id).neq("status", "cancelled");
          if (error) { res.errors.push(`${row.bill_no}: ${error.message}`); continue; }
          if (ord.source_warehouse_id === AGOUZA_WAREHOUSE_ID) {
            try {
              await supabase.rpc("release_agouza_stock_reservation", {
                p_order_id: ord.id, p_reason: "zodex_sheet_upload",
              });
            } catch { /* non-fatal */ }
          }
          res.returned++;
        }
      }

      setResult(res);
      toast.success(`تم تحديث ${res.delivered} تسليم و ${res.returned} مرتجع`);
    } catch (e: any) {
      toast.error(e?.message || "فشل التحديث");
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setRows([]);
    setResult(null);
    setFilename("");
    setOpen(false);
  };

  const btnLabel = label || (forceKind === "returned"
    ? "رفع شيت مرتجعات زودكس"
    : forceKind === "delivered"
    ? "رفع شيت تسليمات زودكس"
    : "رفع شيت تحديث أوردرات زودكس");

  const Icon = forceKind === "returned" ? PackageX : PackageCheck;

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
      />
      <Button
        variant={variant}
        className={className}
        onClick={() => inputRef.current?.click()}
        disabled={loading}
      >
        {loading ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Icon className="w-4 h-4 ml-2" />}
        {btnLabel}
      </Button>

      <Dialog open={open} onOpenChange={(v) => !v && reset()}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-blue-600" />
              {btnLabel} — {filename}
            </DialogTitle>
            <DialogDescription>
              راجع البوالص قبل الاعتماد. التحديث يتم بالمطابقة على رقم البوليصة (ZX...) في الأوردرات.
            </DialogDescription>
          </DialogHeader>

          {!result ? (
            <>
              <div className="grid grid-cols-4 gap-3 mb-4">
                <Stat label="إجمالي البوالص" value={rows.length} color="slate" />
                <Stat label="تسليمات ناجحة" value={delivered.length} color="emerald" />
                <Stat label="مرتجعات" value={returned.length} color="red" />
                <Stat label="حالة غير معروفة" value={unknown.length} color="amber" />
              </div>

              <Tabs defaultValue={delivered.length ? "delivered" : returned.length ? "returned" : "unknown"}>
                <TabsList>
                  <TabsTrigger value="delivered">تسليمات ({delivered.length})</TabsTrigger>
                  <TabsTrigger value="returned">مرتجعات ({returned.length})</TabsTrigger>
                  <TabsTrigger value="unknown">مش هيتحدث ({unknown.length})</TabsTrigger>
                </TabsList>
                <TabsContent value="delivered"><BillsTable rows={delivered} /></TabsContent>
                <TabsContent value="returned"><BillsTable rows={returned} /></TabsContent>
                <TabsContent value="unknown">
                  {unknown.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">مفيش صفوف بحالة غير معروفة</p>
                  ) : (
                    <>
                      <Alert className="mb-3 bg-amber-50 border-amber-300">
                        <AlertTriangle className="w-4 h-4" />
                        <AlertTitle>الصفوف دي حالتها غير واضحة</AlertTitle>
                        <AlertDescription>
                          مش هيتم تحديث الأوردرات دي — راجع الحالة في الشيت الأصلي أو استخدم زر المزامنة العادي.
                        </AlertDescription>
                      </Alert>
                      <BillsTable rows={unknown} />
                    </>
                  )}
                </TabsContent>
              </Tabs>

              <DialogFooter className="mt-4">
                <Button variant="ghost" onClick={reset}>إلغاء</Button>
                <Button
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  disabled={submitting || delivered.length + returned.length === 0}
                  onClick={doSubmit}
                >
                  {submitting ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 ml-2" />}
                  تأكيد وتحديث {delivered.length + returned.length} أوردر
                </Button>
              </DialogFooter>
            </>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-4 gap-3">
                <Stat label="تم تسليمها" value={result.delivered} color="emerald" />
                <Stat label="تم إلغاؤها (مرتجع)" value={result.returned} color="red" />
                <Stat label="مش موجودة عندنا" value={result.not_found.length} color="amber" />
                <Stat label="متجاهلة (محدَّثة قبل كدا)" value={result.skipped} color="slate" />
              </div>
              {result.not_found.length > 0 && (
                <Alert className="bg-amber-50 border-amber-300">
                  <AlertTriangle className="w-4 h-4" />
                  <AlertTitle>بوالص مش موجودة في نظامنا</AlertTitle>
                  <AlertDescription className="text-xs max-h-40 overflow-y-auto font-mono">
                    {result.not_found.join("، ")}
                  </AlertDescription>
                </Alert>
              )}
              {result.errors.length > 0 && (
                <Alert variant="destructive">
                  <AlertTitle>أخطاء</AlertTitle>
                  <AlertDescription className="text-xs max-h-40 overflow-y-auto">
                    {result.errors.map((e, i) => <div key={i}>{e}</div>)}
                  </AlertDescription>
                </Alert>
              )}
              <DialogFooter>
                <Button onClick={reset}>تمام</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  const cls: Record<string, string> = {
    slate: "bg-slate-50 border-slate-200 text-slate-800",
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-800",
    red: "bg-red-50 border-red-200 text-red-800",
    amber: "bg-amber-50 border-amber-200 text-amber-800",
  };
  return (
    <div className={`border rounded p-3 text-center ${cls[color]}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs">{label}</div>
    </div>
  );
}

function BillsTable({ rows }: { rows: Row[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground text-center py-6">لا توجد بوالص</p>;
  return (
    <div className="border rounded overflow-x-auto max-h-[50vh]">
      <table className="w-full text-xs text-right">
        <thead className="bg-muted/60 sticky top-0">
          <tr>
            <th className="p-2">البوليصة</th>
            <th className="p-2">التاريخ</th>
            <th className="p-2">الحالة (زودكس)</th>
            <th className="p-2">التحصيل</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.bill_no} className="border-t">
              <td className="p-2 font-mono">{r.bill_no}</td>
              <td className="p-2">{r.shipment_date || "-"}</td>
              <td className="p-2">{r.status || "-"}</td>
              <td className="p-2">{r.cod ? r.cod.toLocaleString() : "-"} ج</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
