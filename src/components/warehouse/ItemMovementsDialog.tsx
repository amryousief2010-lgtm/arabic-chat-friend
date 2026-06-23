import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { formatDateTime } from "@/lib/dateFormat";
import { openPrintWindow, escapeHtml, fmtNum, fmtDate, COMPANY_AR } from "@/lib/printPdf";
import { Printer, FileSpreadsheet, FileText, ArrowDown, ArrowUp, Package, Archive } from "lucide-react";
import { MAIN_WAREHOUSE_OPERATIONAL_START, MAIN_WAREHOUSE_OPERATIONAL_START_ISO } from "@/constants/warehouseOperations";
import * as XLSX from "xlsx";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  item: any | null; // inventory_items row
  warehouseId: string;
  warehouseName?: string;
}

const TYPE_LABELS: Record<string, string> = {
  in: "وارد",
  stock_in: "وارد",
  purchase_receipt: "توريد",
  finished_goods_receipt: "وارد إنتاج",
  sales_return: "مرتجع",
  return: "مرتجع",
  opening_balance: "رصيد افتتاحي",
  out: "صرف",
  stock_out: "صرف",
  sales_dispatch: "صرف للعميل",
  transfer: "تحويل",
  production_consumption: "استهلاك إنتاج",
  packaging_consumption: "استهلاك تعبئة",
  waste_loss: "تالف",
  adjustment: "تسوية",
  adjust: "تسوية",
  reconciliation: "تسوية جرد",
};

const IN_TYPES = new Set(["in","stock_in","purchase_receipt","finished_goods_receipt","sales_return","return","opening_balance"]);
const OUT_TYPES = new Set(["out","stock_out","sales_dispatch","production_consumption","packaging_consumption","waste_loss"]);

const dirOf = (t: string): "in" | "out" | "other" =>
  IN_TYPES.has(t) ? "in" : OUT_TYPES.has(t) ? "out" : "other";

