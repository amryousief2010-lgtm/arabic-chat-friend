import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Package as PackageIcon, Plus, Minus, RotateCcw, ClipboardList, PowerOff, AlertTriangle, Wallet, FileSpreadsheet, Printer } from "lucide-react";
import { toast } from "sonner";
import { openPrintWindow } from "@/lib/printPdf";
import * as XLSX from "xlsx";

type Item = { id: string; name: string; unit: string; current_stock: number; avg_cost: number; low_stock_threshold: number | null; kind: string; is_active: boolean; notes: string | null; updated_at: string };
type Move = { id: string; item_kind: string; item_id: string; item_name: string; direction: "IN"|"OUT"; quantity: number; unit_cost: number | null; reason: string | null; ref_table: string | null; ref_id: string | null; stock_before: number | null; stock_after: number | null; created_by: string | null; created_at: string };

const fmt = (n: any) => Number(n || 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 });
const fmtDateTime = (s: string) => new Date(s).toLocaleString("ar-EG");

const UNITS = ["قطعة", "كجم", "رول", "كيس", "علبة"];
const ISSUE_REASONS = ["تصنيع", "تالف", "تجربة", "تسوية جرد", "صرف يدوي", "أخرى"];

export default function MeatPackagingInventory() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [showOnlyActive, setShowOnlyActive] = useState(true);

  // dialog state
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [addQtyItem, setAddQtyItem] = useState<Item | null>(null);
  const [issueItem, setIssueItem] = useState<Item | null>(null);
  const [adjustItem, setAdjustItem] = useState<Item | null>(null);
  const [reverseMove, setReverseMove] = useState<Move | null>(null);

  const { data: items = [] } = useQuery({
    queryKey: ["mf-pack-items"],
    queryFn: async () => (await supabase.from("meat_factory_raw_items" as any).select("*").eq("kind", "packaging").order("name")).data || [],
  });
  const { data: moves = [] } = useQuery({
    queryKey: ["mf-pack-moves"],
    queryFn: async () => (await supabase.from("meat_factory_inventory_moves" as any).select("*").eq("item_kind", "packaging").order("created_at", { ascending: false }).limit(1000)).data || [],
  });

  const itemsArr = items as unknown as Item[];
  const movesArr = moves as unknown as Move[];

  const filtered = useMemo(() => itemsArr.filter(i =>
    (!search || i.name.includes(search)) &&
    (!showOnlyActive || i.is_active)
  ), [itemsArr, search, showOnlyActive]);

  const lastByItem = useMemo(() => {
    const map: Record<string, { in?: string; out?: string }> = {};
    for (const m of movesArr) {
      if (!map[m.item_id]) map[m.item_id] = {};
      if (m.direction === "IN" && !map[m.item_id].in) map[m.item_id].in = m.created_at;
      if (m.direction === "OUT" && !map[m.item_id].out) map[m.item_id].out = m.created_at;
    }
    return map;
  }, [movesArr]);

  const totalValue = useMemo(() => itemsArr.reduce((s, i) => s + Number(i.current_stock) * Number(i.avg_cost || 0), 0), [itemsArr]);
  const activeCount = itemsArr.filter(i => i.is_active).length;
  const lowCount = itemsArr.filter(i => i.is_active && Number(i.current_stock) > 0 && Number(i.current_stock) <= Number(i.low_stock_threshold || 0)).length;
  const zeroCount = itemsArr.filter(i => i.is_active && Number(i.current_stock) <= 0).length;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["mf-pack-items"] });
    qc.invalidateQueries({ queryKey: ["mf-pack-moves"] });
    qc.invalidateQueries({ queryKey: ["mf-raw-inv"] });
    qc.invalidateQueries({ queryKey: ["mf-raw-moves"] });
  };

  // ---------- Mutations ----------
  async function postMove(item: Item, direction: "IN"|"OUT", qty: number, unitCost: number, reason: string, refTable = "manual_adjustment", refId: string | null = null) {
    const stock_before = Number(item.current_stock);
    const stock_after = direction === "IN" ? stock_before + qty : stock_before - qty;
    if (direction === "OUT" && qty > stock_before) {
      toast.error("الرصيد المتاح غير كافٍ لإتمام الصرف");
      return false;
    }
    // moving avg cost only for IN moves with cost
    let newAvg = Number(item.avg_cost);
    if (direction === "IN" && unitCost > 0 && qty > 0) {
      const prevVal = stock_before * Number(item.avg_cost || 0);
      const addVal = qty * unitCost;
      newAvg = stock_after > 0 ? (prevVal + addVal) / stock_after : unitCost;
    }
    const user = (await supabase.auth.getUser()).data.user;
    const { error: e1 } = await supabase.from("meat_factory_inventory_moves" as any).insert({
      item_kind: "packaging", item_id: item.id, item_name: item.name,
      direction, quantity: qty, unit_cost: unitCost,
      reason, ref_table: refTable, ref_id: refId, created_by: user?.id ?? null,
      stock_before, stock_after,
    });
    if (e1) { toast.error(e1.message); return false; }
    const { error: e2 } = await supabase.from("meat_factory_raw_items" as any)
      .update({ current_stock: stock_after, avg_cost: newAvg }).eq("id", item.id);
    if (e2) { toast.error(e2.message); return false; }
    refresh();
    return true;
  }

  async function deactivateItem(item: Item) {
    if (!confirm(`تعطيل الصنف "${item.name}"؟ سيختفي من الاختيارات الجديدة ولن يُحذف.`)) return;
    const { error } = await supabase.from("meat_factory_raw_items" as any).update({ is_active: false }).eq("id", item.id);
    if (error) return toast.error(error.message);
    toast.success("تم تعطيل الصنف");
    refresh();
  }
  async function activateItem(item: Item) {
    const { error } = await supabase.from("meat_factory_raw_items" as any).update({ is_active: true }).eq("id", item.id);
    if (error) return toast.error(error.message);
    toast.success("تم تفعيل الصنف");
    refresh();
  }

  // ---------- Print / Excel ----------
  function exportExcel() {
    const rows = filtered.map(i => ({
      "الصنف": i.name, "الوحدة": i.unit, "الرصيد الحالي": Number(i.current_stock),
      "متوسط التكلفة": Number(i.avg_cost), "إجمالي القيمة": Number(i.current_stock) * Number(i.avg_cost || 0),
      "حد إعادة الطلب": Number(i.low_stock_threshold || 0),
      "آخر وارد": lastByItem[i.id]?.in ? new Date(lastByItem[i.id]!.in!).toLocaleDateString("ar-EG") : "",
      "آخر صرف": lastByItem[i.id]?.out ? new Date(lastByItem[i.id]!.out!).toLocaleDateString("ar-EG") : "",
      "الحالة": i.is_active ? "نشط" : "معطّل",
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "مخزون التغليف");
    XLSX.writeFile(wb, `meat_factory_packaging_${new Date().toISOString().slice(0,10)}.xlsx`);
  }
  function printReport() {
    const total = filtered.reduce((s, i) => s + Number(i.current_stock) * Number(i.avg_cost || 0), 0);
    const html = `
      <h1 style="text-align:center">تقرير مخزن مواد التغليف والتعبئة — مصنع اللحوم</h1>
      <p style="text-align:center">${new Date().toLocaleDateString("ar-EG")}</p>
      <table border="1" cellpadding="6" cellspacing="0" style="width:100%;border-collapse:collapse;text-align:center">
        <thead style="background:#f3e8ff"><tr>
          <th>الصنف</th><th>الوحدة</th><th>الرصيد</th><th>متوسط التكلفة</th><th>إجمالي القيمة</th><th>حد الطلب</th><th>الحالة</th>
        </tr></thead>
        <tbody>${filtered.map(i => `<tr>
          <td>${i.name}</td><td>${i.unit}</td><td>${fmt(i.current_stock)}</td>
          <td>${fmt(i.avg_cost)}</td><td>${fmt(Number(i.current_stock)*Number(i.avg_cost||0))}</td>
          <td>${fmt(i.low_stock_threshold)}</td><td>${i.is_active ? "نشط" : "معطّل"}</td>
        </tr>`).join("")}</tbody>
        <tfoot><tr style="background:#fef3c7;font-weight:bold"><td colspan="4">الإجمالي</td><td>${fmt(total)} ج.م</td><td colspan="2"></td></tr></tfoot>
      </table>`;
    openPrintWindow({ title: "مخزن مواد التغليف والتعبئة", bodyHtml: html });
  }

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-4" dir="rtl">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <PackageIcon className="w-7 h-7 text-emerald-600" />
            <div>
              <h1 className="text-2xl font-bold">مخزن مواد التغليف والتعبئة</h1>
              <p className="text-sm text-muted-foreground">إدارة كاملة لخامات التغليف: إضافة/صرف/عكس حركة/تسوية جرد.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={exportExcel}><FileSpreadsheet className="w-4 h-4 ml-1" />Excel</Button>
            <Button variant="outline" size="sm" onClick={printReport}><Printer className="w-4 h-4 ml-1" />طباعة / PDF</Button>
            <Button size="sm" onClick={() => setAddItemOpen(true)} className="bg-emerald-600 hover:bg-emerald-700"><Plus className="w-4 h-4 ml-1" />إضافة صنف تغليف</Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={Wallet} label="إجمالي قيمة مخزون التغليف" value={fmt(totalValue) + " ج.م"} color="text-purple-700" big />
          <StatCard icon={PackageIcon} label="الأصناف النشطة" value={String(activeCount)} color="text-emerald-700" />
          <StatCard icon={AlertTriangle} label="منخفضة الرصيد" value={String(lowCount)} color="text-amber-600" />
          <StatCard icon={AlertTriangle} label="نفدت" value={String(zeroCount)} color="text-red-600" />
        </div>

        <Tabs defaultValue="items">
          <TabsList>
            <TabsTrigger value="items">الأصناف</TabsTrigger>
            <TabsTrigger value="moves">سجل حركات التغليف</TabsTrigger>
          </TabsList>

          <TabsContent value="items" className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input placeholder="بحث باسم الصنف…" value={search} onChange={e => setSearch(e.target.value)} className="max-w-sm" />
              <Button size="sm" variant={showOnlyActive ? "default" : "outline"} onClick={() => setShowOnlyActive(s => !s)} className={showOnlyActive ? "bg-purple-600 hover:bg-purple-700" : ""}>
                {showOnlyActive ? "النشطة فقط" : "كل الأصناف"}
              </Button>
              <Badge variant="outline" className="mr-auto">{filtered.length} صنف</Badge>
            </div>

            <Card><CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>الصنف</TableHead><TableHead>الوحدة</TableHead>
                  <TableHead>الرصيد</TableHead><TableHead>متوسط التكلفة</TableHead><TableHead>القيمة</TableHead>
                  <TableHead>حد الطلب</TableHead><TableHead>آخر وارد</TableHead><TableHead>آخر صرف</TableHead>
                  <TableHead>الحالة</TableHead><TableHead className="text-center">إجراءات</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">لا توجد أصناف</TableCell></TableRow>
                  ) : filtered.map(i => {
                    const value = Number(i.current_stock) * Number(i.avg_cost || 0);
                    const last = lastByItem[i.id] || {};
                    const isZero = Number(i.current_stock) <= 0;
                    const isLow = !isZero && Number(i.current_stock) <= Number(i.low_stock_threshold || 0);
                    return (
                      <TableRow key={i.id} className={!i.is_active ? "opacity-60" : isZero ? "bg-red-50 dark:bg-red-950/30" : isLow ? "bg-amber-50 dark:bg-amber-950/30" : ""}>
                        <TableCell className="font-medium">{i.name}</TableCell>
                        <TableCell>{i.unit}</TableCell>
                        <TableCell className="font-bold">{fmt(i.current_stock)}</TableCell>
                        <TableCell>{fmt(i.avg_cost)}</TableCell>
                        <TableCell className="font-bold text-purple-700">{fmt(value)}</TableCell>
                        <TableCell className="text-xs">{fmt(i.low_stock_threshold)}</TableCell>
                        <TableCell className="text-xs">{last.in ? new Date(last.in).toLocaleDateString("ar-EG") : "—"}</TableCell>
                        <TableCell className="text-xs">{last.out ? new Date(last.out).toLocaleDateString("ar-EG") : "—"}</TableCell>
                        <TableCell>
                          {!i.is_active ? <Badge variant="secondary">معطّل</Badge>
                            : isZero ? <Badge variant="destructive">نفد</Badge>
                            : isLow ? <Badge className="bg-amber-600">منخفض</Badge>
                            : <Badge className="bg-emerald-600">متاح</Badge>}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 justify-center flex-wrap">
                            <Button size="sm" variant="outline" onClick={() => setAddQtyItem(i)} className="h-7 px-2"><Plus className="w-3 h-3 ml-1" />إضافة</Button>
                            <Button size="sm" variant="outline" onClick={() => setIssueItem(i)} className="h-7 px-2"><Minus className="w-3 h-3 ml-1" />صرف</Button>
                            <Button size="sm" variant="outline" onClick={() => setAdjustItem(i)} className="h-7 px-2"><ClipboardList className="w-3 h-3 ml-1" />تسوية</Button>
                            {i.is_active
                              ? <Button size="sm" variant="ghost" onClick={() => deactivateItem(i)} className="h-7 px-2 text-amber-700"><PowerOff className="w-3 h-3 ml-1" />تعطيل</Button>
                              : <Button size="sm" variant="ghost" onClick={() => activateItem(i)} className="h-7 px-2 text-emerald-700"><PowerOff className="w-3 h-3 ml-1" />تفعيل</Button>}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="moves">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">سجل حركات التغليف</CardTitle>
                <CardDescription>أحدث 1000 حركة. زر "عكس" متاح بجانب كل حركة.</CardDescription>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>التاريخ</TableHead><TableHead>الصنف</TableHead><TableHead>النوع</TableHead>
                    <TableHead>الكمية</TableHead><TableHead>سعر الوحدة</TableHead><TableHead>إجمالي</TableHead>
                    <TableHead>قبل</TableHead><TableHead>بعد</TableHead>
                    <TableHead>السبب / المرجع</TableHead><TableHead>إجراء</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {movesArr.length === 0 ? (
                      <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">لا توجد حركات</TableCell></TableRow>
                    ) : movesArr.map(m => (
                      <TableRow key={m.id}>
                        <TableCell className="text-xs">{fmtDateTime(m.created_at)}</TableCell>
                        <TableCell className="font-medium">{m.item_name}</TableCell>
                        <TableCell>{m.direction === "IN" ? <Badge className="bg-emerald-600">وارد</Badge> : <Badge className="bg-rose-600">صرف</Badge>}</TableCell>
                        <TableCell className="font-bold">{fmt(m.quantity)}</TableCell>
                        <TableCell>{fmt(m.unit_cost)}</TableCell>
                        <TableCell>{fmt(Number(m.quantity) * Number(m.unit_cost || 0))}</TableCell>
                        <TableCell className="text-xs">{fmt(m.stock_before)}</TableCell>
                        <TableCell className="text-xs">{fmt(m.stock_after)}</TableCell>
                        <TableCell className="text-xs max-w-[280px] truncate" title={`${m.reason || ""} | ${m.ref_table || ""}`}>{m.reason || "—"}</TableCell>
                        <TableCell>
                          {(m.ref_table === "manual_adjustment" || m.ref_table === "reverse" || m.ref_table === "opening_balance_packaging") ? (
                            <Button size="sm" variant="outline" onClick={() => setReverseMove(m)} className="h-7 px-2"><RotateCcw className="w-3 h-3 ml-1" />عكس</Button>
                          ) : <span className="text-xs text-muted-foreground">—</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Add Item Dialog */}
      <AddItemDialog open={addItemOpen} onClose={() => setAddItemOpen(false)} onDone={refresh} existing={itemsArr} />
      {/* Add Qty */}
      <AddQtyDialog item={addQtyItem} onClose={() => setAddQtyItem(null)} onSubmit={postMove} />
      {/* Issue */}
      <IssueDialog item={issueItem} onClose={() => setIssueItem(null)} onSubmit={postMove} />
      {/* Adjustment */}
      <AdjustDialog item={adjustItem} onClose={() => setAdjustItem(null)} onSubmit={postMove} />
      {/* Reverse */}
      <ReverseDialog move={reverseMove} items={itemsArr} onClose={() => setReverseMove(null)} onSubmit={postMove} />
    </DashboardLayout>
  );
}

function StatCard({ icon: Icon, label, value, color, big }: { icon: any; label: string; value: string; color: string; big?: boolean }) {
  return (
    <Card><CardContent className="pt-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className={`w-4 h-4 ${color}`} />{label}</div>
      <div className={`mt-1 font-bold ${color} ${big ? "text-2xl" : "text-lg"}`}>{value}</div>
    </CardContent></Card>
  );
}

// ---------------- Dialogs ----------------

function AddItemDialog({ open, onClose, onDone, existing }: { open: boolean; onClose: () => void; onDone: () => void; existing: Item[] }) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("قطعة");
  const [stock, setStock] = useState("");
  const [cost, setCost] = useState("");
  const [reorder, setReorder] = useState("");
  const [notes, setNotes] = useState("");
  const reset = () => { setName(""); setUnit("قطعة"); setStock(""); setCost(""); setReorder(""); setNotes(""); };

  async function submit() {
    const nm = name.trim();
    if (!nm) return toast.error("اسم الصنف مطلوب");
    if (existing.some(i => i.name.trim() === nm && i.unit === unit)) return toast.error("صنف بنفس الاسم والوحدة موجود بالفعل");
    const qty = Number(stock || 0), c = Number(cost || 0), rl = Number(reorder || 0);
    const { data: ins, error } = await supabase.from("meat_factory_raw_items" as any)
      .insert({ name: nm, unit, current_stock: qty, avg_cost: c, low_stock_threshold: rl, kind: "packaging", is_active: true, notes: notes || null })
      .select().single();
    if (error) return toast.error(error.message);
    if (qty > 0) {
      const user = (await supabase.auth.getUser()).data.user;
      await supabase.from("meat_factory_inventory_moves" as any).insert({
        item_kind: "packaging", item_id: (ins as any).id, item_name: nm,
        direction: "IN", quantity: qty, unit_cost: c,
        reason: "رصيد افتتاحي عند إنشاء الصنف",
        ref_table: "opening_balance_packaging", created_by: user?.id ?? null,
        stock_before: 0, stock_after: qty,
      });
    }
    toast.success("تم إضافة الصنف");
    reset(); onDone(); onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader><DialogTitle>إضافة صنف تغليف جديد</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Field label="اسم الصنف *"><Input value={name} onChange={e => setName(e.target.value)} /></Field>
          <Field label="الوحدة">
            <Select value={unit} onValueChange={setUnit}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="الرصيد الافتتاحي"><Input type="number" value={stock} onChange={e => setStock(e.target.value)} /></Field>
            <Field label="سعر الوحدة"><Input type="number" value={cost} onChange={e => setCost(e.target.value)} /></Field>
          </div>
          <Field label="حد إعادة الطلب"><Input type="number" value={reorder} onChange={e => setReorder(e.target.value)} /></Field>
          <Field label="ملاحظات"><Textarea value={notes} onChange={e => setNotes(e.target.value)} /></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>إلغاء</Button><Button onClick={submit} className="bg-emerald-600 hover:bg-emerald-700">حفظ</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddQtyDialog({ item, onClose, onSubmit }: { item: Item | null; onClose: () => void; onSubmit: (i: Item, d: "IN"|"OUT", q: number, c: number, r: string, refTable?: string, refId?: string|null) => Promise<boolean> }) {
  const [qty, setQty] = useState(""); const [cost, setCost] = useState(""); const [supplier, setSupplier] = useState(""); const [invoice, setInvoice] = useState(""); const [notes, setNotes] = useState("");
  const reset = () => { setQty(""); setCost(""); setSupplier(""); setInvoice(""); setNotes(""); };
  if (!item) return null;
  async function submit() {
    const q = Number(qty); const c = Number(cost || item!.avg_cost || 0);
    if (!q || q <= 0) return toast.error("أدخل كمية صحيحة");
    const reason = `إضافة كمية — ${supplier ? `مورد: ${supplier} — ` : ""}${invoice ? `فاتورة: ${invoice} — ` : ""}${notes || ""}`.trim();
    const ok = await onSubmit(item!, "IN", q, c, reason || "إضافة كمية يدوية", "manual_adjustment", null);
    if (ok) { toast.success("تم إضافة الكمية"); reset(); onClose(); }
  }
  return (
    <Dialog open={!!item} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader><DialogTitle>إضافة كمية — {item.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="text-sm text-muted-foreground">الرصيد الحالي: <span className="font-bold text-foreground">{fmt(item.current_stock)} {item.unit}</span></div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="الكمية المضافة *"><Input type="number" value={qty} onChange={e => setQty(e.target.value)} /></Field>
            <Field label="سعر الوحدة"><Input type="number" value={cost} onChange={e => setCost(e.target.value)} placeholder={String(item.avg_cost)} /></Field>
          </div>
          <Field label="المورد"><Input value={supplier} onChange={e => setSupplier(e.target.value)} /></Field>
          <Field label="رقم الفاتورة"><Input value={invoice} onChange={e => setInvoice(e.target.value)} /></Field>
          <Field label="ملاحظات"><Textarea value={notes} onChange={e => setNotes(e.target.value)} /></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>إلغاء</Button><Button onClick={submit} className="bg-emerald-600 hover:bg-emerald-700">حفظ الوارد</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IssueDialog({ item, onClose, onSubmit }: { item: Item | null; onClose: () => void; onSubmit: (i: Item, d: "IN"|"OUT", q: number, c: number, r: string, refTable?: string, refId?: string|null) => Promise<boolean> }) {
  const [qty, setQty] = useState(""); const [reason, setReason] = useState(ISSUE_REASONS[0]); const [notes, setNotes] = useState(""); const [responsible, setResponsible] = useState("");
  const reset = () => { setQty(""); setReason(ISSUE_REASONS[0]); setNotes(""); setResponsible(""); };
  if (!item) return null;
  async function submit() {
    const q = Number(qty);
    if (!q || q <= 0) return toast.error("أدخل كمية صحيحة");
    if (q > Number(item!.current_stock)) return toast.error("الرصيد المتاح غير كافٍ لإتمام الصرف");
    const rsn = `صرف — ${reason}${responsible ? ` — مسؤول: ${responsible}` : ""}${notes ? ` — ${notes}` : ""}`;
    const ok = await onSubmit(item!, "OUT", q, Number(item!.avg_cost || 0), rsn, "manual_adjustment", null);
    if (ok) { toast.success("تم تسجيل الصرف"); reset(); onClose(); }
  }
  return (
    <Dialog open={!!item} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader><DialogTitle>صرف كمية — {item.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="text-sm text-muted-foreground">الرصيد المتاح: <span className="font-bold text-foreground">{fmt(item.current_stock)} {item.unit}</span></div>
          <Field label="الكمية المصروفة *"><Input type="number" value={qty} onChange={e => setQty(e.target.value)} /></Field>
          <Field label="سبب الصرف">
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{ISSUE_REASONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="المسؤول عن الصرف"><Input value={responsible} onChange={e => setResponsible(e.target.value)} /></Field>
          <Field label="ملاحظات"><Textarea value={notes} onChange={e => setNotes(e.target.value)} /></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>إلغاء</Button><Button onClick={submit} className="bg-rose-600 hover:bg-rose-700">تأكيد الصرف</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdjustDialog({ item, onClose, onSubmit }: { item: Item | null; onClose: () => void; onSubmit: (i: Item, d: "IN"|"OUT", q: number, c: number, r: string, refTable?: string, refId?: string|null) => Promise<boolean> }) {
  const [actual, setActual] = useState(""); const [reason, setReason] = useState("");
  if (!item) return null;
  const diff = Number(actual || 0) - Number(item.current_stock);
  async function submit() {
    if (actual === "") return toast.error("أدخل الرصيد الفعلي");
    if (diff === 0) { toast.info("لا فرق — لم تُسجّل أي حركة"); return; }
    const dir = diff > 0 ? "IN" : "OUT";
    const q = Math.abs(diff);
    const rsn = `تسوية جرد — ${reason || "بدون سبب"}`;
    const ok = await onSubmit(item!, dir, q, Number(item!.avg_cost || 0), rsn, "manual_adjustment", null);
    if (ok) { toast.success("تمت التسوية"); setActual(""); setReason(""); onClose(); }
  }
  return (
    <Dialog open={!!item} onOpenChange={(o) => { if (!o) { setActual(""); setReason(""); onClose(); } }}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader><DialogTitle>تسوية جرد — {item.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="text-sm">الرصيد في النظام: <span className="font-bold">{fmt(item.current_stock)} {item.unit}</span></div>
          <Field label="الرصيد الفعلي حسب الجرد *"><Input type="number" value={actual} onChange={e => setActual(e.target.value)} /></Field>
          {actual !== "" && (
            <div className={`text-sm font-bold ${diff > 0 ? "text-emerald-600" : diff < 0 ? "text-rose-600" : ""}`}>
              الفرق: {fmt(diff)} {item.unit} {diff > 0 ? "(زيادة)" : diff < 0 ? "(نقص)" : ""}
            </div>
          )}
          <Field label="سبب التسوية"><Textarea value={reason} onChange={e => setReason(e.target.value)} /></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>إلغاء</Button><Button onClick={submit} className="bg-amber-600 hover:bg-amber-700">حفظ التسوية</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReverseDialog({ move, items, onClose, onSubmit }: { move: Move | null; items: Item[]; onClose: () => void; onSubmit: (i: Item, d: "IN"|"OUT", q: number, c: number, r: string, refTable?: string, refId?: string|null) => Promise<boolean> }) {
  const [reason, setReason] = useState("");
  if (!move) return null;
  const item = items.find(i => i.id === move.item_id);
  const reverseDir: "IN"|"OUT" = move.direction === "IN" ? "OUT" : "IN";
  async function submit() {
    if (!item) return toast.error("الصنف غير موجود");
    if (!reason.trim()) return toast.error("اذكر سبب العكس");
    const rsn = `عكس حركة ${move!.direction === "IN" ? "وارد" : "صرف"} #${move!.id.slice(0,8)} — ${reason}`;
    const ok = await onSubmit(item, reverseDir, Number(move!.quantity), Number(move!.unit_cost || 0), rsn, "reverse", move!.id);
    if (ok) { toast.success("تم عكس الحركة"); setReason(""); onClose(); }
  }
  return (
    <Dialog open={!!move} onOpenChange={(o) => { if (!o) { setReason(""); onClose(); } }}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader><DialogTitle>عكس حركة — {move.item_name}</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <div>الحركة الأصلية: <Badge className={move.direction === "IN" ? "bg-emerald-600" : "bg-rose-600"}>{move.direction === "IN" ? "وارد" : "صرف"}</Badge> بكمية <b>{fmt(move.quantity)}</b></div>
          <div>سيتم إنشاء حركة <Badge className={reverseDir === "IN" ? "bg-emerald-600" : "bg-rose-600"}>{reverseDir === "IN" ? "وارد عكسي" : "صرف عكسي"}</Badge> بنفس الكمية.</div>
          <Field label="سبب العكس *"><Textarea value={reason} onChange={e => setReason(e.target.value)} /></Field>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>إلغاء</Button><Button onClick={submit} className="bg-orange-600 hover:bg-orange-700">تأكيد العكس</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label className="text-xs">{label}</Label>{children}</div>;
}
