import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Factory, Plus, Trash2, CheckCircle2, Send, Loader2, Printer, Eye } from "lucide-react";
import DashboardLayout from "@/components/layout/DashboardLayout";

type Kind = "raw" | "spice" | "packaging";
type Warehouse = { id: string; name: string; type: string };
type RawItem = { id: string; name: string; unit: string; current_stock: number; avg_cost: number; kind: Kind; is_active: boolean };
type Line = { tmp: string; item_id: string; item_name: string; kind: Kind; unit: string; quantity: number; unit_cost: number; line_total: number; notes: string | null };
type Invoice = {
  id: string; invoice_no: string | null; product_name: string; finished_qty: number; unit: string;
  status: string; raw_cost: number; spice_cost: number; packaging_cost: number; extra_cost: number;
  materials_total_cost: number; total_manufacturing_cost: number; unit_cost: number | null;
  factory_warehouse_id: string; finished_item_id: string | null; destination_kind: string;
  transfer_no: string | null; created_at: string; approved_at: string | null; approved_by: string | null;
  notes: string | null;
};

const KIND_LABEL: Record<Kind,string> = { raw: "خامة", spice: "بهارات", packaging: "تغليف" };
const PRODUCT_PRESETS = ["برجر نعام", "كفتة نعام", "سجق نعام", "مفروم نعام", "حواوشي", "نقانق", "شاورما", "شيش"];
const newLine = (k: Kind = "raw"): Line => ({ tmp: crypto.randomUUID(), item_id: "", item_name: "", kind: k, unit: "كجم", quantity: 0, unit_cost: 0, line_total: 0, notes: null });
const esc = (s: any) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const fmt = (n: any) => Number(n || 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 });

