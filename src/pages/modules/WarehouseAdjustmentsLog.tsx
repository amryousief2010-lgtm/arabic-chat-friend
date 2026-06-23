import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Settings2, RefreshCw, Download, Printer, FileText, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { MAIN_WAREHOUSE_OPERATIONAL_START_ISO } from "@/constants/warehouseOperations";
import { signedDelta, MOVEMENT_TYPE_LABEL } from "@/lib/warehouseMovementSign";
import { STOCK_ADJUSTMENT_REASONS } from "@/lib/warehouseAdjustmentReasons";
import { openPrintWindow, escapeHtml, fmtNum, fmtDate, COMPANY_AR } from "@/lib/printPdf";
import * as XLSX from "xlsx";

interface Mov {
  id: string;
  movement_no: string | null;
  performed_at: string;
  warehouse_id: string;
  item_id: string;
  movement_type: string;
  quantity: number;
  performed_by: string | null;
  reason: string | null;
  notes: string | null;
  party: string | null;
  reference: string | null;
  reference_type: string | null;
}

const todayISO = () => new Date().toISOString().slice(0, 10);

const REASONS_SET = new Set<string>(STOCK_ADJUSTMENT_REASONS as readonly string[]);

const isManagerOverride = (m: Mov) =>
  /سالب|صلاحية مدير|تجاوز/.test((m.notes || "") + " " + (m.reason || ""));

const isAdjustment = (m: Mov) => {
  const t = m.movement_type;
  if (t === "adjustment" || t === "adjust" || t === "reconciliation") return true;
  if (m.reference_type === "stocktaking" || (m.reference || "").startsWith("stocktaking")) return true;
  if (m.reason && REASONS_SET.has(m.reason.trim())) return true;
  if (isManagerOverride(m)) return true;
  return false;
};

