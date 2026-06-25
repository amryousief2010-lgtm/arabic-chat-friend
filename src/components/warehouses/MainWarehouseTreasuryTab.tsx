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

const CATEGORY_LABELS: Record<string, string> = {
  direct_sale_cash: "تحصيل بيع مباشر",
  courier_deposit: "توريد نقدية من مندوب",
  transfer_to_main_treasury: "تحويل للخزينة الرئيسية",
  manual_adjust: "تسوية يدوية",
  opening_balance: "رصيد افتتاحي",
  other: "أخرى",
};


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
  const [lineType, setLineType] = useState<"issue" | "return" | "sale" | "cash_collect">("issue");
  const [lineProduct, setLineProduct] = useState("");
  const [lineQty, setLineQty] = useState("");
  const [lineUnit, setLineUnit] = useState("كجم");
  const [linePrice, setLinePrice] = useState("");
  const [lineCash, setLineCash] = useState("");
  const [lineNotes, setLineNotes] = useState("");




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

  useEffect(() => { fetchAll(); fetchRecons(); fetchCustodies(); /* eslint-disable-next-line */ }, []);

  const fetchRecons = async () => {
    const { data } = await (supabase as any)
      .from("main_warehouse_reconciliations")
      .select("*")
      .order("performed_at", { ascending: false })
      .limit(100);
    setRecons(data || []);
  };

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
    } else {
      setCustodyLines([]);
    }
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
        if (t.category === "transfer_to_main_treasury") transferred += amt;
      }
      if (isPending && t.category === "transfer_to_main_treasury") pending += amt;
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
        category: "transfer_to_main_treasury",
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
    if (!window.confirm(`اعتماد التحويل ${fmt(t.amount)} ج.م؟ سيتم إضافة المبلغ للخزينة الرئيسية.`)) return;
    setBusy(true);
    try {
      const { error } = await (supabase as any).rpc("approve_main_warehouse_transfer", { _txn_id: t.id });
      if (error) throw error;
      toast({ title: "تم اعتماد التحويل", description: "تمت إضافة المبلغ للخزينة الرئيسية" });
      await fetchAll();
    } catch (e: any) {
      toast({ title: "تعذّر الاعتماد", description: e?.message || "", variant: "destructive" });
    } finally { setBusy(false); }
  };

  const rejectTransfer = async (t: Txn) => {
    if (!canApprove) return;
    const reason = window.prompt("سبب الرفض:", "") || "";
    if (!reason.trim()) { toast({ title: "أدخل سبب الرفض", variant: "destructive" }); return; }
    if (!window.confirm(`رفض التحويل ${fmt(t.amount)} ج.م؟`)) return;
    setBusy(true);
    try {
      const { error } = await (supabase as any).rpc("reject_main_warehouse_transfer", { _txn_id: t.id, _reason: reason });
      if (error) throw error;
      toast({ title: "تم رفض التحويل" });
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
    setLineProduct(""); setLineQty(""); setLinePrice(""); setLineCash(""); setLineNotes(""); setLineUnit("كجم");
    setLineOpen(true);
  };

  const submitLine = async () => {
    if (!lineCustodyId) return;
    const qty = Number(lineQty || 0);
    const price = Number(linePrice || 0);
    const cash = Number(lineCash || 0);
    if (lineType !== "cash_collect") {
      if (!lineProduct.trim()) { toast({ title: "أدخل اسم المنتج", variant: "destructive" }); return; }
      if (!qty || qty <= 0) { toast({ title: "أدخل كمية صحيحة", variant: "destructive" }); return; }
    } else {
      if (!cash || cash <= 0) { toast({ title: "أدخل مبلغ نقدية صحيح", variant: "destructive" }); return; }
    }
    setBusy(true);
    try {
      const total = qty * price;
      const { error } = await (supabase as any).from("courier_goods_custody_lines").insert({
        custody_id: lineCustodyId,
        line_type: lineType,
        product_name: lineType === "cash_collect" ? null : lineProduct.trim(),
        quantity: lineType === "cash_collect" ? null : qty,
        unit: lineType === "cash_collect" ? null : lineUnit,
        unit_price: lineType === "cash_collect" ? null : (price || null),
        total_value: lineType === "cash_collect" ? null : (total || null),
        cash_collected: lineType === "cash_collect" ? cash : null,
        notes: lineNotes.trim() || null,
        performed_by: user?.id,
      });
      if (error) throw error;
      // If it's cash_collect, also push into treasury as courier deposit
      if (lineType === "cash_collect") {
        const courier = custodies.find((c) => c.id === lineCustodyId)?.courier_name || "مندوب";
        await (supabase as any).from("main_warehouse_treasury_txns").insert({
          direction: "in", category: "courier_deposit", amount: cash,
          courier_name: courier, notes: `تحصيل من عهدة بضائع — ${lineNotes.trim() || ""}`.trim(),
          performed_by: user?.id, status: "posted",
        });
        await fetchAll();
      }
      toast({ title: "تم التسجيل" });
      setLineOpen(false);
      await fetchCustodies();
    } catch (e: any) {
      toast({ title: "تعذّر التسجيل", description: e?.message || "", variant: "destructive" });
    } finally { setBusy(false); }
  };

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

  // Per-courier custody summary
  const custodySummary = useMemo(() => {
    return custodies.map((c) => {
      const lines = custodyLines.filter((l) => l.custody_id === c.id);
      let goodsOutValue = 0, goodsReturnedValue = 0, salesValue = 0, cashCollected = 0;
      lines.forEach((l) => {
        const tv = Number(l.total_value || 0);
        if (l.line_type === "issue") goodsOutValue += tv;
        else if (l.line_type === "return") goodsReturnedValue += tv;
        else if (l.line_type === "sale") salesValue += tv;
        else if (l.line_type === "cash_collect") cashCollected += Number(l.cash_collected || 0);
      });
      const remainingGoods = goodsOutValue - goodsReturnedValue - salesValue;
      const remainingCash = salesValue - cashCollected;
      return { ...c, lines, goodsOutValue, goodsReturnedValue, salesValue, cashCollected, remainingGoods, remainingCash };
    });
  }, [custodies, custodyLines]);

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

  const pendingTransfers = rows.filter(r => r.status === "pending_approval" && r.category === "transfer_to_main_treasury");

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
    </div>
  );
}
