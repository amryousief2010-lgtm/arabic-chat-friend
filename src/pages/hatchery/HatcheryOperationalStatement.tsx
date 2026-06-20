// كشف حساب تشغيل معمل التفريخ للعملاء
// Read-only operational statement. Pulls from hatchery_batches, hatchery_batch_lots,
// hatchery_client_invoices, hatchery_invoice_payments. Does NOT mutate any data.
import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  FileSpreadsheet, Printer, FileText, AlertTriangle, Users, Download,
} from "lucide-react";
import * as XLSX from "xlsx";
import { openPrintWindow, escapeHtml } from "@/lib/printPdf";
import { supabase } from "@/integrations/supabase/client";

// ---------- Types ----------
interface Lot {
  id: string;
  batch_id: string;
  client_id: string | null;
  client_name_snapshot: string | null;
  owner_type: string;
  eggs_in: number | null;
  infertile_eggs: number | null;
  fertile_eggs: number | null;
  transferred_count: number | null;
  completed_unhatched: number | null;
  chicks_hatched: number | null;
  hatch_mortality_count: number | null;
  brooding_days: number | null;
  candling_recorded_at: string | null;
  transferred_to_hatcher_at: string | null;
  hatcher_out_at: string | null;
  brooding_in_at: string | null;
  brooding_out_at: string | null;
  invoice_id: string | null;
  cancelled: boolean;
}
interface Batch {
  id: string;
  batch_number: string;
  entry_date: string;
  status: string;
}
interface Invoice {
  id: string;
  lot_id: string | null;
  invoice_no: string;
  eggs_in: number;
  infertile_count: number; infertile_amount: number;
  completed_unhatched_count: number; completed_unhatched_amount: number;
  hatch_mortality_count: number; hatch_mortality_amount: number;
  chicks_count: number; chicks_amount: number;
  brooding_chicks_count: number; brooding_days: number; brooding_amount: number;
  total_amount: number; paid_amount: number; remaining_amount: number;
  discount_amount: number; carryover_in_amount: number; carryover_out_amount: number;
  payment_status: "unpaid" | "partial" | "paid";
  notes: string | null;
}
interface Customer { id: string; name: string; phone: string | null; }
interface Pricing {
  infertile_egg_price: number;
  chick_price: number;
  completed_unhatched_price: number;
  daily_brooding_price: number;
  hatch_mortality_price: number;
}

// ---------- Helpers ----------
const num = (v: any) => Number(v ?? 0) || 0;
const fmt = (n: number) => Math.round(n || 0).toLocaleString("ar-EG-u-nu-latn");
const fmtMoney = (n: number) => `${fmt(n)} ج.م`;
const today = () => new Date().toISOString().slice(0, 10);
const DEFAULT_FROM = "2026-01-01";

function weekKey(dateStr: string): string {
  // ISO-week-like: Monday start. Returns key "YYYY-Wxx" and Monday date.
  const d = new Date(dateStr + "T00:00:00Z");
  const day = d.getUTCDay() || 7; // 1..7 (Mon..Sun)
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return d.toISOString().slice(0, 10);
}
function weekRange(monday: string): string {
  const d = new Date(monday + "T00:00:00Z");
  const e = new Date(d);
  e.setUTCDate(e.getUTCDate() + 6);
  return `${monday} → ${e.toISOString().slice(0, 10)}`;
}

interface Row {
  lot: Lot;
  batch: Batch | undefined;
  invoice: Invoice | undefined;
  // computed fees
  fees: {
    infCount: number; infAmt: number;
    unCount: number; unAmt: number;
    hmCount: number; hmAmt: number;
    chCount: number; chAmt: number;
    brDays: number; brAmt: number;
    total: number; paid: number; remaining: number;
    status: "unpaid" | "partial" | "paid" | "in_progress";
  };
  derivedTotalEggs: number;
  derivedChicks: number;
}