export default function WarehouseAdjustmentsLog() {
  const [items, setItems] = useState<Record<string, { name: string; unit: string }>>({});
  const [users, setUsers] = useState<Record<string, string>>({});
  const [userRoles, setUserRoles] = useState<Record<string, string[]>>({});
  const [from, setFrom] = useState(MAIN_WAREHOUSE_OPERATIONAL_START_ISO.slice(0, 10));
  const [to, setTo] = useState(todayISO());
  const [reasonFilter, setReasonFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("all");
  const [itemFilter, setItemFilter] = useState("");
  const [rows, setRows] = useState<Mov[]>([]);
  const [baselineByItem, setBaselineByItem] = useState<Record<string, number>>({});
  const [approvedSessionAt, setApprovedSessionAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data: whs } = await supabase.from("warehouses").select("id, name");
      const main = (whs || []).find((w: any) =>
        w.name?.includes("الرئيسي") || w.name?.includes("المقر"));
      if (!main) { setRows([]); setLoading(false); return; }

      const fromIso = from + "T00:00:00";
      const toIso = to + "T23:59:59";
      const effectiveFrom = fromIso < MAIN_WAREHOUSE_OPERATIONAL_START_ISO
        ? MAIN_WAREHOUSE_OPERATIONAL_START_ISO : fromIso;

      const { data: movs } = await supabase
        .from("inventory_movements")
        .select("id, movement_no, performed_at, warehouse_id, item_id, movement_type, quantity, performed_by, reason, notes, party, reference, reference_type")
        .eq("warehouse_id", main.id)
        .gte("performed_at", effectiveFrom)
        .lte("performed_at", toIso)
        .order("performed_at", { ascending: false })
        .limit(2000);
      const all = (movs || []) as Mov[];
      const adj = all.filter(isAdjustment);
      setRows(adj);

      // approved stocktaking date (latest)
      try {
        const { data: sess } = await (supabase as any)
          .from("stocktaking_sessions")
          .select("approved_at, status")
          .eq("status", "approved")
          .order("approved_at", { ascending: false })
          .limit(1);
        setApprovedSessionAt(sess?.[0]?.approved_at || null);
      } catch { setApprovedSessionAt(null); }

      const itemIds = Array.from(new Set(adj.map(r => r.item_id)));
      if (itemIds.length) {
        const { data: its } = await supabase
          .from("inventory_items")
          .select("id, name, unit")
          .in("id", itemIds);
        const m: Record<string, { name: string; unit: string }> = {};
        (its || []).forEach((it: any) => { m[it.id] = { name: it.name, unit: it.unit || "" }; });
        setItems(m);

        const { data: prior } = await supabase
          .from("inventory_movements")
          .select("item_id, movement_type, quantity")
          .eq("warehouse_id", main.id)
          .in("item_id", itemIds)
          .lt("performed_at", effectiveFrom);
        const base: Record<string, number> = {};
        (prior || []).forEach((p: any) => {
          base[p.item_id] = (base[p.item_id] || 0) + signedDelta(p.movement_type, p.quantity);
        });
        setBaselineByItem(base);
      } else { setItems({}); setBaselineByItem({}); }

      const userIds = Array.from(new Set(adj.map(r => r.performed_by).filter(Boolean))) as string[];
      if (userIds.length) {
        const { data: us } = await supabase.from("profiles").select("id, full_name").in("id", userIds);
        const u: Record<string, string> = {};
        (us || []).forEach((x: any) => { u[x.id] = x.full_name || x.id; });
        setUsers(u);
        const { data: ur } = await supabase.from("user_roles").select("user_id, role").in("user_id", userIds);
        const rmap: Record<string, string[]> = {};
        (ur || []).forEach((r: any) => { (rmap[r.user_id] ||= []).push(r.role); });
        setUserRoles(rmap);
      } else { setUsers({}); setUserRoles({}); }
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const visible = useMemo(() => {
    const filtered = rows.filter(r => {
      if (reasonFilter !== "all" && (r.reason || "") !== reasonFilter) return false;
      if (userFilter !== "all" && r.performed_by !== userFilter) return false;
      if (itemFilter) {
        const name = items[r.item_id]?.name || "";
        if (!name.includes(itemFilter)) return false;
      }
      return true;
    });
    const byItem: Record<string, Mov[]> = {};
    [...filtered].sort((a, b) => a.performed_at.localeCompare(b.performed_at))
      .forEach(m => { (byItem[m.item_id] ||= []).push(m); });
    const before: Record<string, number> = {}; const after: Record<string, number> = {};
    Object.entries(byItem).forEach(([itemId, list]) => {
      let bal = baselineByItem[itemId] || 0;
      list.forEach(m => {
        before[m.id] = bal;
        bal += signedDelta(m.movement_type, m.quantity);
        after[m.id] = bal;
      });
    });
    return filtered.map(r => ({
      ...r,
      _before: before[r.id] ?? 0,
      _after: after[r.id] ?? 0,
      _diff: signedDelta(r.movement_type, r.quantity),
      _afterApproval: approvedSessionAt ? r.performed_at > approvedSessionAt : false,
      _managerOverride: isManagerOverride(r),
    }));
  }, [rows, items, reasonFilter, userFilter, itemFilter, baselineByItem, approvedSessionAt]);

  const exportExcel = () => {
    const data = visible.map(r => ({
      "التاريخ والوقت": new Date(r.performed_at).toLocaleString("ar-EG"),
      "المستخدم": users[r.performed_by || ""] || "—",
      "الدور": (userRoles[r.performed_by || ""] || []).join("، "),
      "الصنف": items[r.item_id]?.name || "—",
      "نوع التعديل": MOVEMENT_TYPE_LABEL[r.movement_type] || r.movement_type,
      "الرصيد قبل": (r as any)._before,
      "الرصيد بعد": (r as any)._after,
      "الفرق": (r as any)._diff,
      "السبب": r.reason || "—",
      "الملاحظات": r.notes || "—",
      "رقم العملية": r.movement_no || "—",
      "بعد اعتماد الجرد؟": (r as any)._afterApproval ? "نعم" : "لا",
      "صلاحية مدير؟": (r as any)._managerOverride ? "نعم" : "لا",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Adjustments");
    XLSX.writeFile(wb, `stock-adjustments-${from}_${to}.xlsx`);
  };

  const printReport = () => {
    const tableRows = visible.map(r => `
      <tr${(r as any)._managerOverride ? ` style="background:#fef2f2"` : ""}>
        <td>${escapeHtml(fmtDate(r.performed_at))}</td>
        <td>${escapeHtml(users[r.performed_by || ""] || "—")}</td>
        <td>${escapeHtml((userRoles[r.performed_by || ""] || []).join("، "))}</td>
        <td>${escapeHtml(items[r.item_id]?.name || "—")}</td>
        <td>${escapeHtml(MOVEMENT_TYPE_LABEL[r.movement_type] || r.movement_type)}</td>
        <td class="num">${escapeHtml(fmtNum((r as any)._before, 2))}</td>
        <td class="num">${escapeHtml(fmtNum((r as any)._after, 2))}</td>
        <td class="num">${escapeHtml(fmtNum((r as any)._diff, 2))}</td>
        <td>${escapeHtml(r.reason || "—")}</td>
        <td>${escapeHtml(r.notes || "—")}</td>
        <td>${escapeHtml(r.movement_no || "—")}</td>
        <td>${(r as any)._afterApproval ? "نعم" : "لا"}</td>
        <td>${(r as any)._managerOverride ? "نعم" : "لا"}</td>
      </tr>`).join("");
    const body = `
      <header>
        <div><h1>سجل تعديلات المخزون — المخزن الرئيسي</h1><div class="en">${COMPANY_AR}</div></div>
        <div class="meta">من: ${escapeHtml(from)}<br>إلى: ${escapeHtml(to)}<br>عدد التعديلات: ${visible.length}</div>
      </header>
      <table>
        <thead><tr>
          <th>التاريخ</th><th>المستخدم</th><th>الدور</th><th>الصنف</th><th>نوع التعديل</th>
          <th>قبل</th><th>بعد</th><th>الفرق</th><th>السبب</th><th>ملاحظات</th><th>رقم</th>
          <th>بعد الاعتماد؟</th><th>صلاحية مدير؟</th>
        </tr></thead>
        <tbody>${tableRows || `<tr><td colspan="13" style="text-align:center;color:#888">لا توجد تعديلات</td></tr>`}</tbody>
      </table>`;
    openPrintWindow("سجل تعديلات المخزون", body);
  };

  const allUsers = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach(r => { if (r.performed_by) map.set(r.performed_by, users[r.performed_by] || r.performed_by); });
    return Array.from(map.entries());
  }, [rows, users]);

  const managerOverrideCount = visible.filter(r => (r as any)._managerOverride).length;
  const afterApprovalCount = visible.filter(r => (r as any)._afterApproval).length;

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Settings2 className="w-6 h-6 text-primary" />
              سجل تعديلات المخزون
            </h1>
            <p className="text-sm text-muted-foreground mt-1">التسويات اليدوية، الجرد، التعديلات بصلاحية مدير</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`w-4 h-4 ml-1 ${loading ? "animate-spin" : ""}`} />تحديث
            </Button>
            <Button variant="outline" size="sm" onClick={exportExcel}><Download className="w-4 h-4 ml-1" />Excel</Button>
            <Button variant="outline" size="sm" onClick={printReport}><FileText className="w-4 h-4 ml-1" />PDF</Button>
            <Button size="sm" onClick={printReport}><Printer className="w-4 h-4 ml-1" />طباعة</Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="p-4">
            <div className="text-xs text-muted-foreground">إجمالي التعديلات</div>
            <div className="text-2xl font-bold mt-1">{visible.length}</div>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><ShieldAlert className="w-3 h-3 text-rose-600" />صلاحية مدير</div>
            <div className="text-2xl font-bold text-rose-700 mt-1">{managerOverrideCount}</div>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <div className="text-xs text-muted-foreground">بعد اعتماد الجرد</div>
            <div className="text-2xl font-bold text-amber-700 mt-1">{afterApprovalCount}</div>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <div className="text-xs text-muted-foreground">آخر اعتماد جرد</div>
            <div className="text-sm font-semibold mt-1">{approvedSessionAt ? new Date(approvedSessionAt).toLocaleDateString("ar-EG") : "—"}</div>
          </CardContent></Card>
        </div>

        <Card>
          <CardContent className="p-4 grid grid-cols-2 md:grid-cols-6 gap-3">
            <div><Label className="text-xs">من تاريخ</Label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
            <div><Label className="text-xs">إلى تاريخ</Label><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
            <div><Label className="text-xs">السبب</Label>
              <Select value={reasonFilter} onValueChange={setReasonFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {STOCK_ADJUSTMENT_REASONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">المستخدم</Label>
              <Select value={userFilter} onValueChange={setUserFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {allUsers.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2"><Label className="text-xs">الصنف</Label>
              <Input value={itemFilter} onChange={e => setItemFilter(e.target.value)} placeholder="اسم الصنف..." />
            </div>
            <div className="md:col-span-6"><Button size="sm" onClick={load}>تطبيق</Button></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">التعديلات ({visible.length})</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>المستخدم</TableHead>
                  <TableHead>الدور</TableHead>
                  <TableHead>الصنف</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>قبل</TableHead>
                  <TableHead>بعد</TableHead>
                  <TableHead>الفرق</TableHead>
                  <TableHead>السبب</TableHead>
                  <TableHead>ملاحظات</TableHead>
                  <TableHead>رقم</TableHead>
                  <TableHead>بعد الاعتماد؟</TableHead>
                  <TableHead>صلاحية مدير؟</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.length === 0 && (
                  <TableRow><TableCell colSpan={13} className="text-center text-muted-foreground py-6">لا توجد تعديلات</TableCell></TableRow>
                )}
                {visible.map(r => (
                  <TableRow key={r.id} className={(r as any)._managerOverride ? "bg-rose-50/60" : ""}>
                    <TableCell className="text-xs whitespace-nowrap">{new Date(r.performed_at).toLocaleString("ar-EG")}</TableCell>
                    <TableCell className="text-xs">{users[r.performed_by || ""] || "—"}</TableCell>
                    <TableCell className="text-xs">{(userRoles[r.performed_by || ""] || []).join("، ") || "—"}</TableCell>
                    <TableCell className="text-sm">{items[r.item_id]?.name || "—"}</TableCell>
                    <TableCell><Badge variant="secondary">{MOVEMENT_TYPE_LABEL[r.movement_type] || r.movement_type}</Badge></TableCell>
                    <TableCell className="font-mono text-xs">{(r as any)._before?.toLocaleString("ar-EG")}</TableCell>
                    <TableCell className="font-mono text-xs">{(r as any)._after?.toLocaleString("ar-EG")}</TableCell>
                    <TableCell className={`font-mono text-xs ${(r as any)._diff < 0 ? "text-rose-700" : "text-emerald-700"}`}>{(r as any)._diff?.toLocaleString("ar-EG")}</TableCell>
                    <TableCell className="text-xs">{r.reason || "—"}</TableCell>
                    <TableCell className="text-xs">{r.notes || "—"}</TableCell>
                    <TableCell className="text-xs font-mono">{r.movement_no || "—"}</TableCell>
                    <TableCell className="text-xs">{(r as any)._afterApproval ? <Badge variant="outline" className="border-amber-400 text-amber-700">نعم</Badge> : "لا"}</TableCell>
                    <TableCell className="text-xs">{(r as any)._managerOverride ? <Badge variant="destructive">نعم</Badge> : "لا"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
