import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Wallet, ArrowDownLeft, ArrowUpRight, Plus, Send, Printer, FileSpreadsheet,
  CheckCircle2, XCircle, Clock, RefreshCw, Search, ClipboardCheck, AlertTriangle, Package, Truck
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { openPrintWindow, escapeHtml, fmtNum, COMPANY_AR } from "@/lib/printPdf";
import { isMainWarehouseName } from "@/constants/warehouseCategoryFilters";
import { getAllowedWarehouseDropdownItems, getWarehouseItemDebugRow, getWarehouseItemRejectionReason, getWarehouseMissingItemDebugRow } from "@/lib/warehouseItemFilters";
import AddMainWarehouseItemDialog from "@/components/warehouses/AddMainWarehouseItemDialog";
import * as XLSX from "xlsx";

interface Txn {
  id: string;
  performed_at: string;
  direction: "in" | "out";
  category: string;
  amount: number;
  reference: string | null;
  notes: string | null;
  performed_by: string | null;
  performed_by_name?: string;
  status: "posted" | "pending_approval" | "rejected";
  transfer_id: string | null;
  courier_name?: string | null;
  rejection_reason?: string | null;
}

interface WarehouseStockItem {
  id: string;
  warehouse_id: string | null;
  product_id?: string | null;
  name?: string | null;
  category?: string | null;
  unit?: string | null;
  stock?: number | null;
  is_active?: boolean | null;
  archived?: boolean | null;
  archived_at?: string | null;
  module?: string | null;
  item_type?: string | null;
  source_module?: string | null;
  unit_cost?: number | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  direct_sale_cash: "تحصيل بيع مباشر",
  courier_deposit: "توريد نقدية من مندوب",
  transfer_to_main_treasury: "تحويل للخزينة الرئيسية (قديم)",
  transfer_from_main_warehouse_treasury: "تحويل من خزينة المخزن للخزينة الرئيسية",
  manual_adjust: "تسوية يدوية",
  opening_balance: "رصيد افتتاحي",
  other: "أخرى",
};

const TRANSFER_OUT_CATEGORIES = new Set(["transfer_to_main_treasury", "transfer_from_main_warehouse_treasury"]);



const STATUS_LABELS: Record<string, { txt: string; cls: string; Icon: typeof CheckCircle2 }> = {
  posted: { txt: "مرحّل", cls: "bg-emerald-100 text-emerald-700", Icon: CheckCircle2 },
  pending_approval: { txt: "بانتظار اعتماد", cls: "bg-amber-100 text-amber-700", Icon: Clock },
  rejected: { txt: "مرفوض", cls: "bg-rose-100 text-rose-700", Icon: XCircle },
};

const fmt = (n: number) => new Intl.NumberFormat("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const fmtDate = (iso: string) => new Date(iso).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" });

