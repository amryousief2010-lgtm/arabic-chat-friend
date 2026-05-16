import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowRight, Upload, CheckCircle2, AlertTriangle, Download } from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { safeParseExcel, SafeExcelError } from "@/lib/safeExcel";

type Mode = "items" | "movements";
interface ParsedRow { row: number; data: any; errors: string[]; }

const itemTemplate = "warehouse_name,name,sku,category,unit,stock,low_stock_threshold,unit_cost\nالمخزن الرئيسي,قطعة غيار,SKU-001,قطع غيار,قطعة,100,10,50\n";
const moveTemplate = "warehouse_name,item_name_or_sku,movement_type,quantity,destination_warehouse_name,reference,party,notes\nالمخزن الرئيسي,SKU-001,in,50,,شراء,المورد س,\n";

const InventoryImport = () => {
  const { canManageWarehouses, user } = useAuth();
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>("items");
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [w, i] = await Promise.all([
        supabase.from("warehouses").select("id, name"),
        supabase.from("inventory_items").select("id, name, sku, warehouse_id, stock, unit_cost"),
      ]);
      setWarehouses(w.data || []);
      setItems(i.data || []);
    })();
  }, []);

  const validateItem = (row: any): string[] => {
    const errs: string[] = [];
    if (!row.warehouse_name?.trim()) errs.push("اسم المخزن مطلوب");
    else if (!warehouses.find(w => w.name === row.warehouse_name.trim())) errs.push(`المخزن "${row.warehouse_name}" غير موجود`);
    if (!row.name?.trim()) errs.push("اسم الصنف مطلوب");
    if (row.stock !== undefined && row.stock !== "" && isNaN(Number(row.stock))) errs.push("الرصيد يجب أن يكون رقمًا");
    if (row.unit_cost !== undefined && row.unit_cost !== "" && isNaN(Number(row.unit_cost))) errs.push("التكلفة يجب أن تكون رقمًا");
    return errs;
  };

  const validateMovement = (row: any): string[] => {
    const errs: string[] = [];
    const wh = warehouses.find(w => w.name === row.warehouse_name?.trim());
    if (!wh) errs.push(`المخزن "${row.warehouse_name}" غير موجود`);
    const key = row.item_name_or_sku?.trim();
    const item = items.find(i => (i.sku === key || i.name === key) && (!wh || i.warehouse_id === wh.id));
    if (!item) errs.push(`الصنف "${key}" غير موجود في هذا المخزن`);
    if (!["in", "out", "transfer", "adjustment"].includes(row.movement_type)) errs.push(`نوع حركة غير صحيح: ${row.movement_type}`);
    const q = Number(row.quantity);
    if (isNaN(q) || q <= 0) errs.push("الكمية يجب أن تكون رقمًا موجبًا");
    if (row.movement_type === "out" && item && Number(item.stock) < q) errs.push(`المخزون غير كافٍ (متاح ${item.stock})`);
    if (row.movement_type === "transfer") {
      if (!row.destination_warehouse_name?.trim()) errs.push("المخزن الوجهة مطلوب للتحويل");
      else if (!warehouses.find(w => w.name === row.destination_warehouse_name.trim())) errs.push("المخزن الوجهة غير موجود");
    }
    return errs;
  };

  const handleFile = async (file: File) => {
    setFileName(file.name);
    let rows: any[];
    try {
      const parsed = await safeParseExcel(file);
      rows = parsed.rows;
    } catch (e) {
      if (e instanceof SafeExcelError) {
        toast({ title: "تعذر قراءة الملف", description: e.message, variant: "destructive" });
        setParsed([]);
        return;
      }
      throw e;
    }
    const validator = mode === "items" ? validateItem : validateMovement;
    const result: ParsedRow[] = rows.map((data, idx) => ({
      row: idx + 2,
      data,
      errors: validator(data),
    }));
    setParsed(result);
  };

  const validRows = parsed.filter(r => r.errors.length === 0);
  const errorRows = parsed.filter(r => r.errors.length > 0);

  const save = async () => {
    if (validRows.length === 0) return;
    setSaving(true);
    try {
      if (mode === "items") {
        const payload = validRows.map(r => {
          const wh = warehouses.find(w => w.name === r.data.warehouse_name.trim())!;
          return {
            warehouse_id: wh.id,
            name: r.data.name.trim(),
            sku: r.data.sku?.trim() || null,
            category: r.data.category?.trim() || null,
            unit: r.data.unit?.trim() || "قطعة",
            stock: Number(r.data.stock) || 0,
            low_stock_threshold: Number(r.data.low_stock_threshold) || 10,
            unit_cost: Number(r.data.unit_cost) || 0,
          };
        });
        const { error } = await supabase.from("inventory_items").insert(payload);
        if (error) throw error;
      } else {
        const payload = validRows.map(r => {
          const wh = warehouses.find(w => w.name === r.data.warehouse_name.trim())!;
          const key = r.data.item_name_or_sku.trim();
          const item = items.find(i => (i.sku === key || i.name === key) && i.warehouse_id === wh.id)!;
          const dest = r.data.movement_type === "transfer" ? warehouses.find(w => w.name === r.data.destination_warehouse_name?.trim()) : null;
          return {
            item_id: item.id,
            warehouse_id: wh.id,
            movement_type: r.data.movement_type,
            quantity: Number(r.data.quantity),
            destination_warehouse_id: dest?.id || null,
            reference: r.data.reference?.trim() || null,
            party: r.data.party?.trim() || null,
            notes: r.data.notes?.trim() || null,
            unit_cost: item.unit_cost,
            performed_by: user?.id,
          };
        });
        const { error } = await supabase.from("inventory_movements").insert(payload);
        if (error) throw error;
      }
      toast({ title: "تم الحفظ", description: `تم استيراد ${validRows.length} سجلًا` });
      setParsed([]);
      setFileName("");
    } catch (e: any) {
      toast({ title: "فشل الحفظ", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  };

  const downloadTemplate = () => {
    const csv = mode === "items" ? itemTemplate : moveTemplate;
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${mode}_template.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Link to="/modules/warehouses"><Button variant="ghost" size="sm"><ArrowRight className="w-4 h-4 ml-1" />رجوع</Button></Link>
          <Upload className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">استيراد المخزون من CSV</h1>
            <p className="text-sm text-muted-foreground">استيراد الأصناف أو حركات المخزون مع التحقق قبل الحفظ</p>
          </div>
        </div>

        {!canManageWarehouses && (
          <Alert variant="destructive"><AlertDescription>تحتاج صلاحية إدارة المخازن لاستخدام الاستيراد</AlertDescription></Alert>
        )}

        <Tabs value={mode} onValueChange={v => { setMode(v as Mode); setParsed([]); setFileName(""); }}>
          <TabsList>
            <TabsTrigger value="items">استيراد أصناف</TabsTrigger>
            <TabsTrigger value="movements">استيراد حركات</TabsTrigger>
          </TabsList>

          <TabsContent value={mode} className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>1. تحميل القالب</CardTitle>
                <CardDescription>
                  {mode === "items"
                    ? "الأعمدة: warehouse_name, name, sku, category, unit, stock, low_stock_threshold, unit_cost"
                    : "الأعمدة: warehouse_name, item_name_or_sku, movement_type (in/out/transfer/adjustment), quantity, destination_warehouse_name, reference, party, notes"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" onClick={downloadTemplate}><Download className="w-4 h-4 ml-2" />تحميل القالب</Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>2. اختيار ملف CSV</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <Input type="file" accept=".csv,.xlsx,.xls" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} disabled={!canManageWarehouses} />
                {fileName && <p className="text-sm text-muted-foreground">الملف: {fileName} · {parsed.length} صف</p>}
              </CardContent>
            </Card>

            {parsed.length > 0 && (
              <>
                <div className="grid gap-4 md:grid-cols-3">
                  <Card><CardHeader className="pb-2"><CardDescription>إجمالي</CardDescription><CardTitle className="text-3xl">{parsed.length}</CardTitle></CardHeader></Card>
                  <Card className="border-success"><CardHeader className="pb-2"><CardDescription>صالحة</CardDescription><CardTitle className="text-3xl text-success">{validRows.length}</CardTitle></CardHeader></Card>
                  <Card className={errorRows.length ? "border-destructive" : ""}><CardHeader className="pb-2"><CardDescription>بها أخطاء</CardDescription><CardTitle className={`text-3xl ${errorRows.length ? "text-destructive" : ""}`}>{errorRows.length}</CardTitle></CardHeader></Card>
                </div>

                {errorRows.length > 0 && (
                  <Card className="border-destructive">
                    <CardHeader><CardTitle className="flex items-center gap-2 text-destructive"><AlertTriangle className="w-5 h-5" />تقرير الأخطاء</CardTitle></CardHeader>
                    <CardContent className="p-0 max-h-96 overflow-auto">
                      <Table>
                        <TableHeader><TableRow><TableHead>الصف</TableHead><TableHead>الأخطاء</TableHead><TableHead>البيانات</TableHead></TableRow></TableHeader>
                        <TableBody>
                          {errorRows.map((r, i) => (
                            <TableRow key={i}>
                              <TableCell><Badge variant="destructive">{r.row}</Badge></TableCell>
                              <TableCell><ul className="list-disc pr-4 text-sm text-destructive">{r.errors.map((e, k) => <li key={k}>{e}</li>)}</ul></TableCell>
                              <TableCell className="text-xs text-muted-foreground max-w-md truncate">{JSON.stringify(r.data)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                )}

                {validRows.length > 0 && (
                  <Card>
                    <CardHeader><CardTitle className="flex items-center gap-2 text-success"><CheckCircle2 className="w-5 h-5" />معاينة الصفوف الصالحة</CardTitle></CardHeader>
                    <CardContent className="p-0 max-h-96 overflow-auto">
                      <Table>
                        <TableHeader><TableRow>{Object.keys(validRows[0].data).map(k => <TableHead key={k}>{k}</TableHead>)}</TableRow></TableHeader>
                        <TableBody>
                          {validRows.slice(0, 50).map((r, i) => (
                            <TableRow key={i}>{Object.keys(r.data).map(k => <TableCell key={k} className="text-xs">{String(r.data[k] ?? "")}</TableCell>)}</TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      {validRows.length > 50 && <p className="text-center text-xs text-muted-foreground py-2">عرض 50 من {validRows.length}</p>}
                    </CardContent>
                  </Card>
                )}

                <div className="flex justify-end">
                  <Button onClick={save} disabled={saving || validRows.length === 0 || !canManageWarehouses} size="lg">
                    {saving ? "جارٍ الحفظ..." : `حفظ ${validRows.length} سجل صالح`}
                  </Button>
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
};

export default InventoryImport;
