import { useCallback, useEffect, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { attachRelated } from "@/lib/inventoryCostAccess";
import { useAuth } from "@/hooks/useAuth";
import { matchOutletLines, parseOutletStatementRows, type MatchedOutletLine, type OutletQtyUnit } from "@/lib/outletSalesStatement";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { FileSpreadsheet, Plus, Trash2 } from "lucide-react";

type Warehouse = { id: string; name: string };
type Statement = {
  id: string;
  warehouse_id: string;
  period_month: string;
  status: "draft" | "posted" | "reversed";
  notes: string | null;
  reversal_reason: string | null;
};
type DraftLine = {
  key: string;
  item_id: string;
  qty: string;
  unit: OutletQtyUnit;
  amount: string;
};
type CatalogItem = {
  id: string;
  name: string;
  sku: string | null;
  item_code: string | null;
  pack_weight_kg: number | null;
  barcode: string | null;
};

const STATUS_LABEL: Record<Statement["status"], string> = {
  draft: "مسودة",
  posted: "مرحّل",
  reversed: "معكوس",
};

const monthInput = (period: string) => (period || "").slice(0, 7);
const monthDate = (value: string) => (value ? `${value}-01` : "");

export default function OutletSalesStatements() {
  const { roles } = useAuth();
  const canOverride = roles.includes("general_manager") || roles.includes("executive_manager");
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [statements, setStatements] = useState<Statement[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [statementId, setStatementId] = useState<string | null>(null);
  const [status, setStatus] = useState<Statement["status"]>("draft");
  const [warehouseId, setWarehouseId] = useState("");
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [preview, setPreview] = useState<MatchedOutletLine[]>([]);
  const [previewErrors, setPreviewErrors] = useState<string[]>([]);
  const [overrideReason, setOverrideReason] = useState("");
  const [lockText, setLockText] = useState<string | null>(null);
  const [reverseOpen, setReverseOpen] = useState(false);
  const [reverseReason, setReverseReason] = useState("");
  const [busy, setBusy] = useState(false);

  const db = supabase as any;

  const loadStatements = useCallback(async () => {
    const { data, error } = await (supabase as any)
      .from("outlet_sales_statements")
      .select("id, warehouse_id, period_month, status, notes, reversal_reason")
      .order("period_month", { ascending: false });
    if (error) throw error;
    setStatements((data || []) as Statement[]);
  }, []);

  useEffect(() => {
    (supabase as any).rpc("list_outlet_sales_warehouses").then(({ data, error }: { data: Warehouse[] | null; error: { message: string } | null }) => {
      if (error) toast.error(error.message);
      else setWarehouses(data || []);
    });
    loadStatements().catch((e) => toast.error(e.message));
  }, [loadStatements]);

  useEffect(() => {
    if (!warehouseId) {
      setCatalog([]);
      setLockText(null);
      return;
    }
    (supabase as any).from("inventory_items_visible")
      .select("id, name, sku, item_code, pack_weight_kg, product_id")
      .eq("warehouse_id", warehouseId)
      .eq("is_active", true)
      .order("name")
      .then(async ({ data, error }: { data: any[] | null; error: { message: string } | null }) => {
        if (error) {
          toast.error(error.message);
          return;
        }
        const rows = await attachRelated(data || [], [
          { as: "product", idField: "product_id", table: "products", columns: "id, barcode" },
        ]);
        setCatalog(rows.map((row) => ({
          id: row.id,
          name: row.name,
          sku: row.sku,
          item_code: row.item_code,
          pack_weight_kg: row.pack_weight_kg,
          barcode: row.product?.barcode || null,
        })));
      });
    (supabase as any).rpc("warehouse_period_locked_until", { p_warehouse: warehouseId }).then(({ data }: { data: string | null }) => {
      if (!data || !month) {
        setLockText(null);
        return;
      }
      const lock = new Date(data);
      const start = new Date(`${month}-01T00:00:00+02:00`);
      setLockText(lock > start ? `جرد قفل هذا المخزن حتى ${lock.toLocaleString("ar-EG")}. الترحيل يحتاج تجاوز المدير العام أو التنفيذي.` : null);
    });
  }, [warehouseId, month]);

  const resetDraft = () => {
    setStatementId(null);
    setStatus("draft");
    setNotes("");
    setLines([]);
    setPreview([]);
    setPreviewErrors([]);
    setOverrideReason("");
  };

  const openStatement = async (row: Statement) => {
    setStatementId(row.id);
    setStatus(row.status);
    setWarehouseId(row.warehouse_id);
    setMonth(monthInput(row.period_month));
    setNotes(row.notes || "");
    setPreview([]);
    setPreviewErrors([]);
    const { data, error } = await db
      .from("outlet_sales_statement_lines")
      .select("id, item_id, qty_input, qty_unit, amount")
      .eq("statement_id", row.id)
      .order("sort_order");
    if (error) {
      toast.error(error.message);
      return;
    }
    setLines((data || []).map((line: any) => ({
      key: line.id,
      item_id: line.item_id,
      qty: String(line.qty_input),
      unit: line.qty_unit,
      amount: line.amount == null ? "" : String(line.amount),
    })));
  };

  const payloadLines = () => lines
    .filter((line) => line.item_id && Number(line.qty) > 0)
    .map((line) => ({
      item_id: line.item_id,
      qty: Number(line.qty),
      unit: line.unit,
      amount: line.amount.trim() === "" ? null : Number(line.amount),
    }));

  const save = async () => {
    setBusy(true);
    try {
      const { data, error } = await db.rpc("save_outlet_sales_statement", {
        p_id: statementId,
        p_warehouse_id: warehouseId,
        p_month: monthDate(month),
        p_notes: notes,
        p_lines: payloadLines(),
      });
      if (error) throw error;
      setStatementId(data.id);
      setStatus("draft");
      toast.success(`حُفظت المسودة. ${data.line_count} بند / ${data.total_kg} كجم`);
      await loadStatements();
    } catch (e: any) {
      toast.error(e.message || "تعذر الحفظ");
    } finally {
      setBusy(false);
    }
  };

  const post = async () => {
    if (preview.length || previewErrors.length) {
      toast.error("أدرج بنود الملف في المسودة أو أزل المعاينة قبل الترحيل");
      return;
    }
    setBusy(true);
    try {
      const saved = await db.rpc("save_outlet_sales_statement", {
        p_id: statementId,
        p_warehouse_id: warehouseId,
        p_month: monthDate(month),
        p_notes: notes,
        p_lines: payloadLines(),
      });
      if (saved.error) throw saved.error;
      const id = saved.data.id as string;
      setStatementId(id);
      const { data, error } = await db.rpc("post_outlet_sales_statement", {
        p_id: id,
        p_override_reason: overrideReason.trim() || null,
      });
      if (error) throw error;
      setStatus(data.status === "already_posted" ? "posted" : "posted");
      toast.success(data.status === "already_posted" ? "الكشف مرحّل من قبل ولم يُخصم مرة ثانية" : "رُحّل الكشف وخصم المخزون مرة واحدة");
      await loadStatements();
    } catch (e: any) {
      toast.error(e.message || "تعذر الترحيل");
    } finally {
      setBusy(false);
    }
  };

  const reverse = async () => {
    if (!statementId) return;
    setBusy(true);
    try {
      const { data, error } = await db.rpc("reverse_outlet_sales_statement", {
        p_id: statementId,
        p_reason: reverseReason,
      });
      if (error) throw error;
      setStatus("reversed");
      setReverseOpen(false);
      toast.success(data.status === "already_reversed" ? "الكشف معكوس من قبل" : "عُكس الكشف بحركة جديدة");
      await loadStatements();
    } catch (e: any) {
      toast.error(e.message || "تعذر العكس");
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File) => {
    const book = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const sheet = book.Sheets[book.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    const parsed = parseOutletStatementRows(rows);
    const matched = matchOutletLines(parsed.lines, catalog);
    setPreview(matched.ok);
    setPreviewErrors([...parsed.errors, ...matched.errors]);
  };

  const applyPreview = () => {
    if (previewErrors.length) return;
    setLines(preview.map((line, index) => ({
      key: `${line.item_id}-${index}`,
      item_id: line.item_id,
      qty: String(line.qty),
      unit: line.unit,
      amount: line.amount == null ? "" : String(line.amount),
    })));
    setPreview([]);
    toast.success("أُدرجت البنود في المسودة. احفظها قبل الترحيل.");
  };

  const editable = status === "draft";

  return (
    <DashboardLayout>
      <div className="space-y-4" dir="rtl">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">كشف مبيعات المنفذ</h1>
            <p className="text-sm text-muted-foreground">كارفور وهيلثي تيست. مسودة ثم ترحيل مرة واحدة لكل بند، والعكس بسبب مكتوب.</p>
          </div>
          <Button variant="outline" onClick={resetDraft}><Plus className="w-4 h-4 ml-1" />كشف جديد</Button>
        </div>

        <div className="grid lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-1">
            <CardHeader className="pb-2"><CardTitle className="text-base">الكشوف</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {statements.length === 0 && <p className="text-sm text-muted-foreground">لا توجد كشوف</p>}
              {statements.map((row) => (
                <button key={row.id} type="button" className="w-full text-right border rounded-md p-2 hover:bg-muted" onClick={() => openStatement(row)}>
                  <div className="flex justify-between gap-2">
                    <span>{warehouses.find((w) => w.id === row.warehouse_id)?.name || "منفذ"}</span>
                    <Badge variant="secondary">{STATUS_LABEL[row.status]}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">{monthInput(row.period_month)}</div>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                بيانات الكشف
                <Badge>{STATUS_LABEL[status]}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <Label>المخزن</Label>
                  <Select value={warehouseId} onValueChange={setWarehouseId} disabled={!editable}>
                    <SelectTrigger><SelectValue placeholder="كارفور أو هيلثي تيست" /></SelectTrigger>
                    <SelectContent>
                      {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>الشهر</Label>
                  <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} disabled={!editable} />
                </div>
              </div>
              <div>
                <Label>ملاحظة</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!editable} />
              </div>
              {lockText && <Alert><AlertDescription>{lockText}</AlertDescription></Alert>}

              <div className="flex items-center justify-between gap-2">
                <Label>البنود</Label>
                {editable && (
                  <Button type="button" size="sm" variant="outline" onClick={() => setLines((prev) => [...prev, { key: crypto.randomUUID(), item_id: "", qty: "", unit: "pack", amount: "" }])}>
                    إضافة بند
                  </Button>
                )}
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الصنف</TableHead>
                    <TableHead>الكمية</TableHead>
                    <TableHead>الوحدة</TableHead>
                    <TableHead>المبلغ</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line) => (
                    <TableRow key={line.key}>
                      <TableCell>
                        <Select value={line.item_id} onValueChange={(value) => setLines((prev) => prev.map((row) => row.key === line.key ? { ...row, item_id: value } : row))} disabled={!editable}>
                          <SelectTrigger><SelectValue placeholder="الصنف" /></SelectTrigger>
                          <SelectContent>
                            {catalog.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell><Input value={line.qty} onChange={(e) => setLines((prev) => prev.map((row) => row.key === line.key ? { ...row, qty: e.target.value } : row))} disabled={!editable} /></TableCell>
                      <TableCell>
                        <Select value={line.unit} onValueChange={(value: OutletQtyUnit) => setLines((prev) => prev.map((row) => row.key === line.key ? { ...row, unit: value } : row))} disabled={!editable}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="pack">عبوة</SelectItem>
                            <SelectItem value="kg">كجم</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell><Input value={line.amount} onChange={(e) => setLines((prev) => prev.map((row) => row.key === line.key ? { ...row, amount: e.target.value } : row))} disabled={!editable} placeholder="اختياري" /></TableCell>
                      <TableCell>
                        {editable && <Button type="button" size="icon" variant="ghost" onClick={() => setLines((prev) => prev.filter((row) => row.key !== line.key))}><Trash2 className="w-4 h-4" /></Button>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {editable && (
                <div className="space-y-2">
                  <Label className="flex items-center gap-2"><FileSpreadsheet className="w-4 h-4" />رفع إكسل أو CSV للمعاينة</Label>
                  <Input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => { const file = e.target.files?.[0]; if (file) onFile(file); }} />
                  <p className="text-xs text-muted-foreground">الأعمدة: الصنف أو الباركود، الكمية، الوحدة (عبوة أو كجم)، والمبلغ اختياري. لا يُرحَّل الملف قبل المعاينة والحفظ.</p>
                  {previewErrors.map((err) => <Alert key={err}><AlertDescription>{err}</AlertDescription></Alert>)}
                  {preview.length > 0 && (
                    <div className="space-y-2">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>الصنف</TableHead>
                            <TableHead>الكمية</TableHead>
                            <TableHead>كجم</TableHead>
                            <TableHead>المبلغ</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {preview.map((line) => (
                            <TableRow key={`${line.item_id}-${line.qty}-${line.unit}`}>
                              <TableCell>{line.name}</TableCell>
                              <TableCell>{line.qty} {line.unit === "pack" ? "عبوة" : "كجم"}</TableCell>
                              <TableCell className="font-mono">{line.quantity_kg}</TableCell>
                              <TableCell>{line.amount ?? "—"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      <Button type="button" variant="secondary" disabled={previewErrors.length > 0} onClick={applyPreview}>إدراج البنود في المسودة</Button>
                    </div>
                  )}
                </div>
              )}

              {editable && canOverride && (
                <div>
                  <Label>سبب التجاوز إن كان الشهر مقفلاً بجرد</Label>
                  <Input value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="ثلاثة أحرف على الأقل، للمدير العام أو التنفيذي" />
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {editable && <Button onClick={save} disabled={busy || !warehouseId || !month}>حفظ مسودة</Button>}
                {editable && <Button onClick={post} disabled={busy || !warehouseId || !month}>ترحيل</Button>}
                {status === "posted" && <Button variant="destructive" onClick={() => setReverseOpen(true)} disabled={busy}>عكس بسبب</Button>}
              </div>
            </CardContent>
          </Card>
        </div>

        <Dialog open={reverseOpen} onOpenChange={setReverseOpen}>
          <DialogContent dir="rtl">
            <DialogHeader><DialogTitle>عكس كشف المبيعات</DialogTitle></DialogHeader>
            <Textarea value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} placeholder="سبب العكس" />
            <DialogFooter>
              <Button variant="destructive" onClick={reverse} disabled={busy || reverseReason.trim().length < 3}>تأكيد العكس</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
