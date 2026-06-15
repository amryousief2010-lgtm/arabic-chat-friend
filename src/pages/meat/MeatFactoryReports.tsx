import { useEffect, useMemo, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { openPrintWindow, escapeHtml, fmtNum as pFmtNum } from "@/lib/printPdf";
import { cairoMonthStartUTC, cairoTodayStartUTC, currentCairoYearMonth } from "@/lib/cairoDate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Printer, FileSpreadsheet, FileText, Calendar, RefreshCw, ArrowLeft,
  PackageOpen, Factory, Boxes, TrendingDown
} from "lucide-react";
import { toast } from "sonner";

type Move = {
  id: string; item_kind: string; item_id: string; item_name: string;
  direction: string; quantity: number; unit_cost: number; reason: string;
  ref_table: string | null; ref_id: string | null; created_by: string | null;
  created_at: string; stock_before: number | null; stock_after: number | null;
};
type Item = { id: string; name: string; kind: string; unit: string; current_stock: number; avg_cost: number; low_stock_threshold: number; is_active: boolean; };
type Invoice = { id: string; invoice_no: string; product_name: string; finished_qty: number; unit: string; status: string; created_at: string; raw_cost: number; spice_cost: number; packaging_cost: number; total_manufacturing_cost: number; materials_total_cost: number; };
type Line = { id: string; invoice_id: string; item_id: string; item_name: string; unit: string; quantity: number; unit_cost: number; line_total: number; kind: string; stock_before: number | null; stock_after: number | null; notes: string | null; };

