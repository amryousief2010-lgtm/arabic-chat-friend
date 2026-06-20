import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Printer, FileDown, FileSpreadsheet } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { openPrintWindow, escapeHtml, fmtNum, fmtDate } from "@/lib/printPdf";
import { toast } from "sonner";
import * as XLSX from "xlsx";

type GroupBy = "batch" | "week" | "month";
type BatchInfo = {
  batch_number: string;
  operational_batch_no: number | null;
  entry_date: string | null;
  receive_date: string | null;
  received_eggs: number;
  net_eggs: number;
  candle1_fertile: number;
  candle1_infertile: number;
  candle2_dead: number;
  hatched_chicks: number;
  hatcher_dead: number;
  brooding_days: number;
};

type Customer = { id: string; name: string; customer_type: string | null; phone?: string | null };
type LedgerRow = {
  id: string; customer_id: string; entry_date: string; entry_type: string;
  source_type: string; source_id: string | null;
  batch_number: string | null; operational_batch_no: number | null;
  infertile_eggs: number; candle2_dead: number; chicks: number;
  brooding_chicks: number; brooding_days: number;
  subtotal: number; discount: number;
  debit: number; credit: number; running_balance: number;
  payment_method: string | null; receipt_no: string | null;
  description: string | null; notes: string | null;
};

const ENTRY_LABEL: Record<string, string> = {
  batch_charge: "مستحقات دفعة تفريخ",
  collection: "تحصيل",
  discount: "خصم",
  internal_settlement: "تسوية داخلية",
  adjustment: "تسوية يدوية",
  reversal: "حركة عكسية",
  opening_balance: "رصيد افتتاحي",
  historical_closeout: "تسوية تاريخية (حتى الدفعة 15)",
};

// Determine treasury impact for a ledger row based on entry_type + payment_method
const PRIOR_BALANCE_PMS = ["credit_prior_balance", "opening_credit", "prior_balance", "historical_settlement"];
function treasuryImpact(r: LedgerRow): { affected: boolean; label: string } {
  const pm = (r.payment_method || "").toLowerCase();
  if (["batch_charge", "adjustment", "discount", "opening_balance", "internal_settlement", "historical_closeout"].includes(r.entry_type)) {
    if (r.entry_type === "opening_balance") return { affected: false, label: "رصيد سابق — لا تؤثر" };
    if (r.entry_type === "historical_closeout") return { affected: false, label: "تسوية تاريخية — لا تؤثر" };
    if (r.entry_type === "internal_settlement") return { affected: false, label: "تسوية داخلية — لا تؤثر" };
    return { affected: false, label: "لا تؤثر على الخزنة" };
  }
  if (PRIOR_BALANCE_PMS.includes(pm) || pm.includes("prior_balance") || pm.includes("رصيد")) {
    return { affected: false, label: "خصم من رصيد سابق — لا تؤثر" };
  }
  return { affected: true, label: "أثرت على خزنة المعمل" };
}