function buildRow(lot: Lot, batch: Batch | undefined, invoice: Invoice | undefined, pricing: Pricing | null): Row {
  let fees: Row["fees"];
  if (invoice) {
    fees = {
      infCount: num(invoice.infertile_count), infAmt: num(invoice.infertile_amount),
      unCount: num(invoice.completed_unhatched_count), unAmt: num(invoice.completed_unhatched_amount),
      hmCount: num(invoice.hatch_mortality_count), hmAmt: num(invoice.hatch_mortality_amount),
      chCount: num(invoice.chicks_count), chAmt: num(invoice.chicks_amount),
      brDays: num(invoice.brooding_days), brAmt: num(invoice.brooding_amount),
      total: num(invoice.total_amount), paid: num(invoice.paid_amount),
      remaining: num(invoice.remaining_amount ?? (num(invoice.total_amount) - num(invoice.paid_amount))),
      status: invoice.payment_status,
    };
  } else {
    const eggs = num(lot.eggs_in);
    const inf = num(lot.infertile_eggs);
    const un = num(lot.completed_unhatched);
    const ch = num(lot.chicks_hatched);
    const transferred = num(lot.transferred_count) || num(lot.fertile_eggs) || Math.max(0, eggs - inf);
    const hm = num(lot.hatch_mortality_count) || Math.max(0, transferred - ch - un);
    let brDays = num(lot.brooding_days);
    if (!brDays && lot.hatcher_out_at) {
      const start = new Date(lot.hatcher_out_at.slice(0, 10));
      const end = new Date((lot.brooding_out_at || today()).slice(0, 10));
      brDays = Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
    }
    const p = pricing || { infertile_egg_price: 50, chick_price: 150, completed_unhatched_price: 100, daily_brooding_price: 10, hatch_mortality_price: 100 };
    const infAmt = inf * num(p.infertile_egg_price);
    const unAmt = un * num(p.completed_unhatched_price);
    const hmAmt = hm * num(p.hatch_mortality_price);
    const chAmt = ch * num(p.chick_price);
    const brAmt = ch * brDays * num(p.daily_brooding_price);
    const total = infAmt + unAmt + hmAmt + chAmt + brAmt;
    fees = {
      infCount: inf, infAmt, unCount: un, unAmt, hmCount: hm, hmAmt,
      chCount: ch, chAmt, brDays, brAmt,
      total, paid: 0, remaining: total, status: "in_progress",
    };
  }
  return {
    lot, batch, invoice, fees,
    derivedTotalEggs: num(lot.eggs_in),
    derivedChicks: num(lot.chicks_hatched),
  };
}

const STATUS_LABEL: Record<string, string> = {
  unpaid: "غير مدفوعة",
  partial: "مدفوعة جزئيًا",
  paid: "مدفوعة",
  in_progress: "قيد التشغيل",
};
const STATUS_COLOR: Record<string, string> = {
  unpaid: "bg-rose-600",
  partial: "bg-amber-500",
  paid: "bg-emerald-600",
  in_progress: "bg-slate-500",
};

