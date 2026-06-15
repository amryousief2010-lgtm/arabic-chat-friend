import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Activity, RefreshCw, Download, Lock, Filter } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import * as XLSX from "xlsx";

interface Mov {
  id: string;
  movement_no: string | null;
  performed_at: string;
  warehouse_id: string;
  destination_warehouse_id: string | null;
  source_warehouse_id: string | null;
  item_id: string;
  movement_type: string;
  quantity: number;
  unit_cost: number | null;
  reference_id: string | null;
  reference_type: string | null;
  performed_by: string | null;
  reason: string | null;
  notes: string | null;
  approval_status: string;
  module: string | null;
}

const typeLabel: Record<string, string> = {
  in: "وارد", out: "صادر", transfer: "تحويل", adjustment: "تسوية",
  opening_balance: "رصيد افتتاحي", sales_dispatch: "صرف مبيعات",
  sales_return: "مرتجع مبيعات", waste_loss: "هالك",
  production_consumption: "استهلاك إنتاج", packaging_consumption: "استهلاك تغليف",
  purchase_receipt: "وارد مشتريات", finished_goods_receipt: "وارد جاهز", return: "مرتجع",
  reconciliation: "تسوية", stock_in: "إدخال", stock_out: "إخراج",
};

const STATUS_COLORS: Record<string, string> = {
  posted: "bg-emerald-500/15 text-emerald-700",
  pending: "bg-amber-500/15 text-amber-700",
  rejected: "bg-rose-500/15 text-rose-700",
  draft: "bg-muted text-muted-foreground",
};

