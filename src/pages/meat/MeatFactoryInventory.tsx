import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { openPrintWindow, escapeHtml, fmtNum, fmtDate, COMPANY_AR } from "@/lib/printPdf";
import * as XLSX from "xlsx";
import { Boxes, Printer, FileSpreadsheet, ShieldAlert, Search, Pencil } from "lucide-react";

type Kind = "raw" | "spice" | "packaging" | "finished";

const KIND_LBL: Record<Kind, string> = {
  raw: "خامات تصنيع",
  spice: "بهارات وإضافات",
  packaging: "خامات تغليف",
  finished: "منتجات مصنعة",
};

interface Item {
  id: string;
  kind: Kind;
  code: string | null;
  name: string;
  unit: string;
  current_stock: number;
  avg_cost: number;
  notes: string | null;
  is_active: boolean;
  last_movement_at: string | null;
}

export default function MeatFactoryInventory() {
  const { user, isGeneralManager, isExecutiveManager } = useAuth();
  const canAdjust = isGeneralManager || isExecutiveManager;

  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [fKind, setFKind] = useState<"all" | Kind>("all");
  const [fActive, setFActive] = useState<"all" | "active" | "inactive">("active");
  const [search, setSearch] = useState("");

  const [adjDlg, setAdjDlg] = useState<{ open: boolean; item: Item | null; actual: string; reason: string; notes: string }>({
    open: false, item: null, actual: "", reason: "", notes: "",
  });

  async function load() {
    setLoading(true);
    const [rawRes, prodRes, movesRes] = await Promise.all([
      (supabase as any).from("meat_factory_raw_items").select("id, kind, code, name, unit, current_stock, avg_cost, notes, is_active, updated_at").order("name"),
      (supabase as any).from("meat_factory_products").select("id, product_code, name_ar, name_en, package_unit, current_stock, latest_unit_cost, cost_price, notes, is_active, updated_at").order("name_ar"),
      (supabase as any).from("meat_factory_inventory_moves").select("item_id, created_at").order("created_at", { ascending: false }).limit(2000),
    ]);
    if (rawRes.error) toast.error("فشل تحميل الخامات: " + rawRes.error.message);
    if (prodRes.error) toast.error("فشل تحميل المنتجات: " + prodRes.error.message);

    const lastMoveMap: Record<string, string> = {};
    (movesRes.data || []).forEach((m: any) => {
      if (m.item_id && !lastMoveMap[m.item_id]) lastMoveMap[m.item_id] = m.created_at;
    });

    const raw: Item[] = (rawRes.data || []).map((r: any) => ({
      id: r.id, kind: (r.kind || "raw") as Kind, code: r.code,
      name: r.name, unit: r.unit || "كجم",
      current_stock: Number(r.current_stock) || 0,
      avg_cost: Number(r.avg_cost) || 0,
      notes: r.notes, is_active: !!r.is_active,
      last_movement_at: lastMoveMap[r.id] || r.updated_at || null,
    }));
    const finished: Item[] = (prodRes.data || []).map((p: any) => ({
      id: p.id, kind: "finished" as Kind, code: p.product_code,
      name: p.name_ar || p.name_en || "—",
      unit: p.package_unit || "علبة",
      current_stock: Number(p.current_stock) || 0,
      avg_cost: Number(p.latest_unit_cost ?? p.cost_price) || 0,
      notes: p.notes, is_active: !!p.is_active,
      last_movement_at: lastMoveMap[p.id] || p.updated_at || null,
    }));
    setItems([...raw, ...finished]);
    setLoading(false);
  }

  useEffect(() => { if (user) load(); /* eslint-disable-next-line */ }, [user?.id]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) =>
      (fKind === "all" || i.kind === fKind) &&
      (fActive === "all" || (fActive === "active" ? i.is_active : !i.is_active)) &&
      (!q || (i.name || "").toLowerCase().includes(q) || (i.code || "").toLowerCase().includes(q))
    );
  }, [items, fKind, fActive, search]);

  const totals = useMemo(() => {
    let qty = 0, value = 0;
    filtered.forEach((i) => { qty += i.current_stock; value += i.current_stock * i.avg_cost; });
    return { count: filtered.length, qty, value };
  }, [filtered]);

  async function submitAdjust() {
    if (!adjDlg.item) return;
    const actual = Number(adjDlg.actual);
    if (!isFinite(actual) || actual < 0) return toast.error("الرصيد الفعلي غير صحيح");
    if (!adjDlg.reason.trim() || adjDlg.reason.trim().length < 3) return toast.error("سبب التسوية مطلوب");
    const { data, error } = await (supabase as any).rpc("meat_factory_adjust_stock", {
      p_item_kind: adjDlg.item.kind,
      p_item_id: adjDlg.item.id,
      p_actual_qty: actual,
      p_reason: adjDlg.reason,
      p_notes: adjDlg.notes || null,
    });
    if (error) return toast.error("فشل التسوية: " + error.message);
    toast.success(`تمت التسوية — الفرق ${(data?.diff ?? 0).toLocaleString("ar-EG")} ${adjDlg.item.unit}`);
    setAdjDlg({ open: false, item: null, actual: "", reason: "", notes: "" });
    load();
  }

  function exportExcel() {
    const rows = filtered.map((i) => ({
      الكود: i.code || "—",
      الصنف: i.name,
      النوع: KIND_LBL[i.kind],
      الوحدة: i.unit,
      "الرصيد الحالي": i.current_stock,
      "متوسط التكلفة": i.avg_cost,
      "إجمالي القيمة": Number((i.current_stock * i.avg_cost).toFixed(2)),
      "آخر حركة": i.last_movement_at ? fmtDate(i.last_movement_at) : "—",
      الملاحظات: i.notes || "",
      الحالة: i.is_active ? "نشط" : "غير نشط",
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "inventory");
    XLSX.writeFile(wb, `meat-factory-inventory-${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  function printReport() {
    const rowsHtml = filtered.map((i) => `
      <tr>
        <td>${escapeHtml(i.code || "—")}</td>
        <td>${escapeHtml(i.name)}</td>
        <td>${escapeHtml(KIND_LBL[i.kind])}</td>
        <td>${escapeHtml(i.unit)}</td>
        <td style="text-align:left">${fmtNum(i.current_stock, 2)}</td>
        <td style="text-align:left">${fmtNum(i.avg_cost, 2)}</td>
        <td style="text-align:left">${fmtNum(i.current_stock * i.avg_cost, 2)}</td>
        <td>${escapeHtml(i.notes || "—")}</td>
      </tr>
    `).join("");
    const filterLabel = fKind === "all" ? "كل الأنواع" : KIND_LBL[fKind];
    const html = `
      <div style="text-align:center;margin-bottom:12px">
        <h2 style="margin:0">${COMPANY_AR}</h2>
        <h3 style="margin:4px 0">كشف مخزون مصنع اللحوم</h3>
        <div>التاريخ: ${escapeHtml(fmtDate(new Date().toISOString()))}</div>
        <div>النوع المختار: ${escapeHtml(filterLabel)}</div>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:11px" border="1" cellpadding="6">
        <thead style="background:#f5f5f5">
          <tr>
            <th>الكود</th><th>الصنف</th><th>النوع</th><th>الوحدة</th>
            <th>الرصيد الحالي</th><th>متوسط التكلفة</th><th>إجمالي القيمة</th><th>ملاحظات</th>
          </tr>
        </thead>
        <tbody>${rowsHtml || `<tr><td colspan="8" style="text-align:center">لا توجد بيانات</td></tr>`}</tbody>
        <tfoot style="background:#fafafa;font-weight:bold">
          <tr>
            <td colspan="4">الإجمالي — عدد الأصناف: ${filtered.length}</td>
            <td style="text-align:left">${fmtNum(totals.qty, 2)}</td>
            <td></td>
            <td style="text-align:left">${fmtNum(totals.value, 2)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
      <div style="margin-top:60px;display:flex;justify-content:space-between;font-size:12px">
        <div>توقيع مسؤول مصنع اللحوم: ____________________</div>
        <div>توقيع المدير التنفيذي: ____________________</div>
        <div>توقيع المدير العام: ____________________</div>
      </div>
    `;
    openPrintWindow("كشف مخزون مصنع اللحوم", html);
  }

  const adjItem = adjDlg.item;
  const adjActual = Number(adjDlg.actual);
  const adjDiff = adjItem && isFinite(adjActual) ? adjActual - adjItem.current_stock : 0;
  const adjValueDiff = adjItem ? adjDiff * adjItem.avg_cost : 0;

  return (
    <DashboardLayout>
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-primary to-accent text-primary-foreground flex items-center justify-center shadow-md">
              <Boxes className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">مخزون مصنع اللحوم</h1>
              <div className="text-xs text-muted-foreground">شاشة موحّدة لكل أنواع المخزون — خامات / بهارات / تغليف / منتجات مصنعة</div>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={printReport} className="gap-2"><Printer className="w-4 h-4" />طباعة المخزون</Button>
            <Button variant="outline" size="sm" onClick={exportExcel} className="gap-2"><FileSpreadsheet className="w-4 h-4" />تصدير Excel</Button>
          </div>
        </div>

        {!canAdjust && (
          <Alert>
            <ShieldAlert className="w-4 h-4" />
            <AlertTitle className="text-sm">عرض فقط</AlertTitle>
            <AlertDescription className="text-xs">تعديل وتسوية المخزون متاح فقط للمدير العام والمدير التنفيذي.</AlertDescription>
          </Alert>
        )}

        {/* Summary */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Card><CardContent className="p-4">
            <div className="text-xs text-muted-foreground">عدد الأصناف</div>
            <div className="text-2xl font-bold font-mono mt-1">{totals.count.toLocaleString("ar-EG")}</div>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <div className="text-xs text-muted-foreground">إجمالي الكميات</div>
            <div className="text-2xl font-bold font-mono mt-1">{fmtNum(totals.qty, 2)}</div>
          </CardContent></Card>
          <Card className="border-primary/40 bg-primary/5"><CardContent className="p-4">
            <div className="text-xs text-muted-foreground">إجمالي قيمة المخزون</div>
            <div className="text-2xl font-bold font-mono mt-1">{fmtNum(totals.value, 2)} ج</div>
          </CardContent></Card>
        </div>

        {/* Filters */}
        <Card><CardContent className="p-3 flex flex-wrap gap-2 items-center">
          <Select value={fKind} onValueChange={(v) => setFKind(v as any)}>
            <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الأنواع</SelectItem>
              {(Object.keys(KIND_LBL) as Kind[]).map((k) => <SelectItem key={k} value={k}>{KIND_LBL[k]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={fActive} onValueChange={(v) => setFActive(v as any)}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">نشط فقط</SelectItem>
              <SelectItem value="inactive">غير نشط</SelectItem>
              <SelectItem value="all">الكل</SelectItem>
            </SelectContent>
          </Select>
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input className="pr-8" placeholder="بحث بالاسم أو الكود..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </CardContent></Card>

        {/* Table */}
        <Card><CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>الكود</TableHead>
              <TableHead>الصنف</TableHead>
              <TableHead>النوع</TableHead>
              <TableHead>الوحدة</TableHead>
              <TableHead>الرصيد الحالي</TableHead>
              <TableHead>متوسط التكلفة</TableHead>
              <TableHead>إجمالي القيمة</TableHead>
              <TableHead>آخر حركة</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead>إجراء</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">جارٍ التحميل...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">لا توجد أصناف</TableCell></TableRow>
              ) : filtered.map((i) => (
                <TableRow key={`${i.kind}-${i.id}`}>
                  <TableCell className="font-mono text-xs">{i.code || "—"}</TableCell>
                  <TableCell className="font-medium">{i.name}</TableCell>
                  <TableCell><Badge variant="secondary" className="text-[10px]">{KIND_LBL[i.kind]}</Badge></TableCell>
                  <TableCell className="text-xs">{i.unit}</TableCell>
                  <TableCell className="font-mono">{fmtNum(i.current_stock, 2)}</TableCell>
                  <TableCell className="font-mono text-xs">{fmtNum(i.avg_cost, 2)}</TableCell>
                  <TableCell className="font-mono font-semibold text-primary">{fmtNum(i.current_stock * i.avg_cost, 2)}</TableCell>
                  <TableCell className="text-xs">{i.last_movement_at ? fmtDate(i.last_movement_at) : "—"}</TableCell>
                  <TableCell>
                    <Badge variant={i.is_active ? "default" : "outline"} className="text-[10px]">
                      {i.is_active ? "نشط" : "غير نشط"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {canAdjust && (
                      <Button size="sm" variant="outline" className="gap-1" onClick={() => setAdjDlg({
                        open: true, item: i, actual: String(i.current_stock), reason: "", notes: "",
                      })}>
                        <Pencil className="w-3 h-3" /> تسوية
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>

        {/* Adjust dialog */}
        <Dialog open={adjDlg.open} onOpenChange={(o) => setAdjDlg({ ...adjDlg, open: o })}>
          <DialogContent className="max-w-xl">
            <DialogHeader><DialogTitle>تسوية مخزون</DialogTitle></DialogHeader>
            {adjItem && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><span className="text-muted-foreground">الصنف: </span><b>{adjItem.name}</b></div>
                  <div><span className="text-muted-foreground">الكود: </span><span className="font-mono">{adjItem.code || "—"}</span></div>
                  <div><span className="text-muted-foreground">النوع: </span>{KIND_LBL[adjItem.kind]}</div>
                  <div><span className="text-muted-foreground">الوحدة: </span>{adjItem.unit}</div>
                  <div><span className="text-muted-foreground">الرصيد في النظام: </span><b className="font-mono">{fmtNum(adjItem.current_stock, 2)}</b></div>
                  <div><span className="text-muted-foreground">متوسط التكلفة: </span><span className="font-mono">{fmtNum(adjItem.avg_cost, 2)}</span></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>الرصيد الفعلي بالجرد *</Label>
                    <Input type="number" step="0.01" value={adjDlg.actual} onChange={(e) => setAdjDlg({ ...adjDlg, actual: e.target.value })} />
                  </div>
                  <div>
                    <Label>الفرق</Label>
                    <Input value={isFinite(adjDiff) ? adjDiff.toFixed(2) : ""} readOnly className={`font-mono font-bold ${adjDiff < 0 ? "text-destructive" : adjDiff > 0 ? "text-green-600" : ""}`} />
                  </div>
                  <div className="col-span-2">
                    <Label>قيمة الفرق</Label>
                    <Input value={isFinite(adjValueDiff) ? adjValueDiff.toFixed(2) + " ج" : ""} readOnly className="font-mono" />
                  </div>
                  <div className="col-span-2">
                    <Label>سبب التسوية *</Label>
                    <Input value={adjDlg.reason} onChange={(e) => setAdjDlg({ ...adjDlg, reason: e.target.value })} placeholder="مثال: تسوية جرد مخزون مصنع اللحوم" />
                  </div>
                  <div className="col-span-2">
                    <Label>ملاحظات</Label>
                    <Textarea value={adjDlg.notes} onChange={(e) => setAdjDlg({ ...adjDlg, notes: e.target.value })} rows={2} />
                  </div>
                </div>
                <Alert>
                  <ShieldAlert className="w-4 h-4" />
                  <AlertDescription className="text-xs">
                    التسوية تنشئ حركة مخزون فقط — لا تأثير على الخزنة ولا الفواتير. تُسجَّل في سجل الحركات وسجل التدقيق.
                  </AlertDescription>
                </Alert>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setAdjDlg({ ...adjDlg, open: false })}>إلغاء</Button>
              <Button onClick={submitAdjust}>اعتماد التسوية</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