export default function ManufacturingInvoices() {
  const { user, roles } = useAuth();
  const isApprover = roles?.some(r => r === "general_manager" || r === "executive_manager" || r === "meat_factory_manager" || r === "production_manager");
  const [tab, setTab] = useState("new");
  const [factoryWarehouses, setFactoryWarehouses] = useState<Warehouse[]>([]);
  const [mainWarehouses, setMainWarehouses] = useState<Warehouse[]>([]);
  const [factoryWarehouseId, setFactoryWarehouseId] = useState<string>("");
  const [items, setItems] = useState<RawItem[]>([]);
  const [productName, setProductName] = useState("");
  const [productNameOther, setProductNameOther] = useState("");
  const [finishedQty, setFinishedQty] = useState<number>(0);
  const [unit, setUnit] = useState("كجم");
  const [destinationKind, setDestinationKind] = useState<"factory_warehouse"|"main_warehouse_direct">("factory_warehouse");
  const [notes, setNotes] = useState("");
  const [extraCost, setExtraCost] = useState<number>(0);
  const [rawLines, setRawLines] = useState<Line[]>([newLine("raw")]);
  const [packLines, setPackLines] = useState<Line[]>([newLine("packaging")]);
  const [saving, setSaving] = useState(false);
  const [invoiceUuid, setInvoiceUuid] = useState<string>(() => crypto.randomUUID());

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [viewing, setViewing] = useState<Invoice | null>(null);
  const [viewLines, setViewLines] = useState<any[]>([]);
  const [transferInv, setTransferInv] = useState<Invoice | null>(null);
  const [transferDestId, setTransferDestId] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const fetchAll = async () => {
    const [whs, inv, ri] = await Promise.all([
      supabase.from("warehouses").select("id, name, type").order("name"),
      supabase.from("meat_manufacturing_invoices" as any).select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("meat_factory_raw_items" as any).select("id,name,unit,current_stock,avg_cost,kind,is_active").eq("is_active", true).order("name"),
    ]);
    if (whs.data) {
      const factory = whs.data.filter(w => w.name?.includes("مصنع اللحوم"));
      const main = whs.data.filter(w => w.type === "finished_goods" && !w.name?.includes("مصنع"));
      setFactoryWarehouses(factory);
      setMainWarehouses(main);
      if (factory[0]) setFactoryWarehouseId(prev => prev || factory[0].id);
    }
    if (inv.data) setInvoices(inv.data as any);
    if (ri.data) setItems(ri.data as any);
  };

  useEffect(() => { fetchAll(); }, []);

  const rawCandidates = useMemo(() => items.filter(i => i.kind === "raw" || i.kind === "spice"), [items]);
  const packCandidates = useMemo(() => items.filter(i => i.kind === "packaging"), [items]);

  const updateLine = (setter: (fn: (ls: Line[]) => Line[]) => void, candidates: RawItem[], tmp: string, patch: Partial<Line>) => {
    setter(ls => ls.map(l => {
      if (l.tmp !== tmp) return l;
      const m = { ...l, ...patch };
      if (patch.item_id) {
        const it = candidates.find(x => x.id === patch.item_id);
        if (it) { m.item_name = it.name; m.unit = it.unit; m.kind = it.kind; if (!m.unit_cost) m.unit_cost = Number(it.avg_cost || 0); }
      }
      m.line_total = Number((Number(m.quantity || 0) * Number(m.unit_cost || 0)).toFixed(3));
      return m;
    }));
  };

  const rawCost = useMemo(() => rawLines.filter(l => l.kind === "raw").reduce((s,l) => s + Number(l.line_total||0), 0), [rawLines]);
  const spiceCost = useMemo(() => rawLines.filter(l => l.kind === "spice").reduce((s,l) => s + Number(l.line_total||0), 0), [rawLines]);
  const packCost = useMemo(() => packLines.reduce((s,l) => s + Number(l.line_total||0), 0), [packLines]);
  const totalCost = rawCost + spiceCost + packCost + Number(extraCost || 0);
  const unitCost = finishedQty > 0 ? totalCost / finishedQty : 0;

  const finalProductName = productName === "أخرى" ? productNameOther.trim() : productName;

  const resetForm = () => {
    setRawLines([newLine("raw")]); setPackLines([newLine("packaging")]);
    setProductName(""); setProductNameOther(""); setFinishedQty(0); setNotes("");
    setExtraCost(0); setDestinationKind("factory_warehouse");
    setInvoiceUuid(crypto.randomUUID());
  };

  const submitDraft = async () => {
    if (!factoryWarehouseId) { toast.error("اختر مخزن مصنع اللحوم"); return; }
    if (!finalProductName) { toast.error("اختر/أدخل اسم المنتج النهائي"); return; }
    if (!finishedQty || finishedQty <= 0) { toast.error("أدخل كمية المنتج التام"); return; }
    const validRaw = rawLines.filter(l => l.item_id && l.quantity > 0);
    const validPack = packLines.filter(l => l.item_id && l.quantity > 0);
    const allLines = [...validRaw, ...validPack];
    if (validRaw.length === 0 || validPack.length === 0) {
      toast.error("لا يمكن حفظ فاتورة تصنيع بدون بنود خامات وتغليف");
      return;
    }

    setSaving(true);
    try {
      const existing = await supabase.from("meat_manufacturing_invoices" as any)
        .select("id, invoice_no").eq("manufacturing_invoice_uuid", invoiceUuid).maybeSingle();
      if (existing.data) { toast.info("الفاتورة محفوظة بالفعل"); await fetchAll(); resetForm(); setTab("list"); return; }

      const { data: noRes, error: noErr } = await supabase.rpc("gen_meat_invoice_no" as any);
      if (noErr) throw noErr;
      const invoiceNo = noRes as unknown as string;

      const { data: inv, error: insErr } = await supabase.from("meat_manufacturing_invoices" as any).insert({
        invoice_no: invoiceNo,
        product_name: finalProductName,
        finished_qty: finishedQty,
        unit,
        factory_warehouse_id: factoryWarehouseId,
        destination_kind: destinationKind,
        manufacturing_invoice_uuid: invoiceUuid,
        materials_total_cost: rawCost + spiceCost + packCost,
        raw_cost: rawCost, spice_cost: spiceCost, packaging_cost: packCost,
        extra_cost: Number(extraCost || 0), total_manufacturing_cost: totalCost,
        unit_cost: unitCost,
        status: "draft",
        notes: notes || null,
        created_by: user?.id || null,
      } as any).select("id").single();
      if (insErr) throw insErr;

      const { error: linesErr } = await supabase.from("meat_manufacturing_invoice_lines" as any).insert(
        allLines.map(l => ({
          invoice_id: (inv as any).id,
          item_id: l.item_id, item_name: l.item_name, kind: l.kind,
          unit: l.unit, quantity: l.quantity, unit_cost: l.unit_cost, line_total: l.line_total,
          notes: l.notes,
        })) as any
      );
      if (linesErr) {
        await supabase.from("meat_manufacturing_invoices" as any).delete().eq("id", (inv as any).id);
        throw new Error("فشل حفظ بنود الفاتورة، لم يتم إنشاء الفاتورة");
      }

      toast.success(`تم حفظ الفاتورة ${invoiceNo} بحالة مسودة — اضغط اعتماد للخصم`);
      resetForm();
      await fetchAll();
      setTab("list");
    } catch (e: any) {
      toast.error(e.message || "فشل حفظ الفاتورة");
    } finally {
      setSaving(false);
    }
  };

  const approve = async (id: string) => {
    if (!isApprover) { toast.error("الاعتماد متاح للمدير العام/التنفيذي/مدير المصنع فقط"); return; }
    const { count } = await supabase.from("meat_manufacturing_invoice_lines" as any)
      .select("id", { count: "exact", head: true }).eq("invoice_id", id);
    if (!count || count === 0) {
      toast.error("لا يمكن اعتماد فاتورة تصنيع بدون بنود خامات وتغليف");
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("approve_meat_manufacturing_invoice" as any, { p_invoice_id: id });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("تم اعتماد الفاتورة وخصم الخامات والتغليف");
    setViewing(null);
    await fetchAll();
  };

  const openTransfer = (inv: Invoice) => { setTransferInv(inv); setTransferDestId(mainWarehouses[0]?.id || ""); };
  const submitTransfer = async () => {
    if (!transferInv || !transferDestId) { toast.error("اختر المخزن الرئيسي"); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc("transfer_meat_invoice_to_warehouse" as any, {
      p_invoice_id: transferInv.id, p_destination_warehouse_id: transferDestId, p_notes: null,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    const r: any = data || {};
    toast.success(`تم إرسال التحويل ${r.transfer_no || ""} — بانتظار موافقة المخزن الرئيسي`);
    setTransferInv(null);
    await fetchAll();
  };

  const openView = async (inv: Invoice) => {
    setViewing(inv);
    const { data } = await supabase.from("meat_manufacturing_invoice_lines" as any).select("*").eq("invoice_id", inv.id).order("kind");
    setViewLines(data || []);
  };

  const printInvoice = async (inv: Invoice) => {
    const { data: ls } = await supabase.from("meat_manufacturing_invoice_lines" as any).select("*").eq("invoice_id", inv.id);
    const lines = (ls || []) as any[];
    const rawRows = lines.filter(l => l.kind !== "packaging");
    const packRows = lines.filter(l => l.kind === "packaging");
    const rowHtml = (l: any) => `<tr>
      <td>${esc(l.item_name)}</td><td>${esc(KIND_LABEL[(l.kind as Kind) || "raw"])}</td>
      <td>${esc(l.unit || "")}</td><td>${fmt(l.quantity)}</td>
      <td>${fmt(l.unit_cost)}</td><td>${fmt(l.line_total)}</td>
      <td>${l.stock_before != null ? fmt(l.stock_before) : "—"}</td>
      <td>${l.stock_after != null ? fmt(l.stock_after) : "—"}</td>
    </tr>`;
    const w = window.open("", "_blank", "width=950,height=720");
    if (!w) return toast.error("فعّل النوافذ المنبثقة للطباعة");
    w.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"/><title>فاتورة تصنيع ${esc(inv.invoice_no || "")}</title>
      <style>*{box-sizing:border-box;font-family:'Cairo','Tajawal',Arial,sans-serif}body{padding:24px;color:#111}
      .header{display:flex;justify-content:space-between;border-bottom:2px solid #7c3aed;padding-bottom:10px;margin-bottom:14px}
      .brand{color:#7c3aed;font-weight:bold;font-size:22px}
      h2{font-size:15px;margin:18px 0 6px;color:#7c3aed}
      .meta{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;color:#444;font-size:13px;margin-bottom:14px}
      table{width:100%;border-collapse:collapse;margin-top:6px}
      th,td{border:1px solid #ccc;padding:6px 8px;font-size:13px;text-align:right}
      th{background:#ede9fe}tfoot td{font-weight:bold;background:#fafafa}
      .summary{margin-top:14px;border:2px solid #7c3aed;border-radius:8px;padding:12px;background:#faf5ff}
      .summary table{margin:0}.summary th{background:#7c3aed;color:#fff}
      .signs{display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;margin-top:60px;text-align:center}
      .signs div{border-top:1px solid #999;padding-top:6px;font-size:13px}
      @media print{button{display:none}}</style></head><body>
      <div class="header"><div class="brand">نعام العاصمة</div><div>فاتورة تصنيع مصنع اللحوم</div></div>
      <div class="meta">
        <div><b>رقم الفاتورة:</b> ${esc(inv.invoice_no || "—")}</div>
        <div><b>التاريخ:</b> ${esc((inv.created_at || "").slice(0,10))}</div>
        <div><b>الحالة:</b> ${esc(inv.status)}</div>
        <div><b>المنتج النهائي:</b> ${esc(inv.product_name)}</div>
        <div><b>الكمية المنتجة:</b> ${fmt(inv.finished_qty)} ${esc(inv.unit)}</div>
        <div><b>وجهة المنتج:</b> ${inv.destination_kind === "main_warehouse_direct" ? "المخزن الرئيسي مباشرة" : "مخزن مصنع اللحوم"}</div>
      </div>

      <h2>المواد الخام والبهارات المستخدمة</h2>
      <table><thead><tr><th>الصنف</th><th>النوع</th><th>الوحدة</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th><th>المخزون قبل</th><th>المخزون بعد</th></tr></thead>
      <tbody>${rawRows.map(rowHtml).join("") || `<tr><td colspan="8" style="text-align:center">لا توجد</td></tr>`}</tbody></table>

      <h2>خامات التغليف المستخدمة</h2>
      <table><thead><tr><th>الصنف</th><th>النوع</th><th>الوحدة</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th><th>المخزون قبل</th><th>المخزون بعد</th></tr></thead>
      <tbody>${packRows.map(rowHtml).join("") || `<tr><td colspan="8" style="text-align:center">لا توجد</td></tr>`}</tbody></table>

      <div class="summary">
        <table>
          <tr><th>إجمالي تكلفة الخامات</th><td>${fmt(inv.raw_cost)} ج</td><th>إجمالي تكلفة البهارات</th><td>${fmt(inv.spice_cost)} ج</td></tr>
          <tr><th>إجمالي تكلفة التغليف</th><td>${fmt(inv.packaging_cost)} ج</td><th>تكلفة إضافية</th><td>${fmt(inv.extra_cost)} ج</td></tr>
          <tr><th>إجمالي تكلفة التصنيع</th><td>${fmt(inv.total_manufacturing_cost)} ج</td><th>تكلفة الوحدة</th><td>${fmt(inv.unit_cost)} ج / ${esc(inv.unit)}</td></tr>
        </table>
      </div>

      ${inv.notes ? `<div style="margin-top:14px"><b>ملاحظات:</b> ${esc(inv.notes)}</div>` : ""}
      <div class="signs"><div>مسؤول مصنع اللحوم</div><div>مشرف المخزن</div><div>المدير المعتمد</div></div>
      <div style="text-align:center;margin-top:18px"><button onclick="window.print()" style="padding:8px 22px;background:#7c3aed;color:#fff;border:0;border-radius:6px;cursor:pointer">طباعة</button></div>
      </body></html>`);
    w.document.close();
  };

  const statusBadge = (s: string) => {
    if (s === "draft") return <Badge variant="outline">مسودة</Badge>;
    if (s === "approved") return <Badge className="bg-emerald-600">معتمدة</Badge>;
    if (s === "transferred") return <Badge className="bg-blue-600">موردة للمخزن الرئيسي</Badge>;
    if (s === "rejected") return <Badge variant="destructive">مرفوضة</Badge>;
    if (s === "cancelled") return <Badge variant="secondary">ملغاة</Badge>;
    return <Badge>{s}</Badge>;
  };

  const renderLineTable = (
    lines: Line[],
    setter: (fn: (ls: Line[]) => Line[]) => void,
    candidates: RawItem[],
    kindLabel: string,
  ) => (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{kindLabel}</h3>
        <Button onClick={() => setter(ls => [...ls, newLine(candidates === packCandidates ? "packaging" : "raw")])} size="sm" variant="outline">
          <Plus className="w-4 h-4 ml-1" /> إضافة سطر
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>الصنف</TableHead>
            <TableHead>النوع</TableHead>
            <TableHead>الوحدة</TableHead>
            <TableHead>المتاح</TableHead>
            <TableHead>الكمية</TableHead>
            <TableHead>سعر الوحدة</TableHead>
            <TableHead>الإجمالي</TableHead>
            <TableHead>المتوقع بعد</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.length === 0 ? (
            <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-4">لا توجد أصناف</TableCell></TableRow>
          ) : lines.map(l => {
            const it = candidates.find(x => x.id === l.item_id);
            const after = it ? Number(it.current_stock) - Number(l.quantity || 0) : null;
            const insufficient = it && Number(l.quantity || 0) > Number(it.current_stock || 0);
            return (
              <TableRow key={l.tmp} className={insufficient ? "bg-red-50 dark:bg-red-950/30" : ""}>
                <TableCell className="min-w-[200px]">
                  <Select value={l.item_id} onValueChange={v => updateLine(setter, candidates, l.tmp, { item_id: v })}>
                    <SelectTrigger><SelectValue placeholder="اختر صنف" /></SelectTrigger>
                    <SelectContent className="max-h-80">
                      {candidates.map(c => (
                        <SelectItem key={c.id} value={c.id}>
                          <span className="text-xs text-muted-foreground ml-2">[{KIND_LABEL[c.kind]}]</span>{c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell><Badge variant="outline" className="text-xs">{KIND_LABEL[l.kind]}</Badge></TableCell>
                <TableCell className="text-xs">{l.unit}</TableCell>
                <TableCell className="text-xs">{it ? fmt(it.current_stock) : "—"}</TableCell>
                <TableCell><Input type="number" step="0.01" className="w-24" value={l.quantity || ""} onChange={e => updateLine(setter, candidates, l.tmp, { quantity: Number(e.target.value) })} /></TableCell>
                <TableCell><Input type="number" step="0.01" className="w-24" value={l.unit_cost || ""} onChange={e => updateLine(setter, candidates, l.tmp, { unit_cost: Number(e.target.value) })} /></TableCell>
                <TableCell className="font-medium">{fmt(l.line_total)}</TableCell>
                <TableCell className={insufficient ? "text-red-600 font-bold" : "text-muted-foreground"}>{after != null ? fmt(after) : "—"}</TableCell>
                <TableCell><Button size="icon" variant="ghost" onClick={() => setter(ls => ls.filter(x => x.tmp !== l.tmp))}><Trash2 className="w-4 h-4 text-red-600" /></Button></TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-4" dir="rtl">
        <div className="flex items-center gap-3">
          <Factory className="w-7 h-7 text-purple-600" />
          <div>
            <h1 className="text-2xl font-bold">فواتير تصنيع مصنع اللحوم</h1>
            <p className="text-sm text-muted-foreground">جدولان منفصلان للخامات والتغليف. الخصم وإضافة المنتج النهائي يتم فقط بعد اعتماد المدير.</p>
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="new">فاتورة جديدة</TabsTrigger>
            <TabsTrigger value="list">سجل التصنيع ({invoices.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="new" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">بيانات الفاتورة</CardTitle>
                <CardDescription>تُحفظ بحالة مسودة. الاعتماد يخصم الكميات ويضيف المنتج النهائي.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div>
                    <Label>مخزن مصنع اللحوم</Label>
                    <Select value={factoryWarehouseId} onValueChange={setFactoryWarehouseId}>
                      <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                      <SelectContent>{factoryWarehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>المنتج النهائي</Label>
                    <Select value={productName} onValueChange={setProductName}>
                      <SelectTrigger><SelectValue placeholder="اختر المنتج" /></SelectTrigger>
                      <SelectContent>
                        {PRODUCT_PRESETS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                        <SelectItem value="أخرى">أخرى (أدخل اسمًا)</SelectItem>
                      </SelectContent>
                    </Select>
                    {productName === "أخرى" && (
                      <Input className="mt-2" placeholder="اسم المنتج" value={productNameOther} onChange={e => setProductNameOther(e.target.value)} />
                    )}
                  </div>
                  <div><Label>الكمية النهائية</Label><Input type="number" step="0.01" value={finishedQty || ""} onChange={e => setFinishedQty(Number(e.target.value))} /></div>
                  <div>
                    <Label>الوحدة</Label>
                    <Select value={unit} onValueChange={setUnit}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="كجم">كجم</SelectItem><SelectItem value="عبوة">عبوة</SelectItem><SelectItem value="قطعة">قطعة</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <div className="md:col-span-2">
                    <Label>وجهة المنتج النهائي</Label>
                    <Select value={destinationKind} onValueChange={v => setDestinationKind(v as any)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="factory_warehouse">مخزن مصنع اللحوم (التوريد للمخزن الرئيسي لاحقًا)</SelectItem>
                        <SelectItem value="main_warehouse_direct">توريد مباشر للمخزن الرئيسي</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>تكلفة إضافية</Label><Input type="number" step="0.01" value={extraCost || ""} onChange={e => setExtraCost(Number(e.target.value))} /></div>
                </div>

                {renderLineTable(rawLines, setRawLines, rawCandidates, "المواد الخام والبهارات المستخدمة")}
                {renderLineTable(packLines, setPackLines, packCandidates, "خامات التغليف المستخدمة")}

                <Card className="border-purple-200 bg-purple-50/50 dark:bg-purple-950/20">
                  <CardContent className="pt-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <div><div className="text-muted-foreground">إجمالي الخامات</div><div className="font-bold text-lg">{fmt(rawCost)}</div></div>
                    <div><div className="text-muted-foreground">إجمالي البهارات</div><div className="font-bold text-lg">{fmt(spiceCost)}</div></div>
                    <div><div className="text-muted-foreground">إجمالي التغليف</div><div className="font-bold text-lg">{fmt(packCost)}</div></div>
                    <div><div className="text-muted-foreground">تكلفة إضافية</div><div className="font-bold text-lg">{fmt(extraCost)}</div></div>
                    <div className="col-span-2"><div className="text-muted-foreground">إجمالي تكلفة التصنيع</div><div className="font-bold text-xl text-purple-700">{fmt(totalCost)} ج</div></div>
                    <div className="col-span-2"><div className="text-muted-foreground">تكلفة الوحدة</div><div className="font-bold text-xl text-purple-700">{fmt(unitCost)} ج / {unit}</div></div>
                  </CardContent>
                </Card>

                <div><Label>ملاحظات</Label><Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="اختياري" /></div>

                <div className="flex justify-end">
                  <Button onClick={submitDraft} disabled={saving} className="bg-purple-600 hover:bg-purple-700">
                    {saving ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <CheckCircle2 className="w-4 h-4 ml-1" />}
                    حفظ الفاتورة (مسودة)
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="list" className="space-y-3">
            {invoices.length === 0 ? (
              <Card><CardContent className="py-10 text-center text-muted-foreground">لا توجد فواتير</CardContent></Card>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>رقم</TableHead>
                        <TableHead>المنتج</TableHead>
                        <TableHead>الكمية</TableHead>
                        <TableHead>خامات</TableHead>
                        <TableHead>تغليف</TableHead>
                        <TableHead>إجمالي</TableHead>
                        <TableHead>تكلفة الوحدة</TableHead>
                        <TableHead>الحالة</TableHead>
                        <TableHead>إجراءات</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invoices.map(inv => (
                        <TableRow key={inv.id}>
                          <TableCell className="font-mono text-xs">{inv.invoice_no}</TableCell>
                          <TableCell className="font-medium">{inv.product_name}</TableCell>
                          <TableCell>{fmt(inv.finished_qty)} {inv.unit}</TableCell>
                          <TableCell>{fmt(Number(inv.raw_cost)+Number(inv.spice_cost))}</TableCell>
                          <TableCell>{fmt(inv.packaging_cost)}</TableCell>
                          <TableCell>{fmt(inv.total_manufacturing_cost || inv.materials_total_cost)}</TableCell>
                          <TableCell>{inv.unit_cost ? fmt(inv.unit_cost) : "—"}</TableCell>
                          <TableCell>{statusBadge(inv.status)}</TableCell>
                          <TableCell className="space-x-1 space-x-reverse">
                            <Button size="sm" variant="outline" onClick={() => openView(inv)}><Eye className="w-3 h-3 ml-1" />عرض</Button>
                            <Button size="sm" variant="outline" onClick={() => printInvoice(inv)}><Printer className="w-3 h-3 ml-1" />طباعة</Button>
                            {inv.status === "draft" && isApprover && (
                              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => approve(inv.id)} disabled={busy}>
                                <CheckCircle2 className="w-3 h-3 ml-1" />اعتماد
                              </Button>
                            )}
                            {inv.status === "approved" && (
                              <Button size="sm" onClick={() => openTransfer(inv)} className="bg-blue-600 hover:bg-blue-700">
                                <Send className="w-3 h-3 ml-1" />توريد للرئيسي
                              </Button>
                            )}
                            {inv.status === "transferred" && inv.transfer_no && (
                              <span className="text-xs text-muted-foreground">#{inv.transfer_no}</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>

        <Dialog open={!!viewing} onOpenChange={(v) => !v && setViewing(null)}>
          <DialogContent className="max-w-4xl" dir="rtl">
            <DialogHeader><DialogTitle>تفاصيل فاتورة {viewing?.invoice_no}</DialogTitle></DialogHeader>
            {viewing && (
              <div className="space-y-3 text-sm max-h-[70vh] overflow-y-auto">
                <div className="grid grid-cols-3 gap-2">
                  <div><b>المنتج:</b> {viewing.product_name}</div>
                  <div><b>الكمية:</b> {fmt(viewing.finished_qty)} {viewing.unit}</div>
                  <div><b>الحالة:</b> {statusBadge(viewing.status)}</div>
                  <div><b>إجمالي الخامات:</b> {fmt(viewing.raw_cost)}</div>
                  <div><b>إجمالي البهارات:</b> {fmt(viewing.spice_cost)}</div>
                  <div><b>إجمالي التغليف:</b> {fmt(viewing.packaging_cost)}</div>
                  <div><b>الإجمالي:</b> {fmt(viewing.total_manufacturing_cost)}</div>
                  <div><b>تكلفة الوحدة:</b> {fmt(viewing.unit_cost)}</div>
                  <div><b>التاريخ:</b> {(viewing.created_at || "").slice(0,10)}</div>
                </div>
                {viewLines.length === 0 ? (
                  <div className="border-2 border-dashed border-amber-400 bg-amber-50 dark:bg-amber-950/20 rounded-lg p-4 space-y-3">
                    <div className="text-amber-900 dark:text-amber-200 text-sm font-semibold">
                      ⚠️ فاتورة قديمة بدون بنود خامات محفوظة — لا يُنصح باعتمادها.
                    </div>
                    <div className="text-xs text-amber-800 dark:text-amber-300">
                      لن يتم خصم أي خامات أو إضافة منتج نهائي للمخزون، ولن تدخل هذه الفاتورة في تقارير التصنيع المعتمدة. يمكن إدخال البنود يدويًا أدناه إذا أردت استكمالها.
                    </div>
                    {viewing.status === "draft" && isApprover && (
                      <AddLinesForViewedInvoice
                        invoice={viewing}
                        rawCandidates={rawCandidates}
                        packCandidates={packCandidates}
                        onSaved={async () => { await openView(viewing); await fetchAll(); }}
                      />
                    )}
                  </div>
                ) : (() => {
                  const rawSpice = viewLines.filter((l: any) => l.kind !== "packaging");
                  const pack = viewLines.filter((l: any) => l.kind === "packaging");
                  const isDraft = viewing.status === "draft";
                  const renderTable = (rows: any[], title: string, emptyText: string) => (
                    <div className="space-y-1">
                      <h3 className="font-semibold text-sm text-purple-700">{title}</h3>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>الصنف</TableHead>
                            <TableHead>النوع</TableHead>
                            <TableHead>الوحدة</TableHead>
                            <TableHead>الكمية</TableHead>
                            <TableHead>سعر الوحدة</TableHead>
                            <TableHead>إجمالي السطر</TableHead>
                            <TableHead>الرصيد قبل</TableHead>
                            <TableHead>الرصيد بعد</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {rows.length === 0 ? (
                            <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-3">{emptyText}</TableCell></TableRow>
                          ) : rows.map((l: any) => (
                            <TableRow key={l.id}>
                              <TableCell className="font-medium">{l.item_name}</TableCell>
                              <TableCell><Badge variant="outline">{KIND_LABEL[(l.kind as Kind)||"raw"]}</Badge></TableCell>
                              <TableCell>{l.unit}</TableCell>
                              <TableCell>{fmt(l.quantity)}</TableCell>
                              <TableCell>{fmt(l.unit_cost)}</TableCell>
                              <TableCell className="font-semibold">{fmt(l.line_total)}</TableCell>
                              <TableCell>{isDraft ? <span className="text-muted-foreground text-xs">لم تعتمد بعد</span> : (l.stock_before != null ? fmt(l.stock_before) : "—")}</TableCell>
                              <TableCell>{isDraft ? <span className="text-muted-foreground text-xs">لم تعتمد بعد</span> : (l.stock_after != null ? fmt(l.stock_after) : "—")}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  );
                  return (
                    <div className="space-y-4">
                      {renderTable(rawSpice, "المواد الخام والبهارات المستخدمة", "لا توجد خامات/بهارات")}
                      {renderTable(pack, "خامات التغليف المستخدمة", "لا توجد خامات تغليف")}
                    </div>
                  );
                })()}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => viewing && printInvoice(viewing)}><Printer className="w-4 h-4 ml-1" />طباعة</Button>
              {viewing?.status === "draft" && isApprover && (
                <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={busy} onClick={() => viewing && approve(viewing.id)}><CheckCircle2 className="w-4 h-4 ml-1" />اعتماد</Button>
              )}
              <Button variant="outline" onClick={() => setViewing(null)}>إغلاق</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!transferInv} onOpenChange={(v) => !v && setTransferInv(null)}>
          <DialogContent dir="rtl">
            <DialogHeader>
              <DialogTitle>تحويل {transferInv?.product_name} ({fmt(transferInv?.finished_qty)} {transferInv?.unit}) للمخزن الرئيسي</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">لن يزيد رصيد المخزن الرئيسي إلا بعد موافقة مسؤول المخزن على الاستلام.</p>
              <div>
                <Label>المخزن الرئيسي المستلِم</Label>
                <Select value={transferDestId} onValueChange={setTransferDestId}>
                  <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                  <SelectContent>{mainWarehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setTransferInv(null)}>إلغاء</Button>
              <Button onClick={submitTransfer} disabled={busy} className="bg-blue-600 hover:bg-blue-700">
                {busy ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <Send className="w-4 h-4 ml-1" />}
                إرسال التحويل
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}

// =========== Inline form to add missing lines to an existing draft invoice ===========
function AddLinesForViewedInvoice({
  invoice, rawCandidates, packCandidates, onSaved,
}: {
  invoice: Invoice;
  rawCandidates: RawItem[];
  packCandidates: RawItem[];
  onSaved: () => Promise<void> | void;
}) {
  const allCandidates = useMemo(() => [...rawCandidates, ...packCandidates], [rawCandidates, packCandidates]);
  void allCandidates;
  const [rows, setRows] = useState<Line[]>([newLine("raw"), newLine("packaging")]);
  const [saving, setSaving] = useState(false);

  const update = (tmp: string, patch: Partial<Line>) => {
    setRows(rs => rs.map(l => {
      if (l.tmp !== tmp) return l;
      const m: Line = { ...l, ...patch };
      if (patch.item_id) {
        const it = allCandidates.find(x => x.id === patch.item_id);
        if (it) { m.item_name = it.name; m.unit = it.unit; m.kind = it.kind; if (!m.unit_cost) m.unit_cost = Number(it.avg_cost || 0); }
      }
      m.line_total = Number((Number(m.quantity || 0) * Number(m.unit_cost || 0)).toFixed(3));
      return m;
    }));
  };

  const totals = useMemo(() => {
    const raw = rows.filter(l => l.kind === "raw").reduce((s,l) => s + Number(l.line_total||0), 0);
    const spice = rows.filter(l => l.kind === "spice").reduce((s,l) => s + Number(l.line_total||0), 0);
    const pack = rows.filter(l => l.kind === "packaging").reduce((s,l) => s + Number(l.line_total||0), 0);
    return { raw, spice, pack, all: raw + spice + pack };
  }, [rows]);

  const save = async () => {
    const valid = rows.filter(l => l.item_id && l.quantity > 0);
    if (valid.length === 0) { toast.error("أضف صنفًا واحدًا على الأقل بكمية > 0"); return; }
    setSaving(true);
    try {
      const { error: e1 } = await supabase.from("meat_manufacturing_invoice_lines" as any).insert(
        valid.map(l => ({
          invoice_id: invoice.id,
          item_id: l.item_id, item_name: l.item_name, kind: l.kind,
          unit: l.unit, quantity: l.quantity, unit_cost: l.unit_cost, line_total: l.line_total,
        })) as any
      );
      if (e1) throw e1;

      const extra = Number(invoice.extra_cost || 0);
      const total = totals.all + extra;
      const unitCost = Number(invoice.finished_qty || 0) > 0 ? total / Number(invoice.finished_qty) : 0;
      const { error: e2 } = await supabase.from("meat_manufacturing_invoices" as any).update({
        raw_cost: totals.raw,
        spice_cost: totals.spice,
        packaging_cost: totals.pack,
        materials_total_cost: totals.all,
        total_manufacturing_cost: total,
        unit_cost: unitCost,
      }).eq("id", invoice.id);
      if (e2) throw e2;

      toast.success(`تم إضافة ${valid.length} بند وتحديث الإجماليات`);
      await onSaved();
    } catch (e: any) {
      toast.error(e?.message || "فشل الحفظ");
    } finally {
      setSaving(false);
    }
  };

  const renderSection = (title: string, kindFilter: Kind[], candidates: RawItem[], defaultKind: Kind) => {
    const sectionRows = rows.filter(l => kindFilter.includes(l.kind) || (!l.item_id && l.kind === defaultKind));
    return (
      <div className="space-y-1 border rounded-md p-2 bg-white/60 dark:bg-background/40">
        <div className="flex items-center justify-between">
          <h4 className="font-semibold text-sm text-purple-700">{title}</h4>
          <span className="text-xs text-muted-foreground">عدد الأصناف المتاحة: {candidates.length}</span>
        </div>
        {candidates.length === 0 && (
          <div className="text-xs text-red-600">لا توجد أصناف نشطة في مخزن خامات مصنع اللحوم لهذا النوع.</div>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الصنف</TableHead>
              <TableHead>الوحدة</TableHead>
              <TableHead>الكمية</TableHead>
              <TableHead>سعر الوحدة</TableHead>
              <TableHead>الإجمالي</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sectionRows.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-2">لا توجد بنود — اضغط إضافة سطر</TableCell></TableRow>
            ) : sectionRows.map(l => (
              <TableRow key={l.tmp}>
                <TableCell className="min-w-[200px]">
                  <Select value={l.item_id} onValueChange={v => update(l.tmp, { item_id: v })}>
                    <SelectTrigger><SelectValue placeholder="اختر صنف" /></SelectTrigger>
                    <SelectContent className="max-h-72">
                      {candidates.map(c => (
                        <SelectItem key={c.id} value={c.id}>
                          <span className="text-xs text-muted-foreground ml-2">[{KIND_LABEL[c.kind]}]</span>{c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="w-16 text-xs">{l.unit || "—"}</TableCell>
                <TableCell className="w-24">
                  <Input type="number" min={0} value={l.quantity || ""} onChange={e => update(l.tmp, { quantity: Number(e.target.value) })} />
                </TableCell>
                <TableCell className="w-24">
                  <Input type="number" min={0} value={l.unit_cost || ""} onChange={e => update(l.tmp, { unit_cost: Number(e.target.value) })} />
                </TableCell>
                <TableCell className="text-xs">{fmt(l.line_total)}</TableCell>
                <TableCell>
                  <Button size="icon" variant="ghost" onClick={() => setRows(rs => rs.filter(x => x.tmp !== l.tmp))}>
                    <Trash2 className="w-4 h-4 text-red-600" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Button size="sm" variant="outline" onClick={() => setRows(rs => [...rs, newLine(defaultKind)])}>
          <Plus className="w-4 h-4 ml-1" /> إضافة سطر {title}
        </Button>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="text-xs text-amber-800 dark:text-amber-200">
        أدخل البنود الفعلية للفاتورة. سيتم إعادة احتساب الإجماليات تلقائيًا.
      </div>
      {renderSection("مواد خام وبهارات", ["raw", "spice"], rawCandidates, "raw")}
      {renderSection("خامات التغليف", ["packaging"], packCandidates, "packaging")}
      <div className="flex items-center justify-between flex-wrap gap-2 border-t pt-2">
        <div className="text-xs">
          خامات: <b>{fmt(totals.raw)}</b> | بهارات: <b>{fmt(totals.spice)}</b> | تغليف: <b>{fmt(totals.pack)}</b> | الإجمالي: <b className="text-purple-700">{fmt(totals.all)}</b>
        </div>
        <Button onClick={save} disabled={saving} className="bg-purple-600 hover:bg-purple-700">
          {saving ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <CheckCircle2 className="w-4 h-4 ml-1" />}
          حفظ البنود
        </Button>
      </div>
    </div>
  );
}