export default function LabCustomerStatement() {
  const [params, setParams] = useSearchParams();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState<string>(params.get("customer") || "");
  const [from, setFrom] = useState<string>(params.get("from") || "");
  const [to, setTo] = useState<string>(params.get("to") || "");
  const [batchFilter, setBatchFilter] = useState<string>("");
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [lotsByBatch, setLotsByBatch] = useState<Record<string, { eggs_in: number; hatch_mortality: number }>>({});
  const [pricing, setPricing] = useState<{ infertile_egg_price: number; completed_unhatched_price: number; hatch_mortality_price: number; chick_price: number; daily_brooding_price: number }>({ infertile_egg_price: 0, completed_unhatched_price: 0, hatch_mortality_price: 0, chick_price: 0, daily_brooding_price: 0 });
  const [batchInfos, setBatchInfos] = useState<Record<string, BatchInfo>>({});
  const [customerPhone, setCustomerPhone] = useState<string>("");
  const [groupBy, setGroupBy] = useState<GroupBy>("batch");
  const [quantitiesOnly, setQuantitiesOnly] = useState(false);
  const [loading, setLoading] = useState(false);


  useEffect(() => {
    supabase
      .from("hatch_customers")
      .select("id,name,customer_type,phone")
      .eq("is_active", true)
      .eq("is_test", false)
      .order("name")
      .then(({ data }) => {
        const list = (data || []) as any[];
        list.sort((a, b) => {
          const aA = /عاصمة/.test(a.name) ? 0 : 1;
          const aB = /عاصمة/.test(b.name) ? 0 : 1;
          return aA - aB;
        });
        setCustomers(list as Customer[]);
      });
    supabase
      .from("hatchery_pricing_settings")
      .select("infertile_egg_price,completed_unhatched_price,hatch_mortality_price,chick_price,daily_brooding_price")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }: any) => {
        if (data) setPricing({
          infertile_egg_price: Number(data.infertile_egg_price) || 0,
          completed_unhatched_price: Number(data.completed_unhatched_price) || 0,
          hatch_mortality_price: Number(data.hatch_mortality_price) || 0,
          chick_price: Number(data.chick_price) || 0,
          daily_brooding_price: Number(data.daily_brooding_price) || 0,
        });
      });
  }, []);


  useEffect(() => {
    if (!customerId) { setRows([]); setLotsByBatch({}); setBatchInfos({}); setCustomerPhone(""); return; }
    setLoading(true);
    const c = customers.find(x => x.id === customerId);
    setCustomerPhone(c?.phone || "");
    let q = supabase
      .from("lab_customer_ledger")
      .select("*")
      .eq("customer_id", customerId)
      .order("entry_date", { ascending: true })
      .order("created_at", { ascending: true });
    if (from) q = q.gte("entry_date", from);
    if (to) q = q.lte("entry_date", to);
    Promise.all([
      q,
      supabase
        .from("hatchery_batch_lots")
        .select("eggs_in,hatch_mortality_count,completed_unhatched,chicks_hatched,transferred_count,hatchery_batches!inner(batch_number)")
        .eq("client_id", customerId)
        .eq("cancelled", false),
      supabase
        .from("hatch_batches")
        .select("batch_number,operational_batch_no,entry_date,receive_date,received_eggs,net_eggs,candle1_fertile,candle1_infertile,candle2_dead,hatched_chicks,hatcher_dead,brooding_days")
        .eq("customer_id", customerId)
        .eq("is_test", false),
    ]).then(([ledRes, lotRes, batchRes]: any) => {
      if (ledRes.error) toast.error(ledRes.error.message);
      let list = (ledRes.data || []) as LedgerRow[];
      if (batchFilter.trim()) {
        const b = batchFilter.trim();
        list = list.filter(r =>
          (r.batch_number || "").includes(b) ||
          String(r.operational_batch_no ?? "").includes(b)
        );
      }
      setRows(list);
      const map: Record<string, { eggs_in: number; hatch_mortality: number }> = {};
      (lotRes.data || []).forEach((l: any) => {
        const key = String(l.hatchery_batches?.batch_number ?? "");
        if (!key) return;
        const hm = Number(l.hatch_mortality_count) || Math.max(0, (Number(l.transferred_count)||0) - (Number(l.chicks_hatched)||0) - (Number(l.completed_unhatched)||0));
        const prev = map[key] || { eggs_in: 0, hatch_mortality: 0 };
        map[key] = { eggs_in: prev.eggs_in + (Number(l.eggs_in)||0), hatch_mortality: prev.hatch_mortality + hm };
      });
      setLotsByBatch(map);
      const bmap: Record<string, BatchInfo> = {};
      (batchRes.data || []).forEach((b: any) => {
        const info: BatchInfo = {
          batch_number: String(b.batch_number ?? ""),
          operational_batch_no: b.operational_batch_no,
          entry_date: b.entry_date,
          receive_date: b.receive_date,
          received_eggs: Number(b.received_eggs) || 0,
          net_eggs: Number(b.net_eggs) || 0,
          candle1_fertile: Number(b.candle1_fertile) || 0,
          candle1_infertile: Number(b.candle1_infertile) || 0,
          candle2_dead: Number(b.candle2_dead) || 0,
          hatched_chicks: Number(b.hatched_chicks) || 0,
          hatcher_dead: Number(b.hatcher_dead) || 0,
          brooding_days: Number(b.brooding_days) || 0,
        };
        if (info.batch_number) bmap[info.batch_number] = info;
        if (info.operational_batch_no != null) bmap[String(info.operational_batch_no)] = info;
      });
      setBatchInfos(bmap);
      setLoading(false);
    });
    setParams(prev => {
      const p = new URLSearchParams(prev);
      p.set("customer", customerId);
      if (from) p.set("from", from); else p.delete("from");
      if (to) p.set("to", to); else p.delete("to");
      return p;
    }, { replace: true });
  }, [customerId, from, to, batchFilter, customers]);

  const summary = useMemo(() => {
    const debit = rows.reduce((a, r) => a + Number(r.debit || 0), 0);
    const credit = rows.reduce((a, r) => a + Number(r.credit || 0), 0);
    const batches = rows.filter(r => r.entry_type === "batch_charge").length;
    const lastBatch = rows.filter(r => r.entry_type === "batch_charge").slice(-1)[0]?.entry_date || null;
    const lastPay = rows.filter(r => ["collection","internal_settlement","historical_closeout"].includes(r.entry_type)).slice(-1)[0]?.entry_date || null;
    return { debit, credit, balance: debit - credit, batches, lastBatch, lastPay };
  }, [rows]);

  const selectedCustomer = customers.find(c => c.id === customerId);

  // Detailed per-batch (operational + financial) row used for printing & Excel
  type DetailRow = {
    key: string;            // grouping key (batch / week / month)
    label: string;          // displayed identifier
    entry_date: string;     // ISO
    type_label: string;     // داخلي / خارجي
    eggs: number;           // received_eggs
    damaged: number;        // received_eggs - net_eggs
    net: number;            // net_eggs
    lait: number;           // candle1_infertile / infertile
    fertile1: number;       // candle1_fertile
    candle2: number;        // candle2_dead
    hatchMort: number;      // hatcher_dead
    chicks: number;
    broodChicks: number;
    broodDays: number;
    debit: number;
    credit: number;
    notes: string;
  };

  const buildDetailRows = (): DetailRow[] => {
    const P = pricing;
    void P;
    const typeLabel = selectedCustomer?.customer_type === "internal" ? "داخلي" : "خارجي";

    // 1) Per-batch base map seeded from hatch_batches
    type BatchAgg = DetailRow & { receive_date: string };
    const map = new Map<string, BatchAgg>();
    Object.values(batchInfos).forEach(info => {
      const k = String(info.operational_batch_no ?? info.batch_number ?? "");
      if (!k || map.has(k)) return;
      const lot = lotsByBatch[info.batch_number];
      const damaged = Math.max(0, info.received_eggs - info.net_eggs);
      map.set(k, {
        key: k, label: k,
        entry_date: info.entry_date || info.receive_date || "",
        receive_date: info.receive_date || "",
        type_label: typeLabel,
        eggs: info.received_eggs,
        damaged,
        net: info.net_eggs,
        lait: info.candle1_infertile,
        fertile1: info.candle1_fertile,
        candle2: info.candle2_dead,
        hatchMort: info.hatcher_dead || lot?.hatch_mortality || 0,
        chicks: info.hatched_chicks,
        broodChicks: 0,
        broodDays: info.brooding_days,
        debit: 0,
        credit: 0,
        notes: "",
      });
    });

    // 2) Merge ledger rows: overlay financial + operational numbers from batch_charge
    rows.forEach(r => {
      const k = String(r.operational_batch_no ?? r.batch_number ?? "");
      if (!k) return;
      let a = map.get(k);
      if (!a) {
        const lot = lotsByBatch[r.batch_number || ""] || lotsByBatch[k];
        a = {
          key: k, label: k, entry_date: r.entry_date, receive_date: "",
          type_label: typeLabel,
          eggs: lot?.eggs_in || 0, damaged: 0, net: lot?.eggs_in || 0,
          lait: 0, fertile1: 0, candle2: 0,
          hatchMort: lot?.hatch_mortality || 0, chicks: 0,
          broodChicks: 0, broodDays: 0, debit: 0, credit: 0, notes: "",
        };
        map.set(k, a);
      }
      if (r.entry_type === "batch_charge") {
        if (!a.entry_date) a.entry_date = r.entry_date;
        // Prefer ledger values if non-zero (they reflect billed quantities)
        if (Number(r.infertile_eggs) > 0) a.lait = Number(r.infertile_eggs);
        if (Number(r.candle2_dead) > 0) a.candle2 = Number(r.candle2_dead);
        if (Number(r.chicks) > 0) a.chicks = Number(r.chicks);
        if (Number(r.brooding_days) > 0) {
          a.broodChicks = Number(r.brooding_chicks || 0);
          a.broodDays = Number(r.brooding_days);
        }
        a.debit += Number(r.debit || 0);
        if (r.notes) a.notes = a.notes ? `${a.notes} • ${r.notes}` : r.notes;
      } else {
        a.credit += Number(r.credit || 0);
        a.debit += Number(r.debit || 0); // adjustments / opening balance
      }
    });

    const detail = Array.from(map.values())
      .sort((x, y) => (x.entry_date || "").localeCompare(y.entry_date || ""));

    if (groupBy === "batch") return detail;

    // Group by week or month
    const bucket = new Map<string, DetailRow>();
    const isoWeek = (d: Date) => {
      const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      const dayNum = t.getUTCDay() || 7;
      t.setUTCDate(t.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
      const w = Math.ceil(((+t - +yearStart) / 86400000 + 1) / 7);
      return `${t.getUTCFullYear()}-W${String(w).padStart(2, "0")}`;
    };
    detail.forEach(d => {
      const dt = d.entry_date ? new Date(d.entry_date) : null;
      const k = !dt || isNaN(+dt)
        ? "—"
        : groupBy === "week"
          ? isoWeek(dt)
          : `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
      let b = bucket.get(k);
      if (!b) {
        b = { ...d, key: k, label: k, notes: "" };
        bucket.set(k, b);
      } else {
        b.eggs += d.eggs; b.damaged += d.damaged; b.net += d.net;
        b.lait += d.lait; b.fertile1 += d.fertile1; b.candle2 += d.candle2;
        b.hatchMort += d.hatchMort; b.chicks += d.chicks;
        b.broodChicks += d.broodChicks;
        b.broodDays = Math.max(b.broodDays, d.broodDays);
        b.debit += d.debit; b.credit += d.credit;
      }
    });
    return Array.from(bucket.values());
  };

  const paymentStatus = (debit: number, credit: number) => {
    if (debit <= 0) return { label: "—", color: "#6b7280" };
    if (credit <= 0) return { label: "غير مدفوع", color: "#b91c1c" };
    if (credit >= debit) return { label: "مدفوع", color: "#047857" };
    return { label: "جزئي", color: "#b45309" };
  };

  const printPdf = () => {
    if (!selectedCustomer) return;
    const detail = buildDetailRows();
    const P = pricing;

    const cells = detail.map((b, i) => {
      const laitFee = b.lait * P.infertile_egg_price;
      const candle2Fee = b.candle2 * P.completed_unhatched_price;
      const hatchMortFee = b.hatchMort * P.hatch_mortality_price;
      const chicksFee = b.chicks * P.chick_price;
      const broodFee = b.broodChicks * b.broodDays * P.daily_brooding_price;
      const debit = b.debit || (laitFee + candle2Fee + hatchMortFee + chicksFee + broodFee);
      const remaining = debit - b.credit;
      const hatchPct = b.eggs > 0 ? (b.chicks / b.eggs) * 100 : 0;
      const status = paymentStatus(debit, b.credit);
      return `<tr>
        <td>${i + 1}</td>
        <td><b>${escapeHtml(b.label)}</b></td>
        <td>${b.entry_date ? escapeHtml(b.entry_date) : "—"}</td>
        <td>${escapeHtml(b.type_label)}</td>
        <td class="num">${fmtNum(b.eggs)}</td>
        <td class="num">${fmtNum(b.damaged)}</td>
        <td class="num">${fmtNum(b.net)}</td>
        <td class="num">${fmtNum(b.lait)}</td>
        <td class="num">${fmtNum(b.fertile1)}</td>
        <td class="num">${fmtNum(b.candle2)}</td>
        <td class="num">${fmtNum(b.hatchMort)}</td>
        <td class="num">${fmtNum(b.chicks)}</td>
        <td class="num">${fmtNum(hatchPct, 1)}%</td>
        <td class="num">${b.broodDays ? `${fmtNum(b.broodChicks)}×${fmtNum(b.broodDays)}` : "—"}</td>
        <td class="num">${fmtNum(laitFee, 2)}</td>
        <td class="num">${fmtNum(candle2Fee, 2)}</td>
        <td class="num">${fmtNum(hatchMortFee, 2)}</td>
        <td class="num">${fmtNum(chicksFee, 2)}</td>
        <td class="num">${fmtNum(broodFee, 2)}</td>
        <td class="num"><b>${fmtNum(debit, 2)}</b></td>
        <td class="num" style="color:#047857">${fmtNum(b.credit, 2)}</td>
        <td class="num"><b style="color:${remaining > 0 ? "#b91c1c" : "#047857"}">${fmtNum(remaining, 2)}</b></td>
        <td style="color:${status.color};font-weight:bold">${status.label}</td>
        <td>${escapeHtml(b.notes || "—")}</td>
      </tr>`;
    }).join("");

    const totals = detail.reduce((t, b) => {
      const laitFee = b.lait * P.infertile_egg_price;
      const candle2Fee = b.candle2 * P.completed_unhatched_price;
      const hatchMortFee = b.hatchMort * P.hatch_mortality_price;
      const chicksFee = b.chicks * P.chick_price;
      const broodFee = b.broodChicks * b.broodDays * P.daily_brooding_price;
      const debit = b.debit || (laitFee + candle2Fee + hatchMortFee + chicksFee + broodFee);
      return {
        eggs: t.eggs + b.eggs, damaged: t.damaged + b.damaged, net: t.net + b.net,
        lait: t.lait + b.lait, fertile1: t.fertile1 + b.fertile1, candle2: t.candle2 + b.candle2,
        hatchMort: t.hatchMort + b.hatchMort, chicks: t.chicks + b.chicks,
        laitFee: t.laitFee + laitFee, candle2Fee: t.candle2Fee + candle2Fee,
        hatchMortFee: t.hatchMortFee + hatchMortFee, chicksFee: t.chicksFee + chicksFee,
        broodFee: t.broodFee + broodFee,
        debit: t.debit + debit, credit: t.credit + b.credit,
      };
    }, { eggs: 0, damaged: 0, net: 0, lait: 0, fertile1: 0, candle2: 0, hatchMort: 0, chicks: 0, laitFee: 0, candle2Fee: 0, hatchMortFee: 0, chicksFee: 0, broodFee: 0, debit: 0, credit: 0 });

    const totalsRow = `<tr style="background:#ede9fe;font-weight:bold">
      <td colspan="4">الإجمالي</td>
      <td class="num">${fmtNum(totals.eggs)}</td>
      <td class="num">${fmtNum(totals.damaged)}</td>
      <td class="num">${fmtNum(totals.net)}</td>
      <td class="num">${fmtNum(totals.lait)}</td>
      <td class="num">${fmtNum(totals.fertile1)}</td>
      <td class="num">${fmtNum(totals.candle2)}</td>
      <td class="num">${fmtNum(totals.hatchMort)}</td>
      <td class="num">${fmtNum(totals.chicks)}</td>
      <td class="num">${totals.eggs > 0 ? fmtNum((totals.chicks / totals.eggs) * 100, 1) + "%" : "—"}</td>
      <td class="num">—</td>
      <td class="num">${fmtNum(totals.laitFee, 2)}</td>
      <td class="num">${fmtNum(totals.candle2Fee, 2)}</td>
      <td class="num">${fmtNum(totals.hatchMortFee, 2)}</td>
      <td class="num">${fmtNum(totals.chicksFee, 2)}</td>
      <td class="num">${fmtNum(totals.broodFee, 2)}</td>
      <td class="num">${fmtNum(totals.debit, 2)}</td>
      <td class="num">${fmtNum(totals.credit, 2)}</td>
      <td class="num">${fmtNum(totals.debit - totals.credit, 2)}</td>
      <td colspan="2">—</td>
    </tr>`;

    const groupLabel = groupBy === "week" ? "حسب الأسبوع" : groupBy === "month" ? "حسب الشهر" : "حسب الدفعات";

    const body = `
      <header>
        <div>
          <h1>شركة نعام العاصمة — معمل تفريخ بيض النعام</h1>
          <div style="font-size:11px;color:#444">الهوت لاين: 01044437790</div>
          <div style="font-size:15px;font-weight:bold;margin-top:6px">كشف حساب تشغيل عميل معمل التفريخ</div>
          <div style="margin-top:4px">العميل: <b>${escapeHtml(selectedCustomer.name)}</b>${selectedCustomer.customer_type === "internal" ? " (داخلي)" : ""}${customerPhone ? ` — هاتف: <b>${escapeHtml(customerPhone)}</b>` : ""}</div>
          <div style="font-size:11px;margin-top:2px">العرض: <b>${groupLabel}</b></div>
        </div>
        <div class="meta">
          تاريخ الطباعة: ${fmtDate(new Date())}<br/>
          ${from ? `من: ${from}` : "من: —"}<br/>${to ? `إلى: ${to}` : "إلى: —"}
        </div>
      </header>
      <div class="stats" style="grid-template-columns:repeat(6,1fr)">
        <div class="stat"><div class="k">عدد الدفعات</div><div class="v num">${fmtNum(detail.length)}</div></div>
        <div class="stat"><div class="k">إجمالي البيض</div><div class="v num">${fmtNum(totals.eggs)}</div></div>
        <div class="stat"><div class="k">إجمالي الكتاكيت</div><div class="v num">${fmtNum(totals.chicks)}</div></div>
        <div class="stat"><div class="k">إجمالي المستحق</div><div class="v num">${fmtNum(totals.debit, 2)}</div></div>
        <div class="stat"><div class="k">إجمالي المدفوع</div><div class="v num">${fmtNum(totals.credit, 2)}</div></div>
        <div class="stat"><div class="k">إجمالي المتبقي</div><div class="v num">${fmtNum(totals.debit - totals.credit, 2)}</div></div>
      </div>
      <table class="main">
        <thead><tr>
          <th>م</th><th>رقم الدفعة</th><th>تاريخ الدخول</th><th>النوع</th>
          <th>عدد البيض</th><th>التالف</th><th>الصافي</th>
          <th>اللايح</th><th>المخصب 1</th><th>نافق كشف ثاني</th><th>نافق هاتشر</th>
          <th>عدد الكتاكيت</th><th>نسبة الفقس %</th><th>أيام التحضين</th>
          <th>رسوم اللايح</th><th>رسوم الكشف الثاني</th><th>رسوم نافق الهاتش</th><th>رسوم الكتاكيت</th><th>رسوم التحضين</th>
          <th>إجمالي المستحق</th><th>المدفوع</th><th>المتبقي</th>
          <th>حالة الدفع</th><th>ملاحظات</th>
        </tr></thead>
        <tbody>${cells}${totalsRow}</tbody>
      </table>`;

    const landscapeCss = `
      @page { size: A4 landscape; margin: 8mm; }
      body { font-size: 10px; }
      header h1 { font-size: 16px; }
      table.main { font-size: 8.5px; }
      table.main th, table.main td { padding: 3px 3px; }
      table.main th { writing-mode: horizontal-tb; }
    `;
    openPrintWindow(`كشف حساب تشغيل — ${selectedCustomer.name}`, body, landscapeCss);
  };

  const exportExcel = () => {
    if (!selectedCustomer) return;
    const detail = buildDetailRows();
    const P = pricing;
    const data = detail.map((b, i) => {
      const laitFee = b.lait * P.infertile_egg_price;
      const candle2Fee = b.candle2 * P.completed_unhatched_price;
      const hatchMortFee = b.hatchMort * P.hatch_mortality_price;
      const chicksFee = b.chicks * P.chick_price;
      const broodFee = b.broodChicks * b.broodDays * P.daily_brooding_price;
      const debit = b.debit || (laitFee + candle2Fee + hatchMortFee + chicksFee + broodFee);
      const remaining = debit - b.credit;
      const hatchPct = b.eggs > 0 ? (b.chicks / b.eggs) * 100 : 0;
      const status = paymentStatus(debit, b.credit).label;
      return {
        "م": i + 1,
        "رقم الدفعة": b.label,
        "تاريخ الدخول": b.entry_date,
        "النوع": b.type_label,
        "عدد البيض": b.eggs,
        "التالف": b.damaged,
        "الصافي": b.net,
        "اللايح": b.lait,
        "المخصب 1": b.fertile1,
        "نافق كشف ثاني": b.candle2,
        "نافق هاتشر": b.hatchMort,
        "عدد الكتاكيت": b.chicks,
        "نسبة الفقس %": Number(hatchPct.toFixed(1)),
        "أيام التحضين": b.broodDays ? `${b.broodChicks}×${b.broodDays}` : "",
        "رسوم اللايح": laitFee,
        "رسوم الكشف الثاني": candle2Fee,
        "رسوم نافق الهاتش": hatchMortFee,
        "رسوم الكتاكيت": chicksFee,
        "رسوم التحضين": broodFee,
        "إجمالي المستحق": debit,
        "المدفوع": b.credit,
        "المتبقي": remaining,
        "حالة الدفع": status,
        "ملاحظات": b.notes,
      };
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "كشف التشغيل");
    XLSX.writeFile(wb, `كشف-تشغيل-${selectedCustomer.name}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">كشف حساب عملاء معمل التفريخ</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Switch checked={quantitiesOnly} onCheckedChange={setQuantitiesOnly} />
            <span>كميات فقط (إخفاء الأرقام المالية)</span>
          </label>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">عرض التقرير:</span>
            <Select value={groupBy} onValueChange={(v) => setGroupBy(v as GroupBy)}>
              <SelectTrigger className="w-36 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="batch">حسب الدفعات</SelectItem>
                <SelectItem value="week">حسب الأسبوع</SelectItem>
                <SelectItem value="month">حسب الشهر</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" onClick={exportExcel} disabled={!customerId}>
            <FileSpreadsheet className="w-4 h-4 ml-1" />Excel
          </Button>
          <Button onClick={printPdf} disabled={!customerId}>
            <Printer className="w-4 h-4 ml-1" />طباعة / PDF
          </Button>
        </div>
      </div>


      <Card className="p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <label className="text-xs text-muted-foreground">العميل</label>
          <Select value={customerId} onValueChange={setCustomerId}>
            <SelectTrigger><SelectValue placeholder="اختر العميل" /></SelectTrigger>
            <SelectContent className="max-h-72">
              {customers.map(c => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}{c.customer_type === "internal" ? " (داخلي)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">من تاريخ</label>
          <Input type="date" value={from} onChange={e => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">إلى تاريخ</label>
          <Input type="date" value={to} onChange={e => setTo(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">رقم الدفعة</label>
          <Input value={batchFilter} onChange={e => setBatchFilter(e.target.value)} placeholder="مثال: 18" />
        </div>
      </Card>

      {customerId && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <Card className="p-3"><div className="text-xs text-muted-foreground">إجمالي المستحقات</div><div className="text-lg font-bold">{fmtNum(summary.debit, 2)}</div></Card>
          <Card className="p-3"><div className="text-xs text-muted-foreground">إجمالي المدفوعات</div><div className="text-lg font-bold text-green-600">{fmtNum(summary.credit, 2)}</div></Card>
          <Card className="p-3"><div className="text-xs text-muted-foreground">الرصيد المتبقي</div><div className={`text-lg font-bold ${summary.balance > 0 ? "text-red-600" : summary.balance < 0 ? "text-blue-600" : ""}`}>{fmtNum(summary.balance, 2)}</div></Card>
          <Card className="p-3"><div className="text-xs text-muted-foreground">عدد الدفعات</div><div className="text-lg font-bold">{summary.batches}</div></Card>
          <Card className="p-3"><div className="text-xs text-muted-foreground">آخر دفعة</div><div className="text-sm font-bold">{summary.lastBatch || "—"}</div></Card>
          <Card className="p-3"><div className="text-xs text-muted-foreground">آخر تحصيل</div><div className="text-sm font-bold">{summary.lastPay || "—"}</div></Card>
        </div>
      )}

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>التاريخ</TableHead>
              <TableHead>الدفعة</TableHead>
              <TableHead>نوع الحركة</TableHead>
              <TableHead>البيان</TableHead>
              <TableHead>بيض داخل</TableHead>
              <TableHead>لايح</TableHead>
              {!quantitiesOnly && <TableHead>قيمة لايح</TableHead>}
              <TableHead>كشف 2</TableHead>
              {!quantitiesOnly && <TableHead>قيمة كشف 2</TableHead>}
              <TableHead>نافق هاتش</TableHead>
              {!quantitiesOnly && <TableHead>قيمة نافق هاتش</TableHead>}
              <TableHead>كتاكيت</TableHead>
              {!quantitiesOnly && <TableHead>قيمة كتاكيت</TableHead>}
              <TableHead>تحضين</TableHead>
              {!quantitiesOnly && <>
                <TableHead>خصم</TableHead>
                <TableHead>مدين</TableHead>
                <TableHead>دائن</TableHead>
                <TableHead>الرصيد</TableHead>
                <TableHead>طريقة الدفع</TableHead>
                <TableHead>تأثير الخزنة</TableHead>
                <TableHead>إيصال</TableHead>
              </>}
              <TableHead>ملاحظات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!customerId && (
              <TableRow><TableCell colSpan={20} className="text-center text-muted-foreground py-8">اختر عميلًا لعرض كشف الحساب</TableCell></TableRow>
            )}
            {customerId && loading && (
              <TableRow><TableCell colSpan={20} className="text-center py-8">جاري التحميل…</TableCell></TableRow>
            )}
            {customerId && !loading && rows.length === 0 && (
              <TableRow><TableCell colSpan={20} className="text-center text-muted-foreground py-8">لا توجد حركات</TableCell></TableRow>
            )}
            {rows.map(r => {
              const ti = treasuryImpact(r);
              const key = String(r.operational_batch_no ?? r.batch_number ?? "");
              const lot = lotsByBatch[key];
              const eggsIn = r.entry_type === "batch_charge" ? (lot?.eggs_in || 0) : 0;
              const hatchMort = r.entry_type === "batch_charge" ? (lot?.hatch_mortality || 0) : 0;
              return (
              <TableRow key={r.id}>
                <TableCell className="whitespace-nowrap text-xs">{r.entry_date}</TableCell>
                <TableCell className="text-xs">{r.operational_batch_no ?? r.batch_number ?? "—"}</TableCell>
                <TableCell><Badge variant={r.entry_type === "batch_charge" ? "destructive" : "secondary"}>{ENTRY_LABEL[r.entry_type] || r.entry_type}</Badge></TableCell>
                <TableCell className="text-xs max-w-[200px] truncate">{r.description || "—"}</TableCell>
                <TableCell className="text-xs font-medium">{eggsIn ? fmtNum(eggsIn) : "—"}</TableCell>
                <TableCell className="text-xs">{r.infertile_eggs || "—"}</TableCell>
                {!quantitiesOnly && <TableCell className="text-xs">{r.infertile_eggs ? fmtNum(r.infertile_eggs * 50) : "—"}</TableCell>}
                <TableCell className="text-xs">{r.candle2_dead || "—"}</TableCell>
                {!quantitiesOnly && <TableCell className="text-xs">{r.candle2_dead ? fmtNum(r.candle2_dead * 100) : "—"}</TableCell>}
                <TableCell className="text-xs">{hatchMort || "—"}</TableCell>
                {!quantitiesOnly && <TableCell className="text-xs">{hatchMort ? fmtNum(hatchMort * 100) : "—"}</TableCell>}
                <TableCell className="text-xs">{r.chicks || "—"}</TableCell>
                {!quantitiesOnly && <TableCell className="text-xs">{r.chicks ? fmtNum(r.chicks * 150) : "—"}</TableCell>}
                <TableCell className="text-xs">{r.brooding_days ? `${r.brooding_chicks}×${r.brooding_days}` : "—"}</TableCell>
                {!quantitiesOnly && <>
                  <TableCell className="text-xs">{r.discount ? fmtNum(r.discount, 2) : "—"}</TableCell>
                  <TableCell className="text-xs font-medium text-red-600">{r.debit ? fmtNum(r.debit, 2) : "—"}</TableCell>
                  <TableCell className="text-xs font-medium text-green-600">{r.credit ? fmtNum(r.credit, 2) : "—"}</TableCell>
                  <TableCell className="text-xs font-bold">{fmtNum(r.running_balance, 2)}</TableCell>
                  <TableCell className="text-xs">{r.payment_method || "—"}</TableCell>
                  <TableCell className="text-xs">
                    <Badge variant={ti.affected ? "default" : "outline"} className={ti.affected ? "bg-emerald-600 hover:bg-emerald-600" : ""}>
                      {ti.label}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">{r.receipt_no || "—"}</TableCell>
                </>}
                <TableCell className="text-xs max-w-[160px] truncate">{r.notes || "—"}</TableCell>
              </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