// ---------- Component ----------
export default function HatcheryOperationalStatement() {
  const [lots, setLots] = useState<Lot[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [loading, setLoading] = useState(true);

  const [customerId, setCustomerId] = useState<string>("");
  const [from, setFrom] = useState<string>(DEFAULT_FROM);
  const [to, setTo] = useState<string>("");
  const [batchFrom, setBatchFrom] = useState<string>("");
  const [batchTo, setBatchTo] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  useEffect(() => {
    (async () => {
      setLoading(true);
      // Batches
      const allBatches: Batch[] = [];
      let off = 0;
      while (true) {
        const { data, error } = await supabase
          .from("hatchery_batches")
          .select("id,batch_number,entry_date,status")
          .order("entry_date", { ascending: true })
          .range(off, off + 999);
        if (error) break;
        allBatches.push(...((data ?? []) as any));
        if (!data || data.length < 1000) break;
        off += 1000;
      }
      setBatches(allBatches);

      // Lots
      const allLots: Lot[] = [];
      off = 0;
      while (true) {
        const { data, error } = await supabase
          .from("hatchery_batch_lots")
          .select("id,batch_id,client_id,client_name_snapshot,owner_type,eggs_in,infertile_eggs,fertile_eggs,transferred_count,completed_unhatched,chicks_hatched,hatch_mortality_count,brooding_days,candling_recorded_at,transferred_to_hatcher_at,hatcher_out_at,brooding_in_at,brooding_out_at,invoice_id,cancelled")
          .eq("cancelled", false)
          .range(off, off + 999);
        if (error) break;
        allLots.push(...((data ?? []) as any));
        if (!data || data.length < 1000) break;
        off += 1000;
      }
      setLots(allLots);

      // Invoices
      const allInv: Invoice[] = [];
      off = 0;
      while (true) {
        const { data, error } = await supabase
          .from("hatchery_client_invoices")
          .select("id,lot_id,invoice_no,eggs_in,infertile_count,infertile_amount,completed_unhatched_count,completed_unhatched_amount,hatch_mortality_count,hatch_mortality_amount,chicks_count,chicks_amount,brooding_chicks_count,brooding_days,brooding_amount,total_amount,paid_amount,remaining_amount,discount_amount,carryover_in_amount,carryover_out_amount,payment_status,notes")
          .range(off, off + 999);
        if (error) break;
        allInv.push(...((data ?? []) as any));
        if (!data || data.length < 1000) break;
        off += 1000;
      }
      setInvoices(allInv);

      const { data: cs } = await supabase
        .from("hatch_customers")
        .select("id,name,phone")
        .order("name");
      setCustomers((cs ?? []) as any);

      const { data: pr } = await supabase
        .from("hatchery_pricing_settings")
        .select("*")
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      setPricing((pr as any) ?? null);

      setLoading(false);
    })();
  }, []);

  const batchById = useMemo(() => {
    const m = new Map<string, Batch>();
    batches.forEach((b) => m.set(b.id, b));
    return m;
  }, [batches]);
  const invoiceByLot = useMemo(() => {
    const m = new Map<string, Invoice>();
    invoices.forEach((i) => { if (i.lot_id) m.set(i.lot_id, i); });
    return m;
  }, [invoices]);
  const customerById = useMemo(() => {
    const m = new Map<string, Customer>();
    customers.forEach((c) => m.set(c.id, c));
    return m;
  }, [customers]);

  const maxEntryDate = useMemo(() => {
    let max = "";
    for (const b of batches) if (b.entry_date && b.entry_date > max) max = b.entry_date;
    return max;
  }, [batches]);
  const effectiveTo = to || maxEntryDate || today();

  const rows: Row[] = useMemo(() => {
    if (!customerId) return [];
    const out: Row[] = [];
    for (const lot of lots) {
      if (lot.client_id !== customerId) continue;
      const batch = batchById.get(lot.batch_id);
      if (!batch || !batch.entry_date) continue;
      if (batch.entry_date < from) continue;
      if (batch.entry_date > effectiveTo) continue;
      if (batchFrom && batch.batch_number < batchFrom) continue;
      if (batchTo && batch.batch_number > batchTo) continue;
      const invoice = invoiceByLot.get(lot.id);
      const row = buildRow(lot, batch, invoice, pricing);
      if (statusFilter !== "all") {
        if (statusFilter === "completed" && !lot.brooding_out_at) continue;
        if (statusFilter === "in_progress" && row.fees.status !== "in_progress") continue;
        if (["unpaid", "partial", "paid"].includes(statusFilter) && row.fees.status !== statusFilter) continue;
        if (statusFilter === "received" && !lot.brooding_out_at) continue;
      }
      out.push(row);
    }
    out.sort((a, b) => (a.batch?.entry_date || "").localeCompare(b.batch?.entry_date || ""));
    return out;
  }, [customerId, lots, batchById, invoiceByLot, pricing, from, effectiveTo, batchFrom, batchTo, statusFilter]);

  const totals = useMemo(() => rows.reduce((a, r) => ({
    eggs: a.eggs + r.derivedTotalEggs,
    inf: a.inf + r.fees.infCount,
    un: a.un + r.fees.unCount,
    hm: a.hm + r.fees.hmCount,
    chicks: a.chicks + r.fees.chCount,
    brDays: a.brDays + r.fees.brDays,
    total: a.total + r.fees.total,
    paid: a.paid + r.fees.paid,
    remaining: a.remaining + r.fees.remaining,
  }), { eggs: 0, inf: 0, un: 0, hm: 0, chicks: 0, brDays: 0, total: 0, paid: 0, remaining: 0 }), [rows]);

  const weekRows = useMemo(() => {
    const map = new Map<string, { wk: string; eggs: number; inf: number; un: number; hm: number; chicks: number; total: number; paid: number; remaining: number; batches: number; }>();
    for (const r of rows) {
      const d = r.batch?.entry_date;
      if (!d) continue;
      const wk = weekKey(d);
      const cur = map.get(wk) || { wk, eggs: 0, inf: 0, un: 0, hm: 0, chicks: 0, total: 0, paid: 0, remaining: 0, batches: 0 };
      cur.eggs += r.derivedTotalEggs;
      cur.inf += r.fees.infCount;
      cur.un += r.fees.unCount;
      cur.hm += r.fees.hmCount;
      cur.chicks += r.fees.chCount;
      cur.total += r.fees.total;
      cur.paid += r.fees.paid;
      cur.remaining += r.fees.remaining;
      cur.batches += 1;
      map.set(wk, cur);
    }
    return [...map.values()].sort((a, b) => a.wk.localeCompare(b.wk));
  }, [rows]);

  const selectedCustomer = customerId ? customerById.get(customerId) : undefined;

  // ----- Export Excel (one customer) -----
  const exportExcel = () => {
    if (!selectedCustomer) return;
    const wb = XLSX.utils.book_new();
    const data = rows.map((r, i) => ({
      "م": i + 1,
      "رقم الدفعة": r.batch?.batch_number || "—",
      "تاريخ الدخول": r.batch?.entry_date || "—",
      "تاريخ الكشف الأول": r.lot.candling_recorded_at?.slice(0, 10) || "—",
      "تاريخ الكشف الثاني / النقل للهاتشر": r.lot.transferred_to_hatcher_at?.slice(0, 10) || "—",
      "تاريخ الفقس": r.lot.hatcher_out_at?.slice(0, 10) || "—",
      "تاريخ الاستلام": r.lot.brooding_out_at?.slice(0, 10) || "—",
      "البيض الداخل": r.derivedTotalEggs,
      "اللايح": r.fees.infCount,
      "الكشف الثاني": r.fees.unCount,
      "نافق الهاتش": r.fees.hmCount,
      "الكتاكيت": r.fees.chCount,
      "أيام التحضين": r.fees.brDays,
      "رسوم اللايح": r.fees.infAmt,
      "رسوم الكشف الثاني": r.fees.unAmt,
      "رسوم نافق الهاتش": r.fees.hmAmt,
      "رسوم الكتاكيت": r.fees.chAmt,
      "رسوم التحضين": r.fees.brAmt,
      "إجمالي مستحقات الدفعة": r.fees.total,
      "المدفوع": r.fees.paid,
      "المتبقي": r.fees.remaining,
      "حالة الدفع": STATUS_LABEL[r.fees.status],
      "ملاحظات": r.invoice?.notes || "—",
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "حسب الدفعات");

    const weekly = weekRows.map((w, i) => ({
      "م": i + 1,
      "الأسبوع": weekRange(w.wk),
      "عدد الدفعات": w.batches,
      "البيض الداخل": w.eggs,
      "اللايح": w.inf,
      "الكشف الثاني": w.un,
      "نافق الهاتش": w.hm,
      "الكتاكيت": w.chicks,
      "إجمالي المستحقات": w.total,
      "المدفوع": w.paid,
      "المتبقي": w.remaining,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(weekly), "أسبوعي");
    XLSX.writeFile(wb, `كشف-تشغيل-${selectedCustomer.name}-${today()}.xlsx`);
  };

  // ----- Build customer print HTML -----
  const buildCustomerHtml = (cust: Customer, custRows: Row[], custWeeks: typeof weekRows): string => {
    const ts = custRows.reduce((a, r) => ({
      eggs: a.eggs + r.derivedTotalEggs, inf: a.inf + r.fees.infCount,
      un: a.un + r.fees.unCount, hm: a.hm + r.fees.hmCount,
      chicks: a.chicks + r.fees.chCount, brDays: a.brDays + r.fees.brDays,
      total: a.total + r.fees.total, paid: a.paid + r.fees.paid, remaining: a.remaining + r.fees.remaining,
    }), { eggs: 0, inf: 0, un: 0, hm: 0, chicks: 0, brDays: 0, total: 0, paid: 0, remaining: 0 });
    const hatchPct = ts.eggs > 0 ? (ts.chicks / ts.eggs * 100).toFixed(1) + "%" : "—";
    const lastDate = custRows.reduce((m, r) => (r.batch?.entry_date && r.batch.entry_date > m ? r.batch.entry_date : m), "");

    const header = `
      <header>
        <div>
          <h1>شركة نعام العاصمة</h1>
          <div class="en">معمل تفريخ بيض النعام • Capital Ostrich Hatchery</div>
          <div class="en">الهوت لاين: 01044437790</div>
        </div>
        <div class="meta">
          ${new Date().toLocaleString("ar-EG")}
        </div>
      </header>
      <h2>كشف حساب تشغيل معمل التفريخ</h2>
      <div style="margin-bottom:8px">
        <b>العميل:</b> ${escapeHtml(cust.name)}
        ${cust.phone ? `&nbsp; • <b>الهاتف:</b> ${escapeHtml(cust.phone)}` : ""}
        <br><b>الفترة:</b> من ${from} إلى ${lastDate || effectiveTo}
      </div>
      <div class="stats">
        <div class="stat"><div class="k">عدد الدفعات</div><div class="v">${fmt(custRows.length)}</div></div>
        <div class="stat"><div class="k">إجمالي البيض</div><div class="v">${fmt(ts.eggs)}</div></div>
        <div class="stat"><div class="k">إجمالي اللايح</div><div class="v">${fmt(ts.inf)}</div></div>
        <div class="stat"><div class="k">إجمالي الكشف الثاني</div><div class="v">${fmt(ts.un)}</div></div>
        <div class="stat"><div class="k">إجمالي نافق الهاتش</div><div class="v">${fmt(ts.hm)}</div></div>
        <div class="stat"><div class="k">إجمالي الكتاكيت</div><div class="v">${fmt(ts.chicks)}</div></div>
        <div class="stat"><div class="k">نسبة الفقس</div><div class="v">${hatchPct}</div></div>
        <div class="stat"><div class="k">إجمالي أيام التحضين</div><div class="v">${fmt(ts.brDays)}</div></div>
        <div class="stat"><div class="k">إجمالي المستحقات</div><div class="v">${fmt(ts.total)}</div></div>
        <div class="stat"><div class="k">إجمالي المدفوع</div><div class="v">${fmt(ts.paid)}</div></div>
        <div class="stat"><div class="k">إجمالي المتبقي</div><div class="v">${fmt(ts.remaining)}</div></div>
      </div>`;

    const batchRowsHtml = custRows.map((r, i) => `<tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(r.batch?.batch_number)}</td>
      <td>${r.batch?.entry_date || "—"}</td>
      <td>${r.lot.hatcher_out_at?.slice(0, 10) || "—"}</td>
      <td>${r.lot.brooding_out_at?.slice(0, 10) || "—"}</td>
      <td class="num">${fmt(r.derivedTotalEggs)}</td>
      <td class="num">${fmt(r.fees.infCount)}</td>
      <td class="num">${fmt(r.fees.unCount)}</td>
      <td class="num">${fmt(r.fees.hmCount)}</td>
      <td class="num">${fmt(r.fees.chCount)}</td>
      <td class="num">${fmt(r.fees.brDays)}</td>
      <td class="num">${fmt(r.fees.total)}</td>
      <td class="num">${fmt(r.fees.paid)}</td>
      <td class="num">${fmt(r.fees.remaining)}</td>
      <td>${STATUS_LABEL[r.fees.status]}</td>
    </tr>`).join("");

    const batchesTable = `
      <h2>تفاصيل الدفعات</h2>
      <table>
        <thead><tr>
          <th>م</th><th>رقم الدفعة</th><th>الدخول</th><th>الفقس</th><th>الاستلام</th>
          <th>البيض</th><th>لايح</th><th>كشف 2</th><th>نافق هاتش</th><th>كتاكيت</th>
          <th>أيام تحضين</th><th>المستحق</th><th>المدفوع</th><th>المتبقي</th><th>الحالة</th>
        </tr></thead>
        <tbody>${batchRowsHtml}</tbody>
      </table>`;

    const weeklyHtml = custWeeks.length ? `
      <h2>الملخص الأسبوعي</h2>
      <table>
        <thead><tr>
          <th>الأسبوع</th><th>عدد الدفعات</th><th>البيض</th><th>لايح</th>
          <th>كشف 2</th><th>نافق هاتش</th><th>كتاكيت</th>
          <th>المستحق</th><th>المدفوع</th><th>المتبقي</th>
        </tr></thead>
        <tbody>${custWeeks.map((w) => `<tr>
          <td>${weekRange(w.wk)}</td>
          <td class="num">${fmt(w.batches)}</td>
          <td class="num">${fmt(w.eggs)}</td>
          <td class="num">${fmt(w.inf)}</td>
          <td class="num">${fmt(w.un)}</td>
          <td class="num">${fmt(w.hm)}</td>
          <td class="num">${fmt(w.chicks)}</td>
          <td class="num">${fmt(w.total)}</td>
          <td class="num">${fmt(w.paid)}</td>
          <td class="num">${fmt(w.remaining)}</td>
        </tr>`).join("")}</tbody>
      </table>` : "";

    return header + batchesTable + weeklyHtml;
  };

  const printCurrent = () => {
    if (!selectedCustomer || rows.length === 0) return;
    openPrintWindow(
      `كشف تشغيل — ${selectedCustomer.name}`,
      buildCustomerHtml(selectedCustomer, rows, weekRows),
    );
  };

  // Export all customers (separate sections, each on a new page)
  const printAllCustomers = () => {
    const grouped = new Map<string, Row[]>();
    for (const lot of lots) {
      if (!lot.client_id) continue;
      const batch = batchById.get(lot.batch_id);
      if (!batch || !batch.entry_date) continue;
      if (batch.entry_date < from) continue;
      if (batch.entry_date > effectiveTo) continue;
      const invoice = invoiceByLot.get(lot.id);
      const r = buildRow(lot, batch, invoice, pricing);
      const arr = grouped.get(lot.client_id) || [];
      arr.push(r);
      grouped.set(lot.client_id, arr);
    }
    const parts: string[] = [];
    let first = true;
    for (const [cid, custRows] of grouped) {
      const cust = customerById.get(cid);
      if (!cust) continue;
      custRows.sort((a, b) => (a.batch?.entry_date || "").localeCompare(b.batch?.entry_date || ""));
      const wkMap = new Map<string, any>();
      for (const r of custRows) {
        const d = r.batch?.entry_date; if (!d) continue;
        const wk = weekKey(d);
        const cur = wkMap.get(wk) || { wk, eggs: 0, inf: 0, un: 0, hm: 0, chicks: 0, total: 0, paid: 0, remaining: 0, batches: 0 };
        cur.eggs += r.derivedTotalEggs; cur.inf += r.fees.infCount; cur.un += r.fees.unCount;
        cur.hm += r.fees.hmCount; cur.chicks += r.fees.chCount; cur.total += r.fees.total;
        cur.paid += r.fees.paid; cur.remaining += r.fees.remaining; cur.batches += 1;
        wkMap.set(wk, cur);
      }
      const wks = [...wkMap.values()].sort((a, b) => a.wk.localeCompare(b.wk));
      parts.push(`<section style="${first ? "" : "page-break-before: always;"}">${buildCustomerHtml(cust, custRows, wks)}</section>`);
      first = false;
    }
    if (!parts.length) { alert("لا توجد بيانات للعملاء في الفترة المختارة."); return; }
    openPrintWindow("كشوف تشغيل كل عملاء المعمل", parts.join(""));
  };

  return (
    <DashboardLayout>
      <div className="space-y-4 p-4 max-w-[1500px] mx-auto" dir="rtl">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="w-6 h-6 text-primary" />
            كشف حساب تشغيل معمل التفريخ للعملاء
          </h1>
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={exportExcel} disabled={!selectedCustomer || rows.length === 0}>
              <FileSpreadsheet className="w-4 h-4 ml-1" /> Excel
            </Button>
            <Button size="sm" variant="outline" onClick={printCurrent} disabled={!selectedCustomer || rows.length === 0}>
              <Printer className="w-4 h-4 ml-1" /> طباعة / PDF
            </Button>
            <Button size="sm" variant="secondary" onClick={printAllCustomers}>
              <Download className="w-4 h-4 ml-1" /> تصدير كشوف كل العملاء
            </Button>
          </div>
        </div>

        <Alert className="border-amber-400 bg-amber-50 dark:bg-amber-950/20">
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          <AlertDescription className="text-xs">
            تقرير قراءة وتجميع فقط. لا يتم تعديل دفعات أو فواتير أو تحصيلات أو أرصدة عملاء.
            الرسوم تُسحب من الفاتورة عند وجودها، وإلا تُحتسب بالأسعار الحالية للدفعات قيد التشغيل.
          </AlertDescription>
        </Alert>

        <Card className="p-3">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-2">
            <div className="lg:col-span-2">
              <Label className="text-xs">العميل</Label>
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger><SelectValue placeholder="اختر العميل…" /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">من تاريخ</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">إلى تاريخ</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} placeholder={maxEntryDate} />
            </div>
            <div>
              <Label className="text-xs">من رقم دفعة</Label>
              <Input value={batchFrom} onChange={(e) => setBatchFrom(e.target.value)} placeholder="HB-…" />
            </div>
            <div>
              <Label className="text-xs">إلى رقم دفعة</Label>
              <Input value={batchTo} onChange={(e) => setBatchTo(e.target.value)} placeholder="HB-…" />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-2">
            <div>
              <Label className="text-xs">حالة الدفعة</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الدفعات</SelectItem>
                  <SelectItem value="in_progress">قيد التشغيل</SelectItem>
                  <SelectItem value="completed">مكتملة</SelectItem>
                  <SelectItem value="received">مستلمة</SelectItem>
                  <SelectItem value="unpaid">غير مدفوعة</SelectItem>
                  <SelectItem value="partial">مدفوعة جزئيًا</SelectItem>
                  <SelectItem value="paid">مدفوعة</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2 flex items-end text-xs text-muted-foreground">
              الفترة الفعلية: من <b className="mx-1">{from}</b> إلى <b className="mx-1">{effectiveTo}</b>
              {!to && maxEntryDate && <span>&nbsp;(آخر دفعة دخلت المعمل)</span>}
            </div>
          </div>
        </Card>

        {loading && <Card className="p-8 text-center text-muted-foreground">جاري التحميل…</Card>}

        {!loading && !selectedCustomer && (
          <Card className="p-8 text-center text-muted-foreground">اختر العميل لعرض كشف التشغيل.</Card>
        )}

        {!loading && selectedCustomer && (
          <>
            {/* Customer summary */}
            <Card className="p-4">
              <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                <div>
                  <div className="text-xs text-muted-foreground">العميل</div>
                  <div className="text-lg font-bold">{selectedCustomer.name}</div>
                  {selectedCustomer.phone && (
                    <div className="text-xs text-muted-foreground">{selectedCustomer.phone}</div>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  من {from} إلى {effectiveTo}
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2 text-xs">
                <Stat label="عدد الدفعات" value={fmt(rows.length)} />
                <Stat label="إجمالي البيض" value={fmt(totals.eggs)} />
                <Stat label="إجمالي اللايح" value={fmt(totals.inf)} />
                <Stat label="إجمالي الكشف 2" value={fmt(totals.un)} />
                <Stat label="إجمالي نافق الهاتش" value={fmt(totals.hm)} />
                <Stat label="إجمالي الكتاكيت" value={fmt(totals.chicks)} />
                <Stat label="نسبة الفقس" value={totals.eggs ? (totals.chicks / totals.eggs * 100).toFixed(1) + "%" : "—"} />
                <Stat label="أيام التحضين" value={fmt(totals.brDays)} />
                <Stat label="إجمالي المستحقات" value={fmtMoney(totals.total)} />
                <Stat label="إجمالي المدفوع" value={fmtMoney(totals.paid)} />
                <Stat label="إجمالي المتبقي" value={fmtMoney(totals.remaining)} highlight />
              </div>
            </Card>

            <Tabs defaultValue="batches" className="space-y-3">
              <TabsList>
                <TabsTrigger value="batches">حسب الدفعات</TabsTrigger>
                <TabsTrigger value="weekly">أسبوعي</TabsTrigger>
              </TabsList>

              <TabsContent value="batches">
                <Card className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">م</TableHead>
                        <TableHead>رقم الدفعة</TableHead>
                        <TableHead>الدخول</TableHead>
                        <TableHead>كشف 1</TableHead>
                        <TableHead>كشف 2</TableHead>
                        <TableHead>الفقس</TableHead>
                        <TableHead>الاستلام</TableHead>
                        <TableHead className="text-center">البيض</TableHead>
                        <TableHead className="text-center">لايح</TableHead>
                        <TableHead className="text-center">كشف 2</TableHead>
                        <TableHead className="text-center">نافق هاتش</TableHead>
                        <TableHead className="text-center">كتاكيت</TableHead>
                        <TableHead className="text-center">أيام تحضين</TableHead>
                        <TableHead className="text-center">رسوم لايح</TableHead>
                        <TableHead className="text-center">رسوم كشف 2</TableHead>
                        <TableHead className="text-center">رسوم نافق</TableHead>
                        <TableHead className="text-center">رسوم كتاكيت</TableHead>
                        <TableHead className="text-center">رسوم تحضين</TableHead>
                        <TableHead className="text-center">المستحق</TableHead>
                        <TableHead className="text-center">المدفوع</TableHead>
                        <TableHead className="text-center">المتبقي</TableHead>
                        <TableHead>الحالة</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={22} className="text-center py-6 text-muted-foreground">
                            لا توجد دفعات لهذا العميل ضمن الفترة المختارة.
                          </TableCell>
                        </TableRow>
                      )}
                      {rows.map((r, i) => (
                        <TableRow key={r.lot.id}>
                          <TableCell>{i + 1}</TableCell>
                          <TableCell className="font-mono text-xs">{r.batch?.batch_number}</TableCell>
                          <TableCell className="text-xs">{r.batch?.entry_date}</TableCell>
                          <TableCell className="text-xs">{r.lot.candling_recorded_at?.slice(0, 10) || "—"}</TableCell>
                          <TableCell className="text-xs">{r.lot.transferred_to_hatcher_at?.slice(0, 10) || "—"}</TableCell>
                          <TableCell className="text-xs">{r.lot.hatcher_out_at?.slice(0, 10) || "—"}</TableCell>
                          <TableCell className="text-xs">{r.lot.brooding_out_at?.slice(0, 10) || "—"}</TableCell>
                          <TableCell className="text-center font-semibold">{fmt(r.derivedTotalEggs)}</TableCell>
                          <TableCell className="text-center">{fmt(r.fees.infCount)}</TableCell>
                          <TableCell className="text-center">{fmt(r.fees.unCount)}</TableCell>
                          <TableCell className="text-center">{fmt(r.fees.hmCount)}</TableCell>
                          <TableCell className="text-center">{fmt(r.fees.chCount)}</TableCell>
                          <TableCell className="text-center">{fmt(r.fees.brDays)}</TableCell>
                          <TableCell className="text-center">{fmt(r.fees.infAmt)}</TableCell>
                          <TableCell className="text-center">{fmt(r.fees.unAmt)}</TableCell>
                          <TableCell className="text-center">{fmt(r.fees.hmAmt)}</TableCell>
                          <TableCell className="text-center">{fmt(r.fees.chAmt)}</TableCell>
                          <TableCell className="text-center">{fmt(r.fees.brAmt)}</TableCell>
                          <TableCell className="text-center font-bold">{fmt(r.fees.total)}</TableCell>
                          <TableCell className="text-center">{fmt(r.fees.paid)}</TableCell>
                          <TableCell className="text-center font-bold">{fmt(r.fees.remaining)}</TableCell>
                          <TableCell>
                            <Badge className={`${STATUS_COLOR[r.fees.status]} text-white text-xs`}>
                              {STATUS_LABEL[r.fees.status]}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                      {rows.length > 0 && (
                        <TableRow className="bg-muted/40 font-bold">
                          <TableCell colSpan={7} className="text-right">الإجمالي</TableCell>
                          <TableCell className="text-center">{fmt(totals.eggs)}</TableCell>
                          <TableCell className="text-center">{fmt(totals.inf)}</TableCell>
                          <TableCell className="text-center">{fmt(totals.un)}</TableCell>
                          <TableCell className="text-center">{fmt(totals.hm)}</TableCell>
                          <TableCell className="text-center">{fmt(totals.chicks)}</TableCell>
                          <TableCell className="text-center">{fmt(totals.brDays)}</TableCell>
                          <TableCell colSpan={5}></TableCell>
                          <TableCell className="text-center">{fmt(totals.total)}</TableCell>
                          <TableCell className="text-center">{fmt(totals.paid)}</TableCell>
                          <TableCell className="text-center">{fmt(totals.remaining)}</TableCell>
                          <TableCell></TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </Card>
              </TabsContent>

              <TabsContent value="weekly">
                <Card className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>الأسبوع</TableHead>
                        <TableHead className="text-center">عدد الدفعات</TableHead>
                        <TableHead className="text-center">البيض</TableHead>
                        <TableHead className="text-center">لايح</TableHead>
                        <TableHead className="text-center">كشف 2</TableHead>
                        <TableHead className="text-center">نافق هاتش</TableHead>
                        <TableHead className="text-center">كتاكيت</TableHead>
                        <TableHead className="text-center">المستحق</TableHead>
                        <TableHead className="text-center">المدفوع</TableHead>
                        <TableHead className="text-center">المتبقي</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {weekRows.length === 0 && (
                        <TableRow><TableCell colSpan={10} className="text-center py-6 text-muted-foreground">لا توجد بيانات.</TableCell></TableRow>
                      )}
                      {weekRows.map((w) => (
                        <TableRow key={w.wk}>
                          <TableCell className="text-xs">{weekRange(w.wk)}</TableCell>
                          <TableCell className="text-center">{fmt(w.batches)}</TableCell>
                          <TableCell className="text-center">{fmt(w.eggs)}</TableCell>
                          <TableCell className="text-center">{fmt(w.inf)}</TableCell>
                          <TableCell className="text-center">{fmt(w.un)}</TableCell>
                          <TableCell className="text-center">{fmt(w.hm)}</TableCell>
                          <TableCell className="text-center">{fmt(w.chicks)}</TableCell>
                          <TableCell className="text-center">{fmt(w.total)}</TableCell>
                          <TableCell className="text-center">{fmt(w.paid)}</TableCell>
                          <TableCell className="text-center font-bold">{fmt(w.remaining)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
              </TabsContent>
            </Tabs>

            {/* Final summary */}
            {rows.length > 0 && (
              <Card className="p-4">
                <h3 className="font-bold mb-2 flex items-center gap-2">
                  <FileText className="w-4 h-4" /> الملخص النهائي
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                  <Stat label="إجمالي البيض الداخل" value={fmt(totals.eggs)} />
                  <Stat label="إجمالي اللايح" value={fmt(totals.inf)} />
                  <Stat label="إجمالي الكشف 2" value={fmt(totals.un)} />
                  <Stat label="إجمالي نافق الهاتش" value={fmt(totals.hm)} />
                  <Stat label="إجمالي الكتاكيت" value={fmt(totals.chicks)} />
                  <Stat label="نسبة الفقس" value={totals.eggs ? (totals.chicks / totals.eggs * 100).toFixed(1) + "%" : "—"} highlight />
                  <Stat label="إجمالي المستحق" value={fmtMoney(totals.total)} />
                  <Stat label="إجمالي المدفوع" value={fmtMoney(totals.paid)} />
                  <Stat label="إجمالي المتبقي" value={fmtMoney(totals.remaining)} highlight />
                </div>
              </Card>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

function Stat({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded border p-2 ${highlight ? "bg-primary/10 border-primary/40" : "bg-muted/30"}`}>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="font-bold text-sm">{value}</div>
    </div>
  );
}