export default function WarehouseMovementsLog() {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [whFilter, setWhFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [refFilter, setRefFilter] = useState<string>("");
  const [itemFilter, setItemFilter] = useState<string>("");
  const [userFilter, setUserFilter] = useState<string>("all");
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([]);
  const [items, setItems] = useState<Record<string, { name: string; unit: string }>>({});
  const [users, setUsers] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<Mov[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data: whs } = await supabase.from("warehouses").select("id, name");
      setWarehouses((whs || []) as any);

      let q = supabase
        .from("inventory_movements")
        .select("id, movement_no, performed_at, warehouse_id, destination_warehouse_id, source_warehouse_id, item_id, movement_type, quantity, unit_cost, reference_id, reference_type, performed_by, reason, notes, approval_status, module")
        .gte("performed_at", from + "T00:00:00")
        .lte("performed_at", to + "T23:59:59")
        .order("performed_at", { ascending: false })
        .limit(1000);
      if (whFilter !== "all") q = q.or(`warehouse_id.eq.${whFilter},destination_warehouse_id.eq.${whFilter},source_warehouse_id.eq.${whFilter}`);
      if (typeFilter !== "all") q = q.eq("movement_type", typeFilter);
      if (statusFilter !== "all") q = q.eq("approval_status", statusFilter);
      if (refFilter.trim()) q = q.ilike("reference_id", `%${refFilter.trim()}%`);
      if (userFilter !== "all") q = q.eq("performed_by", userFilter);
      const { data: movs } = await q;
      const list = (movs || []) as Mov[];

      const itemIds = Array.from(new Set(list.map((m) => m.item_id).filter(Boolean)));
      const userIds = Array.from(new Set(list.map((m) => m.performed_by).filter(Boolean))) as string[];
      const [{ data: its }, { data: prof }] = await Promise.all([
        itemIds.length
          ? supabase.from("inventory_items").select("id, name, unit").in("id", itemIds)
          : Promise.resolve({ data: [] }),
        userIds.length
          ? supabase.from("profiles").select("id, full_name").in("id", userIds)
          : Promise.resolve({ data: [] }),
      ]);
      const im: Record<string, { name: string; unit: string }> = {};
      (its || []).forEach((it: any) => { im[it.id] = { name: it.name, unit: it.unit }; });
      setItems(im);
      const um: Record<string, string> = {};
      (prof || []).forEach((p: any) => { um[p.id] = p.full_name; });
      setUsers(um);
      setRows(list);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const filteredRows = useMemo(() => {
    let r = rows;
    if (itemFilter.trim()) {
      const q = itemFilter.trim();
      r = r.filter((m) => (items[m.item_id]?.name || "").includes(q));
    }
    return r;
  }, [rows, itemFilter, items]);

  const whName = (id: string | null) => (id ? warehouses.find((w) => w.id === id)?.name || "—" : "—");

  const exportXlsx = () => {
    const data = filteredRows.map((m) => ({
      "رقم الحركة": m.movement_no || "",
      "التاريخ": new Date(m.performed_at).toLocaleString("ar-EG"),
      "المخزن": whName(m.warehouse_id),
      "الصنف": items[m.item_id]?.name || "",
      "الوحدة": items[m.item_id]?.unit || "",
      "نوع الحركة": typeLabel[m.movement_type] || m.movement_type,
      "الكمية": m.quantity,
      "المصدر": whName(m.source_warehouse_id),
      "الوجهة": whName(m.destination_warehouse_id),
      "Reference": m.reference_id || "",
      "نوع المرجع": m.reference_type || "",
      "المستخدم": users[m.performed_by || ""] || "",
      "السبب": m.reason || "",
      "ملاحظات": m.notes || "",
      "الحالة": m.approval_status,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "حركات");
    XLSX.writeFile(wb, `inventory_movements_${from}_${to}.xlsx`);
  };

  return (
    <DashboardLayout>
      <div className="space-y-4 p-4" dir="rtl">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Activity className="w-6 h-6 text-primary" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">سجل حركات المخازن الموحد</h1>
            <p className="text-sm text-muted-foreground">قراءة فقط من <code>inventory_movements</code> لكل المخازن. لا يمكن إنشاء أو تعديل أو حذف من هذه الصفحة.</p>
          </div>
          <Badge variant="outline" className="gap-1"><Lock className="w-3 h-3" /> Read-only</Badge>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Filter className="w-4 h-4" /> فلاتر</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              <div><Label className="text-xs">من تاريخ</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div><Label className="text-xs">إلى تاريخ</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
              <div>
                <Label className="text-xs">المخزن</Label>
                <Select value={whFilter} onValueChange={setWhFilter}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل المخازن</SelectItem>
                    {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">نوع الحركة</Label>
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">الكل</SelectItem>
                    {Object.entries(typeLabel).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">الحالة</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">الكل</SelectItem>
                    <SelectItem value="posted">مرحَّل</SelectItem>
                    <SelectItem value="pending">معلق</SelectItem>
                    <SelectItem value="rejected">مرفوض</SelectItem>
                    <SelectItem value="draft">مسودة</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Reference ID</Label><Input value={refFilter} onChange={(e) => setRefFilter(e.target.value)} placeholder="بحث بالمرجع" /></div>
              <div><Label className="text-xs">الصنف</Label><Input value={itemFilter} onChange={(e) => setItemFilter(e.target.value)} placeholder="اسم الصنف" /></div>
              <div className="col-span-2 md:col-span-4 flex gap-2 items-end">
                <Button onClick={load} disabled={loading}><RefreshCw className="w-4 h-4 ml-1" /> تطبيق</Button>
                <Button variant="outline" onClick={exportXlsx} disabled={!filteredRows.length}><Download className="w-4 h-4 ml-1" /> Excel</Button>
                <span className="text-sm text-muted-foreground ms-auto">عدد الحركات: <b>{filteredRows.length}</b></span>
              </div>
            </div>
          </CardContent>
        </Card>

        {rows.length >= 1000 && (
          <Alert><AlertDescription>تم تحميل أحدث 1000 حركة. ضيّق التواريخ لاستعراض حركات أقدم.</AlertDescription></Alert>
        )}

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الرقم</TableHead>
                    <TableHead>التاريخ</TableHead>
                    <TableHead>المخزن</TableHead>
                    <TableHead>الصنف</TableHead>
                    <TableHead>النوع</TableHead>
                    <TableHead>الكمية</TableHead>
                    <TableHead>الوحدة</TableHead>
                    <TableHead>المصدر</TableHead>
                    <TableHead>الوجهة</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>المستخدم</TableHead>
                    <TableHead>السبب</TableHead>
                    <TableHead>الحالة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow><TableCell colSpan={13} className="text-center py-8 text-muted-foreground">جاري التحميل...</TableCell></TableRow>
                  ) : filteredRows.length === 0 ? (
                    <TableRow><TableCell colSpan={13} className="text-center py-8 text-muted-foreground">لا توجد حركات بالفلاتر الحالية.</TableCell></TableRow>
                  ) : filteredRows.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-mono text-xs">{m.movement_no || "—"}</TableCell>
                      <TableCell className="text-xs">{new Date(m.performed_at).toLocaleString("ar-EG")}</TableCell>
                      <TableCell>{whName(m.warehouse_id)}</TableCell>
                      <TableCell>{items[m.item_id]?.name || "—"}</TableCell>
                      <TableCell><Badge variant="outline">{typeLabel[m.movement_type] || m.movement_type}</Badge></TableCell>
                      <TableCell className="font-mono">{m.quantity}</TableCell>
                      <TableCell className="text-xs">{items[m.item_id]?.unit || "—"}</TableCell>
                      <TableCell className="text-xs">{whName(m.source_warehouse_id)}</TableCell>
                      <TableCell className="text-xs">{whName(m.destination_warehouse_id)}</TableCell>
                      <TableCell className="font-mono text-xs max-w-[200px] truncate" title={m.reference_id || ""}>{m.reference_id || "—"}</TableCell>
                      <TableCell className="text-xs">{users[m.performed_by || ""] || "—"}</TableCell>
                      <TableCell className="text-xs max-w-[180px] truncate" title={m.reason || ""}>{m.reason || "—"}</TableCell>
                      <TableCell><Badge className={STATUS_COLORS[m.approval_status] || ""}>{m.approval_status}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
