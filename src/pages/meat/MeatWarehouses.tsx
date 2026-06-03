import { useState, useMemo } from "react";
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
import {
  Warehouse, Package, ShoppingCart, Banknote, Plus, Trash2, AlertTriangle, Printer,
  ClipboardCheck, Wallet, Factory, Undo2, Beef, BarChart3, CheckCircle2, XCircle,
} from "lucide-react";
import { toast } from "sonner";

type Kind = "raw" | "finished";
type LineRow = { id: string; item_id: string; qty: number; price: number };
const newLine = (): LineRow => ({ id: crypto.randomUUID(), item_id: "", qty: 0, price: 0 });
const fmt = (n: number) => Number(n || 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 });

const printHtml = (title: string, body: string) => {
  const w = window.open("", "_blank", "width=950,height=720");
  if (!w) return toast.error("فعّل النوافذ المنبثقة للطباعة");
  w.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"/><title>${title}</title>
  <style>*{box-sizing:border-box;font-family:'Cairo','Tajawal',Arial,sans-serif}body{padding:24px;color:#111}
  h1{margin:0 0 4px;font-size:20px}.meta{color:#555;font-size:13px;margin-bottom:14px}
  table{width:100%;border-collapse:collapse;margin-top:10px}
  th,td{border:1px solid #ccc;padding:6px 8px;font-size:13px;text-align:right}
  th{background:#fee2e2}tfoot td{font-weight:bold;background:#fafafa}
  .header{display:flex;justify-content:space-between;border-bottom:2px solid #dc2626;padding-bottom:10px;margin-bottom:14px}
  .brand{color:#dc2626;font-weight:bold;font-size:22px}
  @media print{button{display:none}}</style></head><body>${body}
  <div style="text-align:center;margin-top:18px"><button onclick="window.print()" style="padding:8px 22px;background:#dc2626;color:#fff;border:0;border-radius:6px;cursor:pointer">طباعة</button></div>
  </body></html>`);
  w.document.close();
};

export default function MeatWarehouses() {
  const qc = useQueryClient();
  const { user, roles } = useAuth();
  const isManager = roles?.some((r) => r === "general_manager" || r === "executive_manager");

  // ---------- DATA ----------
  const { data: rawItems = [] } = useQuery({
    queryKey: ["mf-raw"],
    queryFn: async () => (await supabase.from("meat_factory_raw_items" as any).select("*").order("name")).data || [],
  });
  const { data: finItems = [] } = useQuery({
    queryKey: ["mf-fin"],
    queryFn: async () => (await supabase.from("meat_factory_finished_items" as any).select("*").order("name")).data || [],
  });
  const { data: pkgItems = [] } = useQuery({
    queryKey: ["mf-pkg"],
    queryFn: async () => (await supabase.from("packaging_materials" as any)
      .select("id,name_ar,unit,stock,unit_cost,module,is_active")
      .in("module", ["meat", "shared"]).eq("is_active", true).order("name_ar")).data || [],
  });
  const { data: purchases = [] } = useQuery({
    queryKey: ["mf-pur"],
    queryFn: async () => (await supabase.from("meat_factory_purchases" as any).select("*, meat_factory_purchase_lines(*)").order("purchase_date", { ascending: false })).data || [],
  });
  const { data: mfgs = [] } = useQuery({
    queryKey: ["mf-mfg"],
    queryFn: async () => (await supabase.from("meat_factory_manufacturing" as any).select("*, meat_factory_manufacturing_lines(*)").order("mfg_date", { ascending: false })).data || [],
  });
  const { data: sales = [] } = useQuery({
    queryKey: ["mf-sal"],
    queryFn: async () => (await supabase.from("meat_factory_sales" as any).select("*, meat_factory_sales_lines(*)").order("sale_date", { ascending: false })).data || [],
  });
  const { data: returns = [] } = useQuery({
    queryKey: ["mf-ret"],
    queryFn: async () => (await supabase.from("meat_factory_sales_returns" as any).select("*, meat_factory_sales_return_lines(*)").order("return_date", { ascending: false })).data || [],
  });
  const { data: txns = [] } = useQuery({
    queryKey: ["mf-txn"],
    queryFn: async () => (await supabase.from("meat_factory_treasury_txns" as any).select("*").order("txn_date", { ascending: false }).limit(500)).data || [],
  });
  const { data: moves = [] } = useQuery({
    queryKey: ["mf-mov"],
    queryFn: async () => (await supabase.from("meat_factory_inventory_moves" as any).select("*").order("created_at", { ascending: false }).limit(500)).data || [],
  });
  const { data: stocks = [] } = useQuery({
    queryKey: ["mf-stk"],
    queryFn: async () => (await supabase.from("meat_factory_stocktaking" as any).select("*, meat_factory_stocktaking_lines(*)").order("taken_date", { ascending: false })).data || [],
  });

  const invalidateAll = () => {
    ["mf-raw","mf-fin","mf-pkg","mf-pur","mf-mfg","mf-sal","mf-ret","mf-txn","mf-mov","mf-stk"].forEach((k)=>qc.invalidateQueries({queryKey:[k]}));
  };

  // ---------- STATS ----------
  const stats = useMemo(() => {
    const rawValue = (rawItems as any[]).reduce((s, i) => s + Number(i.current_stock) * Number(i.avg_cost), 0);
    const finValue = (finItems as any[]).reduce((s, i) => s + Number(i.current_stock) * Number(i.avg_cost), 0);
    const balance = (txns as any[]).reduce((s, t) => s + (t.direction === "IN" ? 1 : -1) * Number(t.amount), 0);
    const naamDue = (txns as any[]).filter((t) => /نعام/.test(t.reason || "")).reduce((s, t) => s + (t.direction === "OUT" ? 1 : -1) * Number(t.amount), 0);
    return { rawValue, finValue, balance, naamDue, rawCount: rawItems.length, finCount: finItems.length };
  }, [rawItems, finItems, txns]);

  // ---------- ITEM CRUD ----------
  const [newItemOpen, setNewItemOpen] = useState<null | Kind>(null);
  const [itemName, setItemName] = useState(""); const [itemUnit, setItemUnit] = useState("كجم");
  const [itemPrice, setItemPrice] = useState(0); const [itemAlert, setItemAlert] = useState(0);
  const saveItem = async () => {
    if (!itemName.trim()) return toast.error("ادخل اسم الصنف");
    const tbl = newItemOpen === "raw" ? "meat_factory_raw_items" : "meat_factory_finished_items";
    const payload: any = { name: itemName, unit: itemUnit, low_stock_threshold: itemAlert };
    if (newItemOpen === "finished") payload.sale_price = itemPrice;
    const { error } = await supabase.from(tbl as any).insert(payload);
    if (error) return toast.error(error.message);
    toast.success("تمت الإضافة"); setNewItemOpen(null); setItemName(""); setItemPrice(0); setItemAlert(0); invalidateAll();
  };

  // ---------- PURCHASE FORM ----------
  const [purOpen, setPurOpen] = useState(false);
  const [purDate, setPurDate] = useState(new Date().toISOString().slice(0,10));
  const [purSupplier, setPurSupplier] = useState("");
  const [purPay, setPurPay] = useState<"cash"|"credit">("cash");
  const [purNotes, setPurNotes] = useState("");
  const [purLines, setPurLines] = useState<LineRow[]>([newLine()]);
  const purTotal = purLines.reduce((s,l)=>s+l.qty*l.price,0);
  const resetPur = () => { setPurOpen(false); setPurSupplier(""); setPurNotes(""); setPurLines([newLine()]); setPurPay("cash"); };
  const savePurchase = async (approve: boolean) => {
    const lines = purLines.filter(l=>l.item_id && l.qty>0 && l.price>=0);
    if (!lines.length) return toast.error("أضف صنفًا واحدًا على الأقل");
    const { data: p, error } = await supabase.from("meat_factory_purchases" as any).insert({
      purchase_date: purDate, supplier: purSupplier, payment_method: purPay,
      total_amount: lines.reduce((s,l)=>s+l.qty*l.price,0), notes: purNotes, created_by: user?.id,
    }).select().single();
    if (error || !p) return toast.error(error?.message || "فشل");
    const lineRows = lines.map((l)=>{const it=(rawItems as any[]).find(x=>x.id===l.item_id); return {
      purchase_id:(p as any).id, raw_item_id:l.item_id, raw_item_name:it?.name||"", quantity:l.qty, unit_price:l.price, line_total:l.qty*l.price,
    };});
    const { error: e2 } = await supabase.from("meat_factory_purchase_lines" as any).insert(lineRows);
    if (e2) return toast.error(e2.message);
    if (approve) {
      const { error: e3 } = await supabase.rpc("approve_meat_purchase" as any, { p_purchase_id: (p as any).id });
      if (e3) return toast.error(e3.message);
      toast.success("تم الاعتماد والتأثير على المخزون والخزنة");
    } else { toast.success("تم الحفظ كمسودة"); }
    resetPur(); invalidateAll();
  };
  const approvePurchase = async (id: string) => {
    const { error } = await supabase.rpc("approve_meat_purchase" as any, { p_purchase_id: id });
    if (error) return toast.error(error.message);
    toast.success("تم الاعتماد"); invalidateAll();
  };

  // ---------- MANUFACTURING FORM ----------
  const [mfgOpen, setMfgOpen] = useState(false);
  const [mfgDate, setMfgDate] = useState(new Date().toISOString().slice(0,10));
  const [mfgItem, setMfgItem] = useState(""); const [mfgQty, setMfgQty] = useState(0); const [mfgNotes, setMfgNotes] = useState("");
  const [mfgLines, setMfgLines] = useState<LineRow[]>([newLine()]);
  const [mfgPkgLines, setMfgPkgLines] = useState<LineRow[]>([newLine()]);
  const resetMfg = () => { setMfgOpen(false); setMfgItem(""); setMfgQty(0); setMfgNotes(""); setMfgLines([newLine()]); setMfgPkgLines([newLine()]); };
  const saveMfg = async (approve: boolean) => {
    if (!mfgItem || mfgQty<=0) return toast.error("اختر منتجًا وادخل الكمية");
    const lines = mfgLines.filter(l=>l.item_id && l.qty>0);
    if (!lines.length) return toast.error("أضف خامة غذائية واحدة على الأقل");
    const pkgLines = mfgPkgLines.filter(l=>l.item_id && l.qty>0);
    const fin = (finItems as any[]).find(x=>x.id===mfgItem);
    const { data: m, error } = await supabase.from("meat_factory_manufacturing" as any).insert({
      mfg_date: mfgDate, finished_item_id: mfgItem, finished_item_name: fin?.name||"", produced_qty: mfgQty, notes: mfgNotes, created_by: user?.id,
    }).select().single();
    if (error || !m) return toast.error(error?.message || "فشل");
    const lineRows = lines.map((l)=>{const it=(rawItems as any[]).find(x=>x.id===l.item_id); return {
      manufacturing_id:(m as any).id, raw_item_id:l.item_id, raw_item_name:it?.name||"", quantity:l.qty, unit_cost:Number(it?.avg_cost||0), line_total:l.qty*Number(it?.avg_cost||0),
    };});
    const { error: e2 } = await supabase.from("meat_factory_manufacturing_lines" as any).insert(lineRows);
    if (e2) return toast.error(e2.message);
    if (pkgLines.length) {
      const pkgRows = pkgLines.map((l)=>{const it=(pkgItems as any[]).find(x=>x.id===l.item_id); return {
        manufacturing_id:(m as any).id, packaging_id:l.item_id, packaging_name:it?.name_ar||"", quantity:l.qty, unit_cost:Number(it?.unit_cost||0), line_total:l.qty*Number(it?.unit_cost||0),
      };});
      const { error: ep } = await supabase.from("meat_factory_manufacturing_packaging_lines" as any).insert(pkgRows);
      if (ep) return toast.error(ep.message);
    }
    if (approve) {
      const { error: e3 } = await supabase.rpc("approve_meat_manufacturing" as any, { p_id: (m as any).id });
      if (e3) return toast.error(e3.message);
      toast.success("تم اعتماد التصنيع — خصم الخامات الغذائية ومواد التغليف وإضافة المنتج");
    } else { toast.success("تم الحفظ كمسودة"); }
    resetMfg(); invalidateAll();
  };
  const approveMfg = async (id: string) => {
    const { error } = await supabase.rpc("approve_meat_manufacturing" as any, { p_id: id });
    if (error) return toast.error(error.message);
    toast.success("تم الاعتماد"); invalidateAll();
  };

  // ---------- SALES FORM ----------
  const [salOpen, setSalOpen] = useState(false);
  const [salDate, setSalDate] = useState(new Date().toISOString().slice(0,10));
  const [salCustomer, setSalCustomer] = useState(""); const [salPay, setSalPay] = useState<"cash"|"credit">("cash");
  const [salNotes, setSalNotes] = useState(""); const [salLines, setSalLines] = useState<LineRow[]>([newLine()]);
  const salTotal = salLines.reduce((s,l)=>s+l.qty*l.price,0);
  const resetSal = () => { setSalOpen(false); setSalCustomer(""); setSalNotes(""); setSalLines([newLine()]); setSalPay("cash"); };
  const saveSale = async (approve: boolean) => {
    const lines = salLines.filter(l=>l.item_id && l.qty>0 && l.price>=0);
    if (!lines.length) return toast.error("أضف منتجًا واحدًا على الأقل");
    const { data: s, error } = await supabase.from("meat_factory_sales" as any).insert({
      sale_date: salDate, customer: salCustomer, payment_method: salPay,
      total_amount: lines.reduce((sm,l)=>sm+l.qty*l.price,0), notes: salNotes, created_by: user?.id,
    }).select().single();
    if (error || !s) return toast.error(error?.message || "فشل");
    const lineRows = lines.map((l)=>{const it=(finItems as any[]).find(x=>x.id===l.item_id); return {
      sale_id:(s as any).id, finished_item_id:l.item_id, finished_item_name:it?.name||"", quantity:l.qty, unit_price:l.price, line_total:l.qty*l.price,
    };});
    const { error: e2 } = await supabase.from("meat_factory_sales_lines" as any).insert(lineRows);
    if (e2) return toast.error(e2.message);
    if (approve) {
      const { error: e3 } = await supabase.rpc("approve_meat_sale" as any, { p_id: (s as any).id });
      if (e3) return toast.error(e3.message);
      toast.success("تم اعتماد البيع");
    } else { toast.success("تم الحفظ كمسودة"); }
    resetSal(); invalidateAll();
  };
  const approveSale = async (id: string) => {
    const { error } = await supabase.rpc("approve_meat_sale" as any, { p_id: id });
    if (error) return toast.error(error.message);
    toast.success("تم الاعتماد"); invalidateAll();
  };

  // ---------- SALES RETURNS FORM ----------
  const [retOpen, setRetOpen] = useState(false);
  const [retDate, setRetDate] = useState(new Date().toISOString().slice(0,10));
  const [retSale, setRetSale] = useState<string>(""); const [retCustomer, setRetCustomer] = useState("");
  const [retReason, setRetReason] = useState(""); const [retNotes, setRetNotes] = useState("");
  const [retLines, setRetLines] = useState<LineRow[]>([newLine()]);
  const retTotal = retLines.reduce((s,l)=>s+l.qty*l.price,0);
  const resetRet = () => { setRetOpen(false); setRetSale(""); setRetCustomer(""); setRetReason(""); setRetNotes(""); setRetLines([newLine()]); };
  const saveReturn = async (approve: boolean) => {
    const lines = retLines.filter(l=>l.item_id && l.qty>0 && l.price>=0);
    if (!lines.length) return toast.error("أضف منتجًا واحدًا على الأقل");
    const { data: r, error } = await supabase.from("meat_factory_sales_returns" as any).insert({
      return_date: retDate, original_sale_id: retSale || null, customer: retCustomer, reason: retReason,
      total_amount: lines.reduce((s,l)=>s+l.qty*l.price,0), notes: retNotes, created_by: user?.id,
    }).select().single();
    if (error || !r) return toast.error(error?.message || "فشل");
    const lineRows = lines.map((l)=>{const it=(finItems as any[]).find(x=>x.id===l.item_id); return {
      return_id:(r as any).id, finished_item_id:l.item_id, finished_item_name:it?.name||"", quantity:l.qty, unit_price:l.price, line_total:l.qty*l.price,
    };});
    const { error: e2 } = await supabase.from("meat_factory_sales_return_lines" as any).insert(lineRows);
    if (e2) return toast.error(e2.message);
    if (approve) {
      const { error: e3 } = await supabase.rpc("approve_meat_sales_return" as any, { p_id: (r as any).id });
      if (e3) return toast.error(e3.message);
      toast.success("تم اعتماد المرتجع — رجع المنتج للجاهز وخصمت قيمته من الخزنة");
    } else { toast.success("تم الحفظ كمسودة"); }
    resetRet(); invalidateAll();
  };
  const approveReturn = async (id: string) => {
    const { error } = await supabase.rpc("approve_meat_sales_return" as any, { p_id: id });
    if (error) return toast.error(error.message);
    toast.success("تم الاعتماد"); invalidateAll();
  };
  const cancelReturn = async (id: string) => {
    if (!confirm("تأكيد إلغاء المرتجع المعتمد؟ سيتم عكس الحركات.")) return;
    const { error } = await supabase.rpc("cancel_meat_sales_return" as any, { p_id: id });
    if (error) return toast.error(error.message);
    toast.success("تم الإلغاء والعكس"); invalidateAll();
  };

  // ---------- STOCKTAKING ----------
  const [stkOpen, setStkOpen] = useState(false);
  const [stkKind, setStkKind] = useState<Kind>("raw"); const [stkNotes, setStkNotes] = useState("");
  const [stkActual, setStkActual] = useState<Record<string, number>>({});
  const openStocktake = (kind: Kind) => {
    setStkKind(kind); setStkNotes("");
    const items = kind === "raw" ? rawItems : finItems;
    const init: Record<string, number> = {}; (items as any[]).forEach((i) => { init[i.id] = Number(i.current_stock); });
    setStkActual(init); setStkOpen(true);
  };
  const saveStocktake = async (approve: boolean) => {
    const { data: st, error } = await supabase.from("meat_factory_stocktaking" as any).insert({
      item_kind: stkKind, notes: stkNotes, created_by: user?.id,
    }).select().single();
    if (error || !st) return toast.error(error?.message || "فشل");
    const items = stkKind === "raw" ? rawItems : finItems;
    const lines = (items as any[]).map((i) => {
      const sys = Number(i.current_stock); const act = Number(stkActual[i.id] ?? sys); const diff = act - sys;
      return { stocktake_id: (st as any).id, item_id: i.id, item_name: i.name, system_qty: sys, actual_qty: act, diff_qty: diff, diff_value: diff * Number(i.avg_cost), reason: "" };
    });
    const { error: e2 } = await supabase.from("meat_factory_stocktaking_lines" as any).insert(lines);
    if (e2) return toast.error(e2.message);
    if (approve) {
      const { error: e3 } = await supabase.rpc("apply_meat_stocktake" as any, { p_id: (st as any).id });
      if (e3) return toast.error(e3.message);
      toast.success("تم تطبيق الجرد والتسوية");
    } else { toast.success("تم حفظ المسودة"); }
    setStkOpen(false); invalidateAll();
  };
  const approveStk = async (id: string) => {
    const { error } = await supabase.rpc("apply_meat_stocktake" as any, { p_id: id });
    if (error) return toast.error(error.message);
    toast.success("تم التطبيق"); invalidateAll();
  };

  // ---------- REPORTS ----------
  const profitability = useMemo(() => {
    const m: Record<string, { name: string; qty: number; cost: number; sales: number }> = {};
    (sales as any[]).filter((s) => s.status === "approved").forEach((s) => {
      (s.meat_factory_sales_lines || []).forEach((l: any) => {
        const k = l.finished_item_id; if (!m[k]) m[k] = { name: l.finished_item_name, qty: 0, cost: 0, sales: 0 };
        m[k].qty += Number(l.quantity); m[k].cost += Number(l.quantity) * Number(l.unit_cost_snapshot || 0); m[k].sales += Number(l.line_total);
      });
    });
    return Object.values(m).map((r) => ({ ...r, profit: r.sales - r.cost, margin: r.sales > 0 ? ((r.sales - r.cost) / r.sales) * 100 : 0 }));
  }, [sales]);

  // ---------- RENDER ----------
  const statusBadge = (s: string) => {
    if (s === "approved") return <Badge className="bg-emerald-600">معتمد</Badge>;
    if (s === "cancelled") return <Badge variant="destructive">ملغي</Badge>;
    return <Badge variant="secondary">مسودة</Badge>;
  };

  const renderLineEditor = (lines: LineRow[], setLines: (l: LineRow[]) => void, items: any[], priceLabel = "سعر الوحدة") => (
    <div className="space-y-2">
      {lines.map((l, idx) => (
        <div key={l.id} className="grid grid-cols-12 gap-2 items-end">
          <div className="col-span-5">
            <Select value={l.item_id} onValueChange={(v) => { const x=[...lines]; x[idx]={...l,item_id:v}; setLines(x); }}>
              <SelectTrigger><SelectValue placeholder="اختر الصنف" /></SelectTrigger>
              <SelectContent>{items.map((i) => <SelectItem key={i.id} value={i.id}>{i.name} ({i.unit})</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="col-span-3"><Input type="number" step="0.01" placeholder="الكمية" value={l.qty||""} onChange={(e)=>{const x=[...lines];x[idx]={...l,qty:Number(e.target.value)};setLines(x);}} /></div>
          <div className="col-span-3"><Input type="number" step="0.01" placeholder={priceLabel} value={l.price||""} onChange={(e)=>{const x=[...lines];x[idx]={...l,price:Number(e.target.value)};setLines(x);}} /></div>
          <div className="col-span-1"><Button variant="ghost" size="icon" onClick={()=>setLines(lines.filter(x=>x.id!==l.id))}><Trash2 className="h-4 w-4 text-destructive" /></Button></div>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={()=>setLines([...lines, newLine()])}><Plus className="h-4 w-4 ml-1" />إضافة سطر</Button>
    </div>
  );

  return (
    <DashboardLayout>
      <div dir="rtl" className="p-4 md:p-6 space-y-4">
        <div className="flex items-center gap-3">
          <Beef className="h-8 w-8 text-red-600" />
          <div>
            <h1 className="text-2xl font-bold">مخازن مصنع اللحوم</h1>
            <p className="text-sm text-muted-foreground">الخامات، التصنيع، المنتجات الجاهزة، المبيعات، الخزنة، والجرد</p>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Package className="h-4 w-4" />قيمة الخامات</div><div className="text-xl font-bold">{fmt(stats.rawValue)} ج.م</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Factory className="h-4 w-4" />قيمة المنتجات الجاهزة</div><div className="text-xl font-bold">{fmt(stats.finValue)} ج.م</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Wallet className="h-4 w-4" />رصيد الخزنة</div><div className={`text-xl font-bold ${stats.balance<0?"text-red-600":"text-emerald-700"}`}>{fmt(stats.balance)} ج.م</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Banknote className="h-4 w-4" />مستحق لشركة نعام</div><div className="text-xl font-bold text-amber-700">{fmt(Math.max(0, stats.naamDue))} ج.م</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Warehouse className="h-4 w-4" />الأصناف</div><div className="text-xl font-bold">{stats.rawCount} خامة / {stats.finCount} جاهز</div></CardContent></Card>
        </div>

        <Tabs defaultValue="raw">
          <TabsList className="grid grid-cols-3 md:grid-cols-9 w-full">
            <TabsTrigger value="raw"><Package className="h-4 w-4 ml-1" />الخامات</TabsTrigger>
            <TabsTrigger value="purchases"><ShoppingCart className="h-4 w-4 ml-1" />المشتريات</TabsTrigger>
            <TabsTrigger value="mfg"><Factory className="h-4 w-4 ml-1" />التصنيع</TabsTrigger>
            <TabsTrigger value="finished"><Beef className="h-4 w-4 ml-1" />الجاهز</TabsTrigger>
            <TabsTrigger value="sales"><ShoppingCart className="h-4 w-4 ml-1" />المبيعات</TabsTrigger>
            <TabsTrigger value="treasury"><Wallet className="h-4 w-4 ml-1" />الخزنة</TabsTrigger>
            <TabsTrigger value="stocktake"><ClipboardCheck className="h-4 w-4 ml-1" />الجرد</TabsTrigger>
            <TabsTrigger value="returns" className="text-orange-600"><Undo2 className="h-4 w-4 ml-1" />مرتجع مبيعات</TabsTrigger>
            <TabsTrigger value="reports"><BarChart3 className="h-4 w-4 ml-1" />التقارير</TabsTrigger>
          </TabsList>

          {/* RAW */}
          <TabsContent value="raw" className="space-y-3 mt-3">
            <div className="flex justify-end gap-2">
              <Button onClick={()=>{setNewItemOpen("raw");}}><Plus className="h-4 w-4 ml-1" />صنف خامة</Button>
              <Button variant="outline" onClick={()=>printHtml("الخامات", `<div class="header"><div class="brand">عاصمة النعام</div><div>كشف خامات مصنع اللحوم</div></div><table><thead><tr><th>الصنف</th><th>الوحدة</th><th>الرصيد</th><th>متوسط التكلفة</th><th>القيمة</th></tr></thead><tbody>${(rawItems as any[]).map(i=>`<tr><td>${i.name}</td><td>${i.unit}</td><td>${fmt(i.current_stock)}</td><td>${fmt(i.avg_cost)}</td><td>${fmt(Number(i.current_stock)*Number(i.avg_cost))}</td></tr>`).join("")}</tbody></table>`)}><Printer className="h-4 w-4 ml-1" />طباعة</Button>
            </div>
            <Card><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>الصنف</TableHead><TableHead>الوحدة</TableHead><TableHead>الرصيد</TableHead><TableHead>متوسط التكلفة</TableHead><TableHead>القيمة</TableHead><TableHead>حد التنبيه</TableHead><TableHead>الحالة</TableHead></TableRow></TableHeader>
              <TableBody>{(rawItems as any[]).map((i) => (
                <TableRow key={i.id}><TableCell>{i.name}</TableCell><TableCell>{i.unit}</TableCell><TableCell>{fmt(i.current_stock)}</TableCell><TableCell>{fmt(i.avg_cost)}</TableCell><TableCell>{fmt(i.current_stock*i.avg_cost)}</TableCell><TableCell>{fmt(i.low_stock_threshold)}</TableCell>
                  <TableCell>{Number(i.current_stock) <= Number(i.low_stock_threshold) ? <Badge variant="destructive"><AlertTriangle className="h-3 w-3 ml-1" />منخفض</Badge> : <Badge variant="secondary">جيد</Badge>}</TableCell></TableRow>
              ))}{!rawItems.length && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">لا توجد أصناف</TableCell></TableRow>}</TableBody></Table></CardContent></Card>
          </TabsContent>

          {/* PURCHASES */}
          <TabsContent value="purchases" className="space-y-3 mt-3">
            <div className="flex justify-end"><Button onClick={()=>setPurOpen(true)}><Plus className="h-4 w-4 ml-1" />فاتورة شراء</Button></div>
            <Card><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>التاريخ</TableHead><TableHead>المورد</TableHead><TableHead>الإجمالي</TableHead><TableHead>الدفع</TableHead><TableHead>الحالة</TableHead><TableHead>إجراءات</TableHead></TableRow></TableHeader>
              <TableBody>{(purchases as any[]).map((p) => (
                <TableRow key={p.id}><TableCell>{p.purchase_date}</TableCell><TableCell>{p.supplier||"-"}</TableCell><TableCell>{fmt(p.total_amount)}</TableCell><TableCell>{p.payment_method==="cash"?"نقدي":"آجل"}</TableCell><TableCell>{statusBadge(p.status)}</TableCell>
                  <TableCell>{p.status==="draft" && <Button size="sm" onClick={()=>approvePurchase(p.id)}><CheckCircle2 className="h-4 w-4 ml-1" />اعتماد</Button>}</TableCell></TableRow>
              ))}{!purchases.length && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">لا توجد فواتير</TableCell></TableRow>}</TableBody></Table></CardContent></Card>
          </TabsContent>

          {/* MFG */}
          <TabsContent value="mfg" className="space-y-3 mt-3">
            <div className="flex justify-end"><Button onClick={()=>setMfgOpen(true)}><Plus className="h-4 w-4 ml-1" />فاتورة تصنيع</Button></div>
            <Card><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>الرقم</TableHead><TableHead>التاريخ</TableHead><TableHead>المنتج</TableHead><TableHead>الكمية</TableHead><TableHead>التكلفة الكلية</TableHead><TableHead>تكلفة الوحدة</TableHead><TableHead>الحالة</TableHead><TableHead>إجراءات</TableHead></TableRow></TableHeader>
              <TableBody>{(mfgs as any[]).map((m) => (
                <TableRow key={m.id}><TableCell className="font-mono text-xs">{m.invoice_number}</TableCell><TableCell>{m.mfg_date}</TableCell><TableCell>{m.finished_item_name}</TableCell><TableCell>{fmt(m.produced_qty)}</TableCell><TableCell>{fmt(m.total_cost)}</TableCell><TableCell>{fmt(m.unit_cost)}</TableCell><TableCell>{statusBadge(m.status)}</TableCell>
                  <TableCell>{m.status==="draft" && <Button size="sm" onClick={()=>approveMfg(m.id)}><CheckCircle2 className="h-4 w-4 ml-1" />اعتماد</Button>}</TableCell></TableRow>
              ))}{!mfgs.length && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">لا توجد فواتير تصنيع</TableCell></TableRow>}</TableBody></Table></CardContent></Card>
          </TabsContent>

          {/* FINISHED */}
          <TabsContent value="finished" className="space-y-3 mt-3">
            <div className="flex justify-end gap-2">
              <Button onClick={()=>{setNewItemOpen("finished");}}><Plus className="h-4 w-4 ml-1" />منتج جاهز</Button>
              <Button variant="outline" onClick={()=>printHtml("المنتجات الجاهزة", `<div class="header"><div class="brand">عاصمة النعام</div><div>كشف منتجات مصنع اللحوم الجاهزة</div></div><table><thead><tr><th>الصنف</th><th>الوحدة</th><th>الرصيد</th><th>متوسط التكلفة</th><th>سعر البيع</th><th>القيمة</th></tr></thead><tbody>${(finItems as any[]).map(i=>`<tr><td>${i.name}</td><td>${i.unit}</td><td>${fmt(i.current_stock)}</td><td>${fmt(i.avg_cost)}</td><td>${fmt(i.sale_price)}</td><td>${fmt(Number(i.current_stock)*Number(i.avg_cost))}</td></tr>`).join("")}</tbody></table>`)}><Printer className="h-4 w-4 ml-1" />طباعة</Button>
            </div>
            <Card><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>المنتج</TableHead><TableHead>الوحدة</TableHead><TableHead>الرصيد</TableHead><TableHead>متوسط التكلفة</TableHead><TableHead>سعر البيع</TableHead><TableHead>القيمة</TableHead><TableHead>الحالة</TableHead></TableRow></TableHeader>
              <TableBody>{(finItems as any[]).map((i) => (
                <TableRow key={i.id}><TableCell>{i.name}</TableCell><TableCell>{i.unit}</TableCell><TableCell>{fmt(i.current_stock)}</TableCell><TableCell>{fmt(i.avg_cost)}</TableCell><TableCell>{fmt(i.sale_price)}</TableCell><TableCell>{fmt(i.current_stock*i.avg_cost)}</TableCell>
                  <TableCell>{Number(i.current_stock) <= Number(i.low_stock_threshold) ? <Badge variant="destructive">منخفض</Badge> : <Badge variant="secondary">جيد</Badge>}</TableCell></TableRow>
              ))}{!finItems.length && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">لا توجد منتجات</TableCell></TableRow>}</TableBody></Table></CardContent></Card>
          </TabsContent>

          {/* SALES */}
          <TabsContent value="sales" className="space-y-3 mt-3">
            <div className="flex justify-end"><Button onClick={()=>setSalOpen(true)}><Plus className="h-4 w-4 ml-1" />فاتورة بيع</Button></div>
            <Card><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>الرقم</TableHead><TableHead>التاريخ</TableHead><TableHead>العميل</TableHead><TableHead>الإجمالي</TableHead><TableHead>الدفع</TableHead><TableHead>الحالة</TableHead><TableHead>إجراءات</TableHead></TableRow></TableHeader>
              <TableBody>{(sales as any[]).map((s) => (
                <TableRow key={s.id}><TableCell className="font-mono text-xs">{s.invoice_number}</TableCell><TableCell>{s.sale_date}</TableCell><TableCell>{s.customer||"-"}</TableCell><TableCell>{fmt(s.total_amount)}</TableCell><TableCell>{s.payment_method==="cash"?"نقدي":"آجل"}</TableCell><TableCell>{statusBadge(s.status)}</TableCell>
                  <TableCell>{s.status==="draft" && <Button size="sm" onClick={()=>approveSale(s.id)}><CheckCircle2 className="h-4 w-4 ml-1" />اعتماد</Button>}</TableCell></TableRow>
              ))}{!sales.length && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">لا توجد فواتير</TableCell></TableRow>}</TableBody></Table></CardContent></Card>
          </TabsContent>

          {/* TREASURY */}
          <TabsContent value="treasury" className="space-y-3 mt-3">
            <Card><CardHeader><CardTitle>رصيد الخزنة: <span className={stats.balance<0?"text-red-600":"text-emerald-700"}>{fmt(stats.balance)} ج.م</span></CardTitle></CardHeader></Card>
            <Card><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>التاريخ</TableHead><TableHead>الاتجاه</TableHead><TableHead>المبلغ</TableHead><TableHead>السبب</TableHead><TableHead>المصدر</TableHead></TableRow></TableHeader>
              <TableBody>{(txns as any[]).map((t) => (
                <TableRow key={t.id}><TableCell>{t.txn_date}</TableCell><TableCell>{t.direction==="IN"?<Badge className="bg-emerald-600">داخل</Badge>:<Badge variant="destructive">خارج</Badge>}</TableCell><TableCell className={t.direction==="IN"?"text-emerald-700 font-bold":"text-red-600 font-bold"}>{fmt(t.amount)}</TableCell><TableCell>{t.reason}</TableCell><TableCell className="text-xs text-muted-foreground">{t.ref_table||"-"}</TableCell></TableRow>
              ))}{!txns.length && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">لا توجد حركات</TableCell></TableRow>}</TableBody></Table></CardContent></Card>
          </TabsContent>

          {/* STOCKTAKE */}
          <TabsContent value="stocktake" className="space-y-3 mt-3">
            <div className="flex justify-end gap-2">
              <Button onClick={()=>openStocktake("raw")}><ClipboardCheck className="h-4 w-4 ml-1" />جرد خامات</Button>
              <Button onClick={()=>openStocktake("finished")} variant="secondary"><ClipboardCheck className="h-4 w-4 ml-1" />جرد جاهز</Button>
            </div>
            <Card><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>التاريخ</TableHead><TableHead>النوع</TableHead><TableHead>عدد الأصناف</TableHead><TableHead>قيمة الفروقات</TableHead><TableHead>الحالة</TableHead><TableHead>إجراءات</TableHead></TableRow></TableHeader>
              <TableBody>{(stocks as any[]).map((s) => { const ln=s.meat_factory_stocktaking_lines||[]; const dv=ln.reduce((sm:number,l:any)=>sm+Number(l.diff_value||0),0); return (
                <TableRow key={s.id}><TableCell>{s.taken_date}</TableCell><TableCell>{s.item_kind==="raw"?"خامات":"جاهز"}</TableCell><TableCell>{ln.length}</TableCell><TableCell className={dv<0?"text-red-600":"text-emerald-700"}>{fmt(dv)}</TableCell><TableCell>{statusBadge(s.status)}</TableCell>
                  <TableCell>{s.status==="draft" && <Button size="sm" onClick={()=>approveStk(s.id)}><CheckCircle2 className="h-4 w-4 ml-1" />تطبيق</Button>}</TableCell></TableRow>
              );})}{!stocks.length && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">لا توجد عمليات جرد</TableCell></TableRow>}</TableBody></Table></CardContent></Card>
          </TabsContent>

          {/* RETURNS */}
          <TabsContent value="returns" className="space-y-3 mt-3">
            <Card className="border-orange-300 bg-orange-50/40"><CardHeader><CardTitle className="text-orange-700 flex items-center gap-2"><Undo2 className="h-5 w-5" />مرتجع مبيعات منتجات مصنع اللحوم</CardTitle><CardDescription>اعتماد المرتجع يزيد مخزون الجاهز ويخصم القيمة من الخزنة فوريًا. لا يمكن تكرار التأثير. الإلغاء للمدير العام/التنفيذي فقط.</CardDescription></CardHeader></Card>
            <div className="flex justify-end"><Button onClick={()=>setRetOpen(true)} className="bg-orange-600 hover:bg-orange-700"><Plus className="h-4 w-4 ml-1" />مرتجع جديد</Button></div>
            <Card><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>الرقم</TableHead><TableHead>التاريخ</TableHead><TableHead>العميل</TableHead><TableHead>الإجمالي</TableHead><TableHead>السبب</TableHead><TableHead>الحالة</TableHead><TableHead>إجراءات</TableHead></TableRow></TableHeader>
              <TableBody>{(returns as any[]).map((r) => (
                <TableRow key={r.id}><TableCell className="font-mono text-xs">{r.return_number}</TableCell><TableCell>{r.return_date}</TableCell><TableCell>{r.customer||"-"}</TableCell><TableCell>{fmt(r.total_amount)}</TableCell><TableCell className="text-xs">{r.reason||"-"}</TableCell><TableCell>{statusBadge(r.status)}</TableCell>
                  <TableCell className="space-x-1 space-x-reverse">{r.status==="draft" && <Button size="sm" onClick={()=>approveReturn(r.id)}><CheckCircle2 className="h-4 w-4 ml-1" />اعتماد</Button>}
                    {r.status==="approved" && isManager && <Button size="sm" variant="destructive" onClick={()=>cancelReturn(r.id)}><XCircle className="h-4 w-4 ml-1" />إلغاء</Button>}</TableCell></TableRow>
              ))}{!returns.length && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">لا توجد مرتجعات</TableCell></TableRow>}</TableBody></Table></CardContent></Card>
          </TabsContent>

          {/* REPORTS */}
          <TabsContent value="reports" className="space-y-3 mt-3">
            <Card><CardHeader><CardTitle>تقرير ربحية المنتجات</CardTitle><CardDescription>محسوب من المبيعات المعتمدة فقط</CardDescription></CardHeader>
              <CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>المنتج</TableHead><TableHead>الكمية المباعة</TableHead><TableHead>إجمالي التكلفة</TableHead><TableHead>إجمالي المبيعات</TableHead><TableHead>صافي الربح</TableHead><TableHead>نسبة الربح</TableHead></TableRow></TableHeader>
                <TableBody>{profitability.map((r,i) => (
                  <TableRow key={i}><TableCell>{r.name}</TableCell><TableCell>{fmt(r.qty)}</TableCell><TableCell>{fmt(r.cost)}</TableCell><TableCell>{fmt(r.sales)}</TableCell><TableCell className={r.profit<0?"text-red-600":"text-emerald-700"}>{fmt(r.profit)}</TableCell><TableCell>{r.margin.toFixed(1)}%</TableCell></TableRow>
                ))}{!profitability.length && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">لا توجد بيانات</TableCell></TableRow>}</TableBody></Table></CardContent></Card>

            <Card><CardHeader><CardTitle>آخر حركات المخزون</CardTitle></CardHeader>
              <CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>التاريخ</TableHead><TableHead>النوع</TableHead><TableHead>الصنف</TableHead><TableHead>الاتجاه</TableHead><TableHead>الكمية</TableHead><TableHead>السبب</TableHead></TableRow></TableHeader>
                <TableBody>{(moves as any[]).slice(0,50).map((m) => (
                  <TableRow key={m.id}><TableCell className="text-xs">{new Date(m.created_at).toLocaleString("ar-EG")}</TableCell><TableCell>{m.item_kind==="raw"?"خامة":"جاهز"}</TableCell><TableCell>{m.item_name}</TableCell><TableCell>{m.direction==="IN"?<Badge className="bg-emerald-600">داخل</Badge>:<Badge variant="destructive">خارج</Badge>}</TableCell><TableCell>{fmt(m.quantity)}</TableCell><TableCell className="text-xs">{m.reason}</TableCell></TableRow>
                ))}</TableBody></Table></CardContent></Card>
          </TabsContent>
        </Tabs>

        {/* ============= DIALOGS ============= */}
        {/* New Item */}
        <Dialog open={!!newItemOpen} onOpenChange={(o)=>!o && setNewItemOpen(null)}>
          <DialogContent dir="rtl"><DialogHeader><DialogTitle>{newItemOpen==="raw"?"إضافة صنف خامة":"إضافة منتج جاهز"}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>الاسم</Label><Input value={itemName} onChange={(e)=>setItemName(e.target.value)} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>الوحدة</Label><Input value={itemUnit} onChange={(e)=>setItemUnit(e.target.value)} /></div>
                <div><Label>حد التنبيه</Label><Input type="number" value={itemAlert||""} onChange={(e)=>setItemAlert(Number(e.target.value))} /></div>
              </div>
              {newItemOpen==="finished" && <div><Label>سعر البيع</Label><Input type="number" value={itemPrice||""} onChange={(e)=>setItemPrice(Number(e.target.value))} /></div>}
            </div>
            <DialogFooter><Button variant="outline" onClick={()=>setNewItemOpen(null)}>إلغاء</Button><Button onClick={saveItem}>حفظ</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Purchase */}
        <Dialog open={purOpen} onOpenChange={setPurOpen}>
          <DialogContent dir="rtl" className="max-w-3xl"><DialogHeader><DialogTitle>فاتورة شراء خامات</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <div><Label>التاريخ</Label><Input type="date" value={purDate} onChange={(e)=>setPurDate(e.target.value)} /></div>
                <div><Label>المورد</Label><Input value={purSupplier} onChange={(e)=>setPurSupplier(e.target.value)} /></div>
                <div><Label>طريقة الدفع</Label><Select value={purPay} onValueChange={(v)=>setPurPay(v as any)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cash">نقدي</SelectItem><SelectItem value="credit">آجل</SelectItem></SelectContent></Select></div>
              </div>
              {renderLineEditor(purLines, setPurLines, rawItems as any[])}
              <div><Label>ملاحظات</Label><Textarea value={purNotes} onChange={(e)=>setPurNotes(e.target.value)} /></div>
              <div className="text-left font-bold">الإجمالي: {fmt(purTotal)} ج.م</div>
            </div>
            <DialogFooter><Button variant="outline" onClick={resetPur}>إلغاء</Button><Button variant="secondary" onClick={()=>savePurchase(false)}>حفظ كمسودة</Button><Button onClick={()=>savePurchase(true)}>حفظ واعتماد</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Manufacturing */}
        <Dialog open={mfgOpen} onOpenChange={setMfgOpen}>
          <DialogContent dir="rtl" className="max-w-3xl"><DialogHeader><DialogTitle>فاتورة تصنيع</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <div><Label>التاريخ</Label><Input type="date" value={mfgDate} onChange={(e)=>setMfgDate(e.target.value)} /></div>
                <div><Label>المنتج النهائي</Label><Select value={mfgItem} onValueChange={setMfgItem}><SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger><SelectContent>{(finItems as any[]).map(i=><SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}</SelectContent></Select></div>
                <div><Label>الكمية المنتجة</Label><Input type="number" value={mfgQty||""} onChange={(e)=>setMfgQty(Number(e.target.value))} /></div>
              </div>
              <Label>الخامات الغذائية المستخدمة — من مخزن خامات مصنع اللحوم (التكلفة من متوسط تكلفة الخامة)</Label>
              {renderLineEditor(mfgLines, setMfgLines, rawItems as any[], "تكلفة (تلقائي)")}
              <Label className="text-orange-700">مواد التغليف والتعبئة المستخدمة — من مخزن التغليف والتعبئة (اختياري)</Label>
              {renderLineEditor(
                mfgPkgLines, setMfgPkgLines,
                (pkgItems as any[]).map((p:any)=>({ id:p.id, name:`${p.name_ar} (متاح: ${fmt(p.stock)})`, unit:p.unit })),
                "تكلفة (تلقائي)"
              )}
              <div><Label>ملاحظات</Label><Textarea value={mfgNotes} onChange={(e)=>setMfgNotes(e.target.value)} /></div>
            </div>
            <DialogFooter><Button variant="outline" onClick={resetMfg}>إلغاء</Button><Button variant="secondary" onClick={()=>saveMfg(false)}>حفظ كمسودة</Button><Button onClick={()=>saveMfg(true)}>حفظ واعتماد</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Sale */}
        <Dialog open={salOpen} onOpenChange={setSalOpen}>
          <DialogContent dir="rtl" className="max-w-3xl"><DialogHeader><DialogTitle>فاتورة بيع</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <div><Label>التاريخ</Label><Input type="date" value={salDate} onChange={(e)=>setSalDate(e.target.value)} /></div>
                <div><Label>العميل</Label><Input value={salCustomer} onChange={(e)=>setSalCustomer(e.target.value)} /></div>
                <div><Label>طريقة الدفع</Label><Select value={salPay} onValueChange={(v)=>setSalPay(v as any)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cash">نقدي</SelectItem><SelectItem value="credit">آجل</SelectItem></SelectContent></Select></div>
              </div>
              {renderLineEditor(salLines, setSalLines, finItems as any[])}
              <div><Label>ملاحظات</Label><Textarea value={salNotes} onChange={(e)=>setSalNotes(e.target.value)} /></div>
              <div className="text-left font-bold">الإجمالي: {fmt(salTotal)} ج.م</div>
            </div>
            <DialogFooter><Button variant="outline" onClick={resetSal}>إلغاء</Button><Button variant="secondary" onClick={()=>saveSale(false)}>حفظ كمسودة</Button><Button onClick={()=>saveSale(true)}>حفظ واعتماد</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Return */}
        <Dialog open={retOpen} onOpenChange={setRetOpen}>
          <DialogContent dir="rtl" className="max-w-3xl"><DialogHeader><DialogTitle className="text-orange-700">مرتجع مبيعات</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <div><Label>التاريخ</Label><Input type="date" value={retDate} onChange={(e)=>setRetDate(e.target.value)} /></div>
                <div><Label>العميل</Label><Input value={retCustomer} onChange={(e)=>setRetCustomer(e.target.value)} /></div>
                <div><Label>فاتورة البيع (اختياري)</Label><Select value={retSale} onValueChange={setRetSale}><SelectTrigger><SelectValue placeholder="—" /></SelectTrigger><SelectContent>{(sales as any[]).filter(s=>s.status==="approved").slice(0,50).map(s=><SelectItem key={s.id} value={s.id}>{s.invoice_number} — {s.customer||"-"}</SelectItem>)}</SelectContent></Select></div>
              </div>
              {renderLineEditor(retLines, setRetLines, finItems as any[])}
              <div><Label>سبب المرتجع</Label><Input value={retReason} onChange={(e)=>setRetReason(e.target.value)} /></div>
              <div><Label>ملاحظات</Label><Textarea value={retNotes} onChange={(e)=>setRetNotes(e.target.value)} /></div>
              <div className="text-left font-bold text-orange-700">إجمالي المرتجع: {fmt(retTotal)} ج.م</div>
            </div>
            <DialogFooter><Button variant="outline" onClick={resetRet}>إلغاء</Button><Button variant="secondary" onClick={()=>saveReturn(false)}>حفظ كمسودة</Button><Button className="bg-orange-600 hover:bg-orange-700" onClick={()=>saveReturn(true)}>حفظ واعتماد</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Stocktake */}
        <Dialog open={stkOpen} onOpenChange={setStkOpen}>
          <DialogContent dir="rtl" className="max-w-4xl max-h-[80vh] overflow-y-auto"><DialogHeader><DialogTitle>جرد {stkKind==="raw"?"الخامات":"المنتجات الجاهزة"}</DialogTitle></DialogHeader>
            <div className="space-y-2">
              <Table><TableHeader><TableRow><TableHead>الصنف</TableHead><TableHead>رصيد السيستم</TableHead><TableHead>الرصيد الفعلي</TableHead><TableHead>الفرق</TableHead><TableHead>قيمة الفرق</TableHead></TableRow></TableHeader>
                <TableBody>{((stkKind==="raw"?rawItems:finItems) as any[]).map((i) => { const act=stkActual[i.id]??Number(i.current_stock); const diff=act-Number(i.current_stock); return (
                  <TableRow key={i.id}><TableCell>{i.name}</TableCell><TableCell>{fmt(i.current_stock)}</TableCell>
                    <TableCell><Input type="number" step="0.01" value={stkActual[i.id]??""} onChange={(e)=>setStkActual({...stkActual,[i.id]:Number(e.target.value)})} className="w-24" /></TableCell>
                    <TableCell className={diff<0?"text-red-600":diff>0?"text-emerald-700":""}>{fmt(diff)}</TableCell><TableCell>{fmt(diff*Number(i.avg_cost))}</TableCell></TableRow>
                );})}</TableBody></Table>
              <div><Label>ملاحظات</Label><Textarea value={stkNotes} onChange={(e)=>setStkNotes(e.target.value)} /></div>
            </div>
            <DialogFooter><Button variant="outline" onClick={()=>setStkOpen(false)}>إلغاء</Button><Button variant="secondary" onClick={()=>saveStocktake(false)}>حفظ كمسودة</Button><Button onClick={()=>saveStocktake(true)}>حفظ وتطبيق</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
