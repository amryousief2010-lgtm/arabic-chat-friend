import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Printer, FileDown } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { openPrintWindow, escapeHtml, fmtNum, fmtDate } from "@/lib/printPdf";
import { toast } from "sonner";

type Customer = { id: string; name: string; customer_type: string | null };
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
  const [quantitiesOnly, setQuantitiesOnly] = useState(false);
  const [loading, setLoading] = useState(false);


  useEffect(() => {
    supabase
      .from("hatch_customers")
      .select("id,name,customer_type")
      .eq("is_active", true)
      .eq("is_test", false)
      .order("name")
      .then(({ data }) => {
        const list = data || [];
        list.sort((a: any, b: any) => {
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
    if (!customerId) { setRows([]); setLotsByBatch({}); return; }
    setLoading(true);
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
    ]).then(([ledRes, lotRes]: any) => {
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
      setLoading(false);
    });
    setParams(prev => {
      const p = new URLSearchParams(prev);
      p.set("customer", customerId);
      if (from) p.set("from", from); else p.delete("from");
      if (to) p.set("to", to); else p.delete("to");
      return p;
    }, { replace: true });
  }, [customerId, from, to, batchFilter]);

  const summary = useMemo(() => {
    const debit = rows.reduce((a, r) => a + Number(r.debit || 0), 0);
    const credit = rows.reduce((a, r) => a + Number(r.credit || 0), 0);
    const batches = rows.filter(r => r.entry_type === "batch_charge").length;
    const lastBatch = rows.filter(r => r.entry_type === "batch_charge").slice(-1)[0]?.entry_date || null;
    const lastPay = rows.filter(r => ["collection","internal_settlement","historical_closeout"].includes(r.entry_type)).slice(-1)[0]?.entry_date || null;
    return { debit, credit, balance: debit - credit, batches, lastBatch, lastPay };
  }, [rows]);

  const selectedCustomer = customers.find(c => c.id === customerId);

  const printPdf = () => {
    if (!selectedCustomer) return;

    // Group rows by batch_number / operational_batch_no
    type Agg = {
      key: string;
      label: string;
      entry_date: string;
      eggs: number;
      lait: number;
      candle2: number;
      hatchMort: number;
      chicks: number;
      broodChicks: number;
      broodDays: number;
      debit: number;
      credit: number;
    };
    const map = new Map<string, Agg>();
    rows.forEach(r => {
      const k = String(r.operational_batch_no ?? r.batch_number ?? "");
      if (!k) return;
      const lot = lotsByBatch[k];
      let a = map.get(k);
      if (!a) {
        a = { key: k, label: k, entry_date: r.entry_date, eggs: lot?.eggs_in || 0, lait: 0, candle2: 0, hatchMort: lot?.hatch_mortality || 0, chicks: 0, broodChicks: 0, broodDays: 0, debit: 0, credit: 0 };
        map.set(k, a);
      }
      if (r.entry_type === "batch_charge") {
        a.entry_date = r.entry_date;
        a.lait += Number(r.infertile_eggs || 0);
        a.candle2 += Number(r.candle2_dead || 0);
        a.chicks += Number(r.chicks || 0);
        if (r.brooding_days) { a.broodChicks = Number(r.brooding_chicks || 0); a.broodDays = Number(r.brooding_days || 0); }
        a.debit += Number(r.debit || 0);
      } else {
        a.credit += Number(r.credit || 0);
        a.debit += Number(r.debit || 0); // adjustments
      }
    });
    const batches = Array.from(map.values()).sort((x, y) => (x.entry_date || "").localeCompare(y.entry_date || ""));

    const totals = batches.reduce((t, b) => ({
      eggs: t.eggs + b.eggs, lait: t.lait + b.lait, candle2: t.candle2 + b.candle2,
      hatchMort: t.hatchMort + b.hatchMort, chicks: t.chicks + b.chicks,
      broodTotal: t.broodTotal + (b.broodChicks * b.broodDays),
      debit: t.debit + b.debit, credit: t.credit + b.credit,
    }), { eggs: 0, lait: 0, candle2: 0, hatchMort: 0, chicks: 0, broodTotal: 0, debit: 0, credit: 0 });

    const P = pricing;
    const batchRows = batches.map(b => {
      const laitFee = b.lait * P.infertile_egg_price;
      const candle2Fee = b.candle2 * P.completed_unhatched_price;
      const hatchMortFee = b.hatchMort * P.hatch_mortality_price;
      const chicksFee = b.chicks * P.chick_price;
      const broodFee = b.broodChicks * b.broodDays * P.daily_brooding_price;
      const hatchPct = b.eggs > 0 ? (b.chicks / b.eggs) * 100 : 0;
      const remaining = b.debit - b.credit;
      return `<tr>
        <td><b>${escapeHtml(b.label)}</b></td>
        <td>${fmtDate(b.entry_date)}</td>
        <td class="num">${fmtNum(b.eggs)}</td>
        <td class="num">${fmtNum(b.lait)}</td>
        <td class="num">${fmtNum(b.candle2)}</td>
        <td class="num">${fmtNum(b.hatchMort)}</td>
        <td class="num">${fmtNum(b.chicks)}</td>
        <td class="num">${b.broodDays ? `${fmtNum(b.broodChicks)}×${fmtNum(b.broodDays)}` : "—"}</td>
        <td class="num">${fmtNum(hatchPct, 1)}%</td>
        <td class="num">${fmtNum(laitFee, 2)}</td>
        <td class="num">${fmtNum(candle2Fee, 2)}</td>
        <td class="num">${fmtNum(hatchMortFee, 2)}</td>
        <td class="num">${fmtNum(chicksFee, 2)}</td>
        <td class="num">${fmtNum(broodFee, 2)}</td>
        <td class="num"><b>${fmtNum(b.debit, 2)}</b></td>
        <td class="num" style="color:#047857">${fmtNum(b.credit, 2)}</td>
        <td class="num"><b style="color:${remaining > 0 ? "#b91c1c" : "#047857"}">${fmtNum(remaining, 2)}</b></td>
      </tr>`;
    }).join("");

    const totalsRow = `<tr style="background:#ede9fe;font-weight:bold">
      <td colspan="2">الإجمالي</td>
      <td class="num">${fmtNum(totals.eggs)}</td>
      <td class="num">${fmtNum(totals.lait)}</td>
      <td class="num">${fmtNum(totals.candle2)}</td>
      <td class="num">${fmtNum(totals.hatchMort)}</td>
      <td class="num">${fmtNum(totals.chicks)}</td>
      <td class="num">${fmtNum(totals.broodTotal)}</td>
      <td class="num">${totals.eggs > 0 ? fmtNum((totals.chicks / totals.eggs) * 100, 1) + "%" : "—"}</td>
      <td class="num">${fmtNum(totals.lait * P.infertile_egg_price, 2)}</td>
      <td class="num">${fmtNum(totals.candle2 * P.completed_unhatched_price, 2)}</td>
      <td class="num">${fmtNum(totals.hatchMort * P.hatch_mortality_price, 2)}</td>
      <td class="num">${fmtNum(totals.chicks * P.chick_price, 2)}</td>
      <td class="num">${fmtNum(totals.broodTotal * P.daily_brooding_price, 2)}</td>
      <td class="num">${fmtNum(totals.debit, 2)}</td>
      <td class="num">${fmtNum(totals.credit, 2)}</td>
      <td class="num">${fmtNum(totals.debit - totals.credit, 2)}</td>
    </tr>`;

    const headerStats = `<div class="stats">
      <div class="stat"><div class="k">عدد الدفعات</div><div class="v num">${fmtNum(batches.length)}</div></div>
      <div class="stat"><div class="k">إجمالي المستحقات</div><div class="v num">${fmtNum(summary.debit, 2)}</div></div>
      <div class="stat"><div class="k">إجمالي المدفوعات</div><div class="v num">${fmtNum(summary.credit, 2)}</div></div>
      <div class="stat"><div class="k">الرصيد المتبقي</div><div class="v num">${fmtNum(summary.balance, 2)}</div></div>
    </div>`;

    const tableRows = rows.map(r => {
      const ti = treasuryImpact(r);
      return `<tr>
      <td>${fmtDate(r.entry_date)}</td>
      <td>${escapeHtml(r.operational_batch_no ?? r.batch_number ?? "—")}</td>
      <td>${escapeHtml(ENTRY_LABEL[r.entry_type] || r.entry_type)}</td>
      <td>${escapeHtml(r.description ?? "")}</td>
      <td class="num">${r.infertile_eggs || "—"}</td>
      <td class="num">${r.candle2_dead || "—"}</td>
      <td class="num">${r.chicks || "—"}</td>
      <td class="num">${r.brooding_days ? `${r.brooding_chicks}×${r.brooding_days}` : "—"}</td>
      <td class="num">${fmtNum(r.debit, 2)}</td>
      <td class="num">${fmtNum(r.credit, 2)}</td>
      <td class="num"><b>${fmtNum(r.running_balance, 2)}</b></td>
      <td>${escapeHtml(r.payment_method ?? "")}</td>
      <td style="color:${ti.affected ? "#047857" : "#6b7280"}">${escapeHtml(ti.label)}</td>
      <td>${escapeHtml(r.notes ?? "")}</td>
    </tr>`;
    }).join("");

    const body = `
      <header>
        <div>
          <h1>شركة نعام العاصمة — معمل تفريخ بيض النعام</h1>
          <div style="font-size:11px;color:#444">الهوت لاين: 01044437790</div>
          <div style="font-size:14px;font-weight:bold;margin-top:6px">كشف حساب عميل معمل التفريخ</div>
          <div style="margin-top:4px">العميل: <b>${escapeHtml(selectedCustomer.name)}</b>${selectedCustomer.customer_type === "internal" ? " (داخلي)" : ""}</div>
        </div>
        <div class="meta">تاريخ التقرير: ${fmtDate(new Date())}<br/>${from ? `من ${from}` : ""} ${to ? `إلى ${to}` : ""}</div>
      </header>
      ${headerStats}
      <h2>تفاصيل الدفعات (تشغيلي + مالي)</h2>
      <table>
        <thead><tr>
          <th>الدفعة</th><th>تاريخ الدخول</th>
          <th>بيض</th><th>لايح</th><th>كشف 2</th><th>نافق هاتشر</th><th>كتاكيت</th><th>تحضين</th><th>% فقس</th>
          <th>رسوم لايح</th><th>رسوم كشف 2</th><th>رسوم نافق هاتشر</th><th>رسوم كتاكيت</th><th>رسوم تحضين</th>
          <th>مدين</th><th>دائن</th><th>المتبقي</th>
        </tr></thead>
        <tbody>${batchRows}${totalsRow}</tbody>
      </table>
      <h2>تفاصيل الحركات المالية</h2>
      <table>
        <thead><tr>
          <th>التاريخ</th><th>الدفعة</th><th>نوع الحركة</th><th>البيان</th>
          <th>لايح</th><th>كشف 2</th><th>كتاكيت</th><th>تحضين</th>
          <th>مدين</th><th>دائن</th><th>الرصيد</th><th>طريقة الدفع</th>
          <th>تأثير الخزنة</th><th>ملاحظات</th>
        </tr></thead>
        <tbody>${tableRows}</tbody>
      </table>`;
    openPrintWindow(`كشف حساب — ${selectedCustomer.name}`, body);
  };

  const exportCsv = () => {
    if (!rows.length) return;
    const headers = ["التاريخ","رقم الدفعة","نوع الحركة","البيان","لايح","قيمة لايح","كشف2","قيمة كشف2","كتاكيت","قيمة كتاكيت","تحضين أيام","خصم","مدين","دائن","الرصيد","طريقة الدفع","إيصال","ملاحظات"];
    const lines = [headers.join(",")];
    rows.forEach(r => {
      const vals = [
        r.entry_date, r.operational_batch_no ?? r.batch_number ?? "",
        ENTRY_LABEL[r.entry_type] || r.entry_type, (r.description||"").replace(/,/g," "),
        r.infertile_eggs, r.infertile_eggs*pricing.infertile_egg_price, r.candle2_dead, r.candle2_dead*pricing.completed_unhatched_price,
        r.chicks, r.chicks*pricing.chick_price, r.brooding_days, r.discount,
        r.debit, r.credit, r.running_balance,
        r.payment_method||"", r.receipt_no||"", (r.notes||"").replace(/,/g," "),
      ];
      lines.push(vals.map(v => `"${String(v ?? "").replace(/"/g,'""')}"`).join(","));
    });

    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lab-statement-${selectedCustomer?.name || "customer"}-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">كشف حساب عملاء معمل التفريخ</h1>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Switch checked={quantitiesOnly} onCheckedChange={setQuantitiesOnly} />
            <span>كميات فقط (إخفاء الأرقام المالية)</span>
          </label>
          <Button variant="outline" onClick={exportCsv} disabled={!rows.length}>
            <FileDown className="w-4 h-4 ml-1" />Excel/CSV
          </Button>
          <Button onClick={printPdf} disabled={!rows.length}>
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
