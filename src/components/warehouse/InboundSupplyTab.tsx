import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Plus, Trash2, Truck, ChevronsUpDown, Check, FileSpreadsheet, Printer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/dateFormat";
import * as XLSX from "xlsx";

const PACKAGE_KG = 0.5;
const isWeightUnit = (u?: string | null) => {
  const s = (u || "").toLowerCase();
  return s.includes("كيلو") || s.includes("كجم") || s.includes("kg");
};

const SOURCES = [
  { value: "slaughterhouse", label: "المجزر" },
  { value: "meat_factory", label: "مصنع اللحوم" },
  { value: "feed_factory", label: "مصنع الأعلاف" },
  { value: "external_supplier", label: "مورد خارجي" },
  { value: "other", label: "أخرى" },
];

interface Item { id: string; name: string; unit: string; stock: number; }
interface Line { itemId: string; qty: string; unitCost: string; notes: string; }
interface Props { warehouseId: string; warehouseName: string; }

export default function InboundSupplyTab({ warehouseId, warehouseName }: Props) {
  const { user, isGeneralManager, isExecutiveManager, isWarehouseSupervisor } = useAuth();
  const canEdit = isGeneralManager || isExecutiveManager || isWarehouseSupervisor;
  const [items, setItems] = useState<Item[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [source, setSource] = useState<string>("slaughterhouse");
  const [supplier, setSupplier] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [supplyDate, setSupplyDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [headerNotes, setHeaderNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ itemId: "", qty: "", unitCost: "", notes: "" }]);

  const [filterSource, setFilterSource] = useState<string>("all");
  const [filterMonth, setFilterMonth] = useState<string>(""); // YYYY-MM

  const fetchAll = async () => {
    setLoading(true);
    const [itRes, mvRes] = await Promise.all([
      supabase.from("inventory_items").select("id, name, unit, stock").eq("warehouse_id", warehouseId).order("name"),
      supabase.from("inventory_movements")
        .select("id, performed_at, quantity, unit_cost, total_cost, party, notes, reference, item:inventory_items(name, unit)")
        .eq("warehouse_id", warehouseId)
        .eq("reference_type", "external_supply")
        .order("performed_at", { ascending: false })
        .limit(500),
    ]);
    setItems((itRes.data || []) as Item[]);
    setHistory(mvRes.data || []);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, [warehouseId]);

  const resetForm = () => {
    setSource("slaughterhouse"); setSupplier(""); setInvoiceNo("");
    setSupplyDate(new Date().toISOString().slice(0, 10)); setHeaderNotes("");
    setLines([{ itemId: "", qty: "", unitCost: "", notes: "" }]);
  };

  const addLine = () => setLines((p) => [...p, { itemId: "", qty: "", unitCost: "", notes: "" }]);
  const removeLine = (i: number) => setLines((p) => p.length === 1 ? p : p.filter((_, idx) => idx !== i));
  const updateLine = (i: number, patch: Partial<Line>) => setLines((p) => p.map((l, idx) => idx === i ? { ...l, ...patch } : l));

  const submit = async () => {
    const srcLabel = SOURCES.find(s => s.value === source)?.label || source;
    const partyParts = [srcLabel];
    if (supplier.trim()) partyParts.push(supplier.trim());
    const party = partyParts.join(" - ");
    const noteParts: string[] = [];
    if (invoiceNo.trim()) noteParts.push(`فاتورة: ${invoiceNo.trim()}`);
    if (supplyDate) noteParts.push(`تاريخ: ${supplyDate}`);
    if (headerNotes.trim()) noteParts.push(headerNotes.trim());

    const valid = lines.map(l => {
      const it = items.find(i => i.id === l.itemId);
      const q = Number(l.qty);
      if (!it || !(q > 0)) return null;
      const weight = isWeightUnit(it.unit);
      const realQty = weight ? q * PACKAGE_KG : q;
      const unitCost = Number(l.unitCost) || 0;
      return { it, inputQty: q, weight, realQty, unitCost, notes: l.notes };
    }).filter(Boolean) as Array<{ it: Item; inputQty: number; weight: boolean; realQty: number; unitCost: number; notes: string; }>;

    if (valid.length === 0) { toast.error("اختر منتجاً واحداً على الأقل وادخل كمية صحيحة"); return; }
    const ids = valid.map(v => v.it.id);
    if (new Set(ids).size !== ids.length) { toast.error("هناك منتج مكرر"); return; }

    setSubmitting(true);
    try {
      const rows = valid.map(v => ({
        item_id: v.it.id,
        product_id: null,
        warehouse_id: warehouseId,
        movement_type: "in",
        quantity: v.realQty,
        unit_cost: v.unitCost > 0 ? v.unitCost : null,
        total_cost: v.unitCost > 0 ? v.unitCost * v.realQty : null,
        reference_type: "external_supply",
        reference: invoiceNo.trim() || null,
        party,
        notes: [noteParts.join(" • "), v.notes].filter(Boolean).join(" | ") || null,
        performed_by: user?.id ?? null,
        module: "warehouse",
      }));
      const { error } = await supabase.from("inventory_movements").insert(rows);
      if (error) throw error;
      toast.success(`تم تسجيل التوريد (${valid.length} صنف) بنجاح`);
      setOpen(false);
      resetForm();
      await fetchAll();
    } catch (e: any) {
      toast.error("فشل التسجيل: " + (e?.message || ""));
    } finally {
      setSubmitting(false);
    }
  };

  const filtered = useMemo(() => {
    return history.filter((h: any) => {
      if (filterSource !== "all") {
        const lbl = SOURCES.find(s => s.value === filterSource)?.label;
        if (!lbl || !(h.party || "").includes(lbl)) return false;
      }
      if (filterMonth) {
        const d = new Date(h.performed_at);
        const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        if (ym !== filterMonth) return false;
      }
      return true;
    });
  }, [history, filterSource, filterMonth]);

  const totalKg = filtered.reduce((s, h) => s + Number(h.quantity || 0), 0);
  const totalCost = filtered.reduce((s, h) => s + Number(h.total_cost || 0), 0);

  const exportExcel = () => {
    const rows = filtered.map((h: any) => ({
      "التاريخ": formatDateTime(h.performed_at),
      "المنتج": h.item?.name || "—",
      "الوحدة": h.item?.unit || "",
      "الكمية (كجم)": Number(h.quantity || 0),
      "العبوات (نص كيلو)": isWeightUnit(h.item?.unit) ? Math.round(Number(h.quantity || 0) / PACKAGE_KG) : "—",
      "سعر الوحدة": h.unit_cost ?? "",
      "إجمالي التكلفة": h.total_cost ?? "",
      "المصدر": h.party || "",
      "رقم الفاتورة": h.reference || "",
      "ملاحظات": h.notes || "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "توريدات");
    XLSX.writeFile(wb, `توريدات_${warehouseName}_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  return (
    <div className="space-y-4">
      {canEdit && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Truck className="w-5 h-5 text-primary" />
                توريدات واردة للمخزن
              </CardTitle>
              <CardDescription>إضافة توريد جديد من المجزر / المصنع / مورد خارجي يزيد رصيد المخزن تلقائياً</CardDescription>
            </div>
            <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
              <Button onClick={() => setOpen(true)} className="gap-1">
                <Plus className="w-4 h-4" /> إضافة توريد جديد
              </Button>
              <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader><DialogTitle>تسجيل توريد جديد للمخزن</DialogTitle></DialogHeader>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">مصدر التوريد</label>
                      <Select value={source} onValueChange={setSource}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {SOURCES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">اسم المورّد / الجهة</label>
                      <Input value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="مثال: مجزر النعام - رحلة 12" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">رقم الفاتورة (اختياري)</label>
                      <Input value={invoiceNo} onChange={e => setInvoiceNo(e.target.value)} />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">تاريخ التوريد</label>
                      <Input type="date" value={supplyDate} onChange={e => setSupplyDate(e.target.value)} />
                    </div>
                    <div className="md:col-span-2">
                      <label className="text-xs text-muted-foreground mb-1 block">ملاحظات عامة</label>
                      <Textarea rows={2} value={headerNotes} onChange={e => setHeaderNotes(e.target.value)} />
                    </div>
                  </div>

                  <div className="border rounded-lg p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold">المنتجات</div>
                      <Button size="sm" variant="outline" onClick={addLine} className="gap-1">
                        <Plus className="w-4 h-4" /> صنف
                      </Button>
                    </div>
                    {lines.map((l, idx) => {
                      const it = items.find(i => i.id === l.itemId);
                      const weight = isWeightUnit(it?.unit);
                      return (
                        <div key={idx} className="grid grid-cols-12 gap-2 items-start border-t pt-3 first:border-t-0 first:pt-0">
                          <div className="col-span-12 md:col-span-5">
                            <label className="text-xs text-muted-foreground mb-1 block">المنتج</label>
                            <ProductPicker items={items} value={l.itemId} onChange={(v) => updateLine(idx, { itemId: v })} />
                          </div>
                          <div className="col-span-4 md:col-span-2">
                            <label className="text-xs text-muted-foreground mb-1 block">
                              الكمية {weight ? "(عبوة نص كيلو)" : `(${it?.unit || "وحدة"})`}
                            </label>
                            <Input type="number" min="0" step="any" value={l.qty} onChange={e => updateLine(idx, { qty: e.target.value })} />
                          </div>
                          <div className="col-span-4 md:col-span-2">
                            <label className="text-xs text-muted-foreground mb-1 block">سعر الوحدة (ج)</label>
                            <Input type="number" min="0" step="any" value={l.unitCost} onChange={e => updateLine(idx, { unitCost: e.target.value })} />
                          </div>
                          <div className="col-span-3 md:col-span-2">
                            <label className="text-xs text-muted-foreground mb-1 block">ملاحظة</label>
                            <Input value={l.notes} onChange={e => updateLine(idx, { notes: e.target.value })} />
                          </div>
                          <div className="col-span-1 flex items-end justify-end h-full">
                            <Button size="icon" variant="ghost" onClick={() => removeLine(idx)} disabled={lines.length === 1}>
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
                  <Button onClick={submit} disabled={submitting}>{submitting ? "جارٍ الحفظ…" : "حفظ التوريد"}</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardHeader>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <CardTitle className="text-base">سجل التوريدات الواردة</CardTitle>
              <CardDescription>
                إجمالي: <b>{filtered.length}</b> حركة • <b>{totalKg.toFixed(2)}</b> كجم
                {totalCost > 0 && <> • التكلفة <b>{totalCost.toFixed(2)}</b> ج</>}
              </CardDescription>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Select value={filterSource} onValueChange={setFilterSource}>
                <SelectTrigger className="w-40"><SelectValue placeholder="المصدر" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل المصادر</SelectItem>
                  {SOURCES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input type="month" value={filterMonth} onChange={e => setFilterMonth(e.target.value)} className="w-40" />
              <Button size="sm" variant="outline" onClick={exportExcel} disabled={filtered.length === 0} className="gap-1">
                <FileSpreadsheet className="w-4 h-4" /> Excel
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="py-10 text-center text-muted-foreground">جارٍ التحميل…</div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground">لا توجد توريدات مسجّلة</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>المنتج</TableHead>
                  <TableHead>الكمية</TableHead>
                  <TableHead>المصدر</TableHead>
                  <TableHead>التكلفة</TableHead>
                  <TableHead>ملاحظات</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {filtered.map((h: any) => {
                    const weight = isWeightUnit(h.item?.unit);
                    const kg = Number(h.quantity || 0);
                    return (
                      <TableRow key={h.id}>
                        <TableCell className="whitespace-nowrap text-xs">{formatDateTime(h.performed_at)}</TableCell>
                        <TableCell className="font-medium">{h.item?.name || "—"}</TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {weight ? `${Math.round(kg / PACKAGE_KG)} عبوة (${kg} كجم)` : `${kg} ${h.item?.unit || ""}`}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">{h.party || "—"}</TableCell>
                        <TableCell className="text-xs">{h.total_cost ? `${Number(h.total_cost).toFixed(2)} ج` : "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{h.notes || "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ProductPicker({ items, value, onChange }: { items: Item[]; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const selected = items.find(i => i.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
          {selected ? selected.name : "اختر المنتج"}
          <ChevronsUpDown className="w-4 h-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[300px]" align="start">
        <Command>
          <CommandInput placeholder="بحث…" />
          <CommandList>
            <CommandEmpty>لا توجد نتائج</CommandEmpty>
            <CommandGroup>
              {items.map(it => (
                <CommandItem key={it.id} value={it.name} onSelect={() => { onChange(it.id); setOpen(false); }}>
                  <Check className={`mr-2 h-4 w-4 ${value === it.id ? "opacity-100" : "opacity-0"}`} />
                  <span>{it.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{it.unit}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