const ItemMovementsDialog = ({ open, onOpenChange, item, warehouseId, warehouseName }: Props) => {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [users, setUsers] = useState<Record<string, string>>({});
  const [reservations, setReservations] = useState<any[]>([]);

  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<"all" | "in" | "out">("all");
  const [partyFilter, setPartyFilter] = useState<string>("all");
  const [search, setSearch] = useState<string>("");

  useEffect(() => {
    if (!open || !item?.id) return;
    let cancel = false;
    (async () => {
      setLoading(true);
      const { data, error } = await (supabase as any)
        .from("inventory_movements")
        .select("id, performed_at, movement_type, quantity, quantity_kg, party, reference, reference_type, notes, performed_by, movement_no, approval_status, source_warehouse_id, destination_warehouse_id")
        .eq("warehouse_id", warehouseId)
        .eq("item_id", item.id)
        .order("performed_at", { ascending: true });
      if (cancel) return;
      const list = error ? [] : (data || []);
      // running balance forward
      let bal = 0;
      const enriched = list.map((m: any) => {
        const dir = dirOf(m.movement_type);
        const qty = Math.abs(Number(m.quantity_kg ?? m.quantity ?? 0));
        const before = bal;
        if (dir === "in") bal += qty;
        else if (dir === "out") bal -= qty;
        else bal += Number(m.quantity || 0);
        return { ...m, _dir: dir, _qty: qty, _before: before, _after: bal };
      });
      // newest first for display
      enriched.reverse();
      setRows(enriched);

      // fetch user names
      const userIds = Array.from(new Set(enriched.map((r: any) => r.performed_by).filter(Boolean)));
      if (userIds.length) {
        const { data: profs } = await (supabase as any).from("profiles").select("id, full_name").in("id", userIds);
        const map: Record<string, string> = {};
        (profs || []).forEach((p: any) => { map[p.id] = p.full_name || ""; });
        setUsers(map);
      } else setUsers({});

      // reservations: order_items linked to non-final orders + matching product_name
      if (item?.name) {
        const { data: oi } = await (supabase as any)
          .from("order_items")
          .select("id, order_id, quantity, product_name, orders!inner(id, order_number, status, source_warehouse_id, created_at, customer:customers(name))")
          .ilike("product_name", `%${item.name}%`);
        const filtered = (oi || []).filter((r: any) =>
          r.orders &&
          r.orders.source_warehouse_id === warehouseId &&
          !["delivered","cancelled","returned"].includes(String(r.orders.status))
        );
        setReservations(filtered);
      } else setReservations([]);

      setLoading(false);
    })();
    return () => { cancel = true; };
  }, [open, item?.id, warehouseId]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (typeFilter !== "all" && r._dir !== typeFilter) return false;
      if (dateFrom && new Date(r.performed_at) < new Date(dateFrom)) return false;
      if (dateTo) {
        const end = new Date(dateTo); end.setHours(23,59,59,999);
        if (new Date(r.performed_at) > end) return false;
      }
      if (partyFilter !== "all" && (r.party || "—") !== partyFilter) return false;
      if (search.trim()) {
        const s = search.trim().toLowerCase();
        const hay = [r.reference, r.movement_no, r.notes, r.party].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [rows, typeFilter, dateFrom, dateTo, partyFilter, search]);

  const parties = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => set.add(r.party || "—"));
    return Array.from(set);
  }, [rows]);

  const summary = useMemo(() => {
    const totalIn = filtered.filter((r) => r._dir === "in").reduce((s, r) => s + r._qty, 0);
    const totalOut = filtered.filter((r) => r._dir === "out").reduce((s, r) => s + r._qty, 0);
    return {
      totalIn,
      totalOut,
      currentStock: Number(item?.stock || 0),
      lastDate: filtered.length ? filtered[0].performed_at : null,
      count: filtered.length,
    };
  }, [filtered, item]);

  const buildPrintHtml = () => {
    const rowsHtml = filtered.map((r) => `
      <tr>
        <td>${escapeHtml(fmtDate(r.performed_at))}</td>
        <td>${escapeHtml(TYPE_LABELS[r.movement_type] || r.movement_type)}</td>
        <td style="font-family:monospace">${escapeHtml(r.movement_no || r.reference || "—")}</td>
        <td>${escapeHtml(r.party || "—")}</td>
        <td>${escapeHtml(r.notes || "—")}</td>
        <td class="num">${r._dir === "in" ? fmtNum(r._qty, 2) : "—"}</td>
        <td class="num">${r._dir === "out" ? fmtNum(r._qty, 2) : "—"}</td>
        <td class="num">${fmtNum(r._before, 2)}</td>
        <td class="num">${fmtNum(r._after, 2)}</td>
        <td>${escapeHtml(users[r.performed_by] || "—")}</td>
      </tr>
    `).join("");

    const period = (dateFrom || dateTo) ? `${dateFrom || "—"}  →  ${dateTo || "—"}` : "كل الفترات";

    return `
      <header>
        <div>
          <h1>${escapeHtml(COMPANY_AR)}</h1>
          <div class="en">سجل حركة صنف</div>
        </div>
        <div class="meta">
          <div>الصنف: <b>${escapeHtml(item?.name || "")}</b></div>
          <div>الوحدة: ${escapeHtml(item?.unit || "—")}</div>
          <div>المخزن: ${escapeHtml(warehouseName || "—")}</div>
          <div>الفترة: ${escapeHtml(period)}</div>
          <div>تاريخ الطباعة: ${escapeHtml(fmtDate(new Date().toISOString()))}</div>
        </div>
      </header>
      <div class="stats">
        <div class="stat"><div class="k">إجمالي الوارد</div><div class="v">${fmtNum(summary.totalIn, 2)}</div></div>
        <div class="stat"><div class="k">إجمالي المنصرف</div><div class="v">${fmtNum(summary.totalOut, 2)}</div></div>
        <div class="stat"><div class="k">الرصيد الحالي</div><div class="v">${fmtNum(summary.currentStock, 2)}</div></div>
        <div class="stat"><div class="k">عدد الحركات</div><div class="v">${summary.count}</div></div>
      </div>
      <table>
        <thead><tr>
          <th>التاريخ</th><th>النوع</th><th>رقم العملية</th><th>الجهة</th><th>البيان</th>
          <th>وارد</th><th>منصرف</th><th>قبل</th><th>بعد</th><th>المستخدم</th>
        </tr></thead>
        <tbody>${rowsHtml || `<tr><td colspan="10" style="text-align:center;color:#999">لا توجد حركات</td></tr>`}</tbody>
      </table>
    `;
  };

  const handlePrint = () => openPrintWindow(`سجل حركة - ${item?.name || ""}`, buildPrintHtml());
  const handlePdf = handlePrint;

  const handleExcel = () => {
    const data = filtered.map((r) => ({
      "التاريخ": formatDateTime(r.performed_at),
      "النوع": TYPE_LABELS[r.movement_type] || r.movement_type,
      "رقم العملية": r.movement_no || r.reference || "",
      "الجهة": r.party || "",
      "البيان": r.notes || "",
      "وارد": r._dir === "in" ? r._qty : "",
      "منصرف": r._dir === "out" ? r._qty : "",
      "الرصيد قبل": r._before,
      "الرصيد بعد": r._after,
      "المستخدم": users[r.performed_by] || "",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "سجل الحركة");
    XLSX.writeFile(wb, `سجل-حركة-${item?.name || "صنف"}.xlsx`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="w-5 h-5 text-primary" />
            سجل حركة الصنف: {item?.name}
          </DialogTitle>
          <DialogDescription>
            عرض كامل لحركات الوارد والصرف الخاصة بهذا الصنف فقط داخل {warehouseName || "المخزن"}.
          </DialogDescription>
        </DialogHeader>

        {/* Summary */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">إجمالي الوارد</div><div className="text-lg font-bold text-emerald-600">{fmtNum(summary.totalIn, 2)} {item?.unit || ""}</div></CardContent></Card>
          <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">إجمالي المنصرف</div><div className="text-lg font-bold text-rose-600">{fmtNum(summary.totalOut, 2)} {item?.unit || ""}</div></CardContent></Card>
          <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">الرصيد الحالي</div><div className="text-lg font-bold">{fmtNum(summary.currentStock, 2)} {item?.unit || ""}</div></CardContent></Card>
          <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">عدد الحركات</div><div className="text-lg font-bold">{summary.count}</div></CardContent></Card>
          <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">آخر حركة</div><div className="text-sm font-semibold">{summary.lastDate ? formatDateTime(summary.lastDate) : "—"}</div></CardContent></Card>
        </div>

        <Tabs defaultValue="movements">
          <TabsList>
            <TabsTrigger value="movements">الحركات ({rows.length})</TabsTrigger>
            <TabsTrigger value="reservations">الحجوزات ({reservations.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="movements" className="space-y-3">
            {/* Filters */}
            <Card><CardContent className="p-3 flex flex-wrap items-end gap-2">
              <div><label className="text-xs text-muted-foreground">من تاريخ</label><Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" /></div>
              <div><label className="text-xs text-muted-foreground">إلى تاريخ</label><Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" /></div>
              <div>
                <label className="text-xs text-muted-foreground">النوع</label>
                <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as any)}>
                  <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">الكل</SelectItem>
                    <SelectItem value="in">وارد فقط</SelectItem>
                    <SelectItem value="out">صرف فقط</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">الجهة</label>
                <Select value={partyFilter} onValueChange={setPartyFilter}>
                  <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل الجهات</SelectItem>
                    {parties.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 min-w-[180px]">
                <label className="text-xs text-muted-foreground">بحث</label>
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بيان أو رقم عملية..." />
              </div>
              <div className="flex gap-2 ms-auto">
                <Button size="sm" variant="outline" onClick={handlePrint}><Printer className="w-4 h-4 ml-1" />طباعة</Button>
                <Button size="sm" variant="outline" onClick={handleExcel}><FileSpreadsheet className="w-4 h-4 ml-1" />Excel</Button>
                <Button size="sm" variant="outline" onClick={handlePdf}><FileText className="w-4 h-4 ml-1" />PDF</Button>
              </div>
            </CardContent></Card>

            <Card><CardContent className="p-0">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>رقم العملية</TableHead>
                  <TableHead>الجهة</TableHead>
                  <TableHead>البيان</TableHead>
                  <TableHead className="text-center text-emerald-600">وارد</TableHead>
                  <TableHead className="text-center text-rose-600">منصرف</TableHead>
                  <TableHead className="text-center">قبل</TableHead>
                  <TableHead className="text-center">بعد</TableHead>
                  <TableHead>المستخدم</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">جارٍ التحميل...</TableCell></TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">لا توجد حركات مطابقة</TableCell></TableRow>
                  ) : filtered.map((r) => (
                    <TableRow key={r.id} className={r._dir === "in" ? "bg-emerald-50/40" : r._dir === "out" ? "bg-rose-50/40" : ""}>
                      <TableCell className="whitespace-nowrap text-xs">{formatDateTime(r.performed_at)}</TableCell>
                      <TableCell>
                        <Badge variant={r._dir === "in" ? "default" : r._dir === "out" ? "destructive" : "secondary"} className="gap-1">
                          {r._dir === "in" ? <ArrowDown className="w-3 h-3" /> : r._dir === "out" ? <ArrowUp className="w-3 h-3" /> : null}
                          {TYPE_LABELS[r.movement_type] || r.movement_type}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{r.movement_no || r.reference || "—"}</TableCell>
                      <TableCell className="text-sm">{r.party || "—"}</TableCell>
                      <TableCell className="text-xs max-w-[220px] truncate" title={r.notes || ""}>{r.notes || "—"}</TableCell>
                      <TableCell className="text-center font-bold text-emerald-700">{r._dir === "in" ? fmtNum(r._qty, 2) : "—"}</TableCell>
                      <TableCell className="text-center font-bold text-rose-700">{r._dir === "out" ? fmtNum(r._qty, 2) : "—"}</TableCell>
                      <TableCell className="text-center text-xs">{fmtNum(r._before, 2)}</TableCell>
                      <TableCell className="text-center text-xs font-semibold">{fmtNum(r._after, 2)}</TableCell>
                      <TableCell className="text-xs">{users[r.performed_by] || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="reservations">
            <Card><CardContent className="p-0">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>رقم الطلب</TableHead>
                  <TableHead>العميل</TableHead>
                  <TableHead>الكمية المحجوزة</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>التاريخ</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {reservations.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">لا توجد حجوزات حالية</TableCell></TableRow>
                  ) : reservations.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono">{r.orders?.order_number || "—"}</TableCell>
                      <TableCell>{r.orders?.customer?.name || "—"}</TableCell>
                      <TableCell className="font-bold">{r.quantity}</TableCell>
                      <TableCell><Badge variant="secondary">{r.orders?.status}</Badge></TableCell>
                      <TableCell className="text-xs">{r.orders?.created_at ? formatDateTime(r.orders.created_at) : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent></Card>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

export default ItemMovementsDialog;
