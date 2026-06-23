import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Activity, RefreshCw, Download, Printer, FileText, TrendingUp, TrendingDown, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { MAIN_WAREHOUSE_OPERATIONAL_START_ISO } from "@/constants/warehouseOperations";
import { signedDelta, MOVEMENT_TYPE_LABEL, POSITIVE_TYPES, NEGATIVE_TYPES } from "@/lib/warehouseMovementSign";
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
  reference: string | null;
  performed_by: string | null;
  reason: string | null;
  notes: string | null;
  party: string | null;
}

const todayISO = () => new Date().toISOString().slice(0, 10);
const yesterdayISO = () => new Date(Date.now() - 86400000).toISOString().slice(0, 10);

export default function WarehouseDailyReport() {
  const [mainWhId, setMainWhId] = useState<string | null>(null);
  const [items, setItems] = useState<Record<string, { name: string; unit: string }>>({});
  const [itemThresholds, setItemThresholds] = useState<Record<string, { low: number; stock: number }>>({});
  const [users, setUsers] = useState<Record<string, string>>({});
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [userFilter, setUserFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [itemFilter, setItemFilter] = useState("");
  const [rows, setRows] = useState<Mov[]>([]);
  const [baselineByItem, setBaselineByItem] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  const setPreset = (p: "today" | "yesterday") => {
    if (p === "today") { setFrom(todayISO()); setTo(todayISO()); }
    else { setFrom(yesterdayISO()); setTo(yesterdayISO()); }
  };

  const load = async () => {
    setLoading(true);
    try {
      const { data: whs } = await supabase.from("warehouses").select("id, name");
      const main = (whs || []).find((w: any) =>
        w.name?.includes("الرئيسي") || w.name?.includes("المقر"));
      if (!main) { setRows([]); setLoading(false); return; }
      setMainWhId(main.id);

      const fromIso = from + "T00:00:00";
      const toIso = to + "T23:59:59";
      const effectiveFrom = fromIso < MAIN_WAREHOUSE_OPERATIONAL_START_ISO
        ? MAIN_WAREHOUSE_OPERATIONAL_START_ISO : fromIso;

      let q = supabase
        .from("inventory_movements")
        .select("id, movement_no, performed_at, warehouse_id, item_id, movement_type, quantity, reference, performed_by, reason, notes, party")
        .eq("warehouse_id", main.id)
        .gte("performed_at", effectiveFrom)
        .lte("performed_at", toIso)
        .order("performed_at", { ascending: false })
        .limit(2000);
      if (typeFilter !== "all") q = q.eq("movement_type", typeFilter);
      if (userFilter !== "all") q = q.eq("performed_by", userFilter);
      const { data: movs } = await q;
      const list = (movs || []) as Mov[];
      setRows(list);

      // load items meta
      const itemIds = Array.from(new Set(list.map(r => r.item_id)));
      if (itemIds.length) {
        const { data: its } = await supabase
          .from("inventory_items")
          .select("id, name, unit, low_stock_threshold, stock")
          .in("id", itemIds);
        const m: Record<string, { name: string; unit: string }> = {};
        const t: Record<string, { low: number; stock: number }> = {};
        (its || []).forEach((it: any) => {
          m[it.id] = { name: it.name, unit: it.unit || "" };
          t[it.id] = { low: Number(it.low_stock_threshold || 0), stock: Number(it.stock || 0) };
        });
        setItems(m); setItemThresholds(t);

        // baseline: sum signed deltas for these items before window starts
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
      } else {
        setItems({}); setItemThresholds({}); setBaselineByItem({});
      }

      // load users
      const userIds = Array.from(new Set(list.map(r => r.performed_by).filter(Boolean))) as string[];
      if (userIds.length) {
        const { data: us } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", userIds);
        const u: Record<string, string> = {};
        (us || []).forEach((x: any) => { u[x.id] = x.full_name || x.id; });
        setUsers(u);
      } else { setUsers({}); }
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  // Apply text filters & compute running balance per row
  const visible = useMemo(() => {
    const filtered = rows.filter(r => {
      if (itemFilter) {
        const name = items[r.item_id]?.name || "";
        if (!name.includes(itemFilter)) return false;
      }
      return true;
    });
    // running balance: traverse ascending per item
    const byItem: Record<string, Mov[]> = {};
    [...filtered].sort((a, b) => a.performed_at.localeCompare(b.performed_at))
      .forEach(m => { (byItem[m.item_id] ||= []).push(m); });
    const before: Record<string, number> = {};
    const after: Record<string, number> = {};
    Object.entries(byItem).forEach(([itemId, list]) => {
      let bal = baselineByItem[itemId] || 0;
      list.forEach(m => {
        before[m.id] = bal;
        bal += signedDelta(m.movement_type, m.quantity);
        after[m.id] = bal;
      });
    });
    return filtered.map(r => ({ ...r, _before: before[r.id] ?? 0, _after: after[r.id] ?? 0 }));
  }, [rows, items, itemFilter, baselineByItem]);

  const kpis = useMemo(() => {
    let totalIn = 0, totalOut = 0, cntIn = 0, cntOut = 0;
    const byItemMoves: Record<string, number> = {};
    const byUser: Set<string> = new Set();
    visible.forEach(r => {
      const q = Math.abs(Number(r.quantity) || 0);
      if (POSITIVE_TYPES.has(r.movement_type)) { totalIn += q; cntIn++; }
      else if (NEGATIVE_TYPES.has(r.movement_type)) { totalOut += q; cntOut++; }
      byItemMoves[r.item_id] = (byItemMoves[r.item_id] || 0) + 1;
      if (r.performed_by) byUser.add(r.performed_by);
    });
    const topItems = Object.entries(byItemMoves)
      .sort((a, b) => b[1] - a[1]).slice(0, 5);
    return { totalIn, totalOut, cntIn, cntOut, topItems, userCount: byUser.size };
  }, [visible]);

  // low stock & negative available — based on current item stock snapshot
  const lowStock = useMemo(() => {
    return Object.entries(itemThresholds)
      .filter(([, v]) => v.low > 0 && v.stock <= v.low)
      .map(([id, v]) => ({ id, name: items[id]?.name || id, stock: v.stock, low: v.low }))
      .slice(0, 20);
  }, [itemThresholds, items]);
  const negativeStock = useMemo(() => {
    return Object.entries(itemThresholds)
      .filter(([, v]) => v.stock < 0)
      .map(([id, v]) => ({ id, name: items[id]?.name || id, stock: v.stock }))
      .slice(0, 20);
  }, [itemThresholds, items]);

  const exportExcel = () => {
    const data = visible.map(r => ({
      "التاريخ والوقت": new Date(r.performed_at).toLocaleString("ar-EG"),
      "رقم العملية": r.movement_no || "—",
      "نوع الحركة": MOVEMENT_TYPE_LABEL[r.movement_type] || r.movement_type,
      "الصنف": items[r.item_id]?.name || "—",
      "الوحدة": items[r.item_id]?.unit || "",
      "الكمية": Number(r.quantity),
      "الجهة": r.party || "—",
      "السبب": r.reason || "—",
      "القائم بالتوريد/الصرف": r.party || "—",
      "المستخدم": users[r.performed_by || ""] || "—",
      "الرصيد قبل": (r as any)._before,
      "الرصيد بعد": (r as any)._after,
      "المرجع": r.reference || "—",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Daily");
    XLSX.writeFile(wb, `daily-warehouse-${from}_${to}.xlsx`);
  };

  const printReport = () => {
    const stats = `
      <div class="stats">
        <div class="stat"><div class="k">إجمالي الوارد</div><div class="v num">${fmtNum(kpis.totalIn, 2)}</div></div>
        <div class="stat"><div class="k">إجمالي الصرف</div><div class="v num">${fmtNum(kpis.totalOut, 2)}</div></div>
        <div class="stat"><div class="k">عدد حركات الوارد</div><div class="v num">${fmtNum(kpis.cntIn)}</div></div>
        <div class="stat"><div class="k">عدد حركات الصرف</div><div class="v num">${fmtNum(kpis.cntOut)}</div></div>
      </div>`;
    const tableRows = visible.map(r => `
      <tr>
        <td>${escapeHtml(fmtDate(r.performed_at))}</td>
        <td>${escapeHtml(r.movement_no || "—")}</td>
        <td>${escapeHtml(MOVEMENT_TYPE_LABEL[r.movement_type] || r.movement_type)}</td>
        <td>${escapeHtml(items[r.item_id]?.name || "—")}</td>
        <td class="num">${escapeHtml(fmtNum(r.quantity, 2))}</td>
        <td>${escapeHtml(r.party || "—")}</td>
        <td>${escapeHtml(r.reason || "—")}</td>
        <td>${escapeHtml(users[r.performed_by || ""] || "—")}</td>
        <td class="num">${escapeHtml(fmtNum((r as any)._before, 2))}</td>
        <td class="num">${escapeHtml(fmtNum((r as any)._after, 2))}</td>
      </tr>`).join("");
    const body = `
      <header>
        <div><h1>التقرير اليومي للمخزن الرئيسي</h1><div class="en">${COMPANY_AR}</div></div>
        <div class="meta">من: ${escapeHtml(from)}<br>إلى: ${escapeHtml(to)}<br>تاريخ الطباعة: ${escapeHtml(fmtDate(new Date().toISOString()))}</div>
      </header>
      ${stats}
      <h2>تفصيل الحركات (${visible.length})</h2>
      <table>
        <thead><tr>
          <th>التاريخ</th><th>رقم العملية</th><th>النوع</th><th>الصنف</th><th>الكمية</th>
          <th>الجهة</th><th>السبب</th><th>المستخدم</th><th>قبل</th><th>بعد</th>
        </tr></thead>
        <tbody>${tableRows || `<tr><td colspan="10" style="text-align:center;color:#888">لا توجد حركات</td></tr>`}</tbody>
      </table>`;
    openPrintWindow("التقرير اليومي للمخزن الرئيسي", body);
  };

  const allUsers = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach(r => { if (r.performed_by) map.set(r.performed_by, users[r.performed_by] || r.performed_by); });
    return Array.from(map.entries());
  }, [rows, users]);

  const allTypes = useMemo(() => Array.from(new Set(rows.map(r => r.movement_type))), [rows]);

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Activity className="w-6 h-6 text-primary" />
              التقرير اليومي للمخزن الرئيسي
            </h1>
            <p className="text-sm text-muted-foreground mt-1">حركات اليوم، الإجماليات، الأصناف المنخفضة، والمستخدمين</p>
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

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="p-4">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><TrendingUp className="w-3 h-3 text-emerald-600" />إجمالي الوارد اليوم</div>
            <div className="text-2xl font-bold text-emerald-700 mt-1">{kpis.totalIn.toLocaleString("ar-EG")}</div>
            <div className="text-xs text-muted-foreground mt-1">{kpis.cntIn} حركة</div>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><TrendingDown className="w-3 h-3 text-rose-600" />إجمالي الصرف اليوم</div>
            <div className="text-2xl font-bold text-rose-700 mt-1">{kpis.totalOut.toLocaleString("ar-EG")}</div>
            <div className="text-xs text-muted-foreground mt-1">{kpis.cntOut} حركة</div>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <div className="text-xs text-muted-foreground">الأصناف المنخفضة</div>
            <div className="text-2xl font-bold text-amber-700 mt-1">{lowStock.length}</div>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <div className="text-xs text-muted-foreground">المستخدمين النشطين</div>
            <div className="text-2xl font-bold mt-1">{kpis.userCount}</div>
          </CardContent></Card>
        </div>

        {negativeStock.length > 0 && (
          <Alert variant="destructive">
            <AlertTriangle className="w-4 h-4" />
            <AlertDescription>
              <span className="font-semibold">أصناف بالسالب: </span>
              {negativeStock.slice(0, 8).map(x => `${x.name} (${x.stock})`).join(" • ")}
              {negativeStock.length > 8 && ` و${negativeStock.length - 8} أخرى`}
            </AlertDescription>
          </Alert>
        )}

        {/* Filters */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" variant="outline" onClick={() => setPreset("today")}>اليوم</Button>
              <Button size="sm" variant="outline" onClick={() => setPreset("yesterday")}>أمس</Button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              <div><Label className="text-xs">من تاريخ</Label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
              <div><Label className="text-xs">إلى تاريخ</Label><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
              <div><Label className="text-xs">نوع الحركة</Label>
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">الكل</SelectItem>
                    {allTypes.map(t => <SelectItem key={t} value={t}>{MOVEMENT_TYPE_LABEL[t] || t}</SelectItem>)}
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
            </div>
            <Button size="sm" onClick={load}>تطبيق الفلاتر</Button>
          </CardContent>
        </Card>

        {/* Top items + low stock */}
        <div className="grid md:grid-cols-2 gap-3">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">أكثر الأصناف حركة</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              {kpis.topItems.length === 0 && <div className="text-muted-foreground text-xs">لا توجد حركات</div>}
              {kpis.topItems.map(([id, count]) => (
                <div key={id} className="flex justify-between border-b py-1">
                  <span>{items[id]?.name || id}</span>
                  <Badge variant="secondary">{count} حركة</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">أصناف منخفضة المخزون</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              {lowStock.length === 0 && <div className="text-muted-foreground text-xs">لا توجد أصناف منخفضة</div>}
              {lowStock.slice(0, 8).map(x => (
                <div key={x.id} className="flex justify-between border-b py-1">
                  <span>{x.name}</span>
                  <span className="font-mono text-amber-700">{x.stock} / {x.low}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Detail table */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">تفصيل الحركات ({visible.length})</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>رقم العملية</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>الصنف</TableHead>
                  <TableHead>الكمية</TableHead>
                  <TableHead>الجهة</TableHead>
                  <TableHead>السبب</TableHead>
                  <TableHead>المستخدم</TableHead>
                  <TableHead>قبل</TableHead>
                  <TableHead>بعد</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.length === 0 && (
                  <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-6">لا توجد حركات</TableCell></TableRow>
                )}
                {visible.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs whitespace-nowrap">{new Date(r.performed_at).toLocaleString("ar-EG")}</TableCell>
                    <TableCell className="text-xs font-mono">{r.movement_no || "—"}</TableCell>
                    <TableCell><Badge variant={POSITIVE_TYPES.has(r.movement_type) ? "default" : NEGATIVE_TYPES.has(r.movement_type) ? "destructive" : "secondary"}>{MOVEMENT_TYPE_LABEL[r.movement_type] || r.movement_type}</Badge></TableCell>
                    <TableCell className="text-sm">{items[r.item_id]?.name || "—"}</TableCell>
                    <TableCell className="font-mono">{Number(r.quantity).toLocaleString("ar-EG")}</TableCell>
                    <TableCell className="text-xs">{r.party || "—"}</TableCell>
                    <TableCell className="text-xs">{r.reason || "—"}</TableCell>
                    <TableCell className="text-xs">{users[r.performed_by || ""] || "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{(r as any)._before?.toLocaleString("ar-EG") ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{(r as any)._after?.toLocaleString("ar-EG") ?? "—"}</TableCell>
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
