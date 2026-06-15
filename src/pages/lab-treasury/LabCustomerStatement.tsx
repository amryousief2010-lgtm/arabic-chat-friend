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
  }, []);

  useEffect(() => {
    if (!customerId) { setRows([]); return; }
    setLoading(true);
    let q = supabase
      .from("lab_customer_ledger")
      .select("*")
      .eq("customer_id", customerId)
      .order("entry_date", { ascending: true })
      .order("created_at", { ascending: true });
    if (from) q = q.gte("entry_date", from);
    if (to) q = q.lte("entry_date", to);
    q.then(({ data, error }) => {
      if (error) toast.error(error.message);
      let list = (data || []) as LedgerRow[];
      if (batchFilter.trim()) {
        const b = batchFilter.trim();
        list = list.filter(r =>
          (r.batch_number || "").includes(b) ||
          String(r.operational_batch_no ?? "").includes(b)
        );
      }
      setRows(list);
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
    const headerStats = `<div class="stats">
      <div class="stat"><div class="k">إجمالي المستحقات</div><div class="v num">${fmtNum(summary.debit, 2)}</div></div>
      <div class="stat"><div class="k">إجمالي المدفوعات</div><div class="v num">${fmtNum(summary.credit, 2)}</div></div>
      <div class="stat"><div class="k">الرصيد المتبقي</div><div class="v num">${fmtNum(summary.balance, 2)}</div></div>
      <div class="stat"><div class="k">عدد الدفعات</div><div class="v num">${fmtNum(summary.batches)}</div></div>
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
        <div><h1>كشف حساب عميل معمل التفريخ</h1>
          <div>${escapeHtml(selectedCustomer.name)}${selectedCustomer.customer_type === "internal" ? " (داخلي)" : ""}</div>
        </div>
        <div class="meta">تاريخ التقرير: ${fmtDate(new Date())}<br/>${from ? `من ${from}` : ""} ${to ? `إلى ${to}` : ""}</div>
      </header>
      ${headerStats}
      <h2>تفاصيل الحركات</h2>
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
        r.infertile_eggs, r.infertile_eggs*50, r.candle2_dead, r.candle2_dead*100,
        r.chicks, r.chicks*150, r.brooding_days, r.discount,
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
        <div className="flex gap-2">
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
              <TableHead>لايح</TableHead>
              <TableHead>قيمة لايح</TableHead>
              <TableHead>كشف 2</TableHead>
              <TableHead>قيمة كشف 2</TableHead>
              <TableHead>كتاكيت</TableHead>
              <TableHead>قيمة كتاكيت</TableHead>
              <TableHead>تحضين</TableHead>
              <TableHead>خصم</TableHead>
              <TableHead>مدين</TableHead>
              <TableHead>دائن</TableHead>
              <TableHead>الرصيد</TableHead>
              <TableHead>طريقة الدفع</TableHead>
              <TableHead>تأثير الخزنة</TableHead>
              <TableHead>إيصال</TableHead>
              <TableHead>ملاحظات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!customerId && (
              <TableRow><TableCell colSpan={18} className="text-center text-muted-foreground py-8">اختر عميلًا لعرض كشف الحساب</TableCell></TableRow>
            )}
            {customerId && loading && (
              <TableRow><TableCell colSpan={18} className="text-center py-8">جاري التحميل…</TableCell></TableRow>
            )}
            {customerId && !loading && rows.length === 0 && (
              <TableRow><TableCell colSpan={18} className="text-center text-muted-foreground py-8">لا توجد حركات</TableCell></TableRow>
            )}
            {rows.map(r => (
              <TableRow key={r.id}>
                <TableCell className="whitespace-nowrap text-xs">{r.entry_date}</TableCell>
                <TableCell className="text-xs">{r.operational_batch_no ?? r.batch_number ?? "—"}</TableCell>
                <TableCell><Badge variant={r.entry_type === "batch_charge" ? "destructive" : "secondary"}>{ENTRY_LABEL[r.entry_type] || r.entry_type}</Badge></TableCell>
                <TableCell className="text-xs max-w-[200px] truncate">{r.description || "—"}</TableCell>
                <TableCell className="text-xs">{r.infertile_eggs || "—"}</TableCell>
                <TableCell className="text-xs">{r.infertile_eggs ? fmtNum(r.infertile_eggs * 50) : "—"}</TableCell>
                <TableCell className="text-xs">{r.candle2_dead || "—"}</TableCell>
                <TableCell className="text-xs">{r.candle2_dead ? fmtNum(r.candle2_dead * 100) : "—"}</TableCell>
                <TableCell className="text-xs">{r.chicks || "—"}</TableCell>
                <TableCell className="text-xs">{r.chicks ? fmtNum(r.chicks * 150) : "—"}</TableCell>
                <TableCell className="text-xs">{r.brooding_days ? `${r.brooding_chicks}×${r.brooding_days}` : "—"}</TableCell>
                <TableCell className="text-xs">{r.discount ? fmtNum(r.discount, 2) : "—"}</TableCell>
                <TableCell className="text-xs font-medium text-red-600">{r.debit ? fmtNum(r.debit, 2) : "—"}</TableCell>
                <TableCell className="text-xs font-medium text-green-600">{r.credit ? fmtNum(r.credit, 2) : "—"}</TableCell>
                <TableCell className="text-xs font-bold">{fmtNum(r.running_balance, 2)}</TableCell>
                <TableCell className="text-xs">{r.payment_method || "—"}</TableCell>
                <TableCell className="text-xs">{r.receipt_no || "—"}</TableCell>
                <TableCell className="text-xs max-w-[160px] truncate">{r.notes || "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