export default function MainWarehouseTreasuryTab() {
  const { user, roles, isGeneralManager, isExecutiveManager, isWarehouseSupervisor } = useAuth();
  const { toast } = useToast();
  const isFinancialManager = (roles || []).includes("financial_manager");
  const isMainTreasuryApprover = ((roles || []) as string[]).includes("main_treasury_approver");

  // عبدالمنعم عثمان = warehouse_supervisor للمخزن الرئيسي → يستطيع التسجيل والتحويل.
  const canRecord = isGeneralManager || isExecutiveManager || isFinancialManager || isWarehouseSupervisor;
  // محمد شعلة = financial_manager → يعتمد التحويلات للخزينة الرئيسية.
  const canApprove = isGeneralManager || isFinancialManager || isMainTreasuryApprover;

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Txn[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "posted" | "pending_approval" | "rejected">("all");

  // Dialogs
  const [collectOpen, setCollectOpen] = useState(false);
  const [collectAmt, setCollectAmt] = useState("");
  const [collectRef, setCollectRef] = useState("");
  const [collectNotes, setCollectNotes] = useState("");

  const [courierOpen, setCourierOpen] = useState(false);
  const [courierName, setCourierName] = useState("");
  const [courierAmt, setCourierAmt] = useState("");
  const [courierDate, setCourierDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [courierNotes, setCourierNotes] = useState("");

  const [transferOpen, setTransferOpen] = useState(false);
  const [transferAmt, setTransferAmt] = useState("");
  const [transferNotes, setTransferNotes] = useState("");

  const [busy, setBusy] = useState(false);

  // === Reconciliation (cash count) ===
  const HIGH_BALANCE_THRESHOLD = 20000;
  const [recons, setRecons] = useState<any[]>([]);
  const [reconOpen, setReconOpen] = useState(false);
  const [reconPhysical, setReconPhysical] = useState("");
  const [reconReason, setReconReason] = useState("");
  const [reconNotes, setReconNotes] = useState("");

  // === Courier goods custody ===
  const [custodies, setCustodies] = useState<any[]>([]);
  const [custodyLines, setCustodyLines] = useState<any[]>([]);
  const [newCustodyOpen, setNewCustodyOpen] = useState(false);
  const [newCustodyName, setNewCustodyName] = useState("");
  const [newCustodyNotes, setNewCustodyNotes] = useState("");
  const [lineOpen, setLineOpen] = useState(false);
  const [lineCustodyId, setLineCustodyId] = useState<string | null>(null);
  const [lineType, setLineType] = useState<"issue" | "return" | "sale" | "cash_collect" | "bonus">("issue");
  const [lineInventoryItemId, setLineInventoryItemId] = useState("");
  const [lineProduct, setLineProduct] = useState("");
  const [lineQty, setLineQty] = useState("");
  const [lineUnit, setLineUnit] = useState("كجم");
  const [linePrice, setLinePrice] = useState(""); // original/list price (or cost for bonus)
  const [lineSalePrice, setLineSalePrice] = useState(""); // sale: actual price
  const [lineDiscountReason, setLineDiscountReason] = useState("");
  const [lineCash, setLineCash] = useState("");
  const [lineNotes, setLineNotes] = useState("");
  const [lineCustomerName, setLineCustomerName] = useState("");
  const [lineCustomerPhone, setLineCustomerPhone] = useState("");
  const [lineBonusReason, setLineBonusReason] = useState("");
  const [discountThresholdPct, setDiscountThresholdPct] = useState<number>(5);
  const [requestCreditOverride, setRequestCreditOverride] = useState(false);
  const [addProductOpen, setAddProductOpen] = useState(false);

  // === Profiles / payouts / closures (new) ===
  const [profiles, setProfiles] = useState<any[]>([]);
  const [payouts, setPayouts] = useState<any[]>([]);
  const [closures, setClosures] = useState<any[]>([]);

  // Profile dialog
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileCourier, setProfileCourier] = useState("");
  const [profileLimit, setProfileLimit] = useState("");
  const [profileCommType, setProfileCommType] = useState<"none" | "percent_of_sales" | "per_kg" | "per_item">("none");
  const [profileCommValue, setProfileCommValue] = useState("");
  const [profileNotes, setProfileNotes] = useState("");

  // Statement dialog
  const [stmtOpen, setStmtOpen] = useState(false);
  const [stmtCustody, setStmtCustody] = useState<any | null>(null);
  const [stmtFrom, setStmtFrom] = useState<string>("");
  const [stmtTo, setStmtTo] = useState<string>(new Date().toISOString().slice(0, 10));

  // Commission payout dialog
  const [payCommOpen, setPayCommOpen] = useState(false);
  const [payCommCourier, setPayCommCourier] = useState("");
  const [payCommAmt, setPayCommAmt] = useState("");
  const [payCommNotes, setPayCommNotes] = useState("");

  const [mainWarehouse, setMainWarehouse] = useState<{ id: string; name: string } | null>(null);
  const [mainWarehouseItems, setMainWarehouseItems] = useState<WarehouseStockItem[]>([]);








  const fetchAll = async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from("main_warehouse_treasury_txns")
        .select("*")
        .order("performed_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      const txns: Txn[] = (data || []) as Txn[];

      // resolve performer names
      const ids = Array.from(new Set(txns.map(t => t.performed_by).filter(Boolean))) as string[];
      const nameMap = new Map<string, string>();
      if (ids.length) {
        const { data: profs } = await (supabase as any)
          .from("profile_directory")
          .select("id, full_name")
          .in("id", ids);
        (profs || []).forEach((p: any) => nameMap.set(p.id, p.full_name));
      }
      txns.forEach((t) => { if (t.performed_by) t.performed_by_name = nameMap.get(t.performed_by); });
      setRows(txns);
    } catch (e: any) {
      toast({ title: "تعذّر تحميل الحركات", description: e?.message || "", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll(); fetchRecons(); fetchCustodies(); fetchCourierExtras(); fetchMainWarehouseItems();
    (async () => {
      const { data } = await (supabase as any).from("courier_custody_settings").select("auto_approve_discount_pct").eq("id", 1).maybeSingle();
      if (data?.auto_approve_discount_pct != null) setDiscountThresholdPct(Number(data.auto_approve_discount_pct));
    })();
    /* eslint-disable-next-line */
  }, []);

  const fetchRecons = async () => {
    const { data } = await (supabase as any)
      .from("main_warehouse_reconciliations")
      .select("*")
      .order("performed_at", { ascending: false })
      .limit(100);
    setRecons(data || []);
  };

  const fetchMainWarehouseItems = async () => {
    const { data: whs } = await (supabase as any).from("warehouses").select("id,name").order("name");
    const wh = ((whs || []) as Array<{ id: string; name: string }>).find((w) => isMainWarehouseName(w.name));
    setMainWarehouse(wh || null);
    if (!wh) { setMainWarehouseItems([]); return; }
    const { data } = await (supabase as any)
      .from("inventory_items")
      .select("id, warehouse_id, product_id, name, category, unit, stock, is_active, archived, archived_at, module, item_type, source_module, unit_cost")
      .eq("warehouse_id", wh.id)
      .order("name");
    setMainWarehouseItems((data || []) as WarehouseStockItem[]);
  };

  const allowedMainWarehouseItems = useMemo(
    () => getAllowedWarehouseDropdownItems(mainWarehouseItems, mainWarehouse?.id, true),
    [mainWarehouseItems, mainWarehouse?.id]
  );

  useEffect(() => {
    if (!import.meta.env.DEV || !lineOpen || lineType !== "issue") return;
    console.table(allowedMainWarehouseItems.map((item) => getWarehouseItemDebugRow(item, mainWarehouse?.id, mainWarehouse?.name)));
  }, [lineOpen, lineType, allowedMainWarehouseItems, mainWarehouse?.id, mainWarehouse?.name]);

  const fetchCustodies = async () => {
    const { data: c } = await (supabase as any)
      .from("courier_goods_custodies")
      .select("*")
      .order("opened_at", { ascending: false })
      .limit(50);
    setCustodies(c || []);
    const ids = (c || []).map((x: any) => x.id);
    if (ids.length) {
      const { data: lns } = await (supabase as any)
        .from("courier_goods_custody_lines")
        .select("*")
        .in("custody_id", ids)
        .order("performed_at", { ascending: false });
      setCustodyLines(lns || []);
      const { data: cls } = await (supabase as any)
        .from("courier_daily_closures")
        .select("*")
        .in("custody_id", ids)
        .order("closure_date", { ascending: false });
      setClosures(cls || []);
    } else {
      setCustodyLines([]);
      setClosures([]);
    }
  };

  const fetchCourierExtras = async () => {
    const { data: profs } = await (supabase as any).from("courier_profiles").select("*").order("courier_name");
    setProfiles(profs || []);
    const { data: pays } = await (supabase as any).from("courier_commission_payouts").select("*").order("paid_at", { ascending: false }).limit(500);
    setPayouts(pays || []);
  };



  const kpis = useMemo(() => {
    let balance = 0, todayIn = 0, todayOut = 0, pending = 0, transferred = 0;
    const todayStr = new Date().toDateString();
    rows.forEach((t) => {
      const amt = Number(t.amount || 0);
      const isPosted = t.status === "posted";
      const isPending = t.status === "pending_approval";
      if (isPosted) {
        balance += t.direction === "in" ? amt : -amt;
        if (new Date(t.performed_at).toDateString() === todayStr) {
          if (t.direction === "in") todayIn += amt;
          else todayOut += amt;
        }
        if (TRANSFER_OUT_CATEGORIES.has(t.category)) transferred += amt;
      }
      if (isPending && TRANSFER_OUT_CATEGORIES.has(t.category)) pending += amt;
    });
    return { balance, todayIn, todayOut, pending, transferred };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (!q) return true;
      return (
        r.reference?.includes(q) ||
        r.notes?.includes(q) ||
        r.performed_by_name?.includes(q) ||
        CATEGORY_LABELS[r.category]?.includes(q)
      );
    });
  }, [rows, search, statusFilter]);

  // === Actions ===
  const submitCollect = async () => {
    const amt = Number(collectAmt);
    if (!amt || amt <= 0) {
      toast({ title: "أدخل مبلغًا صحيحًا", variant: "destructive" }); return;
    }
    setBusy(true);
    try {
      const { error } = await (supabase as any).from("main_warehouse_treasury_txns").insert({
        direction: "in",
        category: "direct_sale_cash",
        amount: amt,
        reference: collectRef.trim() || null,
        notes: collectNotes.trim() || null,
        performed_by: user?.id,
        status: "posted",
      });
      if (error) throw error;
      toast({ title: "تم تسجيل التحصيل", description: `+ ${fmt(amt)} ج.م` });
      setCollectOpen(false); setCollectAmt(""); setCollectRef(""); setCollectNotes("");
      await fetchAll();
    } catch (e: any) {
      toast({ title: "تعذّر التسجيل", description: e?.message || "", variant: "destructive" });
    } finally { setBusy(false); }
  };

  const submitCourier = async () => {
    const amt = Number(courierAmt);
    if (!courierName.trim()) { toast({ title: "أدخل اسم المندوب", variant: "destructive" }); return; }
    if (!amt || amt <= 0) { toast({ title: "أدخل مبلغًا صحيحًا", variant: "destructive" }); return; }
    setBusy(true);
    try {
      const performedAt = courierDate ? new Date(`${courierDate}T12:00:00`).toISOString() : new Date().toISOString();
      const { error } = await (supabase as any).from("main_warehouse_treasury_txns").insert({
        direction: "in",
        category: "courier_deposit",
        amount: amt,
        courier_name: courierName.trim(),
        notes: courierNotes.trim() || null,
        performed_at: performedAt,
        performed_by: user?.id,
        status: "posted",
      });
      if (error) throw error;
      toast({ title: "تم تسجيل التوريد", description: `+ ${fmt(amt)} ج.م من ${courierName.trim()}` });
      setCourierOpen(false); setCourierName(""); setCourierAmt(""); setCourierNotes("");
      setCourierDate(new Date().toISOString().slice(0, 10));
      await fetchAll();
    } catch (e: any) {
      toast({ title: "تعذّر التسجيل", description: e?.message || "", variant: "destructive" });
    } finally { setBusy(false); }
  };

  const submitTransfer = async () => {
    const amt = Number(transferAmt);
    if (!amt || amt <= 0) {
      toast({ title: "أدخل مبلغًا صحيحًا", variant: "destructive" }); return;
    }
    if (amt > kpis.balance) {
      if (!window.confirm(`المبلغ (${fmt(amt)}) أكبر من الرصيد الحالي (${fmt(kpis.balance)}). متابعة؟`)) return;
    }
    setBusy(true);
    try {
      const { error } = await (supabase as any).from("main_warehouse_treasury_txns").insert({
        direction: "out",
        category: "transfer_from_main_warehouse_treasury",
        amount: amt,
        notes: transferNotes.trim() || null,
        performed_by: user?.id,
        status: "pending_approval",
      });
      if (error) throw error;

      // notify financial manager(s) / main treasury approvers
      try {
        const { data: approvers } = await (supabase as any)
          .from("user_roles")
          .select("user_id")
          .in("role", ["financial_manager", "main_treasury_approver", "general_manager"]);
        const targetIds = Array.from(new Set((approvers || []).map((a: any) => a.user_id))) as string[];
        if (targetIds.length) {
          await (supabase as any).from("notifications").insert(
            targetIds.map((uid) => ({
              user_id: uid,
              type: "main_warehouse_transfer_pending",
              title: "تحويل جديد من خزينة المخزن الرئيسي",
              message: `بانتظار اعتمادك: ${fmt(amt)} ج.م${transferNotes ? ` — ${transferNotes}` : ""}`,
              read: false,
            }))
          );
        }
      } catch { /* best effort */ }

      toast({ title: "تم إرسال التحويل للاعتماد", description: `بانتظار محمد شعلة: ${fmt(amt)} ج.م` });
      setTransferOpen(false); setTransferAmt(""); setTransferNotes("");
      await fetchAll();
    } catch (e: any) {
      toast({ title: "تعذّر إرسال التحويل", description: e?.message || "", variant: "destructive" });
    } finally { setBusy(false); }
  };

  const approveTransfer = async (t: Txn) => {
    if (!canApprove) return;
    const isCourierDeposit = t.category === "courier_deposit";
    const label = isCourierDeposit
      ? `اعتماد توريد نقدية المندوب "${(t as any).courier_name || ""}" بمبلغ ${fmt(t.amount)} ج.م؟ سيُضاف لخزينة المخزن الرئيسي.`
      : `اعتماد التحويل ${fmt(t.amount)} ج.م؟ سيتم إضافة المبلغ للخزينة الرئيسية.`;
    if (!window.confirm(label)) return;
    setBusy(true);
    try {
      const rpcName = isCourierDeposit ? "approve_courier_cash_handover" : "approve_main_warehouse_transfer";
      const params: any = isCourierDeposit ? { p_txn_id: t.id, p_note: null } : { _txn_id: t.id };
      const { error } = await (supabase as any).rpc(rpcName, params);
      if (error) throw error;
      toast({ title: "تم الاعتماد", description: isCourierDeposit ? "تم اعتماد توريد المندوب" : "تمت إضافة المبلغ للخزينة الرئيسية" });
      await fetchAll();
    } catch (e: any) {
      toast({ title: "تعذّر الاعتماد", description: e?.message || "", variant: "destructive" });
    } finally { setBusy(false); }
  };

  const rejectTransfer = async (t: Txn) => {
    if (!canApprove) return;
    const isCourierDeposit = t.category === "courier_deposit";
    const reason = window.prompt("سبب الرفض:", "") || "";
    if (!reason.trim()) { toast({ title: "أدخل سبب الرفض", variant: "destructive" }); return; }
    if (!window.confirm(`رفض ${isCourierDeposit ? "توريد المندوب" : "التحويل"} ${fmt(t.amount)} ج.م؟${isCourierDeposit ? " سيتم إعادة المبلغ لعهدة المندوب." : ""}`)) return;
    setBusy(true);
    try {
      const rpcName = isCourierDeposit ? "reject_courier_cash_handover" : "reject_main_warehouse_transfer";
      const params: any = isCourierDeposit ? { p_txn_id: t.id, p_reason: reason } : { _txn_id: t.id, _reason: reason };
      const { error } = await (supabase as any).rpc(rpcName, params);
      if (error) throw error;
      toast({ title: "تم الرفض", description: isCourierDeposit ? "تمت إعادة المبلغ لعهدة المندوب" : undefined });
      await fetchAll();
    } catch (e: any) {
      toast({ title: "تعذّر الرفض", description: e?.message || "", variant: "destructive" });
    } finally { setBusy(false); }
  };

  // === Reconciliation actions ===
  const submitRecon = async () => {
    const phys = Number(reconPhysical);
    if (isNaN(phys) || phys < 0) { toast({ title: "أدخل نقدية فعلية صحيحة", variant: "destructive" }); return; }
    const diff = phys - kpis.balance;
    if (Math.abs(diff) > 0.009 && !reconReason.trim()) {
      toast({ title: "أدخل سبب الفرق", description: `الفرق = ${fmt(diff)} ج.م`, variant: "destructive" }); return;
    }
    setBusy(true);
    try {
      const { error } = await (supabase as any).from("main_warehouse_reconciliations").insert({
        book_balance: kpis.balance,
        physical_cash: phys,
        reason: reconReason.trim() || null,
        notes: reconNotes.trim() || null,
        performed_by: user?.id,
        status: "pending",
      });
      if (error) throw error;
      // notify approvers
      try {
        const { data: approvers } = await (supabase as any)
          .from("user_roles").select("user_id")
          .in("role", ["general_manager", "executive_manager", "financial_manager"]);
        const ids = Array.from(new Set((approvers || []).map((a: any) => a.user_id))) as string[];
        if (ids.length) {
          await (supabase as any).from("notifications").insert(
            ids.map((uid) => ({
              user_id: uid, type: "warehouse_recon_pending", read: false,
              title: "جرد جديد لخزينة المخزن الرئيسي",
              message: `الرصيد الدفتري: ${fmt(kpis.balance)} • النقدية: ${fmt(phys)} • الفرق: ${fmt(diff)}`,
            }))
          );
        }
      } catch {}
      toast({ title: "تم إرسال الجرد للاعتماد", description: `الفرق: ${fmt(diff)} ج.م` });
      setReconOpen(false); setReconPhysical(""); setReconReason(""); setReconNotes("");
      await fetchRecons();
    } catch (e: any) {
      toast({ title: "تعذّر التسجيل", description: e?.message || "", variant: "destructive" });
    } finally { setBusy(false); }
  };

  const canApproveRecon = isGeneralManager || isExecutiveManager || isFinancialManager;
  const approveRecon = async (r: any) => {
    if (!canApproveRecon) return;
    if (!window.confirm(`اعتماد الجرد؟ الفرق ${fmt(Number(r.difference))} ج.م ${Math.abs(Number(r.difference)) > 0.009 ? "سيتم تسجيل تسوية تلقائية بالخزينة" : ""}`)) return;
    setBusy(true);
    try {
      const { error } = await (supabase as any).rpc("approve_warehouse_reconciliation", { _id: r.id });
      if (error) throw error;
      toast({ title: "تم اعتماد الجرد" });
      await Promise.all([fetchRecons(), fetchAll()]);
    } catch (e: any) {
      toast({ title: "تعذّر الاعتماد", description: e?.message || "", variant: "destructive" });
    } finally { setBusy(false); }
  };
  const rejectRecon = async (r: any) => {
    if (!canApproveRecon) return;
    const reason = window.prompt("سبب الرفض:", "") || "";
    if (!reason.trim()) return;
    setBusy(true);
    try {
      const { error } = await (supabase as any).rpc("reject_warehouse_reconciliation", { _id: r.id, _reason: reason });
      if (error) throw error;
      toast({ title: "تم رفض الجرد" });
      await fetchRecons();
    } catch (e: any) {
      toast({ title: "تعذّر الرفض", description: e?.message || "", variant: "destructive" });
    } finally { setBusy(false); }
  };

  // === Courier custody actions ===
  const submitNewCustody = async () => {
    if (!newCustodyName.trim()) { toast({ title: "أدخل اسم المندوب", variant: "destructive" }); return; }
    setBusy(true);
    try {
      const { error } = await (supabase as any).from("courier_goods_custodies").insert({
        courier_name: newCustodyName.trim(),
        notes: newCustodyNotes.trim() || null,
        opened_by: user?.id,
        status: "open",
      });
      if (error) throw error;
      toast({ title: "تم فتح عهدة جديدة" });
      setNewCustodyOpen(false); setNewCustodyName(""); setNewCustodyNotes("");
      await fetchCustodies();
    } catch (e: any) {
      toast({ title: "تعذّر الفتح", description: e?.message || "", variant: "destructive" });
    } finally { setBusy(false); }
  };

  const openLineDialog = (custodyId: string, type: typeof lineType) => {
    setLineCustodyId(custodyId); setLineType(type);
    setLineInventoryItemId("");
    setLineProduct(""); setLineQty(""); setLinePrice(""); setLineSalePrice("");
    setLineDiscountReason(""); setLineCash(""); setLineNotes(""); setLineUnit("كجم");
    setLineCustomerName(""); setLineCustomerPhone(""); setLineBonusReason("");
    setRequestCreditOverride(false);
    setLineOpen(true);
  };


  const submitLine = async () => {
    if (!lineCustodyId) return;
    const qty = Number(lineQty || 0);
    const price = Number(linePrice || 0); // original/list price
    const salePrice = Number(lineSalePrice || 0);
    const cash = Number(lineCash || 0);

    if (lineType === "cash_collect") {
      if (!cash || cash <= 0) { toast({ title: "أدخل مبلغ نقدية صحيح", variant: "destructive" }); return; }
    } else if (lineType === "bonus") {
      if (!lineInventoryItemId) { toast({ title: "اختر صنف المجاني من المخزن الرئيسي", variant: "destructive" }); return; }
      if (!qty || qty <= 0) { toast({ title: "أدخل كمية صحيحة للمجاني", variant: "destructive" }); return; }
      if (!lineCustomerName.trim()) { toast({ title: "أدخل اسم العميل", variant: "destructive" }); return; }
      if (!lineBonusReason.trim()) { toast({ title: "اختر سبب المجاني", variant: "destructive" }); return; }
    } else {
      if (lineType === "issue") {
        if (!lineInventoryItemId) { toast({ title: "اختر المنتج من أصناف المخزن الرئيسي", variant: "destructive" }); return; }
      } else if (lineType === "sale") {
        if (!lineInventoryItemId) { toast({ title: "اختر المنتج من أصناف المخزن الرئيسي", variant: "destructive" }); return; }
        if (!lineCustomerName.trim()) { toast({ title: "أدخل اسم العميل", variant: "destructive" }); return; }
      } else if (!lineProduct.trim()) { toast({ title: "أدخل اسم المنتج", variant: "destructive" }); return; }
      if (!qty || qty <= 0) { toast({ title: "أدخل كمية صحيحة", variant: "destructive" }); return; }
      if (lineType === "sale") {
        if (!price || price <= 0) { toast({ title: "أدخل السعر الأصلي", variant: "destructive" }); return; }
        if (!salePrice || salePrice <= 0) { toast({ title: "أدخل سعر البيع الفعلي", variant: "destructive" }); return; }
      }
    }

    // Sale discount logic
    let discountAmt = 0, discountPct = 0, discountStatus: string = "none";
    if (lineType === "sale") {
      discountAmt = Math.max(0, (price - salePrice) * qty);
      discountPct = price > 0 ? Math.max(0, ((price - salePrice) / price) * 100) : 0;
      if (discountAmt > 0) {
        if (discountPct > discountThresholdPct && !(isGeneralManager || isExecutiveManager)) {
          discountStatus = "pending";
          if (!lineDiscountReason.trim()) { toast({ title: "اختر سبب الخصم", variant: "destructive" }); return; }
        } else {
          discountStatus = "auto_approved";
        }
      }
    }

    // Credit-limit enforcement for issue
    let creditOverrideStatus: "none" | "pending" | "approved" = "none";
    if (lineType === "issue") {
      const sum = custodySummary.find((s) => s.id === lineCustodyId);
      const limit = sum?.creditLimit;
      const addValue = qty * price;
      if (limit != null && sum) {
        const projected = (sum.remainingGoods || 0) + addValue;
        if (projected > limit) {
          if (isGeneralManager || isExecutiveManager) {
            creditOverrideStatus = "approved";
          } else if (requestCreditOverride) {
            creditOverrideStatus = "pending";
          } else {
            toast({
              title: "تجاوز الحد الائتماني",
              description: `العهدة الحالية ${fmt(sum.remainingGoods)} + قيمة الصرف ${fmt(addValue)} = ${fmt(projected)} > الحد ${fmt(limit)}. فعّل خيار "طلب اعتماد تجاوز" أو اطلب من المدير.`,
              variant: "destructive",
            });
            return;
          }
        }
      }
    }


    setBusy(true);
    try {
      let selectedIssueItem: WarehouseStockItem | null = null;
      if (lineType === "issue" || lineType === "bonus" || lineType === "sale") {
        if (!mainWarehouse?.id) throw new Error("تعذّر تحديد المخزن الرئيسي");
        const { data: dbItem, error: dbItemErr } = await (supabase as any)
          .from("inventory_items")
          .select("id, warehouse_id, product_id, name, category, unit, stock, is_active, archived, archived_at, module, item_type, source_module, unit_cost")
          .eq("id", lineInventoryItemId)
          .maybeSingle();
        if (dbItemErr) throw dbItemErr;
        const rejectionReason = getWarehouseItemRejectionReason(dbItem as WarehouseStockItem | null, mainWarehouse.id);
        const debugRow = dbItem
          ? getWarehouseItemDebugRow(dbItem as WarehouseStockItem, mainWarehouse.id, mainWarehouse.name)
          : getWarehouseMissingItemDebugRow(lineInventoryItemId, mainWarehouse.id, mainWarehouse.name);
        console.table([debugRow]);
        if (rejectionReason) {
          throw new Error(`الصنف "${(dbItem as any)?.name || lineProduct || "—"}" غير تابع/غير مفعّل بالمخزن الرئيسي (${rejectionReason}).`);
        }
        selectedIssueItem = dbItem as WarehouseStockItem;
      }

      // Bonus: compute cost value & approval status based on % of sales for this custody
      let bonusStatus: "auto_approved" | "pending_executive" | "pending_general" = "auto_approved";
      let bonusUnitCost = 0;
      if (lineType === "bonus") {
        bonusUnitCost = Number((selectedIssueItem as any)?.unit_cost || 0);
        const bonusValueNew = qty * bonusUnitCost;
        const sum = custodySummary.find((s) => s.id === lineCustodyId);
        const salesBase = Number(sum?.salesValue || 0);
        const existingBonus = Number((sum as any)?.bonusValue || 0);
        const pct = salesBase > 0 ? ((existingBonus + bonusValueNew) / salesBase) * 100 : 100;
        if (pct <= 3) bonusStatus = "auto_approved";
        else if (pct <= 5) bonusStatus = "pending_executive";
        else bonusStatus = "pending_general";
      }

      // For sale: total_value = qty * actual sale price. For issue/return: qty * price.
      const totalValue =
        lineType === "sale" ? qty * salePrice :
        lineType === "cash_collect" ? null :
        lineType === "bonus" ? qty * bonusUnitCost :
        qty * price;

      const insertPayload: any = {
        custody_id: lineCustodyId,
        line_type: lineType,
        product_name: lineType === "cash_collect" ? null : (selectedIssueItem?.name || lineProduct.trim()),
        inventory_item_id: (lineType === "issue" || lineType === "bonus" || lineType === "sale") ? lineInventoryItemId : null,
        quantity: lineType === "cash_collect" ? null : qty,
        unit: lineType === "cash_collect" ? null : (selectedIssueItem?.unit || lineUnit),
        unit_price: lineType === "sale" ? salePrice : (lineType === "cash_collect" ? null : (lineType === "bonus" ? bonusUnitCost : (price || null))),
        total_value: totalValue,
        cash_collected: lineType === "cash_collect" ? cash : null,
        notes: lineNotes.trim() || null,
        performed_by: user?.id,
      };

      if (lineType === "bonus") {
        insertPayload.customer_name = lineCustomerName.trim();
        insertPayload.bonus_reason = lineBonusReason;
        insertPayload.bonus_status = bonusStatus === "auto_approved" ? "auto_approved" : "pending";
        if (bonusStatus === "auto_approved") {
          insertPayload.bonus_approved_by = user?.id;
          insertPayload.bonus_approved_at = new Date().toISOString();
        }
      }


      if (lineType === "sale") {
        insertPayload.customer_name = lineCustomerName.trim() || null;
        insertPayload.customer_phone = lineCustomerPhone.trim() || null;
        insertPayload.original_price = price;
        insertPayload.discount_amount = discountAmt || null;
        insertPayload.discount_pct = discountAmt > 0 ? Number(discountPct.toFixed(2)) : null;
        insertPayload.discount_reason = discountAmt > 0 ? (lineDiscountReason || null) : null;
        insertPayload.discount_status = discountStatus;
        if (discountStatus === "auto_approved") {
          insertPayload.discount_approved_by = user?.id;
          insertPayload.discount_approved_at = new Date().toISOString();
        }
      }

      if (lineType === "issue" && creditOverrideStatus !== "none") {
        insertPayload.credit_override_status = creditOverrideStatus;
        if (creditOverrideStatus === "approved") {
          insertPayload.credit_override_by = user?.id;
          insertPayload.credit_override_at = new Date().toISOString();
        }
      }


      const { error } = await (supabase as any).from("courier_goods_custody_lines").insert(insertPayload);
      if (error) throw error;

      // cash collect → treasury deposit (auto-created via DB trigger on courier_goods_custody_lines)
      if (lineType === "cash_collect") {
        await fetchAll();
      }

      // notify approvers if pending discount
      if (lineType === "sale" && discountStatus === "pending") {
        try {
          const { data: approvers } = await (supabase as any)
            .from("user_roles").select("user_id")
            .in("role", ["general_manager", "executive_manager"]);
          const ids = Array.from(new Set((approvers || []).map((a: any) => a.user_id))) as string[];
          if (ids.length) {
            await (supabase as any).from("notifications").insert(
              ids.map((uid) => ({
                user_id: uid, type: "courier_discount_pending", read: false,
                title: "خصم مندوب بانتظار الاعتماد",
                message: `خصم ${discountPct.toFixed(1)}% (${fmt(discountAmt)} ج.م) — ${lineProduct.trim()}`,
              }))
            );
          }
        } catch {}
      }

      // notify approvers if pending bonus
      if (lineType === "bonus" && insertPayload.bonus_status === "pending") {
        try {
          const roles = bonusStatus === "pending_executive" ? ["executive_manager", "general_manager"] : ["general_manager"];
          const { data: approvers } = await (supabase as any)
            .from("user_roles").select("user_id").in("role", roles);
          const ids = Array.from(new Set((approvers || []).map((a: any) => a.user_id))) as string[];
          if (ids.length) {
            await (supabase as any).from("notifications").insert(
              ids.map((uid) => ({
                user_id: uid, type: "courier_bonus_pending", read: false,
                title: "مجاني مندوب بانتظار الاعتماد",
                message: `مجاني ${qty} ${selectedIssueItem?.unit || ""} — ${selectedIssueItem?.name || ""} للعميل ${lineCustomerName.trim()}`,
              }))
            );
          }
        } catch {}
      }

      toast({
        title: "تم التسجيل",
        description:
          lineType === "bonus" && bonusStatus !== "auto_approved"
            ? (bonusStatus === "pending_executive" ? "المجاني بانتظار اعتماد المدير التنفيذي" : "المجاني بانتظار اعتماد المدير العام")
            : (discountStatus === "pending" ? "الخصم بانتظار اعتماد المدير العام/التنفيذي" : undefined),
      });
      setLineOpen(false);
      await fetchCustodies();
    } catch (e: any) {
      toast({ title: "تعذّر التسجيل", description: e?.message || "", variant: "destructive" });
    } finally { setBusy(false); }
  };

  const approveDiscount = async (lineId: string) => {
    if (!(isGeneralManager || isExecutiveManager)) return;
    setBusy(true);
    try {
      const { error } = await (supabase as any).rpc("approve_courier_discount", { _line_id: lineId });
      if (error) throw error;
      toast({ title: "تم اعتماد الخصم" });
      await fetchCustodies();
    } catch (e: any) {
      toast({ title: "تعذّر الاعتماد", description: e?.message || "", variant: "destructive" });
    } finally { setBusy(false); }
  };
  const rejectDiscount = async (lineId: string) => {
    if (!(isGeneralManager || isExecutiveManager)) return;
    const reason = window.prompt("سبب الرفض:", "") || "";
    if (!reason.trim()) return;
    setBusy(true);
    try {
      const { error } = await (supabase as any).rpc("reject_courier_discount", { _line_id: lineId, _reason: reason });
      if (error) throw error;
      toast({ title: "تم رفض الخصم" });
      await fetchCustodies();
    } catch (e: any) {
      toast({ title: "تعذّر الرفض", description: e?.message || "", variant: "destructive" });
    } finally { setBusy(false); }
  };

  const approveBonus = async (lineId: string) => {
    if (!(isGeneralManager || isExecutiveManager)) return;
    setBusy(true);
    try {
      const { error } = await (supabase as any)
        .from("courier_goods_custody_lines")
        .update({ bonus_status: "approved", bonus_approved_by: user?.id, bonus_approved_at: new Date().toISOString() })
        .eq("id", lineId);
      if (error) throw error;
      toast({ title: "تم اعتماد المجاني" });
      await fetchCustodies();
    } catch (e: any) {
      toast({ title: "تعذّر الاعتماد", description: e?.message || "", variant: "destructive" });
    } finally { setBusy(false); }
  };
  const rejectBonus = async (lineId: string) => {
    if (!(isGeneralManager || isExecutiveManager)) return;
    const reason = window.prompt("سبب الرفض:", "") || "";
    if (!reason.trim()) return;
    setBusy(true);
    try {
      const { error } = await (supabase as any)
        .from("courier_goods_custody_lines")
        .update({ bonus_status: "rejected", notes: `[رفض: ${reason}]` })
        .eq("id", lineId);
      if (error) throw error;
      toast({ title: "تم رفض المجاني" });
      await fetchCustodies();
    } catch (e: any) {
      toast({ title: "تعذّر الرفض", description: e?.message || "", variant: "destructive" });
    } finally { setBusy(false); }
  };

  // === Credit override approve/reject ===
  const approveCreditOverride = async (lineId: string) => {
    if (!(isGeneralManager || isExecutiveManager)) return;
    setBusy(true);
    try {
      const { error } = await (supabase as any).rpc("approve_courier_credit_override", { _line_id: lineId });
      if (error) throw error;
      toast({ title: "تم اعتماد تجاوز الحد" });
      await fetchCustodies();
    } catch (e: any) {
      toast({ title: "تعذّر الاعتماد", description: e?.message || "", variant: "destructive" });
    } finally { setBusy(false); }
  };
  const rejectCreditOverride = async (lineId: string) => {
    if (!(isGeneralManager || isExecutiveManager)) return;
    const reason = window.prompt("سبب الرفض:", "") || "";
    if (!reason.trim()) return;
    setBusy(true);
    try {
      const { error } = await (supabase as any).rpc("reject_courier_credit_override", { _line_id: lineId, _reason: reason });
      if (error) throw error;
      toast({ title: "تم رفض التجاوز" });
      await fetchCustodies();
    } catch (e: any) {
      toast({ title: "تعذّر الرفض", description: e?.message || "", variant: "destructive" });
    } finally { setBusy(false); }
  };

  // === Profile (limit + commission) save ===
  const openProfileDialog = (courierName: string) => {
    const p = profiles.find((x) => x.courier_name === courierName);
    setProfileCourier(courierName);
    setProfileLimit(p?.credit_limit != null ? String(p.credit_limit) : "");
    setProfileCommType(p?.commission_type || "none");
    setProfileCommValue(p?.commission_value != null ? String(p.commission_value) : "");
    setProfileNotes(p?.notes || "");
    setProfileOpen(true);
  };
  const saveProfile = async () => {
    if (!(isGeneralManager || isExecutiveManager)) {
      toast({ title: "غير مصرح", variant: "destructive" }); return;
    }
    setBusy(true);
    try {
      const payload: any = {
        courier_name: profileCourier,
        credit_limit: profileLimit ? Number(profileLimit) : null,
        commission_type: profileCommType,
        commission_value: profileCommValue ? Number(profileCommValue) : 0,
        notes: profileNotes || null,
        updated_by: user?.id,
        updated_at: new Date().toISOString(),
      };
      const { error } = await (supabase as any)
        .from("courier_profiles")
        .upsert(payload, { onConflict: "courier_name" });
      if (error) throw error;
      toast({ title: "تم حفظ إعدادات المندوب" });
      setProfileOpen(false);
      await fetchCourierExtras();
    } catch (e: any) {
      toast({ title: "تعذّر الحفظ", description: e?.message || "", variant: "destructive" });
    } finally { setBusy(false); }
  };

  // === Close day ===
  const closeDay = async (custodyId: string) => {
    const dateStr = window.prompt("تاريخ الإغلاق (YYYY-MM-DD):", new Date().toISOString().slice(0, 10));
    if (!dateStr) return;
    setBusy(true);
    try {
      const { error } = await (supabase as any).rpc("close_courier_day", { _custody_id: custodyId, _date: dateStr });
      if (error) throw error;
      toast({ title: "تم إغلاق اليوم" });
      await fetchCustodies();
    } catch (e: any) {
      toast({ title: "تعذّر الإغلاق", description: e?.message || "", variant: "destructive" });
    } finally { setBusy(false); }
  };
  const reopenDay = async (closureId: string) => {
    if (!(isGeneralManager || isExecutiveManager)) {
      toast({ title: "إعادة الفتح للمدير العام/التنفيذي فقط", variant: "destructive" }); return;
    }
    const reason = window.prompt("سبب إعادة الفتح:", "") || "";
    if (!reason.trim()) return;
    setBusy(true);
    try {
      const { error } = await (supabase as any).rpc("reopen_courier_day", { _closure_id: closureId, _reason: reason });
      if (error) throw error;
      toast({ title: "تم إعادة الفتح" });
      await fetchCustodies();
    } catch (e: any) {
      toast({ title: "تعذّر إعادة الفتح", description: e?.message || "", variant: "destructive" });
    } finally { setBusy(false); }
  };

  // === Pay commission ===
  const openPayCommission = (courierName: string, suggested: number) => {
    setPayCommCourier(courierName);
    setPayCommAmt(suggested > 0 ? suggested.toFixed(2) : "");
    setPayCommNotes("");
    setPayCommOpen(true);
  };
  const submitPayCommission = async () => {
    const amt = Number(payCommAmt || 0);
    if (!amt || amt <= 0) { toast({ title: "أدخل مبلغ صحيح", variant: "destructive" }); return; }
    setBusy(true);
    try {
      const { error } = await (supabase as any).rpc("pay_courier_commission", {
        _courier_name: payCommCourier, _amount: amt, _notes: payCommNotes || null,
      });
      if (error) throw error;
      toast({ title: "تم صرف العمولة" });
      setPayCommOpen(false);
      await fetchCourierExtras();
      await fetchAll();
    } catch (e: any) {
      toast({ title: "تعذّر الصرف", description: e?.message || "", variant: "destructive" });
    } finally { setBusy(false); }
  };

  // === Statement helpers ===
  const openStatement = (sum: any) => {
    setStmtCustody(sum);
    setStmtFrom("");
    setStmtTo(new Date().toISOString().slice(0, 10));
    setStmtOpen(true);
  };


  const stmtRows = useMemo(() => {
    if (!stmtCustody) return [] as any[];
    const fromT = stmtFrom ? new Date(stmtFrom + "T00:00:00").getTime() : -Infinity;
    const toT = stmtTo ? new Date(stmtTo + "T23:59:59").getTime() : Infinity;
    return (stmtCustody.lines || [])
      .filter((l: any) => {
        const t = new Date(l.performed_at).getTime();
        return t >= fromT && t <= toT;
      })
      .sort((a: any, b: any) => new Date(a.performed_at).getTime() - new Date(b.performed_at).getTime());
  }, [stmtCustody, stmtFrom, stmtTo]);

  const stmtTotals = useMemo(() => {
    let issue = 0, ret = 0, sale = 0, disc = 0, cash = 0, bonus = 0;
    stmtRows.forEach((l: any) => {
      const tv = Number(l.total_value || 0);
      if (l.line_type === "issue") issue += tv;
      else if (l.line_type === "return") ret += tv;
      else if (l.line_type === "sale") { sale += tv; disc += Number(l.discount_amount || 0); }
      else if (l.line_type === "bonus") { if (l.bonus_status !== "rejected") bonus += tv; }
      else if (l.line_type === "cash_collect") cash += Number(l.cash_collected || 0);
    });
    return { issue, ret, sale, disc, cash, bonus, remainingGoods: issue - ret - sale - bonus, remainingCash: sale - cash };
  }, [stmtRows]);

  const exportStatementExcel = () => {
    if (!stmtCustody) return;
    const data = stmtRows.map((l: any) => ({
      "التاريخ": fmtDate(l.performed_at),
      "النوع": l.line_type === "issue" ? "صرف" : l.line_type === "return" ? "مرتجع" : l.line_type === "sale" ? "بيع" : l.line_type === "bonus" ? "مجاني/بونص" : "تحصيل نقدية",
      "الصنف": l.product_name || "",
      "الكمية": Number(l.quantity || 0),
      "الوحدة": l.unit || "",
      "سعر الوحدة": Number(l.unit_price || 0),
      "السعر الأصلي": Number(l.original_price || 0),
      "قيمة الخصم": Number(l.discount_amount || 0),
      "إجمالي القيمة": Number(l.total_value || 0),
      "النقدية": Number(l.cash_collected || 0),
      "ملاحظات": l.notes || "",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "كشف حساب");
    XLSX.writeFile(wb, `كشف-حساب-${stmtCustody.courier_name}-${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  const printStatement = () => {
    if (!stmtCustody) return;
    const rowsHtml = stmtRows.map((l: any) => `
      <tr>
        <td>${escapeHtml(fmtDate(l.performed_at))}</td>
        <td>${l.line_type === "issue" ? "صرف" : l.line_type === "return" ? "مرتجع" : l.line_type === "sale" ? "بيع" : l.line_type === "bonus" ? "مجاني/بونص" : "تحصيل نقدية"}</td>
        <td>${escapeHtml(l.product_name || "—")}</td>
        <td class="num">${fmtNum(Number(l.quantity || 0), 2)}</td>
        <td class="num">${fmtNum(Number(l.unit_price || 0), 2)}</td>
        <td class="num">${fmtNum(Number(l.discount_amount || 0), 2)}</td>
        <td class="num"><b>${fmtNum(Number(l.total_value || 0), 2)}</b></td>
        <td class="num">${fmtNum(Number(l.cash_collected || 0), 2)}</td>
      </tr>
    `).join("");
    const body = `
      <header>
        <div>
          <h1>كشف حساب المندوب — ${escapeHtml(stmtCustody.courier_name)}</h1>
          <div class="en">${escapeHtml(COMPANY_AR)}</div>
        </div>
        <div class="meta">
          <div>الفترة: <b>${escapeHtml(stmtFrom || "—")} → ${escapeHtml(stmtTo || "—")}</b></div>
          <div>تاريخ الطباعة: <b>${escapeHtml(new Date().toLocaleString("ar-EG-u-nu-latn"))}</b></div>
        </div>
      </header>
      <table>
        <thead><tr>
          <th>التاريخ</th><th>النوع</th><th>الصنف</th><th>الكمية</th>
          <th>سعر</th><th>خصم</th><th>إجمالي</th><th>نقدية</th>
        </tr></thead>
        <tbody>${rowsHtml || `<tr><td colspan="8" style="text-align:center">لا توجد حركات</td></tr>`}</tbody>
        <tfoot>
          <tr><td colspan="6">إجمالي البضاعة المصروفة</td><td class="num"><b>${fmtNum(stmtTotals.issue, 2)}</b></td><td></td></tr>
          <tr><td colspan="6">إجمالي المرتجعات</td><td class="num"><b>${fmtNum(stmtTotals.ret, 2)}</b></td><td></td></tr>
          <tr><td colspan="6">إجمالي المبيعات</td><td class="num"><b>${fmtNum(stmtTotals.sale, 2)}</b></td><td></td></tr>
          <tr><td colspan="6">إجمالي الخصومات</td><td class="num"><b>${fmtNum(stmtTotals.disc, 2)}</b></td><td></td></tr>
          <tr><td colspan="6">إجمالي المجانيات / البونصات</td><td class="num"><b>${fmtNum(stmtTotals.bonus, 2)}</b></td><td></td></tr>
          <tr><td colspan="6">إجمالي النقدية الموردة</td><td class="num"><b>${fmtNum(stmtTotals.cash, 2)}</b></td><td></td></tr>
          <tr><td colspan="6"><b>المتبقي بضاعة مع المندوب</b></td><td class="num"><b>${fmtNum(stmtTotals.remainingGoods, 2)}</b></td><td></td></tr>
          <tr><td colspan="6"><b>المتبقي نقدية على المندوب</b></td><td class="num"><b>${fmtNum(stmtTotals.remainingCash, 2)}</b></td><td></td></tr>
        </tfoot>
      </table>
    `;
    openPrintWindow(body, `كشف حساب ${stmtCustody.courier_name}`);
  };

  const DISCOUNT_REASONS = ["عميل جملة", "تصفية صنف", "قرب انتهاء", "عرض خاص", "أخرى"];
  const BONUS_REASONS = ["عرض ترويجي", "بونص على كمية", "تعويض عميل", "تشجيع عميل جديد", "موافقة مدير", "أخرى"];




  const closeCustody = async (id: string) => {
    if (!window.confirm("إغلاق العهدة؟ لن يمكن إضافة حركات بعد الإغلاق.")) return;
    setBusy(true);
    try {
      const { error } = await (supabase as any).from("courier_goods_custodies")
        .update({ status: "closed", closed_at: new Date().toISOString(), closed_by: user?.id })
        .eq("id", id);
      if (error) throw error;
      toast({ title: "تم إغلاق العهدة" });
      await fetchCustodies();
    } catch (e: any) {
      toast({ title: "تعذّر الإغلاق", description: e?.message || "", variant: "destructive" });
    } finally { setBusy(false); }
  };

  // Per-courier custody summary (extended with profile, commission, closures)
  const custodySummary = useMemo(() => {
    return custodies.map((c) => {
      const lines = custodyLines.filter((l) => l.custody_id === c.id);
      let goodsOutValue = 0, goodsReturnedValue = 0, salesValue = 0, cashCollected = 0, discountsValue = 0, bonusValue = 0;
      let salesQtyKg = 0, salesItems = 0;
      lines.forEach((l) => {
        const tv = Number(l.total_value || 0);
        if (l.line_type === "issue") goodsOutValue += tv;
        else if (l.line_type === "return") goodsReturnedValue += tv;
        else if (l.line_type === "sale") {
          // Skip rejected discount sales? we still count, but discount status matters for commission
          salesValue += tv;
          discountsValue += Number(l.discount_amount || 0);
          if (l.discount_status !== "rejected") {
            salesQtyKg += Number(l.quantity || 0);
            salesItems += 1;
          }
        }
        else if (l.line_type === "bonus") {
          if (l.bonus_status !== "rejected") bonusValue += tv;
        }
        else if (l.line_type === "cash_collect") cashCollected += Number(l.cash_collected || 0);
      });
      const remainingGoods = goodsOutValue - goodsReturnedValue - salesValue - bonusValue;
      const remainingCash = salesValue - cashCollected;

      const profile = profiles.find((p) => p.courier_name === c.courier_name);
      const courierPayouts = payouts.filter((p) => p.courier_name === c.courier_name);
      const paidCommission = courierPayouts.reduce((s, p) => s + Number(p.amount || 0), 0);
      let dueCommission = 0;
      if (profile?.commission_type === "percent_of_sales") dueCommission = salesValue * (Number(profile.commission_value || 0) / 100);
      else if (profile?.commission_type === "per_kg") dueCommission = salesQtyKg * Number(profile.commission_value || 0);
      else if (profile?.commission_type === "per_item") dueCommission = salesItems * Number(profile.commission_value || 0);
      const remainingCommission = dueCommission - paidCommission;

      const myClosures = closures.filter((cl) => cl.custody_id === c.id);
      const lastClosure = myClosures.find((cl) => cl.status === "closed");
      const creditLimit = profile?.credit_limit ? Number(profile.credit_limit) : null;
      const creditUsedPct = creditLimit ? Math.min(100, (remainingGoods / creditLimit) * 100) : null;
      const creditAvailable = creditLimit != null ? Math.max(0, creditLimit - remainingGoods) : null;
      const bonusPct = salesValue > 0 ? (bonusValue / salesValue) * 100 : 0;

      return {
        ...c, lines, goodsOutValue, goodsReturnedValue, salesValue, discountsValue, bonusValue, bonusPct, cashCollected,
        remainingGoods, remainingCash, profile, paidCommission, dueCommission, remainingCommission,
        closures: myClosures, lastClosure, creditLimit, creditUsedPct, creditAvailable,
      };
    });
  }, [custodies, custodyLines, profiles, payouts, closures]);

  const pendingRecons = recons.filter((r) => r.status === "pending");




  const exportExcel = () => {
    const data = filtered.map((r) => ({
      "التاريخ": fmtDate(r.performed_at),
      "النوع": r.direction === "in" ? "وارد" : "صادر",
      "التصنيف": CATEGORY_LABELS[r.category] || r.category,
      "المبلغ": Number(r.amount || 0),
      "المرجع": r.reference || "",
      "ملاحظات": r.notes || "",
      "بواسطة": r.performed_by_name || "",
      "الحالة": STATUS_LABELS[r.status]?.txt || r.status,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "حركات الخزينة");
    XLSX.writeFile(wb, `خزينة-المخزن-الرئيسي-${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  const printAll = () => {
    const body = `
      <header>
        <div>
          <h1>كشف خزينة المخزن الرئيسي</h1>
          <div class="en">${escapeHtml(COMPANY_AR)}</div>
        </div>
        <div class="meta">
          <div>تاريخ الطباعة: <b>${escapeHtml(new Date().toLocaleString("ar-EG-u-nu-latn"))}</b></div>
          <div>الرصيد الحالي: <b>${fmtNum(kpis.balance, 2)} ج.م</b></div>
          <div>بانتظار الاعتماد: <b>${fmtNum(kpis.pending, 2)} ج.م</b></div>
        </div>
      </header>
      <table>
        <thead>
          <tr>
            <th style="width:30px;">#</th>
            <th>التاريخ</th>
            <th>النوع</th>
            <th>التصنيف</th>
            <th>المبلغ</th>
            <th>المرجع</th>
            <th>بواسطة</th>
            <th>الحالة</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map((r, i) => `
            <tr>
              <td class="num">${i + 1}</td>
              <td>${escapeHtml(fmtDate(r.performed_at))}</td>
              <td>${r.direction === "in" ? "وارد" : "صادر"}</td>
              <td>${escapeHtml(CATEGORY_LABELS[r.category] || r.category)}</td>
              <td class="num"><b>${fmtNum(Number(r.amount || 0), 2)}</b></td>
              <td>${escapeHtml(r.reference || "—")}</td>
              <td>${escapeHtml(r.performed_by_name || "—")}</td>
              <td>${escapeHtml(STATUS_LABELS[r.status]?.txt || r.status)}</td>
            </tr>`).join("")}
        </tbody>
      </table>`;
    openPrintWindow("كشف خزينة المخزن الرئيسي", body);
  };

  const pendingTransfers = rows.filter(r => r.status === "pending_approval" && TRANSFER_OUT_CATEGORIES.has(r.category));

  return (
    <div className="space-y-4">
      {/* Header + actions */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-md bg-primary/15 text-primary"><Wallet className="w-5 h-5" /></div>
          <div>
            <h3 className="font-bold text-lg">خزينة المخزن الرئيسي</h3>
            <p className="text-xs text-muted-foreground">تحصيل البيع المباشر وتحويل الإيرادات إلى الخزينة الرئيسية</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canRecord && (
            <>
              <Button size="sm" onClick={() => setCollectOpen(true)} className="bg-emerald-600 hover:bg-emerald-700">
                <Plus className="w-4 h-4 ml-1" /> تسجيل تحصيل
              </Button>
              <Button size="sm" onClick={() => setCourierOpen(true)} className="bg-sky-600 hover:bg-sky-700">
                <ArrowDownLeft className="w-4 h-4 ml-1" /> توريد نقدية من مندوب
              </Button>
              <Button size="sm" onClick={() => setTransferOpen(true)} variant="outline">
                <Send className="w-4 h-4 ml-1" /> تحويل للخزينة الرئيسية
              </Button>

            </>
          )}
          <Button size="sm" variant="outline" onClick={printAll}><Printer className="w-4 h-4 ml-1" /> طباعة</Button>
          <Button size="sm" variant="outline" onClick={exportExcel}><FileSpreadsheet className="w-4 h-4 ml-1" /> Excel</Button>
          <Button size="sm" variant="outline" onClick={fetchAll} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">الرصيد الحالي</p>
          <p className={`text-2xl font-bold ${kpis.balance >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{fmt(kpis.balance)}</p>
          <p className="text-[10px] text-muted-foreground">ج.م</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground flex items-center gap-1"><ArrowDownLeft className="w-3 h-3 text-emerald-600" /> وارد اليوم</p>
          <p className="text-2xl font-bold text-emerald-600">{fmt(kpis.todayIn)}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground flex items-center gap-1"><ArrowUpRight className="w-3 h-3 text-rose-600" /> صادر اليوم</p>
          <p className="text-2xl font-bold text-rose-600">{fmt(kpis.todayOut)}</p>
        </CardContent></Card>
        <Card className={pendingTransfers.length > 0 ? "border-amber-400" : ""}><CardContent className="p-4">
          <p className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3 text-amber-600" /> بانتظار الاعتماد</p>
          <p className="text-2xl font-bold text-amber-600">{fmt(kpis.pending)}</p>
          <p className="text-[10px] text-muted-foreground">{pendingTransfers.length} تحويل</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">إجمالي المحوّل (معتمد)</p>
          <p className="text-2xl font-bold text-primary">{fmt(kpis.transferred)}</p>
        </CardContent></Card>
      </div>

      {/* High balance alert */}
      {kpis.balance > HIGH_BALANCE_THRESHOLD && (
        <div className="border border-amber-400 bg-amber-50 text-amber-900 rounded-md p-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="text-sm">
            <div className="font-semibold">يوجد مبلغ كبير بخزينة المخزن الرئيسي</div>
            <div className="text-xs">الرصيد الحالي {fmt(kpis.balance)} ج.م تجاوز الحد ({fmt(HIGH_BALANCE_THRESHOLD)} ج.م). يفضّل تحويله للخزينة الرئيسية.</div>
          </div>
          {canRecord && (
            <Button size="sm" variant="outline" className="ms-auto" onClick={() => { setTransferAmt(String(kpis.balance)); setTransferOpen(true); }}>
              <Send className="w-3 h-3 ml-1" /> تحويل الآن
            </Button>
          )}
        </div>
      )}


      {/* Pending approvals block */}
      {pendingTransfers.length > 0 && (
        <Card className="border-amber-400 bg-amber-50/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-600" /> تحويلات بانتظار اعتماد محمد شعلة
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {pendingTransfers.map((t) => (
                <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 bg-background rounded-md p-3 border">
                  <div className="text-sm">
                    <div className="font-bold">{fmt(t.amount)} ج.م</div>
                    <div className="text-xs text-muted-foreground">
                      {fmtDate(t.performed_at)} • بواسطة: {t.performed_by_name || "—"}
                      {t.notes ? ` • ${t.notes}` : ""}
                    </div>
                  </div>
                  {canApprove ? (
                    <div className="flex gap-1">
                      <Button size="sm" disabled={busy} className="bg-emerald-600 hover:bg-emerald-700" onClick={() => approveTransfer(t)}>
                        <CheckCircle2 className="w-3 h-3 ml-1" /> اعتماد
                      </Button>
                      <Button size="sm" disabled={busy} variant="outline" className="text-rose-600 border-rose-300" onClick={() => rejectTransfer(t)}>
                        <XCircle className="w-3 h-3 ml-1" /> رفض
                      </Button>
                    </div>
                  ) : (
                    <Badge variant="outline" className="bg-amber-100 text-amber-700">بانتظار الموافقة</Badge>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Reconciliation */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <ClipboardCheck className="w-4 h-4 text-primary" /> مطابقة (جرد) خزينة المخزن الرئيسي
            </CardTitle>
            {canRecord && (
              <Button size="sm" onClick={() => { setReconPhysical(""); setReconReason(""); setReconNotes(""); setReconOpen(true); }}>
                <Plus className="w-4 h-4 ml-1" /> تسجيل جرد جديد
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {recons.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">لا يوجد جرد مسجل بعد</p>
          ) : (
            <div className="border rounded-lg overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead className="bg-muted/60 text-xs">
                  <tr>
                    <th className="p-2">التاريخ</th>
                    <th className="p-2">الرصيد الدفتري</th>
                    <th className="p-2">النقدية الفعلية</th>
                    <th className="p-2">الفرق</th>
                    <th className="p-2">السبب</th>
                    <th className="p-2">الحالة</th>
                    <th className="p-2">إجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {recons.map((r) => {
                    const diff = Number(r.difference || 0);
                    return (
                      <tr key={r.id} className="border-t">
                        <td className="p-2 text-xs whitespace-nowrap">{fmtDate(r.performed_at)}</td>
                        <td className="p-2 font-mono">{fmt(Number(r.book_balance))}</td>
                        <td className="p-2 font-mono">{fmt(Number(r.physical_cash))}</td>
                        <td className={`p-2 font-mono font-bold ${diff === 0 ? "text-emerald-700" : diff > 0 ? "text-sky-700" : "text-rose-700"}`}>
                          {diff > 0 ? "+" : ""}{fmt(diff)}
                        </td>
                        <td className="p-2 text-xs max-w-[220px] truncate" title={r.reason || ""}>{r.reason || "—"}</td>
                        <td className="p-2">
                          <Badge variant="outline" className={
                            r.status === "approved" ? "bg-emerald-100 text-emerald-700" :
                            r.status === "rejected" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"
                          }>
                            {r.status === "approved" ? "معتمد" : r.status === "rejected" ? "مرفوض" : "بانتظار اعتماد"}
                          </Badge>
                        </td>
                        <td className="p-2">
                          {r.status === "pending" && canApproveRecon ? (
                            <div className="flex gap-1">
                              <Button size="sm" disabled={busy} className="bg-emerald-600 hover:bg-emerald-700 h-7 px-2" onClick={() => approveRecon(r)}>
                                <CheckCircle2 className="w-3 h-3" />
                              </Button>
                              <Button size="sm" disabled={busy} variant="outline" className="h-7 px-2 text-rose-600 border-rose-300" onClick={() => rejectRecon(r)}>
                                <XCircle className="w-3 h-3" />
                              </Button>
                            </div>
                          ) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Courier goods custody */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Truck className="w-4 h-4 text-primary" /> عهدة بضائع المندوبين
            </CardTitle>
            {canRecord && (
              <Button size="sm" onClick={() => { setNewCustodyName(""); setNewCustodyNotes(""); setNewCustodyOpen(true); }}>
                <Plus className="w-4 h-4 ml-1" /> فتح عهدة جديدة
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Dashboard */}
          {custodySummary.length > 0 && (() => {
            const tot = custodySummary.reduce((a, c) => ({
              goods: a.goods + c.remainingGoods,
              cash: a.cash + c.remainingCash,
              sales: a.sales + c.salesValue,
              returns: a.returns + c.goodsReturnedValue,
              collected: a.collected + c.cashCollected,
              discounts: a.discounts + (c.discountsValue || 0),
              bonuses: a.bonuses + (c.bonusValue || 0),
            }), { goods: 0, cash: 0, sales: 0, returns: 0, collected: 0, discounts: 0, bonuses: 0 });
            const topBy = (key: string) => {
              const sorted = [...custodySummary].sort((a: any, b: any) => Number(b[key] || 0) - Number(a[key] || 0));
              return sorted[0];
            };
            const topSales = topBy("salesValue");
            const topDisc = topBy("discountsValue");
            const topCash = topBy("cashCollected");
            const topBonus = topBy("bonusValue");
            const topDef = [...custodySummary].sort((a, b) => b.remainingCash - a.remainingCash)[0];
            // Top customer bonuses
            const customerBonus: Record<string, number> = {};
            custodySummary.forEach((c: any) => (c.lines || []).forEach((l: any) => {
              if (l.line_type === "bonus" && l.bonus_status !== "rejected") {
                const k = l.customer_name || "—";
                customerBonus[k] = (customerBonus[k] || 0) + Number(l.total_value || 0);
              }
            }));
            const topCustomerBonus = Object.entries(customerBonus).sort((a, b) => b[1] - a[1])[0];
            const bonusPct = tot.sales > 0 ? (tot.bonuses / tot.sales) * 100 : 0;
            return (
              <div className="border rounded-lg p-3 bg-gradient-to-br from-slate-50 to-white space-y-2">
                <div className="text-xs font-semibold text-slate-700">لوحة المندوبين</div>
                <div className="grid grid-cols-2 md:grid-cols-7 gap-2 text-xs">
                  <div className="bg-white rounded p-2 border"><div className="text-muted-foreground">إجمالي البضاعة لدى المندوبين</div><div className="font-bold font-mono">{fmt(tot.goods)}</div></div>
                  <div className="bg-white rounded p-2 border"><div className="text-muted-foreground">إجمالي المبيعات</div><div className="font-bold font-mono text-emerald-700">{fmt(tot.sales)}</div></div>
                  <div className="bg-white rounded p-2 border"><div className="text-muted-foreground">إجمالي المرتجعات</div><div className="font-bold font-mono">{fmt(tot.returns)}</div></div>
                  <div className="bg-white rounded p-2 border"><div className="text-muted-foreground">إجمالي التحصيلات</div><div className="font-bold font-mono text-sky-700">{fmt(tot.collected)}</div></div>
                  <div className="bg-white rounded p-2 border"><div className="text-muted-foreground">إجمالي الخصومات</div><div className="font-bold font-mono text-rose-700">{fmt(tot.discounts)}</div></div>
                  <div className="bg-white rounded p-2 border"><div className="text-muted-foreground">🎁 إجمالي المجانيات</div><div className="font-bold font-mono text-fuchsia-700">{fmt(tot.bonuses)} <span className="text-[10px] text-muted-foreground">({bonusPct.toFixed(1)}%)</span></div></div>
                  <div className="bg-white rounded p-2 border"><div className="text-muted-foreground">المتبقي نقدية</div><div className="font-bold font-mono text-amber-700">{fmt(tot.cash)}</div></div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                  <div className="rounded p-2 bg-emerald-50 border border-emerald-200"><div className="text-muted-foreground">أعلى مبيعات</div><div className="font-bold">{topSales?.courier_name || "—"} • {fmt(topSales?.salesValue || 0)}</div></div>
                  <div className="rounded p-2 bg-rose-50 border border-rose-200"><div className="text-muted-foreground">أعلى خصومات</div><div className="font-bold">{topDisc?.courier_name || "—"} • {fmt(topDisc?.discountsValue || 0)}</div></div>
                  <div className="rounded p-2 bg-sky-50 border border-sky-200"><div className="text-muted-foreground">أعلى تحصيل</div><div className="font-bold">{topCash?.courier_name || "—"} • {fmt(topCash?.cashCollected || 0)}</div></div>
                  <div className="rounded p-2 bg-fuchsia-50 border border-fuchsia-200"><div className="text-muted-foreground">🎁 أعلى مجانيات</div><div className="font-bold">{topBonus?.courier_name || "—"} • {fmt(topBonus?.bonusValue || 0)}</div><div className="text-[10px] text-muted-foreground">أعلى عميل: {topCustomerBonus?.[0] || "—"} ({fmt(topCustomerBonus?.[1] || 0)})</div></div>
                  <div className="rounded p-2 bg-amber-50 border border-amber-200"><div className="text-muted-foreground">أعلى عجز/متبقي</div><div className="font-bold">{topDef?.courier_name || "—"} • {fmt(topDef?.remainingCash || 0)}</div></div>
                </div>
              </div>
            );
          })()}

          {custodySummary.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">لا توجد عهد مفتوحة</p>
          ) : custodySummary.map((c) => (

            <div key={c.id} className="border rounded-lg p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Package className="w-4 h-4 text-primary" />
                  <span className="font-bold">{c.courier_name}</span>
                  <Badge variant="outline" className={c.status === "open" ? "bg-emerald-100 text-emerald-700" : "bg-muted"}>
                    {c.status === "open" ? "مفتوحة" : "مغلقة"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">منذ {fmtDate(c.opened_at)}</span>
                </div>
                {c.status === "open" && canRecord && (
                  <div className="flex flex-wrap gap-1">
                   <Button size="sm" variant="outline" className="h-7" onClick={() => openLineDialog(c.id, "issue")}>صرف بضاعة</Button>
                   <Button size="sm" variant="outline" className="h-7" onClick={() => openLineDialog(c.id, "return")}>استرجاع</Button>
                   <Button size="sm" variant="outline" className="h-7" onClick={() => openLineDialog(c.id, "sale")}>تسجيل بيع</Button>
                   <Button size="sm" variant="outline" className="h-7 border-fuchsia-300 text-fuchsia-700 hover:bg-fuchsia-50" onClick={() => openLineDialog(c.id, "bonus")}>🎁 مجاني / بونص</Button>
                   <Button size="sm" variant="outline" className="h-7" onClick={() => openLineDialog(c.id, "cash_collect")}>تحصيل نقدية</Button>
                    <Button size="sm" variant="outline" className="h-7" onClick={() => openStatement(c)}>كشف حساب</Button>
                    {(isGeneralManager || isExecutiveManager || canRecord) && (
                      <Button size="sm" variant="outline" className="h-7" onClick={() => closeDay(c.id)}>إغلاق اليوم</Button>
                    )}
                    {(isGeneralManager || isExecutiveManager) && (
                      <Button size="sm" variant="outline" className="h-7" onClick={() => openProfileDialog(c.courier_name)}>إعدادات</Button>
                    )}
                    <Button size="sm" variant="outline" className="h-7 text-rose-600 border-rose-300" onClick={() => closeCustody(c.id)}>إغلاق العهدة</Button>
                  </div>
                )}
              </div>

              {/* Credit limit progress */}
              {c.creditLimit != null && (
                <div className="rounded border p-2 bg-slate-50 space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">الحد الائتماني: <b className="font-mono">{fmt(c.creditLimit)}</b></span>
                    <span className="text-muted-foreground">العهدة الحالية: <b className="font-mono">{fmt(c.remainingGoods)}</b></span>
                    <span className={(c.creditAvailable ?? 0) < 0 ? "text-rose-700 font-bold" : "text-emerald-700 font-bold"}>
                      المتبقي: <span className="font-mono">{fmt(c.creditAvailable ?? 0)}</span>
                    </span>
                  </div>
                  <div className="h-2 rounded bg-slate-200 overflow-hidden">
                    <div
                      className={`h-full ${(c.creditUsedPct ?? 0) >= 100 ? "bg-rose-600" : (c.creditUsedPct ?? 0) >= 80 ? "bg-amber-500" : "bg-emerald-500"}`}
                      style={{ width: `${Math.min(100, c.creditUsedPct ?? 0)}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
                <div className="bg-muted/40 rounded p-2"><div className="text-muted-foreground">قيمة المصروف</div><div className="font-bold font-mono">{fmt(c.goodsOutValue)}</div></div>
                <div className="bg-muted/40 rounded p-2"><div className="text-muted-foreground">قيمة المرتجع</div><div className="font-bold font-mono">{fmt(c.goodsReturnedValue)}</div></div>
                <div className="bg-muted/40 rounded p-2"><div className="text-muted-foreground">قيمة المبيعات</div><div className="font-bold font-mono text-emerald-700">{fmt(c.salesValue)}</div></div>
                <div className="bg-muted/40 rounded p-2"><div className="text-muted-foreground">نقدية محصّلة</div><div className="font-bold font-mono text-sky-700">{fmt(c.cashCollected)}</div></div>
                <div className="bg-fuchsia-50 rounded p-2 border border-fuchsia-100"><div className="text-muted-foreground">🎁 مجانيات</div><div className="font-bold font-mono text-fuchsia-700">{fmt(c.bonusValue || 0)} <span className="text-[10px]">({(c.bonusPct || 0).toFixed(1)}%)</span></div></div>
                <div className={`rounded p-2 ${Math.abs(c.remainingCash) < 0.01 && Math.abs(c.remainingGoods) < 0.01 ? "bg-emerald-50" : "bg-amber-50"}`}>
                  <div className="text-muted-foreground">المتبقي (بضائع / نقدية)</div>
                  <div className="font-bold font-mono">{fmt(c.remainingGoods)} / {fmt(c.remainingCash)}</div>
                </div>
              </div>

              {/* Commission summary */}
              {c.profile?.commission_type && c.profile.commission_type !== "none" && (
                <div className="border rounded p-2 bg-violet-50/50 text-xs flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <b className="text-violet-800">عمولة المندوب:</b>{" "}
                    {c.profile.commission_type === "percent_of_sales" ? `${c.profile.commission_value}% من المبيعات` :
                     c.profile.commission_type === "per_kg" ? `${c.profile.commission_value} ج/كجم` :
                     `${c.profile.commission_value} ج/صنف`}
                    {" • "}مستحقة: <b className="font-mono">{fmt(c.dueCommission)}</b>
                    {" • "}مصروفة: <b className="font-mono">{fmt(c.paidCommission)}</b>
                    {" • "}متبقي: <b className={`font-mono ${c.remainingCommission > 0 ? "text-amber-700" : "text-emerald-700"}`}>{fmt(c.remainingCommission)}</b>
                  </div>
                  {(isGeneralManager || isExecutiveManager) && c.remainingCommission > 0 && (
                    <Button size="sm" className="h-7" onClick={() => openPayCommission(c.courier_name, c.remainingCommission)}>صرف عمولة</Button>
                  )}
                </div>
              )}

              {/* Pending credit override approvals */}
              {(() => {
                const pendingCO = c.lines.filter((l: any) => l.line_type === "issue" && l.credit_override_status === "pending");
                if (pendingCO.length === 0) return null;
                return (
                  <div className="border border-rose-300 bg-rose-50 rounded p-2 space-y-1">
                    <div className="text-xs font-semibold text-rose-800">طلبات تجاوز الحد الائتماني بانتظار الاعتماد ({pendingCO.length})</div>
                    {pendingCO.map((l: any) => (
                      <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 text-xs bg-background rounded p-2 border">
                        <div><b>{l.product_name}</b> — كمية {l.quantity} {l.unit} • قيمة <b>{fmt(Number(l.total_value || 0))}</b></div>
                        {(isGeneralManager || isExecutiveManager) && (
                          <div className="flex gap-1">
                            <Button size="sm" className="h-7 px-2 bg-emerald-600 hover:bg-emerald-700" onClick={() => approveCreditOverride(l.id)}>
                              <CheckCircle2 className="w-3 h-3" />
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 px-2 text-rose-600 border-rose-300" onClick={() => rejectCreditOverride(l.id)}>
                              <XCircle className="w-3 h-3" />
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* Daily closures history */}
              {c.closures && c.closures.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground">إغلاقات يومية ({c.closures.length})</summary>
                  <div className="mt-2 border rounded overflow-x-auto">
                    <table className="w-full text-right">
                      <thead className="bg-muted/40">
                        <tr>
                          <th className="p-1">التاريخ</th><th className="p-1">مصروف</th><th className="p-1">مرتجع</th>
                          <th className="p-1">مبيعات</th><th className="p-1">خصم</th><th className="p-1">نقدية</th>
                          <th className="p-1">متبقي بضاعة</th><th className="p-1">متبقي نقدية</th>
                          <th className="p-1">الحالة</th><th className="p-1">إجراءات</th>
                        </tr>
                      </thead>
                      <tbody>
                        {c.closures.map((cl: any) => (
                          <tr key={cl.id} className="border-t">
                            <td className="p-1">{cl.closure_date}</td>
                            <td className="p-1 font-mono">{fmt(Number(cl.goods_out))}</td>
                            <td className="p-1 font-mono">{fmt(Number(cl.goods_returned))}</td>
                            <td className="p-1 font-mono">{fmt(Number(cl.sales_value))}</td>
                            <td className="p-1 font-mono">{fmt(Number(cl.discounts_value))}</td>
                            <td className="p-1 font-mono">{fmt(Number(cl.cash_collected))}</td>
                            <td className="p-1 font-mono">{fmt(Number(cl.remaining_goods))}</td>
                            <td className="p-1 font-mono">{fmt(Number(cl.remaining_cash))}</td>
                            <td className="p-1">
                              <Badge variant="outline" className={cl.status === "closed" ? "bg-slate-100" : "bg-amber-100 text-amber-800"}>
                                {cl.status === "closed" ? "مغلق" : "أُعيد الفتح"}
                              </Badge>
                            </td>
                            <td className="p-1">
                              {cl.status === "closed" && (isGeneralManager || isExecutiveManager) && (
                                <Button size="sm" variant="outline" className="h-6 px-2" onClick={() => reopenDay(cl.id)}>إعادة فتح</Button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}


              {/* Pending discount approvals banner */}
              {(() => {
                const pendingD = c.lines.filter((l: any) => l.line_type === "sale" && l.discount_status === "pending");
                if (pendingD.length === 0) return null;
                return (
                  <div className="border border-amber-300 bg-amber-50 rounded p-2 space-y-1">
                    <div className="text-xs font-semibold text-amber-800">خصومات بانتظار اعتماد المدير العام/التنفيذي ({pendingD.length})</div>
                    {pendingD.map((l: any) => (
                      <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 text-xs bg-background rounded p-2 border">
                        <div>
                          <b>{l.product_name}</b> — كمية {l.quantity} {l.unit} • سعر أصلي {fmt(Number(l.original_price))} → بيع {fmt(Number(l.unit_price))} •
                          خصم <b className="text-rose-700">{fmt(Number(l.discount_amount || 0))}</b> ({Number(l.discount_pct || 0).toFixed(1)}%) — {l.discount_reason}
                        </div>
                        {(isGeneralManager || isExecutiveManager) && (
                          <div className="flex gap-1">
                            <Button size="sm" className="h-7 px-2 bg-emerald-600 hover:bg-emerald-700" onClick={() => approveDiscount(l.id)}>
                              <CheckCircle2 className="w-3 h-3" />
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 px-2 text-rose-600 border-rose-300" onClick={() => rejectDiscount(l.id)}>
                              <XCircle className="w-3 h-3" />
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* Pending bonus approvals banner */}
              {(() => {
                const pendingB = c.lines.filter((l: any) => l.line_type === "bonus" && l.bonus_status === "pending");
                if (pendingB.length === 0) return null;
                return (
                  <div className="border border-fuchsia-300 bg-fuchsia-50 rounded p-2 space-y-1">
                    <div className="text-xs font-semibold text-fuchsia-800">🎁 مجانيات بانتظار الاعتماد ({pendingB.length})</div>
                    {pendingB.map((l: any) => (
                      <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 text-xs bg-background rounded p-2 border">
                        <div>
                          <b>{l.product_name}</b> — كمية {l.quantity} {l.unit} • قيمة <b className="text-fuchsia-700">{fmt(Number(l.total_value || 0))}</b>
                          {l.customer_name ? <> • عميل: <b>{l.customer_name}</b></> : null}
                          {l.bonus_reason ? <> • السبب: {l.bonus_reason}</> : null}
                        </div>
                        {(isGeneralManager || isExecutiveManager) && (
                          <div className="flex gap-1">
                            <Button size="sm" className="h-7 px-2 bg-emerald-600 hover:bg-emerald-700" onClick={() => approveBonus(l.id)}>
                              <CheckCircle2 className="w-3 h-3" />
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 px-2 text-rose-600 border-rose-300" onClick={() => rejectBonus(l.id)}>
                              <XCircle className="w-3 h-3" />
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })()}


              {c.lines.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground">عرض الحركات ({c.lines.length})</summary>
                  <div className="mt-2 border rounded overflow-x-auto">
                    <table className="w-full text-right">
                      <thead className="bg-muted/40">
                        <tr>
                          <th className="p-1">التاريخ</th>
                          <th className="p-1">النوع</th>
                          <th className="p-1">المنتج</th>
                          <th className="p-1">كمية</th>
                          <th className="p-1">سعر أصلي</th>
                          <th className="p-1">سعر فعلي</th>
                          <th className="p-1">خصم</th>
                          <th className="p-1">قيمة</th>
                          <th className="p-1">نقدية</th>
                          <th className="p-1">حالة الخصم</th>
                          <th className="p-1">ملاحظات</th>
                        </tr>
                      </thead>
                      <tbody>
                        {c.lines.map((l: any) => (
                          <tr key={l.id} className={`border-t ${l.line_type === "bonus" ? "bg-fuchsia-50/40" : ""}`}>
                            <td className="p-1 whitespace-nowrap">{fmtDate(l.performed_at)}</td>
                            <td className="p-1">
                              {l.line_type === "issue" ? "صرف" :
                               l.line_type === "return" ? "استرجاع" :
                               l.line_type === "sale" ? "بيع" :
                               l.line_type === "bonus" ? <span className="text-fuchsia-700">🎁 مجاني</span> :
                               "تحصيل نقدية"}
                            </td>
                            <td className="p-1">
                              {l.product_name || "—"}
                              {l.line_type === "bonus" && l.customer_name ? <div className="text-[10px] text-muted-foreground">عميل: {l.customer_name}</div> : null}
                            </td>
                            <td className="p-1 font-mono">{l.quantity ? `${l.quantity} ${l.unit || ""}` : "—"}</td>
                            <td className="p-1 font-mono">{l.original_price ? fmt(Number(l.original_price)) : (l.line_type === "sale" ? "—" : (l.unit_price ? fmt(Number(l.unit_price)) : "—"))}</td>
                            <td className="p-1 font-mono">{l.line_type === "sale" && l.unit_price ? fmt(Number(l.unit_price)) : "—"}</td>
                            <td className="p-1 font-mono text-rose-700">
                              {l.discount_amount ? `${fmt(Number(l.discount_amount))} (${Number(l.discount_pct || 0).toFixed(1)}%)` : "—"}
                            </td>
                            <td className="p-1 font-mono">{l.total_value ? fmt(Number(l.total_value)) : "—"}</td>
                            <td className="p-1 font-mono">{l.cash_collected ? fmt(Number(l.cash_collected)) : "—"}</td>
                            <td className="p-1">
                              {l.line_type === "bonus" ? (
                                <>
                                  {l.bonus_status === "auto_approved" ? <Badge variant="outline" className="bg-emerald-100 text-emerald-700">تلقائي</Badge> :
                                   l.bonus_status === "approved" ? <Badge variant="outline" className="bg-emerald-100 text-emerald-700">معتمد</Badge> :
                                   l.bonus_status === "rejected" ? <Badge variant="outline" className="bg-rose-100 text-rose-700">مرفوض</Badge> :
                                   <Badge variant="outline" className="bg-amber-100 text-amber-700">بانتظار اعتماد</Badge>}
                                  {l.bonus_reason ? <div className="text-[10px] text-muted-foreground">{l.bonus_reason}</div> : null}
                                </>
                              ) : l.line_type !== "sale" || !l.discount_status || l.discount_status === "none" ? "—" :
                               l.discount_status === "auto_approved" ? <Badge variant="outline" className="bg-emerald-100 text-emerald-700">تلقائي</Badge> :
                               l.discount_status === "approved" ? <Badge variant="outline" className="bg-emerald-100 text-emerald-700">معتمد</Badge> :
                               l.discount_status === "rejected" ? <Badge variant="outline" className="bg-rose-100 text-rose-700">مرفوض</Badge> :
                               <Badge variant="outline" className="bg-amber-100 text-amber-700">بانتظار اعتماد</Badge>}
                              {l.line_type === "sale" && l.discount_reason ? <div className="text-[10px] text-muted-foreground">{l.discount_reason}</div> : null}
                            </td>
                            <td className="p-1 text-muted-foreground">{l.notes || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                  </div>
                </details>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Bonus / Free items report */}
      {(() => {
        const bonusLines: any[] = [];
        custodySummary.forEach((c: any) => (c.lines || []).forEach((l: any) => {
          if (l.line_type === "bonus") bonusLines.push({ ...l, courier_name: c.courier_name });
        }));
        if (bonusLines.length === 0) return null;
        const totalQty = bonusLines.reduce((s, l) => s + Number(l.quantity || 0), 0);
        const totalVal = bonusLines.filter((l) => l.bonus_status !== "rejected").reduce((s, l) => s + Number(l.total_value || 0), 0);
        return (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                🎁 تقرير المجانيات / البونصات
                <Badge variant="outline" className="bg-fuchsia-50 text-fuchsia-700">{bonusLines.length} حركة</Badge>
                <Badge variant="outline" className="bg-fuchsia-100 text-fuchsia-800">قيمة: {fmt(totalVal)} ج.م</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="border rounded overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="p-2">التاريخ</th>
                      <th className="p-2">المندوب</th>
                      <th className="p-2">العميل</th>
                      <th className="p-2">الصنف</th>
                      <th className="p-2">الكمية</th>
                      <th className="p-2">قيمة التكلفة</th>
                      <th className="p-2">السبب</th>
                      <th className="p-2">الحالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bonusLines.map((l) => (
                      <tr key={l.id} className="border-t">
                        <td className="p-2 whitespace-nowrap">{fmtDate(l.performed_at)}</td>
                        <td className="p-2 font-semibold text-sky-700">{l.courier_name}</td>
                        <td className="p-2">{l.customer_name || "—"}</td>
                        <td className="p-2">{l.product_name || "—"}</td>
                        <td className="p-2 font-mono">{l.quantity} {l.unit || ""}</td>
                        <td className="p-2 font-mono text-fuchsia-700">{fmt(Number(l.total_value || 0))}</td>
                        <td className="p-2">{l.bonus_reason || "—"}</td>
                        <td className="p-2">
                          {l.bonus_status === "auto_approved" ? <Badge variant="outline" className="bg-emerald-100 text-emerald-700">تلقائي</Badge> :
                           l.bonus_status === "approved" ? <Badge variant="outline" className="bg-emerald-100 text-emerald-700">معتمد</Badge> :
                           l.bonus_status === "rejected" ? <Badge variant="outline" className="bg-rose-100 text-rose-700">مرفوض</Badge> :
                           <Badge variant="outline" className="bg-amber-100 text-amber-700">بانتظار اعتماد</Badge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-muted/30 font-semibold">
                    <tr>
                      <td className="p-2" colSpan={4}>الإجمالي</td>
                      <td className="p-2 font-mono">{fmt(totalQty)}</td>
                      <td className="p-2 font-mono text-fuchsia-700">{fmt(totalVal)}</td>
                      <td className="p-2" colSpan={2}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Movements table */}

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
            <CardTitle className="text-base">سجل الحركات</CardTitle>
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input placeholder="بحث (مرجع/ملاحظات/مستخدم)" value={search} onChange={(e) => setSearch(e.target.value)} className="pr-9 w-60" />
              </div>
              <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الحالات</SelectItem>
                  <SelectItem value="posted">مرحّل</SelectItem>
                  <SelectItem value="pending_approval">بانتظار الاعتماد</SelectItem>
                  <SelectItem value="rejected">مرفوض</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-muted/60 text-xs">
                <tr>
                  <th className="p-2">التاريخ</th>
                  <th className="p-2">النوع</th>
                  <th className="p-2">التصنيف</th>
                  <th className="p-2">المبلغ</th>
                  <th className="p-2">المرجع</th>
                  <th className="p-2">بواسطة</th>
                  <th className="p-2">ملاحظات</th>
                  <th className="p-2">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">
                    {loading ? "جاري التحميل..." : "لا توجد حركات"}
                  </td></tr>
                ) : filtered.map((r) => {
                  const isIn = r.direction === "in";
                  const st = STATUS_LABELS[r.status];
                  const StIcon = st?.Icon || CheckCircle2;
                  return (
                    <tr key={r.id} className={`border-t hover:bg-muted/30 ${r.status === "rejected" ? "opacity-60" : ""}`}>
                      <td className="p-2 text-xs whitespace-nowrap text-muted-foreground">{fmtDate(r.performed_at)}</td>
                      <td className="p-2">
                        <Badge className={`gap-1 ${isIn ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-600 hover:bg-rose-700"} text-white`}>
                          {isIn ? <ArrowDownLeft className="w-3 h-3" /> : <ArrowUpRight className="w-3 h-3" />}
                          {isIn ? "وارد" : "صادر"}
                        </Badge>
                      </td>
                      <td className="p-2 text-xs">{CATEGORY_LABELS[r.category] || r.category}</td>
                      <td className={`p-2 font-mono font-bold ${isIn ? "text-emerald-700" : "text-rose-700"}`}>
                        {isIn ? "+" : "-"}{fmt(Number(r.amount || 0))}
                      </td>
                      <td className="p-2 text-xs">{r.reference || "—"}</td>
                      <td className="p-2 text-xs">{r.performed_by_name || "—"}</td>
                      <td className="p-2 text-xs text-muted-foreground max-w-[260px] truncate" title={[r.courier_name ? `المندوب: ${r.courier_name}` : "", r.notes || "", r.rejection_reason ? `سبب الرفض: ${r.rejection_reason}` : ""].filter(Boolean).join(" • ")}>
                        {r.courier_name ? <span className="font-semibold text-sky-700">{r.courier_name}</span> : null}
                        {r.courier_name && r.notes ? " • " : ""}
                        {r.notes || (!r.courier_name ? "—" : "")}
                        {r.rejection_reason ? <span className="text-rose-600"> • {r.rejection_reason}</span> : null}
                      </td>

                      <td className="p-2">
                        <Badge variant="outline" className={`gap-1 ${st?.cls || ""}`}>
                          <StIcon className="w-3 h-3" /> {st?.txt || r.status}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Collect dialog */}
      <Dialog open={collectOpen} onOpenChange={setCollectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تسجيل تحصيل بيع مباشر</DialogTitle>
            <DialogDescription>أضف المبلغ المحصّل نقدًا للخزينة.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>المبلغ (ج.م)</Label><Input type="number" min="0" step="0.01" value={collectAmt} onChange={(e) => setCollectAmt(e.target.value)} /></div>
            <div><Label>المرجع (رقم طلب/فاتورة — اختياري)</Label><Input value={collectRef} onChange={(e) => setCollectRef(e.target.value)} /></div>
            <div><Label>ملاحظات</Label><Textarea rows={2} value={collectNotes} onChange={(e) => setCollectNotes(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCollectOpen(false)}>إلغاء</Button>
            <Button disabled={busy} onClick={submitCollect} className="bg-emerald-600 hover:bg-emerald-700">تسجيل</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Courier deposit dialog */}
      <Dialog open={courierOpen} onOpenChange={setCourierOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>توريد نقدية من مندوب</DialogTitle>
            <DialogDescription>تسجيل مبلغ مستلم من مندوب (مثال: كيمو) داخل خزينة المخزن الرئيسي.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>اسم المندوب</Label><Input value={courierName} onChange={(e) => setCourierName(e.target.value)} placeholder="مثال: كيمو" /></div>
            <div><Label>المبلغ (ج.م)</Label><Input type="number" min="0" step="0.01" value={courierAmt} onChange={(e) => setCourierAmt(e.target.value)} /></div>
            <div><Label>التاريخ</Label><Input type="date" value={courierDate} onChange={(e) => setCourierDate(e.target.value)} /></div>
            <div><Label>ملاحظات</Label><Textarea rows={2} value={courierNotes} onChange={(e) => setCourierNotes(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCourierOpen(false)}>إلغاء</Button>
            <Button disabled={busy} onClick={submitCourier} className="bg-sky-600 hover:bg-sky-700">تسجيل التوريد</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>



      {/* Transfer dialog */}
      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تحويل إلى الخزينة الرئيسية</DialogTitle>
            <DialogDescription>سيتم إرسال إشعار لمحمد شعلة لاعتماد التحويل.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm bg-muted/40 rounded-md p-2">الرصيد الحالي: <b>{fmt(kpis.balance)} ج.م</b></div>
            <div><Label>المبلغ (ج.م)</Label><Input type="number" min="0" step="0.01" value={transferAmt} onChange={(e) => setTransferAmt(e.target.value)} /></div>
            <div><Label>ملاحظات / سبب التحويل</Label><Textarea rows={2} value={transferNotes} onChange={(e) => setTransferNotes(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferOpen(false)}>إلغاء</Button>
            <Button disabled={busy} onClick={submitTransfer}>
              <Send className="w-4 h-4 ml-1" /> إرسال للاعتماد
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reconciliation dialog */}
      <Dialog open={reconOpen} onOpenChange={setReconOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تسجيل جرد خزينة المخزن الرئيسي</DialogTitle>
            <DialogDescription>يتم اعتماده من المدير العام / التنفيذي / محمد شعلة، وأي فرق يُسجَّل تلقائيًا كتسوية في الخزينة بعد الاعتماد.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm bg-muted/40 rounded-md p-2">الرصيد الدفتري الحالي: <b>{fmt(kpis.balance)} ج.م</b></div>
            <div><Label>النقدية الموجودة فعليًا (ج.م)</Label><Input type="number" min="0" step="0.01" value={reconPhysical} onChange={(e) => setReconPhysical(e.target.value)} /></div>
            {reconPhysical !== "" && (
              <div className="text-sm bg-amber-50 border border-amber-300 rounded p-2">
                الفرق: <b className={Number(reconPhysical) - kpis.balance >= 0 ? "text-sky-700" : "text-rose-700"}>{fmt(Number(reconPhysical) - kpis.balance)}</b> ج.م
              </div>
            )}
            <div><Label>سبب الفرق (إلزامي إذا كان هناك فرق)</Label><Textarea rows={2} value={reconReason} onChange={(e) => setReconReason(e.target.value)} /></div>
            <div><Label>ملاحظات إضافية</Label><Textarea rows={2} value={reconNotes} onChange={(e) => setReconNotes(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReconOpen(false)}>إلغاء</Button>
            <Button disabled={busy} onClick={submitRecon}>إرسال للاعتماد</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New custody dialog */}
      <Dialog open={newCustodyOpen} onOpenChange={setNewCustodyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>فتح عهدة بضائع جديدة</DialogTitle>
            <DialogDescription>تتبّع البضاعة المصروفة للمندوب حتى يبيعها أو يعيدها أو يحصّل قيمتها.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>اسم المندوب</Label><Input value={newCustodyName} onChange={(e) => setNewCustodyName(e.target.value)} placeholder="مثال: كيمو" /></div>
            <div><Label>ملاحظات</Label><Textarea rows={2} value={newCustodyNotes} onChange={(e) => setNewCustodyNotes(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewCustodyOpen(false)}>إلغاء</Button>
            <Button disabled={busy} onClick={submitNewCustody}>فتح العهدة</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Custody line dialog */}
      <Dialog open={lineOpen} onOpenChange={setLineOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {lineType === "issue" ? "صرف بضاعة للمندوب" :
               lineType === "return" ? "استرجاع بضاعة من المندوب" :
               lineType === "sale" ? "تسجيل بيع من بضاعة العهدة" :
               lineType === "bonus" ? "🎁 مجاني / بونص عميل" :
               "تحصيل نقدية من المندوب"}
            </DialogTitle>
            <DialogDescription>
              {lineType === "cash_collect" ? "سيتم إضافة المبلغ تلقائيًا كتوريد نقدية بخزينة المخزن الرئيسي." :
               lineType === "bonus" ? "لا تُسجَّل كبيع بسعر صفر، ولا تُضاف نقدية. تُخصم من عهدة المندوب وتظهر في تقرير المجانيات." :
               "تُسجَّل الحركة على عهدة المندوب لحساب المتبقي والعجز/الزيادة."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {lineType !== "cash_collect" && (
              <>
                {(lineType === "issue" || lineType === "bonus" || lineType === "sale") ? (
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <Label>المنتج من المخزن الرئيسي</Label>
                      {canRecord && (
                        <Button type="button" size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setAddProductOpen(true)}>
                          <Plus className="w-3 h-3" /> إضافة منتج جديد
                        </Button>
                      )}
                    </div>
                    <Select
                      value={lineInventoryItemId}
                      onValueChange={(value) => {
                        setLineInventoryItemId(value);
                        const item = allowedMainWarehouseItems.find((x) => x.id === value);
                        setLineProduct(item?.name || "");
                        setLineUnit(item?.unit || "كجم");
                        if (item?.unit_cost != null) setLinePrice(String(item.unit_cost));
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="اختر صنفًا من أصناف المخزن الرئيسي" />
                      </SelectTrigger>
                      <SelectContent>
                        {allowedMainWarehouseItems.map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {(item.name || "بدون اسم")} — رصيد: {fmt(Number(item.stock || 0))} {item.unit || ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <div><Label>المنتج</Label><Input value={lineProduct} onChange={(e) => setLineProduct(e.target.value)} placeholder="مثال: سجق نعام" /></div>
                )}
                <div className="grid grid-cols-3 gap-2">
                  <div><Label>الكمية</Label><Input type="number" min="0" step="0.001" value={lineQty} onChange={(e) => setLineQty(e.target.value)} /></div>
                  <div><Label>الوحدة</Label><Input value={lineUnit} onChange={(e) => setLineUnit(e.target.value)} /></div>
                  <div><Label>{lineType === "sale" ? "السعر الأصلي" : lineType === "bonus" ? "تكلفة الوحدة" : "سعر الوحدة"}</Label><Input type="number" min="0" step="0.01" value={linePrice} onChange={(e) => setLinePrice(e.target.value)} /></div>
                </div>
                {lineType === "bonus" && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div><Label>العميل</Label><Input value={lineCustomerName} onChange={(e) => setLineCustomerName(e.target.value)} placeholder="اسم العميل" /></div>
                      <div>
                        <Label>سبب المجاني</Label>
                        <Select value={lineBonusReason} onValueChange={setLineBonusReason}>
                          <SelectTrigger><SelectValue placeholder="اختر السبب" /></SelectTrigger>
                          <SelectContent>
                            {BONUS_REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    {(() => {
                      const q = Number(lineQty || 0), p = Number(linePrice || 0);
                      const bv = q * p;
                      const sum = custodySummary.find((s) => s.id === lineCustodyId);
                      const salesBase = Number(sum?.salesValue || 0);
                      const existing = Number((sum as any)?.bonusValue || 0);
                      const pct = salesBase > 0 ? ((existing + bv) / salesBase) * 100 : 100;
                      const status = pct <= 3 ? "auto" : pct <= 5 ? "executive" : "general";
                      return (
                        <div className={`text-xs rounded p-2 border ${status === "auto" ? "bg-emerald-50 border-emerald-200" : status === "executive" ? "bg-amber-50 border-amber-300" : "bg-rose-50 border-rose-300"}`}>
                          <div>قيمة المجاني (تكلفة): <b className="font-mono">{fmt(bv)}</b> ج.م</div>
                          <div>إجمالي المجانيات / المبيعات بعد الإضافة: <b>{pct.toFixed(2)}%</b></div>
                          <div className="font-semibold mt-1">
                            {status === "auto" ? "✓ اعتماد تلقائي (حتى 3%)" :
                             status === "executive" ? "⚠️ يتطلب اعتماد المدير التنفيذي (> 3% وحتى 5%)" :
                             "⛔ يتطلب اعتماد المدير العام (> 5%)"}
                          </div>
                        </div>
                      );
                    })()}
                  </>
                )}
                {lineType === "sale" && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div><Label>اسم العميل</Label><Input value={lineCustomerName} onChange={(e) => setLineCustomerName(e.target.value)} placeholder="اسم العميل" /></div>
                      <div><Label>رقم التليفون</Label><Input type="tel" inputMode="tel" value={lineCustomerPhone} onChange={(e) => setLineCustomerPhone(e.target.value)} placeholder="01xxxxxxxxx" /></div>
                    </div>
                    <div><Label>سعر البيع الفعلي للوحدة</Label><Input type="number" min="0" step="0.01" value={lineSalePrice} onChange={(e) => setLineSalePrice(e.target.value)} /></div>
                    {Number(lineQty) > 0 && Number(linePrice) > 0 && Number(lineSalePrice) > 0 && (() => {
                      const q = Number(lineQty), p = Number(linePrice), sp = Number(lineSalePrice);
                      const dAmt = Math.max(0, (p - sp) * q);
                      const dPct = p > 0 ? Math.max(0, ((p - sp) / p) * 100) : 0;
                      const needsApproval = dPct > discountThresholdPct && !(isGeneralManager || isExecutiveManager);
                      return (
                        <div className={`text-xs rounded p-2 ${dAmt > 0 ? (needsApproval ? "bg-amber-50 border border-amber-300" : "bg-muted/40") : "bg-muted/40"}`}>
                          <div>قيمة البيع: <b>{fmt(q * sp)}</b> ج.م</div>
                          {dAmt > 0 && (
                            <div>
                              قيمة الخصم: <b className="text-rose-700">{fmt(dAmt)}</b> ج.م ({dPct.toFixed(1)}%)
                              {needsApproval && <span className="text-amber-700 mr-2">— يتجاوز الحد المسموح ({discountThresholdPct}%)، يتطلب اعتماد المدير العام/التنفيذي.</span>}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    {Number(linePrice) > 0 && Number(lineSalePrice) > 0 && Number(linePrice) > Number(lineSalePrice) && (
                      <div>
                        <Label>سبب الخصم</Label>
                        <Select value={lineDiscountReason} onValueChange={setLineDiscountReason}>
                          <SelectTrigger><SelectValue placeholder="اختر السبب" /></SelectTrigger>
                          <SelectContent>
                            {DISCOUNT_REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </>
                )}
                {lineType !== "sale" && Number(lineQty) > 0 && Number(linePrice) > 0 && (
                  <div className="text-sm bg-muted/40 rounded p-2">القيمة: <b>{fmt(Number(lineQty) * Number(linePrice))}</b> ج.م</div>
                )}
              </>
            )}
            {lineType === "cash_collect" && (
              <div><Label>المبلغ المحصّل (ج.م)</Label><Input type="number" min="0" step="0.01" value={lineCash} onChange={(e) => setLineCash(e.target.value)} /></div>
            )}
            {lineType === "issue" && lineCustodyId && (() => {
              const sum = custodySummary.find((s) => s.id === lineCustodyId);
              if (!sum?.creditLimit) return null;
              const q = Number(lineQty || 0), p = Number(linePrice || 0);
              const add = q * p;
              const projected = (sum.remainingGoods || 0) + add;
              const over = projected > sum.creditLimit;
              return (
                <div className={`rounded p-2 text-xs ${over ? "bg-rose-50 border border-rose-300" : "bg-slate-50 border"}`}>
                  <div>الحد: <b className="font-mono">{fmt(sum.creditLimit)}</b> • العهدة بعد الصرف: <b className={`font-mono ${over ? "text-rose-700" : ""}`}>{fmt(projected)}</b></div>
                  {over && (
                    <>
                      <div className="text-rose-700 font-bold mt-1">⚠️ هذا الصرف يتجاوز الحد الائتماني للمندوب.</div>
                      {!(isGeneralManager || isExecutiveManager) && (
                        <label className="flex items-center gap-2 mt-1">
                          <input type="checkbox" checked={requestCreditOverride} onChange={(e) => setRequestCreditOverride(e.target.checked)} />
                          <span>طلب اعتماد تجاوز من المدير العام/التنفيذي</span>
                        </label>
                      )}
                    </>
                  )}
                </div>
              );
            })()}
            <div><Label>ملاحظات</Label><Textarea rows={2} value={lineNotes} onChange={(e) => setLineNotes(e.target.value)} /></div>

          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setLineOpen(false)}>إلغاء</Button>
            <Button disabled={busy} onClick={submitLine}>تسجيل</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* === Profile dialog: credit limit + commission === */}
      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إعدادات المندوب — {profileCourier}</DialogTitle>
            <DialogDescription>الحد الائتماني وعمولة المندوب (المدير العام/التنفيذي فقط).</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>الحد الائتماني (ج.م)</Label>
              <Input type="number" min="0" step="0.01" value={profileLimit} onChange={(e) => setProfileLimit(e.target.value)} placeholder="اتركه فارغًا بدون حد" />
            </div>
            <div>
              <Label>نوع العمولة</Label>
              <Select value={profileCommType} onValueChange={(v) => setProfileCommType(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">بدون عمولة</SelectItem>
                  <SelectItem value="percent_of_sales">نسبة من المبيعات (%)</SelectItem>
                  <SelectItem value="per_kg">مبلغ ثابت لكل كيلو</SelectItem>
                  <SelectItem value="per_item">مبلغ ثابت لكل صنف</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {profileCommType !== "none" && (
              <div>
                <Label>{profileCommType === "percent_of_sales" ? "النسبة %" : profileCommType === "per_kg" ? "ج / كجم" : "ج / صنف"}</Label>
                <Input type="number" min="0" step="0.0001" value={profileCommValue} onChange={(e) => setProfileCommValue(e.target.value)} />
              </div>
            )}
            <div><Label>ملاحظات</Label><Textarea rows={2} value={profileNotes} onChange={(e) => setProfileNotes(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProfileOpen(false)}>إلغاء</Button>
            <Button disabled={busy || !(isGeneralManager || isExecutiveManager)} onClick={saveProfile}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* === Pay commission dialog === */}
      <Dialog open={payCommOpen} onOpenChange={setPayCommOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>صرف عمولة — {payCommCourier}</DialogTitle>
            <DialogDescription>سيتم خصم المبلغ من خزينة المخزن الرئيسي.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>المبلغ (ج.م)</Label><Input type="number" min="0" step="0.01" value={payCommAmt} onChange={(e) => setPayCommAmt(e.target.value)} /></div>
            <div><Label>ملاحظات</Label><Textarea rows={2} value={payCommNotes} onChange={(e) => setPayCommNotes(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayCommOpen(false)}>إلغاء</Button>
            <Button disabled={busy} onClick={submitPayCommission}>صرف</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* === Statement dialog === */}
      <Dialog open={stmtOpen} onOpenChange={setStmtOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>كشف حساب المندوب — {stmtCustody?.courier_name}</DialogTitle>
            <DialogDescription>عرض/طباعة/تصدير حركات المندوب خلال فترة محددة.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 items-end">
              <div><Label>من تاريخ</Label><Input type="date" value={stmtFrom} onChange={(e) => setStmtFrom(e.target.value)} /></div>
              <div><Label>إلى تاريخ</Label><Input type="date" value={stmtTo} onChange={(e) => setStmtTo(e.target.value)} /></div>
              <Button variant="outline" onClick={exportStatementExcel}>تصدير Excel</Button>
              <Button variant="outline" onClick={printStatement}>طباعة / PDF</Button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-7 gap-2 text-xs">
              <div className="bg-muted/40 rounded p-2"><div className="text-muted-foreground">مصروف</div><div className="font-bold font-mono">{fmt(stmtTotals.issue)}</div></div>
              <div className="bg-muted/40 rounded p-2"><div className="text-muted-foreground">مرتجع</div><div className="font-bold font-mono">{fmt(stmtTotals.ret)}</div></div>
              <div className="bg-muted/40 rounded p-2"><div className="text-muted-foreground">مبيعات</div><div className="font-bold font-mono text-emerald-700">{fmt(stmtTotals.sale)}</div></div>
              <div className="bg-muted/40 rounded p-2"><div className="text-muted-foreground">خصومات</div><div className="font-bold font-mono text-rose-700">{fmt(stmtTotals.disc)}</div></div>
              <div className="bg-fuchsia-50 rounded p-2"><div className="text-muted-foreground">🎁 مجانيات</div><div className="font-bold font-mono text-fuchsia-700">{fmt(stmtTotals.bonus)}</div></div>
              <div className="bg-muted/40 rounded p-2"><div className="text-muted-foreground">نقدية</div><div className="font-bold font-mono text-sky-700">{fmt(stmtTotals.cash)}</div></div>
              <div className="bg-amber-50 rounded p-2"><div className="text-muted-foreground">متبقي بضاعة</div><div className="font-bold font-mono">{fmt(stmtTotals.remainingGoods)}</div></div>
              <div className="bg-amber-50 rounded p-2"><div className="text-muted-foreground">متبقي نقدية</div><div className="font-bold font-mono">{fmt(stmtTotals.remainingCash)}</div></div>
            </div>
            <div className="max-h-[400px] overflow-auto border rounded">
              <table className="w-full text-xs text-right">
                <thead className="bg-muted/40 sticky top-0">
                  <tr>
                    <th className="p-1">التاريخ</th><th className="p-1">النوع</th><th className="p-1">الصنف</th>
                    <th className="p-1">كمية</th><th className="p-1">سعر</th><th className="p-1">خصم</th>
                    <th className="p-1">قيمة</th><th className="p-1">نقدية</th>
                  </tr>
                </thead>
                <tbody>
                  {stmtRows.length === 0 ? (
                    <tr><td colSpan={8} className="p-4 text-center text-muted-foreground">لا توجد حركات</td></tr>
                  ) : stmtRows.map((l: any) => (
                    <tr key={l.id} className="border-t">
                      <td className="p-1 whitespace-nowrap">{fmtDate(l.performed_at)}</td>
                      <td className="p-1">{l.line_type === "issue" ? "صرف" : l.line_type === "return" ? "مرتجع" : l.line_type === "sale" ? "بيع" : l.line_type === "bonus" ? "🎁 مجاني" : "تحصيل"}</td>
                      <td className="p-1">{l.product_name || "—"}</td>
                      <td className="p-1 font-mono">{l.quantity ? `${l.quantity} ${l.unit || ""}` : "—"}</td>
                      <td className="p-1 font-mono">{l.unit_price ? fmt(Number(l.unit_price)) : "—"}</td>
                      <td className="p-1 font-mono">{l.discount_amount ? fmt(Number(l.discount_amount)) : "—"}</td>
                      <td className="p-1 font-mono font-bold">{l.total_value ? fmt(Number(l.total_value)) : "—"}</td>
                      <td className="p-1 font-mono">{l.cash_collected ? fmt(Number(l.cash_collected)) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStmtOpen(false)}>إغلاق</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>


  );
}
