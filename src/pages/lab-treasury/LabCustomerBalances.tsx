import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Printer, FileDown, ExternalLink } from "lucide-react";
import { openPrintWindow, escapeHtml, fmtNum, fmtDate } from "@/lib/printPdf";

type Row = {
  customer_id: string; name: string; customer_type: string | null;
  total_debit: number; total_credit: number; balance: number;
  batches_count: number; last_batch_date: string | null;
  last_payment_date: string | null; account_status: string;
};

const STATUS_LABEL: Record<string, { label: string; variant: any }> = {
  no_activity: { label: "لا يوجد رصيد", variant: "outline" },
  settled: { label: "مسدد بالكامل", variant: "secondary" },
  credit_balance: { label: "له رصيد مقدم", variant: "default" },
  partially_paid: { label: "مسدد جزئيًا", variant: "default" },
  outstanding: { label: "عليه مديونية", variant: "destructive" },
};

export default function LabCustomerBalances() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  useEffect(() => {
    setLoading(true);
    supabase
      .from("v_lab_customer_balances")
      .select("*")
      .order("balance", { ascending: false })
      .then(({ data }) => {
        setRows((data || []) as Row[]);
        setLoading(false);
      });
  }, []);

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (statusFilter !== "all" && r.account_status !== statusFilter) return false;
      if (search.trim() && !r.name.toLowerCase().includes(search.trim().toLowerCase())) return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  const totals = useMemo(() => ({
    debit: filtered.reduce((a, r) => a + Number(r.total_debit || 0), 0),
    credit: filtered.reduce((a, r) => a + Number(r.total_credit || 0), 0),
    balance: filtered.reduce((a, r) => a + Number(r.balance || 0), 0),
    customers: filtered.length,
  }), [filtered]);

  const printPdf = () => {
    const stats = `<div class="stats">
      <div class="stat"><div class="k">عدد العملاء</div><div class="v num">${totals.customers}</div></div>
      <div class="stat"><div class="k">إجمالي المستحقات</div><div class="v num">${fmtNum(totals.debit, 2)}</div></div>
      <div class="stat"><div class="k">إجمالي المدفوعات</div><div class="v num">${fmtNum(totals.credit, 2)}</div></div>
      <div class="stat"><div class="k">صافي الرصيد</div><div class="v num">${fmtNum(totals.balance, 2)}</div></div>
    </div>`;
    const body = `
      <header><div><h1>أرصدة عملاء معمل التفريخ</h1></div>
      <div class="meta">${fmtDate(new Date())}</div></header>
      ${stats}
      <table><thead><tr>
        <th>العميل</th><th>الدفعات</th><th>مستحقات</th><th>مدفوعات</th>
        <th>الرصيد</th><th>آخر دفعة</th><th>آخر تحصيل</th><th>الحالة</th>
      </tr></thead><tbody>
      ${filtered.map(r => `<tr>
        <td>${escapeHtml(r.name)}${r.customer_type === "internal" ? " (داخلي)" : ""}</td>
        <td class="num">${r.batches_count}</td>
        <td class="num">${fmtNum(r.total_debit, 2)}</td>
        <td class="num">${fmtNum(r.total_credit, 2)}</td>
        <td class="num"><b>${fmtNum(r.balance, 2)}</b></td>
        <td>${r.last_batch_date || "—"}</td>
        <td>${r.last_payment_date || "—"}</td>
        <td>${STATUS_LABEL[r.account_status]?.label || r.account_status}</td>
      </tr>`).join("")}
      </tbody></table>`;
    openPrintWindow("أرصدة عملاء معمل التفريخ", body);
  };

  const exportCsv = () => {
    const headers = ["العميل","النوع","عدد الدفعات","إجمالي المستحقات","إجمالي المدفوعات","الرصيد","آخر دفعة","آخر تحصيل","الحالة"];
    const lines = [headers.join(",")];
    filtered.forEach(r => {
      lines.push([
        r.name, r.customer_type || "external", r.batches_count,
        r.total_debit, r.total_credit, r.balance,
        r.last_batch_date || "", r.last_payment_date || "",
        STATUS_LABEL[r.account_status]?.label || r.account_status,
      ].map(v => `"${String(v ?? "").replace(/"/g,'""')}"`).join(","));
    });
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lab-balances-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">أرصدة عملاء معمل التفريخ</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCsv}><FileDown className="w-4 h-4 ml-1" />CSV</Button>
          <Button onClick={printPdf}><Printer className="w-4 h-4 ml-1" />PDF</Button>
        </div>
      </div>

      <Card className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="text-xs text-muted-foreground">اسم العميل</label>
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="ابحث…" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">حالة الحساب</label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">الكل</SelectItem>
              <SelectItem value="outstanding">عليه مديونية</SelectItem>
              <SelectItem value="partially_paid">مسدد جزئيًا</SelectItem>
              <SelectItem value="settled">مسدد بالكامل</SelectItem>
              <SelectItem value="credit_balance">له رصيد مقدم</SelectItem>
              <SelectItem value="no_activity">لا يوجد رصيد</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Card className="p-3"><div className="text-xs text-muted-foreground">عدد العملاء</div><div className="text-lg font-bold">{totals.customers}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">إجمالي المستحقات</div><div className="text-lg font-bold">{fmtNum(totals.debit, 2)}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">إجمالي المدفوعات</div><div className="text-lg font-bold text-green-600">{fmtNum(totals.credit, 2)}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">صافي الرصيد</div><div className={`text-lg font-bold ${totals.balance > 0 ? "text-red-600" : ""}`}>{fmtNum(totals.balance, 2)}</div></Card>
      </div>

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>العميل</TableHead>
              <TableHead>عدد الدفعات</TableHead>
              <TableHead>إجمالي المستحقات</TableHead>
              <TableHead>إجمالي المدفوعات</TableHead>
              <TableHead>الرصيد</TableHead>
              <TableHead>آخر دفعة</TableHead>
              <TableHead>آخر تحصيل</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <TableRow><TableCell colSpan={9} className="text-center py-8">جاري التحميل…</TableCell></TableRow>}
            {!loading && filtered.length === 0 && <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">لا توجد بيانات</TableCell></TableRow>}
            {filtered.map(r => {
              const s = STATUS_LABEL[r.account_status] || { label: r.account_status, variant: "outline" };
              return (
                <TableRow key={r.customer_id}>
                  <TableCell className="font-medium">
                    {r.name}
                    {r.customer_type === "internal" && <Badge variant="outline" className="mr-2">داخلي</Badge>}
                  </TableCell>
                  <TableCell>{r.batches_count}</TableCell>
                  <TableCell>{fmtNum(r.total_debit, 2)}</TableCell>
                  <TableCell className="text-green-600">{fmtNum(r.total_credit, 2)}</TableCell>
                  <TableCell className={`font-bold ${r.balance > 0 ? "text-red-600" : r.balance < 0 ? "text-blue-600" : ""}`}>{fmtNum(r.balance, 2)}</TableCell>
                  <TableCell>{r.last_batch_date || "—"}</TableCell>
                  <TableCell>{r.last_payment_date || "—"}</TableCell>
                  <TableCell><Badge variant={s.variant}>{s.label}</Badge></TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => navigate(`/lab-treasury/customer-statement?customer=${r.customer_id}`)}>
                      <ExternalLink className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