const fmt = (n: any, d = 2) => Number(n || 0).toLocaleString("ar-EG", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtInt = (n: any) => Number(n || 0).toLocaleString("ar-EG");
const fmtMoney = (n: any) => `${fmt(n, 2)} ج.م`;
const fmtDT = (d: any) => d ? new Date(d).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" }) : "—";
const fmtD = (d: any) => d ? new Date(d).toLocaleDateString("ar-EG") : "—";

const KIND_LABEL: Record<string, string> = { raw: "خام", spice: "بهارات", packaging: "تغليف", finished: "منتج جاهز" };

function rangeDefaults() {
  const { year, monthIndex0 } = currentCairoYearMonth();
  const start = cairoMonthStartUTC(year, monthIndex0);
  const end = new Date();
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
}

function applyPreset(preset: string) {
  const now = new Date();
  if (preset === "today") {
    const s = cairoTodayStartUTC(now).toISOString().slice(0, 10);
    return { from: s, to: s };
  }
  if (preset === "week") {
    const start = new Date(cairoTodayStartUTC(now).getTime() - 6 * 86400000);
    return { from: start.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
  }
  return rangeDefaults();
}

export default function MeatFactoryReports() {
  const [params] = useSearchParams();
  const initialTab = params.get("tab") || "incoming";
  const [tab, setTab] = useState(initialTab);
  const [{ from, to }, setRange] = useState(rangeDefaults);
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [loading, setLoading] = useState(false);

  const [moves, setMoves] = useState<Move[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});

  const reload = async () => {
    setLoading(true);
    try {
      const fromISO = new Date(from + "T00:00:00").toISOString();
      const toISO = new Date(to + "T23:59:59").toISOString();

      const [movesRes, itemsRes, invRes] = await Promise.all([
        (supabase as any)
          .from("meat_factory_inventory_moves")
          .select("*")
          .gte("created_at", fromISO).lte("created_at", toISO)
          .order("created_at", { ascending: false })
          .limit(5000),
        (supabase as any).from("meat_factory_raw_items").select("*").order("name"),
        (supabase as any)
          .from("meat_manufacturing_invoices")
          .select("*")
          .gte("created_at", fromISO).lte("created_at", toISO)
          .order("created_at", { ascending: false })
          .limit(2000),
      ]);

      const mList: Move[] = movesRes.data || [];
      const iList: Item[] = itemsRes.data || [];
      const invList: Invoice[] = invRes.data || [];
      setMoves(mList);
      setItems(iList);
      setInvoices(invList);

      // Lines for invoices in range
      const invIds = invList.map(i => i.id);
      if (invIds.length) {
        const { data: ld } = await (supabase as any)
          .from("meat_manufacturing_invoice_lines")
          .select("*")
          .in("invoice_id", invIds);
        setLines(ld || []);
      } else setLines([]);

      // Profiles
      const uids = Array.from(new Set(mList.map(m => m.created_by).filter(Boolean))) as string[];
      if (uids.length) {
        const { data: pd } = await (supabase as any).from("profiles").select("id, full_name").in("id", uids);
        const map: Record<string, string> = {};
        (pd || []).forEach((p: any) => map[p.id] = p.full_name || "");
        setProfiles(map);
      } else setProfiles({});
    } catch (e: any) {
      toast.error(e?.message || "فشل تحميل البيانات");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [from, to]);

  // ───────── Derived data per report
  const incoming = useMemo(
    () => moves.filter(m => m.direction === "IN" && m.ref_table === "slaughter_batch_outputs"
      && (kindFilter === "all" || m.item_kind === kindFilter)),
    [moves, kindFilter]
  );
  const consumption = useMemo(
    () => moves.filter(m => m.direction === "OUT" && m.ref_table === "meat_manufacturing_invoices"
      && (kindFilter === "all" || m.item_kind === kindFilter)),
    [moves, kindFilter]
  );

  const invoiceById = useMemo(() => {
    const map: Record<string, Invoice> = {};
    invoices.forEach(i => { map[i.id] = i; });
    return map;
  }, [invoices]);

  // Production summary per product (approved/transferred + has lines)
  const linesByInvoice = useMemo(() => {
    const map: Record<string, Line[]> = {};
    lines.forEach(l => { (map[l.invoice_id] ||= []).push(l); });
    return map;
  }, [lines]);

  const production = useMemo(() => {
    const valid = invoices.filter(i =>
      ["approved", "transferred"].includes(i.status) && (linesByInvoice[i.id]?.length || 0) > 0
    );
    const byProduct: Record<string, any> = {};
    valid.forEach(i => {
      const k = i.product_name;
      if (!byProduct[k]) {
        byProduct[k] = {
          product_name: k, invoices: 0, qty: 0, raw: 0, spice: 0, packaging: 0,
          total: 0, last_date: i.created_at, unit: i.unit,
        };
      }
      const r = byProduct[k];
      r.invoices += 1;
      r.qty += Number(i.finished_qty || 0);
      r.raw += Number(i.raw_cost || 0);
      r.spice += Number(i.spice_cost || 0);
      r.packaging += Number(i.packaging_cost || 0);
      r.total += Number(i.total_manufacturing_cost || i.materials_total_cost || 0);
      if (new Date(i.created_at) > new Date(r.last_date)) r.last_date = i.created_at;
    });
    return Object.values(byProduct).map((r: any) => ({
      ...r,
      avg_unit_cost: r.qty > 0 ? r.total / r.qty : 0,
    }));
  }, [invoices, linesByInvoice]);

  const filteredItems = useMemo(
    () => items.filter(it => kindFilter === "all" || it.kind === kindFilter),
    [items, kindFilter]
  );

  // ───────── Summary cards
  const sumIncoming = useMemo(() => ({
    qty: incoming.reduce((s, m) => s + Number(m.quantity), 0),
    value: incoming.reduce((s, m) => s + Number(m.quantity) * Number(m.unit_cost), 0),
    items: new Set(incoming.map(m => m.item_id)).size,
    batches: new Set(incoming.map(m => m.ref_id).filter(Boolean)).size,
  }), [incoming]);

  const sumConsumption = useMemo(() => {
    const byItem: Record<string, number> = {};
    consumption.forEach(m => { byItem[m.item_name] = (byItem[m.item_name] || 0) + Number(m.quantity); });
    const top = Object.entries(byItem).sort((a, b) => b[1] - a[1])[0];
    return {
      qty: consumption.reduce((s, m) => s + Number(m.quantity), 0),
      value: consumption.reduce((s, m) => s + Number(m.quantity) * Number(m.unit_cost), 0),
      invoices: new Set(consumption.map(m => m.ref_id).filter(Boolean)).size,
      top_item: top ? `${top[0]} (${fmt(top[1], 2)})` : "—",
    };
  }, [consumption]);

  const sumProduction = useMemo(() => {
    const qty = production.reduce((s, r) => s + r.qty, 0);
    const total = production.reduce((s, r) => s + r.total, 0);
    return {
      qty, total, products: production.length,
      avg: qty > 0 ? total / qty : 0,
    };
  }, [production]);

  const sumStock = useMemo(() => {
    const v = (k?: string) => filteredItems
      .filter(i => !k || i.kind === k)
      .reduce((s, i) => s + Number(i.current_stock) * Number(i.avg_cost), 0);
    return {
      total: v(),
      raw: v("raw"),
      spice: v("spice"),
      packaging: v("packaging"),
      low: filteredItems.filter(i => i.current_stock > 0 && i.current_stock <= i.low_stock_threshold).length,
      zero: filteredItems.filter(i => Number(i.current_stock) <= 0).length,
    };
  }, [filteredItems]);

  // Last move per item (for stock report)
  const lastMoveByItem = useMemo(() => {
    const last: Record<string, { in?: string; out?: string }> = {};
    moves.forEach(m => {
      const e = (last[m.item_id] ||= {});
      if (m.direction === "IN" && (!e.in || m.created_at > e.in)) e.in = m.created_at;
      if (m.direction === "OUT" && (!e.out || m.created_at > e.out)) e.out = m.created_at;
    });
    return last;
  }, [moves]);

  // ───────── Export helpers
  const exportExcel = (rows: any[], filename: string) => {
    if (!rows.length) { toast.info("لا توجد بيانات للتصدير"); return; }
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = Object.keys(rows[0]).map(() => ({ wch: 18 }));
    (ws as any)["!dir"] = "rtl";
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "تقرير");
    XLSX.writeFile(wb, `${filename}.xlsx`);
  };

  const buildPrintHtml = (title: string, summary: [string, string][], headers: string[], rows: (string | number)[][]) => {
    const stats = summary.map(([k, v]) =>
      `<div class="stat"><div class="k">${escapeHtml(k)}</div><div class="v">${escapeHtml(v)}</div></div>`
    ).join("");
    const head = headers.map(h => `<th>${escapeHtml(h)}</th>`).join("");
    const body = rows.map(r =>
      `<tr>${r.map(c => `<td class="num">${escapeHtml(c)}</td>`).join("")}</tr>`
    ).join("") || `<tr><td colspan="${headers.length}" style="text-align:center;color:#888;padding:18px">لا توجد بيانات</td></tr>`;
    return `
      <header>
        <div>
          <h1>${escapeHtml(title)}</h1>
          <div class="en">Meat Factory Report — ${escapeHtml(from)} → ${escapeHtml(to)}</div>
        </div>
        <div class="meta">${new Date().toLocaleString("ar-EG")}</div>
      </header>
      <div class="stats">${stats}</div>
      <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
    `;
  };

  // ───────── Report 1: Incoming from slaughter
  const incomingRows = incoming.map(m => ({
    "التاريخ": fmtDT(m.created_at),
    "مرجع الذبح": m.ref_id ? m.ref_id.slice(0, 8) : "—",
    "الصنف": m.item_name,
    "النوع": KIND_LABEL[m.item_kind] || m.item_kind,
    "الكمية": Number(m.quantity),
    "سعر الوحدة": Number(m.unit_cost),
    "إجمالي القيمة": Number(m.quantity) * Number(m.unit_cost),
    "الرصيد قبل": m.stock_before ?? "",
    "الرصيد بعد": m.stock_after ?? "",
    "المستخدم": profiles[m.created_by || ""] || "—",
    "الملاحظات": m.reason || "",
  }));

  const printIncoming = () => openPrintWindow("تقرير وارد مصنع اللحوم من المجزر", buildPrintHtml(
    "تقرير وارد مصنع اللحوم من المجزر",
    [["إجمالي الكمية", fmt(sumIncoming.qty, 2)], ["إجمالي القيمة", fmtMoney(sumIncoming.value)],
     ["عدد الأصناف", String(sumIncoming.items)], ["عدد الدفعات", String(sumIncoming.batches)]],
    ["التاريخ", "مرجع", "الصنف", "النوع", "الكمية", "سعر", "إجمالي", "قبل", "بعد", "المستخدم"],
    incoming.map(m => [
      fmtDT(m.created_at), m.ref_id?.slice(0, 8) || "—", m.item_name, KIND_LABEL[m.item_kind] || m.item_kind,
      pFmtNum(m.quantity, 2), pFmtNum(m.unit_cost, 2), pFmtNum(Number(m.quantity) * Number(m.unit_cost), 2),
      pFmtNum(m.stock_before ?? 0, 2), pFmtNum(m.stock_after ?? 0, 2), profiles[m.created_by || ""] || "—"
    ])
  ));

  // ───────── Report 2: Consumption for manufacturing
  const consumptionRows = consumption.map(m => {
    const inv = invoiceById[m.ref_id || ""];
    return {
      "التاريخ": fmtDT(m.created_at),
      "رقم الفاتورة": inv?.invoice_no || "—",
      "المنتج النهائي": inv?.product_name || "—",
      "الصنف المسحوب": m.item_name,
      "النوع": KIND_LABEL[m.item_kind] || m.item_kind,
      "الكمية": Number(m.quantity),
      "سعر الوحدة": Number(m.unit_cost),
      "إجمالي التكلفة": Number(m.quantity) * Number(m.unit_cost),
      "الرصيد قبل": m.stock_before ?? "",
      "الرصيد بعد": m.stock_after ?? "",
      "المستخدم": profiles[m.created_by || ""] || "—",
      "الملاحظات": m.reason || "",
    };
  });

  const printConsumption = () => openPrintWindow("تقرير صرف خامات التصنيع", buildPrintHtml(
    "تقرير صرف خامات التصنيع",
    [["إجمالي الكمية", fmt(sumConsumption.qty, 2)], ["إجمالي التكلفة", fmtMoney(sumConsumption.value)],
     ["عدد الفواتير", String(sumConsumption.invoices)], ["أكثر صنف", sumConsumption.top_item]],
    ["التاريخ", "فاتورة", "المنتج", "الصنف", "النوع", "الكمية", "سعر", "إجمالي", "قبل", "بعد"],
    consumption.map(m => {
      const inv = invoiceById[m.ref_id || ""];
      return [
        fmtDT(m.created_at), inv?.invoice_no || "—", inv?.product_name || "—", m.item_name,
        KIND_LABEL[m.item_kind] || m.item_kind, pFmtNum(m.quantity, 2), pFmtNum(m.unit_cost, 2),
        pFmtNum(Number(m.quantity) * Number(m.unit_cost), 2), pFmtNum(m.stock_before ?? 0, 2), pFmtNum(m.stock_after ?? 0, 2)
      ];
    })
  ));

  // ───────── Report 3: Production
  const productionRows = production.map(r => ({
    "المنتج النهائي": r.product_name,
    "عدد الفواتير": r.invoices,
    "الكمية المصنعة": Number(r.qty),
    "الوحدة": r.unit,
    "تكلفة الخامات": Number(r.raw),
    "تكلفة البهارات": Number(r.spice),
    "تكلفة التغليف": Number(r.packaging),
    "إجمالي تكلفة التصنيع": Number(r.total),
    "متوسط تكلفة الوحدة": Number(r.avg_unit_cost),
    "آخر تاريخ تصنيع": fmtD(r.last_date),
  }));

  const printProduction = () => openPrintWindow("تقرير إنتاج الفترة", buildPrintHtml(
    "تقرير إنتاج الفترة",
    [["إجمالي الكمية المصنعة", fmt(sumProduction.qty, 2)], ["إجمالي التكلفة", fmtMoney(sumProduction.total)],
     ["عدد المنتجات", String(sumProduction.products)], ["متوسط تكلفة الوحدة", fmtMoney(sumProduction.avg)]],
    ["المنتج", "فواتير", "الكمية", "خامات", "بهارات", "تغليف", "إجمالي", "متوسط/وحدة", "آخر تاريخ"],
    production.map(r => [
      r.product_name, String(r.invoices), pFmtNum(r.qty, 2),
      pFmtNum(r.raw, 2), pFmtNum(r.spice, 2), pFmtNum(r.packaging, 2),
      pFmtNum(r.total, 2), pFmtNum(r.avg_unit_cost, 2), fmtD(r.last_date)
    ])
  ));

  // ───────── Report 4: Stock value
  const stockRows = filteredItems.map(i => {
    const value = Number(i.current_stock) * Number(i.avg_cost);
    const status = !i.is_active ? "غير نشط" : i.current_stock <= 0 ? "صفر" :
      i.current_stock <= i.low_stock_threshold ? "منخفض" : "متاح";
    return {
      "الصنف": i.name,
      "النوع": KIND_LABEL[i.kind] || i.kind,
      "الوحدة": i.unit,
      "الرصيد الحالي": Number(i.current_stock),
      "متوسط التكلفة": Number(i.avg_cost),
      "إجمالي القيمة": value,
      "حد إعادة الطلب": Number(i.low_stock_threshold),
      "الحالة": status,
      "آخر وارد": fmtD(lastMoveByItem[i.id]?.in),
      "آخر صرف": fmtD(lastMoveByItem[i.id]?.out),
    };
  });

  const printStock = () => openPrintWindow("تقرير قيمة المخزون", buildPrintHtml(
    "تقرير قيمة مخزون مصنع اللحوم",
    [["إجمالي القيمة", fmtMoney(sumStock.total)], ["قيمة الخامات", fmtMoney(sumStock.raw)],
     ["قيمة البهارات", fmtMoney(sumStock.spice)], ["قيمة التغليف", fmtMoney(sumStock.packaging)]],
    ["الصنف", "النوع", "الوحدة", "الرصيد", "متوسط التكلفة", "القيمة", "حد الطلب", "الحالة", "آخر وارد", "آخر صرف"],
    filteredItems.map(i => [
      i.name, KIND_LABEL[i.kind] || i.kind, i.unit, pFmtNum(i.current_stock, 2), pFmtNum(i.avg_cost, 2),
      pFmtNum(Number(i.current_stock) * Number(i.avg_cost), 2), pFmtNum(i.low_stock_threshold, 2),
      i.current_stock <= 0 ? "صفر" : i.current_stock <= i.low_stock_threshold ? "منخفض" : "متاح",
      fmtD(lastMoveByItem[i.id]?.in), fmtD(lastMoveByItem[i.id]?.out)
    ])
  ));

  // ───────── UI
  const Stat = ({ label, value, icon: Icon, color = "text-primary" }: any) => (
    <Card><CardContent className="p-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className={`text-lg font-bold tabular-nums ${color}`}>{value}</div>
        </div>
        {Icon && <Icon className={`h-7 w-7 opacity-30 ${color}`} />}
      </div>
    </CardContent></Card>
  );

  return (
    <div dir="rtl" className="p-4 space-y-4 max-w-[1600px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="h-6 w-6 text-primary" /> تقارير مصنع اللحوم
          </h1>
          <p className="text-sm text-muted-foreground">عرض وتحليل فقط — لا يتم تعديل أي رصيد من هنا.</p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/meat-factory/dashboard"><ArrowLeft className="h-4 w-4 ml-1" /> Dashboard</Link>
        </Button>
      </div>

      {/* Global Filters */}
      <Card>
        <CardContent className="p-3 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">من تاريخ</Label>
            <Input type="date" value={from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} className="w-40" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">إلى تاريخ</Label>
            <Input type="date" value={to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} className="w-40" />
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" onClick={() => setRange(applyPreset("today"))}>اليوم</Button>
            <Button size="sm" variant="outline" onClick={() => setRange(applyPreset("week"))}>الأسبوع</Button>
            <Button size="sm" variant="outline" onClick={() => setRange(applyPreset("month"))}>الشهر</Button>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">نوع الصنف</Label>
            <Select value={kindFilter} onValueChange={setKindFilter}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                <SelectItem value="raw">خام</SelectItem>
                <SelectItem value="spice">بهارات</SelectItem>
                <SelectItem value="packaging">تغليف</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" onClick={reload} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ml-1 ${loading ? "animate-spin" : ""}`} /> تحديث
          </Button>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid grid-cols-4 w-full">
          <TabsTrigger value="incoming"><PackageOpen className="h-4 w-4 ml-1" /> وارد المجزر</TabsTrigger>
          <TabsTrigger value="consumption"><Boxes className="h-4 w-4 ml-1" /> صرف التصنيع</TabsTrigger>
          <TabsTrigger value="production"><Factory className="h-4 w-4 ml-1" /> إنتاج الفترة</TabsTrigger>
          <TabsTrigger value="stock"><TrendingDown className="h-4 w-4 ml-1" /> قيمة المخزون</TabsTrigger>
        </TabsList>

        {/* Tab 1: Incoming */}
        <TabsContent value="incoming" className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Stat label="إجمالي الكمية" value={fmt(sumIncoming.qty, 2)} icon={PackageOpen} />
            <Stat label="إجمالي القيمة" value={fmtMoney(sumIncoming.value)} icon={PackageOpen} color="text-emerald-600" />
            <Stat label="عدد الأصناف" value={fmtInt(sumIncoming.items)} />
            <Stat label="عدد دفعات الذبح" value={fmtInt(sumIncoming.batches)} />
          </div>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 py-3">
              <CardTitle className="text-base">حركات الوارد من المجزر</CardTitle>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={printIncoming}><Printer className="h-4 w-4 ml-1" /> طباعة / PDF</Button>
                <Button size="sm" variant="outline" onClick={() => exportExcel(incomingRows, `incoming_${from}_${to}`)}>
                  <FileSpreadsheet className="h-4 w-4 ml-1" /> Excel
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      {["التاريخ", "مرجع الذبح", "الصنف", "النوع", "الكمية", "سعر الوحدة", "إجمالي القيمة", "قبل", "بعد", "المستخدم"].map(h =>
                        <th key={h} className="p-2 text-right">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {incoming.length === 0 ? (
                      <tr><td colSpan={10} className="p-6 text-center text-muted-foreground">لا توجد حركات وارد من المجزر في هذه الفترة</td></tr>
                    ) : incoming.map(m => (
                      <tr key={m.id} className="border-b hover:bg-muted/30">
                        <td className="p-2">{fmtDT(m.created_at)}</td>
                        <td className="p-2 font-mono text-[10px]">{m.ref_id?.slice(0, 8) || "—"}</td>
                        <td className="p-2 font-medium">{m.item_name}</td>
                        <td className="p-2"><Badge variant="outline">{KIND_LABEL[m.item_kind]}</Badge></td>
                        <td className="p-2 text-center tabular-nums">{fmt(m.quantity, 2)}</td>
                        <td className="p-2 text-center tabular-nums">{fmt(m.unit_cost, 2)}</td>
                        <td className="p-2 text-center tabular-nums font-semibold text-emerald-700">{fmt(Number(m.quantity) * Number(m.unit_cost), 2)}</td>
                        <td className="p-2 text-center tabular-nums">{fmt(m.stock_before ?? 0, 2)}</td>
                        <td className="p-2 text-center tabular-nums">{fmt(m.stock_after ?? 0, 2)}</td>
                        <td className="p-2 text-xs">{profiles[m.created_by || ""] || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 2: Consumption */}
        <TabsContent value="consumption" className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Stat label="إجمالي الكمية المصروفة" value={fmt(sumConsumption.qty, 2)} icon={Boxes} />
            <Stat label="إجمالي التكلفة" value={fmtMoney(sumConsumption.value)} color="text-rose-600" icon={Boxes} />
            <Stat label="عدد فواتير التصنيع" value={fmtInt(sumConsumption.invoices)} />
            <Stat label="أكثر صنف مسحوب" value={sumConsumption.top_item} />
          </div>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 py-3">
              <CardTitle className="text-base">صرف خامات للتصنيع</CardTitle>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={printConsumption}><Printer className="h-4 w-4 ml-1" /> طباعة / PDF</Button>
                <Button size="sm" variant="outline" onClick={() => exportExcel(consumptionRows, `consumption_${from}_${to}`)}>
                  <FileSpreadsheet className="h-4 w-4 ml-1" /> Excel
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      {["التاريخ", "فاتورة", "المنتج", "الصنف", "النوع", "الكمية", "سعر", "إجمالي", "قبل", "بعد"].map(h =>
                        <th key={h} className="p-2 text-right">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {consumption.length === 0 ? (
                      <tr><td colSpan={10} className="p-6 text-center text-muted-foreground">لا توجد حركات صرف تصنيع في هذه الفترة</td></tr>
                    ) : consumption.map(m => {
                      const inv = invoiceById[m.ref_id || ""];
                      return (
                        <tr key={m.id} className="border-b hover:bg-muted/30">
                          <td className="p-2">{fmtDT(m.created_at)}</td>
                          <td className="p-2 font-mono text-[10px]">{inv?.invoice_no || "—"}</td>
                          <td className="p-2 font-medium">{inv?.product_name || "—"}</td>
                          <td className="p-2">{m.item_name}</td>
                          <td className="p-2"><Badge variant="outline">{KIND_LABEL[m.item_kind]}</Badge></td>
                          <td className="p-2 text-center tabular-nums">{fmt(m.quantity, 2)}</td>
                          <td className="p-2 text-center tabular-nums">{fmt(m.unit_cost, 2)}</td>
                          <td className="p-2 text-center tabular-nums font-semibold text-rose-700">{fmt(Number(m.quantity) * Number(m.unit_cost), 2)}</td>
                          <td className="p-2 text-center tabular-nums">{fmt(m.stock_before ?? 0, 2)}</td>
                          <td className="p-2 text-center tabular-nums">{fmt(m.stock_after ?? 0, 2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 3: Production */}
        <TabsContent value="production" className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Stat label="إجمالي الكمية المصنعة" value={fmt(sumProduction.qty, 2)} icon={Factory} />
            <Stat label="إجمالي تكلفة التصنيع" value={fmtMoney(sumProduction.total)} color="text-primary" icon={Factory} />
            <Stat label="عدد المنتجات" value={fmtInt(sumProduction.products)} />
            <Stat label="متوسط تكلفة الوحدة" value={fmtMoney(sumProduction.avg)} color="text-emerald-600" />
          </div>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 py-3">
              <CardTitle className="text-base">إنتاج الفترة</CardTitle>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={printProduction}><Printer className="h-4 w-4 ml-1" /> طباعة / PDF</Button>
                <Button size="sm" variant="outline" onClick={() => exportExcel(productionRows, `production_${from}_${to}`)}>
                  <FileSpreadsheet className="h-4 w-4 ml-1" /> Excel
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      {["المنتج", "فواتير", "الكمية", "خامات", "بهارات", "تغليف", "إجمالي التكلفة", "متوسط/وحدة", "آخر تاريخ"].map(h =>
                        <th key={h} className="p-2 text-right">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {production.length === 0 ? (
                      <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">
                        لا توجد فواتير تصنيع معتمدة في هذه الفترة (يتم استبعاد draft/cancelled والفواتير بدون بنود)
                      </td></tr>
                    ) : production.map((r: any) => (
                      <tr key={r.product_name} className="border-b hover:bg-muted/30">
                        <td className="p-2 font-medium">{r.product_name}</td>
                        <td className="p-2 text-center">{r.invoices}</td>
                        <td className="p-2 text-center tabular-nums">{fmt(r.qty, 2)} {r.unit}</td>
                        <td className="p-2 text-center tabular-nums">{fmt(r.raw, 2)}</td>
                        <td className="p-2 text-center tabular-nums">{fmt(r.spice, 2)}</td>
                        <td className="p-2 text-center tabular-nums">{fmt(r.packaging, 2)}</td>
                        <td className="p-2 text-center tabular-nums font-semibold text-primary">{fmt(r.total, 2)}</td>
                        <td className="p-2 text-center tabular-nums">{fmt(r.avg_unit_cost, 2)}</td>
                        <td className="p-2">{fmtD(r.last_date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 4: Stock value */}
        <TabsContent value="stock" className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
            <Stat label="إجمالي قيمة المخزون" value={fmtMoney(sumStock.total)} color="text-primary" icon={Boxes} />
            <Stat label="قيمة الخامات" value={fmtMoney(sumStock.raw)} />
            <Stat label="قيمة البهارات" value={fmtMoney(sumStock.spice)} />
            <Stat label="قيمة التغليف" value={fmtMoney(sumStock.packaging)} />
            <Stat label="أصناف منخفضة" value={fmtInt(sumStock.low)} color="text-amber-600" />
            <Stat label="أصناف صفرية" value={fmtInt(sumStock.zero)} color="text-rose-600" />
          </div>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 py-3">
              <CardTitle className="text-base">قيمة مخزون مصنع اللحوم</CardTitle>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={printStock}><Printer className="h-4 w-4 ml-1" /> طباعة / PDF</Button>
                <Button size="sm" variant="outline" onClick={() => exportExcel(stockRows, `stock_value_${from}_${to}`)}>
                  <FileSpreadsheet className="h-4 w-4 ml-1" /> Excel
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      {["الصنف", "النوع", "الوحدة", "الرصيد", "متوسط التكلفة", "إجمالي القيمة", "حد الطلب", "الحالة", "آخر وارد", "آخر صرف"].map(h =>
                        <th key={h} className="p-2 text-right">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.length === 0 ? (
                      <tr><td colSpan={10} className="p-6 text-center text-muted-foreground">لا توجد أصناف</td></tr>
                    ) : filteredItems.map(i => {
                      const value = Number(i.current_stock) * Number(i.avg_cost);
                      const isLow = i.current_stock > 0 && i.current_stock <= i.low_stock_threshold;
                      const isZero = Number(i.current_stock) <= 0;
                      return (
                        <tr key={i.id} className="border-b hover:bg-muted/30">
                          <td className="p-2 font-medium">{i.name}</td>
                          <td className="p-2"><Badge variant="outline">{KIND_LABEL[i.kind]}</Badge></td>
                          <td className="p-2">{i.unit}</td>
                          <td className="p-2 text-center tabular-nums">{fmt(i.current_stock, 2)}</td>
                          <td className="p-2 text-center tabular-nums">{fmt(i.avg_cost, 2)}</td>
                          <td className="p-2 text-center tabular-nums font-semibold text-primary">{fmt(value, 2)}</td>
                          <td className="p-2 text-center tabular-nums">{fmt(i.low_stock_threshold, 2)}</td>
                          <td className="p-2">
                            {!i.is_active ? <Badge variant="secondary">غير نشط</Badge> :
                              isZero ? <Badge variant="destructive">صفر</Badge> :
                              isLow ? <Badge className="bg-amber-500">منخفض</Badge> :
                              <Badge className="bg-emerald-500">متاح</Badge>}
                          </td>
                          <td className="p-2 text-xs">{fmtD(lastMoveByItem[i.id]?.in)}</td>
                          <td className="p-2 text-xs">{fmtD(lastMoveByItem[i.id]?.out)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
