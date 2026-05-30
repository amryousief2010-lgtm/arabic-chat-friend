import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Warehouse, Package, ShoppingCart, Banknote, Plus, Trash2, AlertTriangle, Pencil, Printer, ClipboardCheck, Eye, Wallet, FileSpreadsheet, ArrowDownCircle, ArrowUpCircle } from "lucide-react";
import { toast } from "sonner";
import { exportCSV } from "@/lib/csvExport";

type Line = { id: string; ref_id: string; qty: number; price: number };
const newLine = (): Line => ({ id: crypto.randomUUID(), ref_id: "", qty: 0, price: 0 });
const fmt = (n: number) => Number(n || 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 });

// ============ PRINT HELPERS ============
const printHtml = (title: string, bodyHtml: string) => {
  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) return toast.error("فعّل النوافذ المنبثقة للطباعة");
  w.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"/><title>${title}</title>
    <style>
      *{box-sizing:border-box;font-family:'Cairo','Tajawal',Arial,sans-serif}
      body{padding:24px;color:#111}
      h1{margin:0 0 4px;font-size:20px}
      .meta{color:#555;font-size:13px;margin-bottom:14px}
      table{width:100%;border-collapse:collapse;margin-top:10px}
      th,td{border:1px solid #ccc;padding:6px 8px;font-size:13px;text-align:right}
      th{background:#f3f0ff}
      tfoot td{font-weight:bold;background:#fafafa}
      .header{display:flex;justify-content:space-between;align-items:start;border-bottom:2px solid #7c3aed;padding-bottom:10px;margin-bottom:14px}
      .brand{color:#7c3aed;font-weight:bold;font-size:22px}
      .total{margin-top:14px;text-align:left;font-size:16px}
      .sig{margin-top:40px;display:flex;justify-content:space-between;font-size:13px}
      @media print{ button{display:none} }
    </style></head><body>${bodyHtml}
    <div style="text-align:center;margin-top:18px"><button onclick="window.print()" style="padding:8px 22px;background:#7c3aed;color:#fff;border:0;border-radius:6px;cursor:pointer">طباعة</button></div>
    </body></html>`);
  w.document.close();
};

const printPurchase = (p: any) => {
  const rows = (p.feed_raw_purchase_items || []).map((it: any) => `
    <tr><td>${it.feed_raw_materials?.name || "-"}</td><td>${fmt(it.quantity)}</td><td>${it.feed_raw_materials?.unit || "كجم"}</td><td>${fmt(it.unit_price)}</td><td>${fmt(Number(it.quantity) * Number(it.unit_price))}</td></tr>`).join("");
  const total = (p.feed_raw_purchase_items || []).reduce((s: number, i: any) => s + Number(i.quantity) * Number(i.unit_price), 0);
  printHtml(`فاتورة شراء ${p.purchase_no}`, `
    <div class="header"><div><div class="brand">عاصمة النعام</div><div>مصنع الأعلاف — فاتورة شراء مواد خام</div></div>
      <div style="text-align:left"><div><b>رقم:</b> ${p.purchase_no}</div><div><b>التاريخ:</b> ${p.purchase_date}</div></div></div>
    <div class="meta"><b>المورد:</b> ${p.supplier || "-"} &nbsp; <b>رقم فاتورة المورد:</b> ${p.supplier_invoice_no || "-"}</div>
    <table><thead><tr><th>الصنف</th><th>الكمية</th><th>الوحدة</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" style="text-align:center">لا توجد بنود</td></tr>'}</tbody>
      <tfoot><tr><td colspan="4">الإجمالي</td><td>${fmt(total)} ج.م</td></tr></tfoot></table>
    ${p.notes ? `<div class="meta" style="margin-top:10px"><b>ملاحظات:</b> ${p.notes}</div>` : ""}
    <div class="sig"><div>توقيع المسؤول: ____________</div><div>توقيع المستلم: ____________</div></div>`);
};

const printSale = (s: any) => {
  const rows = (s.feed_sale_items || []).map((it: any) => `
    <tr><td>${it.feed_products?.name || it.feed_raw_materials?.name || "-"}</td><td>${fmt(it.quantity)} ${it.feed_raw_materials?.unit || "كجم"}</td><td>${fmt(it.unit_price)}</td><td>${fmt(Number(it.quantity) * Number(it.unit_price))}</td></tr>`).join("");
  const total = (s.feed_sale_items || []).reduce((sum: number, i: any) => sum + Number(i.quantity) * Number(i.unit_price), 0);
  printHtml(`فاتورة بيع ${s.sale_no}`, `
    <div class="header"><div><div class="brand">عاصمة النعام</div><div>مصنع الأعلاف — فاتورة بيع</div></div>
      <div style="text-align:left"><div><b>رقم:</b> ${s.sale_no}</div><div><b>التاريخ:</b> ${s.sale_date}</div></div></div>
    <div class="meta"><b>العميل:</b> ${s.customer || "-"}</div>
    <table><thead><tr><th>المنتج</th><th>الكمية</th><th>سعر الكيلو</th><th>الإجمالي</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4" style="text-align:center">لا توجد بنود</td></tr>'}</tbody>
      <tfoot><tr><td colspan="3">الإجمالي</td><td>${fmt(total)} ج.م</td></tr></tfoot></table>
    ${s.notes ? `<div class="meta" style="margin-top:10px"><b>ملاحظات:</b> ${s.notes}</div>` : ""}
    <div class="sig"><div>توقيع البائع: ____________</div><div>توقيع العميل: ____________</div></div>`);
};

const printCount = (c: any) => {
  const rows = (c.feed_stock_count_items || []).map((it: any) => {
    const v = Number(it.counted_qty) - Number(it.system_qty);
    const vv = v * Number(it.unit_cost || 0);
    return `<tr><td>${it.item_name}</td><td>${it.item_kind === "raw_material" ? "خامة" : "علف جاهز"}</td><td>${fmt(it.system_qty)}</td><td>${fmt(it.counted_qty)}</td><td style="color:${v < 0 ? "#dc2626" : v > 0 ? "#059669" : "#111"}">${fmt(v)}</td><td>${fmt(it.unit_cost)}</td><td>${fmt(vv)}</td></tr>`;
  }).join("");
  const total = (c.feed_stock_count_items || []).reduce((s: number, i: any) => s + (Number(i.counted_qty) - Number(i.system_qty)) * Number(i.unit_cost || 0), 0);
  printHtml(`محضر جرد ${c.count_no}`, `
    <div class="header"><div><div class="brand">عاصمة النعام</div><div>مصنع الأعلاف — محضر جرد</div></div>
      <div style="text-align:left"><div><b>رقم:</b> ${c.count_no}</div><div><b>التاريخ:</b> ${c.count_date}</div><div><b>الحالة:</b> ${c.status === "closed" ? "مغلق" : "مسودة"}</div></div></div>
    <table><thead><tr><th>الصنف</th><th>النوع</th><th>رصيد النظام</th><th>الفعلي</th><th>الفرق</th><th>سعر الوحدة</th><th>قيمة الفرق</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" style="text-align:center">لا توجد بنود</td></tr>'}</tbody>
      <tfoot><tr><td colspan="6">إجمالي قيمة الفروقات</td><td>${fmt(total)} ج.م</td></tr></tfoot></table>
    ${c.notes ? `<div class="meta" style="margin-top:10px"><b>ملاحظات:</b> ${c.notes}</div>` : ""}
    <div class="sig"><div>القائم بالجرد: ____________</div><div>المدير التنفيذي: ____________</div></div>`);
};

// ---- list printers ----
const printRawList = (rows: any[]) => {
  const body = rows.map((r) => `<tr><td>${r.name}</td><td>${fmt(r.stock)}</td><td>${r.unit||'كجم'}</td><td>${fmt(r.unit_cost)}</td><td>${fmt(Number(r.stock)*Number(r.unit_cost))}</td><td>${r.supplier||'-'}</td></tr>`).join("");
  const total = rows.reduce((s,r)=>s+Number(r.stock)*Number(r.unit_cost),0);
  printHtml("جرد المواد الخام", `<div class="header"><div><div class="brand">عاصمة النعام</div><div>مصنع الأعلاف — كشف المواد الخام</div></div><div style="text-align:left"><b>التاريخ:</b> ${new Date().toLocaleDateString('ar-EG')}</div></div>
  <table><thead><tr><th>الصنف</th><th>الرصيد</th><th>الوحدة</th><th>متوسط التكلفة</th><th>القيمة</th><th>المورد</th></tr></thead><tbody>${body}</tbody><tfoot><tr><td colspan="4">إجمالي قيمة المخزون</td><td colspan="2">${fmt(total)} ج.م</td></tr></tfoot></table>`);
};
const printProdList = (rows: any[]) => {
  const body = rows.map((p)=>{const bag=Number(p.default_bag_kg||50);const st=Number(p.current_stock||0);return `<tr><td>${p.name}</td><td>${p.stage||'-'}</td><td>${fmt(st)}</td><td>${fmt(bag>0?st/bag:0)}</td><td>${fmt(p.latest_unit_cost)}</td><td>${fmt(p.selling_price)}</td><td>${fmt(st*Number(p.latest_unit_cost||0))}</td></tr>`}).join("");
  const total = rows.reduce((s,p)=>s+Number(p.current_stock||0)*Number(p.latest_unit_cost||0),0);
  printHtml("جرد العلف الجاهز", `<div class="header"><div><div class="brand">عاصمة النعام</div><div>مصنع الأعلاف — كشف العلف الجاهز</div></div><div style="text-align:left"><b>التاريخ:</b> ${new Date().toLocaleDateString('ar-EG')}</div></div>
  <table><thead><tr><th>المنتج</th><th>المرحلة</th><th>الكمية كجم</th><th>عدد الشكاير</th><th>متوسط التكلفة</th><th>سعر البيع</th><th>القيمة</th></tr></thead><tbody>${body}</tbody><tfoot><tr><td colspan="6">إجمالي قيمة العلف</td><td>${fmt(total)} ج.م</td></tr></tfoot></table>`);
};
const printTreasury = (rows: any[], balance: number) => {
  const body = rows.map((t)=>`<tr><td>${t.txn_no}</td><td>${t.txn_date}</td><td>${KIND_LABEL[t.kind]||t.kind}</td><td>${t.party||'-'}</td><td>${t.note||'-'}</td><td style="color:#059669">${t.direction==='in'?fmt(t.amount):'-'}</td><td style="color:#dc2626">${t.direction==='out'?fmt(t.amount):'-'}</td></tr>`).join("");
  const tin = rows.filter(r=>r.direction==='in').reduce((s,r)=>s+Number(r.amount),0);
  const tout = rows.filter(r=>r.direction==='out').reduce((s,r)=>s+Number(r.amount),0);
  printHtml("كشف خزنة المصنع", `<div class="header"><div><div class="brand">عاصمة النعام</div><div>مصنع الأعلاف — كشف حركة الخزنة</div></div><div style="text-align:left"><b>التاريخ:</b> ${new Date().toLocaleDateString('ar-EG')}<br/><b>الرصيد:</b> ${fmt(balance)} ج.م</div></div>
  <table><thead><tr><th>الرقم</th><th>التاريخ</th><th>النوع</th><th>الجهة</th><th>البيان</th><th>وارد</th><th>منصرف</th></tr></thead><tbody>${body}</tbody><tfoot><tr><td colspan="5">الإجمالي</td><td>${fmt(tin)}</td><td>${fmt(tout)}</td></tr><tr><td colspan="6">الرصيد الحالي</td><td>${fmt(balance)} ج.م</td></tr></tfoot></table>`);
};

const KIND_LABEL: Record<string,string> = {
  sale: "بيع علف", purchase: "شراء خامات",
  loan_from_naam: "سلفة من شركة نعام", loan_to_naam: "إقراض شركة نعام",
  manual_in: "إيداع يدوي", manual_out: "سحب يدوي",
  opening_balance: "رصيد افتتاحي", other: "أخرى",
};
export default function FeedWarehouses() {
  const qc = useQueryClient();
  const { roles } = useAuth();
  const canEditStock = roles.some((r) => ["general_manager","executive_manager","warehouse_supervisor","production_manager"].includes(r));
  const canStockCount = roles.some((r) => ["general_manager","executive_manager"].includes(r));
  // Only top managers may delete/edit any transaction.
  const canManageAll = roles.some((r) => ["general_manager","executive_manager"].includes(r));
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [saleOpen, setSaleOpen] = useState(false);
  const [countOpen, setCountOpen] = useState(false);
  const [editRaw, setEditRaw] = useState<any | null>(null);
  const [editProd, setEditProd] = useState<any | null>(null);
  const [treasuryOpen, setTreasuryOpen] = useState(false);
  const canTreasury = roles.some((r) => ["general_manager","executive_manager","feed_factory_manager","warehouse_supervisor"].includes(r));

  // ---- delete helpers (top managers only) ----
  const confirmDel = (msg: string) => window.confirm(msg);
  const delPurchase = async (p: any) => {
    if (!confirmDel(`حذف فاتورة الشراء ${p.purchase_no}؟ سيتم إرجاع كميات الخامات من المخزن.`)) return;
    const { error } = await supabase.from("feed_raw_purchases").delete().eq("id", p.id);
    if (error) return toast.error(error.message);
    toast.success("تم حذف الفاتورة وإرجاع الخامات");
    qc.invalidateQueries({ queryKey: ["feed-purchases"] });
    qc.invalidateQueries({ queryKey: ["feed-raw-materials"] });
    qc.invalidateQueries({ queryKey: ["feed-treasury"] });
  };
  const delSale = async (s: any) => {
    if (!confirmDel(`حذف فاتورة البيع ${s.sale_no}؟ سيتم إرجاع كميات العلف للمخزون.`)) return;
    const { error } = await supabase.from("feed_sales").delete().eq("id", s.id);
    if (error) return toast.error(error.message);
    toast.success("تم حذف الفاتورة وإرجاع المخزون");
    qc.invalidateQueries({ queryKey: ["feed-sales"] });
    qc.invalidateQueries({ queryKey: ["feed-products"] });
    qc.invalidateQueries({ queryKey: ["feed-treasury"] });
  };
  const delTreasury = async (t: any) => {
    if (t.kind === "sale" || t.kind === "purchase") return toast.error("هذه الحركة ناتجة عن فاتورة — احذف الفاتورة من تبويبها.");
    if (!confirmDel(`حذف حركة الخزنة ${t.txn_no}؟`)) return;
    const { error } = await (supabase as any).from("feed_factory_treasury_txns").delete().eq("id", t.id);
    if (error) return toast.error(error.message);
    toast.success("تم حذف الحركة");
    qc.invalidateQueries({ queryKey: ["feed-treasury"] });
  };
  const delCount = async (c: any) => {
    if (!confirmDel(`حذف محضر الجرد ${c.count_no}؟`)) return;
    const { error } = await supabase.from("feed_stock_counts").delete().eq("id", c.id);
    if (error) return toast.error(error.message);
    toast.success("تم الحذف");
    qc.invalidateQueries({ queryKey: ["feed-stock-counts"] });
  };

  const rawQ = useQuery({
    queryKey: ["feed-raw-materials"],
    queryFn: async () => {
      const { data, error } = await supabase.from("feed_raw_materials").select("*").eq("is_active", true).order("name");
      if (error) throw error; return data || [];
    },
  });
  const prodQ = useQuery({
    queryKey: ["feed-products"],
    queryFn: async () => {
      const { data, error } = await supabase.from("feed_products").select("*").order("name");
      if (error) throw error; return data || [];
    },
  });
  const purQ = useQuery({
    queryKey: ["feed-purchases"],
    queryFn: async () => {
      const { data, error } = await supabase.from("feed_raw_purchases").select("*, feed_raw_purchase_items(*, feed_raw_materials(name,unit))").order("purchase_date", { ascending: false }).limit(100);
      if (error) throw error; return data || [];
    },
  });
  const salesQ = useQuery({
    queryKey: ["feed-sales"],
    queryFn: async () => {
      const { data, error } = await supabase.from("feed_sales").select("*, feed_sale_items(*, feed_products(name), feed_raw_materials(name,unit))").order("sale_date", { ascending: false }).limit(100);
      if (error) throw error; return data || [];
    },
  });
  const countsQ = useQuery({
    queryKey: ["feed-stock-counts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("feed_stock_counts").select("*, feed_stock_count_items(*)").order("count_date", { ascending: false }).limit(100);
      if (error) throw error; return data || [];
    },
  });
  const treasuryQ = useQuery({
    queryKey: ["feed-treasury"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("feed_factory_treasury_txns").select("*").order("txn_date", { ascending: false }).order("created_at", { ascending: false }).limit(500);
      if (error) throw error; return data || [];
    },
  });

  const rawValue = useMemo(() => (rawQ.data || []).reduce((s: number, r: any) => s + Number(r.stock || 0) * Number(r.unit_cost || 0), 0), [rawQ.data]);
  const finishedValue = useMemo(() => (prodQ.data || []).reduce((s: number, p: any) => s + Number(p.current_stock || 0) * Number(p.latest_unit_cost || 0), 0), [prodQ.data]);
  const treasuryBalance = useMemo(() => (treasuryQ.data || []).reduce((s: number, t: any) => s + (t.direction === "in" ? 1 : -1) * Number(t.amount || 0), 0), [treasuryQ.data]);
  const loanFromNaam = useMemo(() => (treasuryQ.data || []).filter((t: any) => t.kind === "loan_from_naam").reduce((s: number, t: any) => s + Number(t.amount), 0) - (treasuryQ.data || []).filter((t: any) => t.kind === "loan_to_naam").reduce((s: number, t: any) => s + Number(t.amount), 0), [treasuryQ.data]);

  const exportRaw = () => exportCSV("raw_materials.csv", (rawQ.data||[]).map((r:any)=>({الصنف:r.name,الرصيد:r.stock,الوحدة:r.unit,متوسط_التكلفة:r.unit_cost,القيمة:Number(r.stock)*Number(r.unit_cost),المورد:r.supplier||""})));
  const exportProd = () => exportCSV("finished_products.csv", (prodQ.data||[]).map((p:any)=>({المنتج:p.name,المرحلة:p.stage,الكمية_كجم:p.current_stock,عدد_الشكاير:Number(p.default_bag_kg||50)>0?Number(p.current_stock)/Number(p.default_bag_kg||50):0,وزن_الشيكارة:p.default_bag_kg,متوسط_التكلفة:p.latest_unit_cost,سعر_البيع:p.selling_price,القيمة:Number(p.current_stock||0)*Number(p.latest_unit_cost||0)})));
  const exportPur = () => exportCSV("purchases.csv", (purQ.data||[]).map((p:any)=>({الرقم:p.purchase_no,التاريخ:p.purchase_date,المورد:p.supplier||"",رقم_فاتورة_المورد:p.supplier_invoice_no||"",عدد_البنود:p.feed_raw_purchase_items?.length||0,الإجمالي:p.total_amount})));
  const exportSales = () => exportCSV("sales.csv", (salesQ.data||[]).map((s:any)=>({الرقم:s.sale_no,التاريخ:s.sale_date,العميل:s.customer||"",الإجمالي:s.total_amount,التكلفة:s.total_cost,الربح:s.profit})));
  const exportCounts = () => exportCSV("stock_counts.csv", (countsQ.data||[]).map((c:any)=>({الرقم:c.count_no,التاريخ:c.count_date,النوع:c.warehouse_kind,عدد_الأصناف:c.feed_stock_count_items?.length||0,الحالة:c.status})));
  const exportTreasury = () => exportCSV("treasury.csv", (treasuryQ.data||[]).map((t:any)=>({الرقم:t.txn_no,التاريخ:t.txn_date,النوع:KIND_LABEL[t.kind]||t.kind,الجهة:t.party||"",وارد:t.direction==="in"?t.amount:0,منصرف:t.direction==="out"?t.amount:0,البيان:t.note||""})));

  return (
    <DashboardLayout>
      <div dir="rtl" className="p-4 md:p-6 space-y-4">
        <div className="flex items-center gap-3">
          <Warehouse className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">مخازن مصنع الأعلاف</h1>
            <p className="text-sm text-muted-foreground">الخامات، الجاهز، المشتريات، المبيعات، الخزنة والجرد</p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">قيمة مخزن الخامات</div><div className="text-2xl font-bold text-primary">{fmt(rawValue)} ج.م</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">قيمة العلف الجاهز</div><div className="text-2xl font-bold text-secondary">{fmt(finishedValue)} ج.م</div></CardContent></Card>
          <Card className="border-success/50"><CardContent className="p-4"><div className="text-xs text-muted-foreground flex items-center gap-1"><Wallet className="h-3 w-3"/>رصيد الخزنة</div><div className={`text-2xl font-bold ${treasuryBalance<0?'text-destructive':'text-success'}`}>{fmt(treasuryBalance)} ج.م</div></CardContent></Card>
          <Card className="border-warning/50"><CardContent className="p-4"><div className="text-xs text-muted-foreground">مستحق لشركة نعام</div><div className={`text-2xl font-bold ${loanFromNaam>0?'text-warning':loanFromNaam<0?'text-success':''}`}>{fmt(loanFromNaam)} ج.م</div><div className="text-[10px] text-muted-foreground">{loanFromNaam>=0?'سلف قائمة':'فائض للمصنع'}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">أصناف خامات / جاهز</div><div className="text-2xl font-bold">{rawQ.data?.length||0} / {prodQ.data?.length||0}</div></CardContent></Card>
        </div>

        <Tabs defaultValue="raw" dir="rtl">
          <TabsList className="grid w-full grid-cols-6">
            <TabsTrigger value="raw"><Package className="h-4 w-4 ml-1" />الخامات</TabsTrigger>
            <TabsTrigger value="finished"><Warehouse className="h-4 w-4 ml-1" />الجاهز</TabsTrigger>
            <TabsTrigger value="purchases"><ShoppingCart className="h-4 w-4 ml-1" />المشتريات</TabsTrigger>
            <TabsTrigger value="sales"><Banknote className="h-4 w-4 ml-1" />المبيعات</TabsTrigger>
            <TabsTrigger value="treasury"><Wallet className="h-4 w-4 ml-1" />الخزنة</TabsTrigger>
            <TabsTrigger value="counts"><ClipboardCheck className="h-4 w-4 ml-1" />الجرد</TabsTrigger>
          </TabsList>

          {/* RAW STOCK */}
          <TabsContent value="raw">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
                <div><CardTitle>المواد الخام تحت التصنيع</CardTitle><CardDescription>الرصيد الحالي ومتوسط تكلفة كل خامة</CardDescription></div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => printRawList(rawQ.data || [])}><Printer className="h-4 w-4 ml-1"/>طباعة</Button>
                  <Button size="sm" variant="outline" onClick={exportRaw}><FileSpreadsheet className="h-4 w-4 ml-1"/>Excel</Button>
                  {canEditStock && <Button onClick={() => setEditRaw({})}><Plus className="h-4 w-4 ml-1" />إضافة خامة</Button>}
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow><TableHead>الصنف</TableHead><TableHead>الرصيد</TableHead><TableHead>الوحدة</TableHead><TableHead>متوسط التكلفة</TableHead><TableHead>القيمة</TableHead><TableHead>المورد</TableHead>{canEditStock && <TableHead></TableHead>}</TableRow></TableHeader>
                  <TableBody>
                    {(rawQ.data || []).map((r: any) => {
                      const low = Number(r.stock) <= Number(r.low_stock_threshold || 0);
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="font-medium">{r.name} {low && <AlertTriangle className="inline h-3 w-3 text-destructive" />}</TableCell>
                          <TableCell className={low ? "text-destructive font-bold" : ""}>{fmt(Number(r.stock))}</TableCell>
                          <TableCell>{r.unit || "كجم"}</TableCell>
                          <TableCell>{fmt(Number(r.unit_cost))}</TableCell>
                          <TableCell className="font-bold">{fmt(Number(r.stock) * Number(r.unit_cost))}</TableCell>
                          <TableCell className="text-muted-foreground text-xs">{r.supplier || "-"}</TableCell>
                          {canEditStock && <TableCell><Button size="icon" variant="ghost" onClick={() => setEditRaw(r)}><Pencil className="h-4 w-4" /></Button></TableCell>}
                        </TableRow>
                      );
                    })}
                    {!rawQ.data?.length && <TableRow><TableCell colSpan={canEditStock ? 7 : 6} className="text-center text-muted-foreground py-6">لا توجد خامات</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* FINISHED STOCK */}
          <TabsContent value="finished">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
                <div><CardTitle>العلف الجاهز للبيع</CardTitle><CardDescription>الرصيد بالكيلو والشكاير لكل منتج</CardDescription></div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => printProdList(prodQ.data || [])}><Printer className="h-4 w-4 ml-1"/>طباعة</Button>
                  <Button size="sm" variant="outline" onClick={exportProd}><FileSpreadsheet className="h-4 w-4 ml-1"/>Excel</Button>
                  {canEditStock && <Button onClick={() => setEditProd({})}><Plus className="h-4 w-4 ml-1" />إضافة منتج</Button>}
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {(prodQ.data || []).map((p: any) => {
                    const bag = Number(p.default_bag_kg || 50);
                    const stock = Number(p.current_stock || 0);
                    const bags = bag > 0 ? stock / bag : 0;
                    const value = stock * Number(p.latest_unit_cost || 0);
                    return (
                      <Card key={p.id} className="border-primary/20">
                        <CardContent className="p-4 space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="font-bold">{p.name}</div>
                            <div className="flex items-center gap-1">
                              <Badge variant="outline">{p.stage}</Badge>
                              {canEditStock && <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditProd(p)}><Pencil className="h-3.5 w-3.5" /></Button>}
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <div><div className="text-xs text-muted-foreground">الكمية</div><div className="font-bold text-lg text-primary">{fmt(stock)} كجم</div></div>
                            <div><div className="text-xs text-muted-foreground">عدد الشكاير</div><div className="font-bold text-lg text-secondary">{fmt(bags)}</div><div className="text-xs text-muted-foreground">({bag} كجم/شيكارة)</div></div>
                            <div><div className="text-xs text-muted-foreground">متوسط التكلفة</div><div>{fmt(Number(p.latest_unit_cost))} ج/كجم</div></div>
                            <div><div className="text-xs text-muted-foreground">سعر البيع</div><div>{fmt(Number(p.selling_price || 0))} ج/كجم</div></div>
                          </div>
                          <div className="pt-2 border-t flex justify-between text-sm"><span className="text-muted-foreground">القيمة الإجمالية</span><span className="font-bold">{fmt(value)} ج.م</span></div>
                        </CardContent>
                      </Card>
                    );
                  })}
                  {!prodQ.data?.length && <div className="text-center text-muted-foreground py-6 col-span-full">لا توجد منتجات</div>}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* PURCHASES */}
          <TabsContent value="purchases">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
                <div><CardTitle>مشتريات المواد الخام</CardTitle><CardDescription>سجل فواتير الشراء — اضغط الطباعة لطباعة الفاتورة</CardDescription></div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={exportPur}><FileSpreadsheet className="h-4 w-4 ml-1"/>Excel</Button>
                  <Button onClick={() => setPurchaseOpen(true)}><Plus className="h-4 w-4 ml-1" />شراء خامات</Button>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow><TableHead>الرقم</TableHead><TableHead>التاريخ</TableHead><TableHead>المورد</TableHead><TableHead>البنود</TableHead><TableHead>الإجمالي</TableHead><TableHead className="w-28">إجراءات</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {(purQ.data || []).map((p: any) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-mono text-xs">{p.purchase_no}</TableCell>
                        <TableCell>{p.purchase_date}</TableCell>
                        <TableCell>{p.supplier || "-"}</TableCell>
                        <TableCell>{p.feed_raw_purchase_items?.length || 0}</TableCell>
                        <TableCell className="font-bold">{fmt(Number(p.total_amount))} ج.م</TableCell>
                        <TableCell className="flex gap-1">
                          <Button size="icon" variant="ghost" onClick={() => printPurchase(p)}><Printer className="h-4 w-4" /></Button>
                          {canManageAll && <Button size="icon" variant="ghost" className="text-destructive" onClick={() => delPurchase(p)}><Trash2 className="h-4 w-4" /></Button>}
                        </TableCell>
                      </TableRow>
                    ))}
                    {!purQ.data?.length && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">لا توجد مشتريات</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* SALES */}
          <TabsContent value="sales">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
                <div><CardTitle>مبيعات العلف</CardTitle><CardDescription>سجل المبيعات والأرباح — اضغط الطباعة لإصدار فاتورة العميل</CardDescription></div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={exportSales}><FileSpreadsheet className="h-4 w-4 ml-1"/>Excel</Button>
                  <Button onClick={() => setSaleOpen(true)}><Plus className="h-4 w-4 ml-1" />فاتورة بيع</Button>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow><TableHead>الرقم</TableHead><TableHead>التاريخ</TableHead><TableHead>العميل</TableHead><TableHead>الإجمالي</TableHead><TableHead>التكلفة</TableHead><TableHead>الربح</TableHead><TableHead className="w-28">إجراءات</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {(salesQ.data || []).map((s: any) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-mono text-xs">{s.sale_no}</TableCell>
                        <TableCell>{s.sale_date}</TableCell>
                        <TableCell>{s.customer || "-"}</TableCell>
                        <TableCell>{fmt(Number(s.total_amount))}</TableCell>
                        <TableCell className="text-muted-foreground">{fmt(Number(s.total_cost))}</TableCell>
                        <TableCell className="font-bold text-success">{fmt(Number(s.profit))}</TableCell>
                        <TableCell className="flex gap-1">
                          <Button size="icon" variant="ghost" onClick={() => printSale(s)}><Printer className="h-4 w-4" /></Button>
                          {canManageAll && <Button size="icon" variant="ghost" className="text-destructive" onClick={() => delSale(s)}><Trash2 className="h-4 w-4" /></Button>}
                        </TableCell>
                      </TableRow>
                    ))}
                    {!salesQ.data?.length && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">لا توجد مبيعات</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* TREASURY */}
          <TabsContent value="treasury">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2"><Wallet className="h-5 w-5 text-success"/>خزنة مصنع الأعلاف</CardTitle>
                  <CardDescription>الرصيد الحالي: <span className={`font-bold ${treasuryBalance<0?'text-destructive':'text-success'}`}>{fmt(treasuryBalance)} ج.م</span> — البيع يضيف للخزنة والشراء يخصم منها تلقائياً</CardDescription>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button size="sm" variant="outline" onClick={() => printTreasury(treasuryQ.data || [], treasuryBalance)}><Printer className="h-4 w-4 ml-1"/>طباعة</Button>
                  <Button size="sm" variant="outline" onClick={exportTreasury}><FileSpreadsheet className="h-4 w-4 ml-1"/>Excel</Button>
                  {canTreasury && <Button onClick={() => setTreasuryOpen(true)}><Plus className="h-4 w-4 ml-1"/>حركة جديدة</Button>}
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow><TableHead>الرقم</TableHead><TableHead>التاريخ</TableHead><TableHead>النوع</TableHead><TableHead>الجهة</TableHead><TableHead>البيان</TableHead><TableHead>وارد</TableHead><TableHead>منصرف</TableHead>{canManageAll && <TableHead className="w-16">حذف</TableHead>}</TableRow></TableHeader>
                  <TableBody>
                    {(treasuryQ.data || []).map((t: any) => (
                      <TableRow key={t.id}>
                        <TableCell className="font-mono text-xs">{t.txn_no}</TableCell>
                        <TableCell>{t.txn_date}</TableCell>
                        <TableCell><Badge variant="outline">{KIND_LABEL[t.kind] || t.kind}</Badge></TableCell>
                        <TableCell>{t.party || "-"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{t.note || "-"}</TableCell>
                        <TableCell className="text-success font-bold">{t.direction === "in" ? fmt(t.amount) : "-"}</TableCell>
                        <TableCell className="text-destructive font-bold">{t.direction === "out" ? fmt(t.amount) : "-"}</TableCell>
                        {canManageAll && <TableCell>{t.kind !== "sale" && t.kind !== "purchase" && <Button size="icon" variant="ghost" className="text-destructive" onClick={() => delTreasury(t)}><Trash2 className="h-4 w-4" /></Button>}</TableCell>}
                      </TableRow>
                    ))}
                    {!treasuryQ.data?.length && <TableRow><TableCell colSpan={canManageAll ? 8 : 7} className="text-center text-muted-foreground py-6">لا توجد حركات بعد</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* STOCK COUNTS */}
          <TabsContent value="counts">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
                <div><CardTitle>الجرد الفعلي للمخازن</CardTitle><CardDescription>للمدير التنفيذي — جرد المخزون في أي وقت ومقارنته برصيد النظام</CardDescription></div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={exportCounts}><FileSpreadsheet className="h-4 w-4 ml-1"/>Excel</Button>
                  {canStockCount && <Button onClick={() => setCountOpen(true)}><Plus className="h-4 w-4 ml-1" />جرد جديد</Button>}
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow><TableHead>الرقم</TableHead><TableHead>التاريخ</TableHead><TableHead>النوع</TableHead><TableHead>عدد الأصناف</TableHead><TableHead>قيمة الفروقات</TableHead><TableHead>الحالة</TableHead><TableHead className="w-40">إجراءات</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {(countsQ.data || []).map((c: any) => {
                      const variance = (c.feed_stock_count_items || []).reduce((s: number, i: any) => s + (Number(i.counted_qty) - Number(i.system_qty)) * Number(i.unit_cost || 0), 0);
                      const applyCount = async () => {
                        if (!window.confirm(`تطبيق نتائج جرد ${c.count_no} على المخزون؟\nسيتم استبدال أرصدة الأصناف بالكميات المجرودة.`)) return;
                        const { error } = await (supabase as any).rpc("apply_feed_stock_count", { _count_id: c.id });
                        if (error) return toast.error(error.message);
                        toast.success("تم تطبيق الجرد وتحديث أرصدة المخزون");
                        qc.invalidateQueries({ queryKey: ["feed-stock-counts"] });
                        qc.invalidateQueries({ queryKey: ["feed-raw-materials"] });
                        qc.invalidateQueries({ queryKey: ["feed-products"] });
                      };
                      return (
                        <TableRow key={c.id}>
                          <TableCell className="font-mono text-xs">{c.count_no}</TableCell>
                          <TableCell>{c.count_date}</TableCell>
                          <TableCell>{c.warehouse_kind === "raw_material" ? "خامات" : c.warehouse_kind === "finished_feed" ? "جاهز" : "الكل"}</TableCell>
                          <TableCell>{c.feed_stock_count_items?.length || 0}</TableCell>
                          <TableCell className={variance < 0 ? "text-destructive font-bold" : variance > 0 ? "text-success font-bold" : ""}>{fmt(variance)} ج.م</TableCell>
                          <TableCell><Badge variant={c.status === "closed" ? "default" : "outline"}>{c.status === "closed" ? "مغلق" : "مسودة"}</Badge></TableCell>
                          <TableCell className="flex gap-1">
                            <Button size="icon" variant="ghost" onClick={() => printCount(c)}><Printer className="h-4 w-4" /></Button>
                            {canStockCount && <Button size="sm" variant="outline" onClick={applyCount} title="تطبيق الجرد على المخزون"><ClipboardCheck className="h-3.5 w-3.5 ml-1"/>تطبيق</Button>}
                            {canManageAll && <Button size="icon" variant="ghost" className="text-destructive" onClick={() => delCount(c)}><Trash2 className="h-4 w-4" /></Button>}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {!countsQ.data?.length && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">لا توجد عمليات جرد بعد</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <PurchaseDialog open={purchaseOpen} onOpenChange={setPurchaseOpen} materials={rawQ.data || []} onSaved={() => { qc.invalidateQueries({ queryKey: ["feed-raw-materials"] }); qc.invalidateQueries({ queryKey: ["feed-purchases"] }); }} />
        <SaleDialog open={saleOpen} onOpenChange={setSaleOpen} products={prodQ.data || []} materials={rawQ.data || []} onSaved={() => { qc.invalidateQueries({ queryKey: ["feed-products"] }); qc.invalidateQueries({ queryKey: ["feed-raw-materials"] }); qc.invalidateQueries({ queryKey: ["feed-sales"] }); qc.invalidateQueries({ queryKey: ["feed-treasury"] }); }} />
        {canEditStock && <RawMaterialDialog item={editRaw} onClose={() => setEditRaw(null)} onSaved={() => qc.invalidateQueries({ queryKey: ["feed-raw-materials"] })} />}
        {canEditStock && <ProductDialog item={editProd} onClose={() => setEditProd(null)} onSaved={() => qc.invalidateQueries({ queryKey: ["feed-products"] })} />}
        {canStockCount && <StockCountDialog open={countOpen} onOpenChange={setCountOpen} rawMaterials={rawQ.data || []} products={prodQ.data || []} onSaved={() => qc.invalidateQueries({ queryKey: ["feed-stock-counts"] })} />}
        {canTreasury && <TreasuryDialog open={treasuryOpen} onOpenChange={setTreasuryOpen} onSaved={() => qc.invalidateQueries({ queryKey: ["feed-treasury"] })} />}
      </div>
    </DashboardLayout>
  );
}

// ============ DIALOGS ============

function RawMaterialDialog({ item, onClose, onSaved }: { item: any | null; onClose: () => void; onSaved: () => void }) {
  const open = item !== null;
  const isEdit = !!item?.id;
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("كجم");
  const [stock, setStock] = useState<number>(0);
  const [unitCost, setUnitCost] = useState<number>(0);
  const [lowThr, setLowThr] = useState<number>(0);
  const [supplier, setSupplier] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setName(item?.name || ""); setUnit(item?.unit || "كجم");
    setStock(Number(item?.stock || 0)); setUnitCost(Number(item?.unit_cost || 0));
    setLowThr(Number(item?.low_stock_threshold || 0)); setSupplier(item?.supplier || "");
  }, [item?.id]);

  const save = async () => {
    if (!name.trim()) return toast.error("اكتب اسم الخامة");
    setSaving(true);
    try {
      const payload = { name, unit, stock, unit_cost: unitCost, low_stock_threshold: lowThr, supplier, is_active: true };
      const { error } = isEdit
        ? await supabase.from("feed_raw_materials").update(payload).eq("id", item.id)
        : await supabase.from("feed_raw_materials").insert(payload);
      if (error) throw error;
      toast.success(isEdit ? "تم تحديث الخامة" : "تم إضافة الخامة");
      onClose(); onSaved();
    } catch (e: any) { toast.error(e.message || "فشل الحفظ"); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader><DialogTitle>{isEdit ? "تعديل خامة" : "إضافة خامة جديدة"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Label>اسم الخامة</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><Label>الوحدة</Label><Input value={unit} onChange={(e) => setUnit(e.target.value)} /></div>
          <div><Label>المورد</Label><Input value={supplier} onChange={(e) => setSupplier(e.target.value)} /></div>
          <div><Label>الرصيد الحالي</Label><Input type="number" value={stock} onChange={(e) => setStock(Number(e.target.value))} /></div>
          <div><Label>متوسط التكلفة</Label><Input type="number" value={unitCost} onChange={(e) => setUnitCost(Number(e.target.value))} /></div>
          <div><Label>حد التنبيه</Label><Input type="number" value={lowThr} onChange={(e) => setLowThr(Number(e.target.value))} /></div>
        </div>
        <DialogFooter><Button onClick={save} disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProductDialog({ item, onClose, onSaved }: { item: any | null; onClose: () => void; onSaved: () => void }) {
  const open = item !== null;
  const isEdit = !!item?.id;
  const [name, setName] = useState("");
  const [stage, setStage] = useState("تسمين");
  const [feedCode, setFeedCode] = useState("");
  const [bagKg, setBagKg] = useState<number>(50);
  const [stock, setStock] = useState<number>(0);
  const [cost, setCost] = useState<number>(0);
  const [price, setPrice] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setName(item?.name || ""); setStage(item?.stage || "تسمين"); setFeedCode(item?.feed_code || "");
    setBagKg(Number(item?.default_bag_kg || 50)); setStock(Number(item?.current_stock || 0));
    setCost(Number(item?.latest_unit_cost || 0)); setPrice(Number(item?.selling_price || 0));
  }, [item?.id]);

  const save = async () => {
    if (!name.trim() || !feedCode.trim()) return toast.error("اكتب اسم وكود المنتج");
    setSaving(true);
    try {
      const payload: any = { name, stage, feed_code: feedCode, default_bag_kg: bagKg, current_stock: stock, latest_unit_cost: cost, selling_price: price };
      const { error } = isEdit
        ? await supabase.from("feed_products").update(payload).eq("id", item.id)
        : await supabase.from("feed_products").insert(payload);
      if (error) throw error;
      toast.success(isEdit ? "تم تحديث المنتج" : "تم إضافة المنتج");
      onClose(); onSaved();
    } catch (e: any) { toast.error(e.message || "فشل الحفظ"); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader><DialogTitle>{isEdit ? "تعديل منتج علف" : "إضافة منتج علف جاهز"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>اسم المنتج</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><Label>كود المنتج</Label><Input value={feedCode} onChange={(e) => setFeedCode(e.target.value)} /></div>
          <div><Label>المرحلة</Label><Input value={stage} onChange={(e) => setStage(e.target.value)} placeholder="تسمين / بادي / بياض ..." /></div>
          <div><Label>وزن الشيكارة (كجم)</Label><Input type="number" value={bagKg} onChange={(e) => setBagKg(Number(e.target.value))} /></div>
          <div><Label>الرصيد الحالي (كجم)</Label><Input type="number" value={stock} onChange={(e) => setStock(Number(e.target.value))} /></div>
          <div><Label>متوسط التكلفة (ج/كجم)</Label><Input type="number" value={cost} onChange={(e) => setCost(Number(e.target.value))} /></div>
          <div className="col-span-2"><Label>سعر البيع (ج/كجم)</Label><Input type="number" value={price} onChange={(e) => setPrice(Number(e.target.value))} /></div>
        </div>
        <DialogFooter><Button onClick={save} disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PurchaseDialog({ open, onOpenChange, materials, onSaved }: any) {
  const [supplier, setSupplier] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [saving, setSaving] = useState(false);
  const total = lines.reduce((s, l) => s + l.qty * l.price, 0);

  const save = async () => {
    const valid = lines.filter((l) => l.ref_id && l.qty > 0 && l.price >= 0);
    if (!valid.length) return toast.error("أضف بنداً واحداً على الأقل");
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: head, error: e1 } = await supabase.from("feed_raw_purchases").insert({
        supplier, supplier_invoice_no: invoiceNo, purchase_date: date, notes, created_by: user?.id,
      }).select("id").single();
      if (e1) throw e1;
      const { error: e2 } = await supabase.from("feed_raw_purchase_items").insert(
        valid.map((l) => ({ purchase_id: head.id, raw_material_id: l.ref_id, quantity: l.qty, unit_price: l.price }))
      );
      if (e2) throw e2;
      toast.success("تم حفظ فاتورة الشراء وتحديث المخزون");
      onOpenChange(false); onSaved();
      setSupplier(""); setInvoiceNo(""); setNotes(""); setLines([newLine()]);
    } catch (err: any) { toast.error(err.message || "فشل الحفظ"); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl" dir="rtl">
        <DialogHeader><DialogTitle>فاتورة شراء مواد خام</DialogTitle></DialogHeader>
        <div className="grid grid-cols-3 gap-3">
          <div><Label>المورد</Label><Input value={supplier} onChange={(e) => setSupplier(e.target.value)} /></div>
          <div><Label>رقم فاتورة المورد</Label><Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} /></div>
          <div><Label>التاريخ</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between"><Label>بنود الشراء</Label><Button size="sm" variant="outline" onClick={() => setLines([...lines, newLine()])}><Plus className="h-3 w-3 ml-1" />بند</Button></div>
          {lines.map((l) => (
            <div key={l.id} className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-5"><Select value={l.ref_id} onValueChange={(v) => setLines(lines.map((x) => x.id === l.id ? { ...x, ref_id: v } : x))}><SelectTrigger><SelectValue placeholder="اختر الخامة" /></SelectTrigger><SelectContent>{materials.map((m: any) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="col-span-2"><Input type="number" placeholder="الكمية" value={l.qty || ""} onChange={(e) => setLines(lines.map((x) => x.id === l.id ? { ...x, qty: Number(e.target.value) } : x))} /></div>
              <div className="col-span-2"><Input type="number" placeholder="سعر الوحدة" value={l.price || ""} onChange={(e) => setLines(lines.map((x) => x.id === l.id ? { ...x, price: Number(e.target.value) } : x))} /></div>
              <div className="col-span-2 text-sm font-bold text-left">{fmt(l.qty * l.price)}</div>
              <div className="col-span-1"><Button size="icon" variant="ghost" onClick={() => setLines(lines.filter((x) => x.id !== l.id))}><Trash2 className="h-4 w-4" /></Button></div>
            </div>
          ))}
        </div>
        <div><Label>ملاحظات</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></div>
        <div className="text-left text-xl font-bold">الإجمالي: {fmt(total)} ج.م</div>
        <DialogFooter><Button onClick={save} disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ الفاتورة"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SaleDialog({ open, onOpenChange, products, onSaved }: any) {
  const [customer, setCustomer] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [saving, setSaving] = useState(false);
  const total = lines.reduce((s, l) => s + l.qty * l.price, 0);

  const save = async () => {
    const valid = lines.filter((l) => l.ref_id && l.qty > 0 && l.price >= 0);
    if (!valid.length) return toast.error("أضف بنداً واحداً على الأقل");
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: head, error: e1 } = await supabase.from("feed_sales").insert({
        customer, sale_date: date, notes, created_by: user?.id,
      }).select("id").single();
      if (e1) throw e1;
      for (const l of valid) {
        const { error } = await supabase.from("feed_sale_items").insert({ sale_id: head.id, feed_product_id: l.ref_id, quantity: l.qty, unit_price: l.price });
        if (error) throw error;
      }
      toast.success("تم حفظ فاتورة البيع وخصم المخزون");
      onOpenChange(false); onSaved();
      setCustomer(""); setNotes(""); setLines([newLine()]);
    } catch (err: any) { toast.error(err.message || "فشل الحفظ"); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl" dir="rtl">
        <DialogHeader><DialogTitle>فاتورة بيع علف</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>العميل</Label><Input value={customer} onChange={(e) => setCustomer(e.target.value)} /></div>
          <div><Label>التاريخ</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between"><Label>البنود</Label><Button size="sm" variant="outline" onClick={() => setLines([...lines, newLine()])}><Plus className="h-3 w-3 ml-1" />بند</Button></div>
          {lines.map((l) => {
            const p = products.find((x: any) => x.id === l.ref_id);
            return (
              <div key={l.id} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-5"><Select value={l.ref_id} onValueChange={(v) => {
                  const prod = products.find((x: any) => x.id === v);
                  setLines(lines.map((x) => x.id === l.id ? { ...x, ref_id: v, price: Number(prod?.selling_price || x.price) } : x));
                }}><SelectTrigger><SelectValue placeholder="اختر المنتج" /></SelectTrigger><SelectContent>{products.map((m: any) => <SelectItem key={m.id} value={m.id}>{m.name} (متاح: {fmt(Number(m.current_stock))} كجم)</SelectItem>)}</SelectContent></Select>{p && <div className="text-xs text-muted-foreground mt-1">تكلفة: {fmt(Number(p.latest_unit_cost))}</div>}</div>
                <div className="col-span-2"><Input type="number" placeholder="الكمية كجم" value={l.qty || ""} onChange={(e) => setLines(lines.map((x) => x.id === l.id ? { ...x, qty: Number(e.target.value) } : x))} /></div>
                <div className="col-span-2"><Input type="number" placeholder="سعر الكيلو" value={l.price || ""} onChange={(e) => setLines(lines.map((x) => x.id === l.id ? { ...x, price: Number(e.target.value) } : x))} /></div>
                <div className="col-span-2 text-sm font-bold text-left">{fmt(l.qty * l.price)}</div>
                <div className="col-span-1"><Button size="icon" variant="ghost" onClick={() => setLines(lines.filter((x) => x.id !== l.id))}><Trash2 className="h-4 w-4" /></Button></div>
              </div>
            );
          })}
        </div>
        <div><Label>ملاحظات</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></div>
        <div className="text-left text-xl font-bold">الإجمالي: {fmt(total)} ج.م</div>
        <DialogFooter><Button onClick={save} disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ الفاتورة"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type CountRow = { id: string; kind: "raw_material" | "finished_feed"; ref_id: string; name: string; unit: string; system_qty: number; counted_qty: number; unit_cost: number };

function StockCountDialog({ open, onOpenChange, rawMaterials, products, onSaved }: any) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [kind, setKind] = useState<"raw_material" | "finished_feed" | "both">("both");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<CountRow[]>([]);
  const [saving, setSaving] = useState(false);

  // build snapshot rows whenever kind or source data changes
  useEffect(() => {
    if (!open) return;
    const items: CountRow[] = [];
    if (kind === "raw_material" || kind === "both") {
      for (const r of rawMaterials || []) {
        items.push({ id: crypto.randomUUID(), kind: "raw_material", ref_id: r.id, name: r.name, unit: r.unit || "كجم", system_qty: Number(r.stock || 0), counted_qty: Number(r.stock || 0), unit_cost: Number(r.unit_cost || 0) });
      }
    }
    if (kind === "finished_feed" || kind === "both") {
      for (const p of products || []) {
        items.push({ id: crypto.randomUUID(), kind: "finished_feed", ref_id: p.id, name: p.name, unit: "كجم", system_qty: Number(p.current_stock || 0), counted_qty: Number(p.current_stock || 0), unit_cost: Number(p.latest_unit_cost || 0) });
      }
    }
    setRows(items);
  }, [open, kind, rawMaterials, products]);

  const totalVariance = rows.reduce((s, r) => s + (r.counted_qty - r.system_qty) * r.unit_cost, 0);

  const save = async (mode: "draft" | "close" | "apply") => {
    if (!rows.length) return toast.error("لا توجد أصناف للجرد");
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const closeIt = mode !== "draft";
      const { data: head, error: e1 } = await supabase.from("feed_stock_counts").insert({
        count_date: date, warehouse_kind: kind, notes, status: closeIt ? "closed" : "draft",
        closed_at: closeIt ? new Date().toISOString() : null,
        total_variance_value: totalVariance, created_by: user?.id,
      }).select("id").single();
      if (e1) throw e1;
      const { error: e2 } = await supabase.from("feed_stock_count_items").insert(
        rows.map((r) => ({
          count_id: head.id, item_kind: r.kind,
          raw_material_id: r.kind === "raw_material" ? r.ref_id : null,
          feed_product_id: r.kind === "finished_feed" ? r.ref_id : null,
          item_name: r.name, unit: r.unit,
          system_qty: r.system_qty, counted_qty: r.counted_qty, unit_cost: r.unit_cost,
        }))
      );
      if (e2) throw e2;
      if (mode === "apply") {
        const { error: e3 } = await (supabase as any).rpc("apply_feed_stock_count", { _count_id: head.id });
        if (e3) throw e3;
        toast.success("تم حفظ الجرد وتعديل أرصدة المخزون");
      } else {
        toast.success(closeIt ? "تم حفظ وإغلاق محضر الجرد" : "تم حفظ محضر الجرد كمسودة");
      }
      onOpenChange(false); onSaved();
      setNotes("");
    } catch (err: any) { toast.error(err.message || "فشل الحفظ"); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader><DialogTitle>جرد فعلي للمخزون</DialogTitle></DialogHeader>
        <div className="grid grid-cols-3 gap-3">
          <div><Label>التاريخ</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div><Label>نوع المخزن</Label>
            <Select value={kind} onValueChange={(v: any) => setKind(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="both">الكل (خامات + جاهز)</SelectItem>
                <SelectItem value="raw_material">المواد الخام فقط</SelectItem>
                <SelectItem value="finished_feed">العلف الجاهز فقط</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end"><div className="text-sm">عدد الأصناف: <b>{rows.length}</b></div></div>
        </div>

        <Table>
          <TableHeader><TableRow><TableHead>الصنف</TableHead><TableHead>النوع</TableHead><TableHead>رصيد النظام</TableHead><TableHead>الفعلي</TableHead><TableHead>الفرق</TableHead><TableHead>قيمة الفرق</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((r, idx) => {
              const v = r.counted_qty - r.system_qty;
              const vv = v * r.unit_cost;
              return (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{r.kind === "raw_material" ? "خامة" : "جاهز"}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{fmt(r.system_qty)} {r.unit}</TableCell>
                  <TableCell>
                    <Input type="number" step="0.01" value={r.counted_qty}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setRows((prev) => prev.map((x, i) => i === idx ? { ...x, counted_qty: val } : x));
                      }}
                      className="h-8 w-28" />
                  </TableCell>
                  <TableCell className={v < 0 ? "text-destructive font-bold" : v > 0 ? "text-success font-bold" : ""}>{fmt(v)}</TableCell>
                  <TableCell className={vv < 0 ? "text-destructive" : vv > 0 ? "text-success" : ""}>{fmt(vv)}</TableCell>
                </TableRow>
              );
            })}
            {!rows.length && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">لا توجد أصناف</TableCell></TableRow>}
          </TableBody>
        </Table>

        <div><Label>ملاحظات</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></div>
        <div className="flex items-center justify-between border-t pt-3">
          <div className="text-lg">إجمالي قيمة الفروقات: <b className={totalVariance < 0 ? "text-destructive" : totalVariance > 0 ? "text-success" : ""}>{fmt(totalVariance)} ج.م</b></div>
        </div>
        <DialogFooter className="gap-2 flex-wrap">
          <Button variant="outline" onClick={() => save("draft")} disabled={saving}>حفظ كمسودة</Button>
          <Button variant="outline" onClick={() => save("close")} disabled={saving}>{saving ? "جاري الحفظ..." : "حفظ وإغلاق المحضر"}</Button>
          <Button onClick={() => save("apply")} disabled={saving} className="bg-primary"><ClipboardCheck className="h-4 w-4 ml-1"/>حفظ وتطبيق على المخزون</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TreasuryDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (b: boolean) => void; onSaved: () => void }) {
  const [kind, setKind] = useState<string>("loan_from_naam");
  const [amount, setAmount] = useState<number>(0);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [party, setParty] = useState("شركة نعام العاصمة");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (kind === "loan_from_naam" || kind === "loan_to_naam") setParty("شركة نعام العاصمة");
    else if (kind === "manual_in" || kind === "manual_out" || kind === "opening_balance") setParty("");
  }, [kind]);

  const direction: "in" | "out" = ["loan_from_naam", "manual_in", "opening_balance"].includes(kind) ? "in" : "out";

  const save = async () => {
    if (!amount || amount <= 0) return toast.error("اكتب مبلغاً صحيحاً");
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const txn_no = `TRZ-${Date.now().toString().slice(-8)}`;
      const { error } = await (supabase as any).from("feed_factory_treasury_txns").insert({
        txn_no, txn_date: date, direction, kind, amount, party, note, created_by: user?.id,
      });
      if (error) throw error;
      toast.success("تم تسجيل الحركة");
      onOpenChange(false); onSaved();
      setAmount(0); setNote("");
    } catch (e: any) { toast.error(e.message || "فشل الحفظ"); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Wallet className="h-5 w-5"/>حركة خزنة جديدة</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>نوع الحركة</Label>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger><SelectValue/></SelectTrigger>
              <SelectContent>
                <SelectItem value="loan_from_naam">سلفة من شركة نعام العاصمة (إيداع)</SelectItem>
                <SelectItem value="loan_to_naam">إقراض شركة نعام العاصمة (سحب)</SelectItem>
                <SelectItem value="manual_in">إيداع يدوي</SelectItem>
                <SelectItem value="manual_out">سحب يدوي / مصروف</SelectItem>
                <SelectItem value="opening_balance">رصيد افتتاحي</SelectItem>
                <SelectItem value="other">أخرى</SelectItem>
              </SelectContent>
            </Select>
            <div className="text-xs mt-1 text-muted-foreground">الاتجاه: <b className={direction === "in" ? "text-success" : "text-destructive"}>{direction === "in" ? "وارد (يضاف للخزنة)" : "منصرف (يُخصم من الخزنة)"}</b></div>
          </div>
          <div><Label>المبلغ (ج.م)</Label><Input type="number" value={amount || ""} onChange={(e) => setAmount(Number(e.target.value))} /></div>
          <div><Label>التاريخ</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="col-span-2"><Label>الجهة</Label><Input value={party} onChange={(e) => setParty(e.target.value)} /></div>
          <div className="col-span-2"><Label>البيان / الملاحظات</Label><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} /></div>
        </div>
        <DialogFooter><Button onClick={save} disabled={saving}>{saving ? "جاري الحفظ..." : "تسجيل الحركة"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
