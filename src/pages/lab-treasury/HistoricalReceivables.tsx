import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { fmtNum, openPrintWindow, escapeHtml } from "@/lib/printPdf";
import { Printer, FileSpreadsheet, Plus, CheckCircle2, AlertTriangle, Wallet } from "lucide-react";

type Status = "unpaid" | "partial" | "paid";
const ST_LBL: Record<Status, string> = { unpaid: "غير مسدد", partial: "مسدد جزئيًا", paid: "مسدد بالكامل" };
const ST_COLOR: Record<Status, string> = {
  unpaid: "bg-red-100 text-red-700 border-red-300",
  partial: "bg-amber-100 text-amber-700 border-amber-300",
  paid: "bg-green-100 text-green-700 border-green-300",
};

interface Head {
  id: string; title: string; total_amount: number; paid_amount: number;
  status: Status; note: string | null; created_at: string;
}
interface Item { id: string; entry_date: string; description: string; amount: number; }
interface Settlement {
  id: string; amount: number; settlement_date: string; note: string | null;
  status: "pending" | "approved" | "rejected";
  created_by: string | null; approved_by: string | null; approved_at: string | null; created_at: string;
}

const fmtDateAr = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("ar-EG-u-nu-latn");

export default function HistoricalReceivables() {
  const { user, isGeneralManager, isExecutiveManager, roles } = useAuth();
  const isApprover = isGeneralManager || isExecutiveManager || roles.includes("lab_treasury_approver");
  const canRequestPayment =
    isApprover ||
    roles.includes("lab_treasury_keeper") ||
    roles.includes("slaughterhouse_custody_keeper") ||
    roles.includes("slaughterhouse_manager");

  const [head, setHead] = useState<Head | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [loading, setLoading] = useState(true);
  const [payOpen, setPayOpen] = useState(false);
  const [payForm, setPayForm] = useState({ amount: "" as any, settlement_date: new Date().toISOString().slice(0, 10), note: "" });

  async function load() {
    setLoading(true);
    const { data: heads } = await (supabase as any)
      .from("lab_treasury_historical_receivables")
      .select("*")
      .order("created_at", { ascending: true })
      .limit(1);
    const h = (heads || [])[0] as Head | undefined;
    if (!h) { setHead(null); setItems([]); setSettlements([]); setLoading(false); return; }
    setHead(h);
    const [{ data: its }, { data: sts }] = await Promise.all([
      (supabase as any).from("lab_treasury_historical_receivable_items").select("*").eq("receivable_id", h.id).order("entry_date", { ascending: true }),
      (supabase as any).from("lab_treasury_historical_receivable_settlements").select("*").eq("receivable_id", h.id).order("created_at", { ascending: false }),
    ]);
    setItems((its || []) as Item[]);
    setSettlements((sts || []) as Settlement[]);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const remaining = useMemo(() => Math.max(0, Number(head?.total_amount || 0) - Number(head?.paid_amount || 0)), [head]);
  const itemsTotal = useMemo(() => items.reduce((s, r) => s + Number(r.amount || 0), 0), [items]);

  async function submitPayment() {
    if (!head) return;
    const amt = Number(payForm.amount || 0);
    if (!(amt > 0)) { toast.error("أدخل مبلغًا صحيحًا أكبر من صفر"); return; }
    if (amt > remaining) { toast.error("المبلغ أكبر من المتبقي للسداد"); return; }
    const { error } = await (supabase as any).from("lab_treasury_historical_receivable_settlements").insert({
      receivable_id: head.id,
      amount: amt,
      settlement_date: payForm.settlement_date,
      note: payForm.note || null,
      status: "pending",
      created_by: user?.id ?? null,
    });
    if (error) { toast.error("تعذر تسجيل الدفعة: " + error.message); return; }
    toast.success("تم تسجيل دفعة السداد بانتظار الاعتماد");
    setPayOpen(false);
    setPayForm({ amount: "", settlement_date: new Date().toISOString().slice(0, 10), note: "" });
    load();
  }

  async function approveSettlement(s: Settlement) {
    if (!isApprover) return;
    const { error } = await (supabase as any).from("lab_treasury_historical_receivable_settlements")
      .update({ status: "approved", approved_by: user?.id ?? null, approved_at: new Date().toISOString() })
      .eq("id", s.id);
    if (error) { toast.error("تعذر الاعتماد: " + error.message); return; }
    toast.success("تم اعتماد دفعة السداد");
    load();
  }
  async function rejectSettlement(s: Settlement) {
    if (!isApprover) return;
    const { error } = await (supabase as any).from("lab_treasury_historical_receivable_settlements")
      .update({ status: "rejected", approved_by: user?.id ?? null, approved_at: new Date().toISOString() })
      .eq("id", s.id);
    if (error) { toast.error("تعذر الرفض: " + error.message); return; }
    toast.success("تم رفض الدفعة");
    load();
  }

  function exportExcel() {
    if (!head) return;
    const rows = [
      ["#", "التاريخ", "البيان", "المبلغ"].join(","),
      ...items.map((it, i) => [i + 1, it.entry_date, `"${it.description.replace(/"/g, '""')}"`, Number(it.amount)].join(",")),
      ["", "", "الإجمالي", Number(head.total_amount)].join(","),
      ["", "", "المسدد", Number(head.paid_amount)].join(","),
      ["", "", "المتبقي", remaining].join(","),
      ["", "", "ملاحظة", `"${(head.note || "").replace(/"/g, '""')}"`].join(","),
    ].join("\n");
    const blob = new Blob(["\uFEFF" + rows], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `lab_historical_receivables_${head.id.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function print() {
    if (!head) return;
    const itemsHtml = items.map((it, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(fmtDateAr(it.entry_date))}</td>
        <td>${escapeHtml(it.description)}</td>
        <td class="num">${fmtNum(it.amount, 2)}</td>
      </tr>`).join("");
    const settlementsHtml = settlements.length
      ? `<h2>دفعات السداد</h2>
         <table><thead><tr><th>التاريخ</th><th>المبلغ</th><th>الحالة</th><th>ملاحظة</th></tr></thead>
         <tbody>${settlements.map(s => `
           <tr><td>${escapeHtml(fmtDateAr(s.settlement_date))}</td>
           <td class="num">${fmtNum(s.amount, 2)}</td>
           <td>${s.status === "approved" ? "معتمدة" : s.status === "rejected" ? "مرفوضة" : "بانتظار الاعتماد"}</td>
           <td>${escapeHtml(s.note || "—")}</td></tr>`).join("")}
         </tbody></table>`
      : "";
    const body = `
      <header>
        <div><h1>${escapeHtml(head.title)}</h1><div class="en">Lab Treasury — Historical Receivables at Slaughterhouse</div></div>
        <div class="meta">تاريخ التقرير: ${new Date().toLocaleString("ar-EG-u-nu-latn")}</div>
      </header>
      <div class="stats">
        <div class="stat"><div class="k">إجمالي المستحق</div><div class="v num">${fmtNum(head.total_amount, 2)} ج</div></div>
        <div class="stat"><div class="k">المسدد</div><div class="v num">${fmtNum(head.paid_amount, 2)} ج</div></div>
        <div class="stat"><div class="k">المتبقي</div><div class="v num">${fmtNum(remaining, 2)} ج</div></div>
        <div class="stat"><div class="k">الحالة</div><div class="v">${ST_LBL[head.status]}</div></div>
      </div>
      ${head.note ? `<div style="background:#fff8e1;border:1px solid #f0c36d;padding:8px;border-radius:6px;margin-bottom:10px"><b>ملاحظة:</b> ${escapeHtml(head.note)}</div>` : ""}
      <h2>تفريدة البنود (${items.length})</h2>
      <table><thead><tr><th>#</th><th>التاريخ</th><th>البيان</th><th>المبلغ</th></tr></thead>
      <tbody>${itemsHtml}
      <tr><td colspan="3" style="text-align:left;font-weight:bold;background:#f5edff">الإجمالي</td><td class="num" style="font-weight:bold;background:#f5edff">${fmtNum(itemsTotal, 2)}</td></tr>
      </tbody></table>
      ${settlementsHtml}
      <div style="margin-top:20px;font-size:10px;color:#777">
        هذا التقرير لا يؤثر على رصيد خزنة المعمل الحالي ولا يدخل ضمن الليميت الأسبوعي للعهدة.
      </div>`;
    openPrintWindow(head.title, body);
  }

  if (loading) {
    return <div className="p-8 text-center text-muted-foreground">جارٍ التحميل…</div>;
  }
  if (!head) {
    return (
      <div className="p-8">
        <Alert><AlertTitle>لا يوجد سجل</AlertTitle>
          <AlertDescription>لم يتم العثور على سجل مستحقات تاريخية بعد.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Wallet className="w-6 h-6 text-primary" /> {head.title}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            سجل مستقل — لا يؤثر على رصيد خزنة المعمل الحالي ولا على الليميت الأسبوعي لعهدة المجزر.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportExcel}>
            <FileSpreadsheet className="w-4 h-4 ml-1" /> Excel
          </Button>
          <Button variant="outline" size="sm" onClick={print}>
            <Printer className="w-4 h-4 ml-1" /> طباعة
          </Button>
          {canRequestPayment && remaining > 0 && (
            <Button size="sm" onClick={() => setPayOpen(true)}>
              <Plus className="w-4 h-4 ml-1" /> تسجيل دفعة سداد
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">إجمالي المستحق</div>
          <div className="text-2xl font-bold text-primary mt-1">{fmtNum(head.total_amount, 2)} ج</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">المسدد</div>
          <div className="text-2xl font-bold text-green-600 mt-1">{fmtNum(head.paid_amount, 2)} ج</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">المتبقي</div>
          <div className="text-2xl font-bold text-amber-600 mt-1">{fmtNum(remaining, 2)} ج</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs text-muted-foreground">الحالة</div>
          <Badge className={`mt-2 text-sm ${ST_COLOR[head.status]}`} variant="outline">{ST_LBL[head.status]}</Badge>
        </CardContent></Card>
      </div>

      {head.note && (
        <Alert className="bg-amber-50 border-amber-300">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertTitle>ملاحظة منفصلة</AlertTitle>
          <AlertDescription className="font-bold text-base">{head.note}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader><CardTitle>تفريدة البنود ({items.length})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>التاريخ</TableHead>
                <TableHead>البيان</TableHead>
                <TableHead className="text-left">المبلغ (ج)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((it, i) => (
                <TableRow key={it.id}>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell className="whitespace-nowrap">{fmtDateAr(it.entry_date)}</TableCell>
                  <TableCell>{it.description}</TableCell>
                  <TableCell className="text-left font-mono">{fmtNum(it.amount, 2)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-primary/5 font-bold">
                <TableCell colSpan={3} className="text-left">الإجمالي</TableCell>
                <TableCell className="text-left font-mono">{fmtNum(itemsTotal, 2)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>دفعات السداد ({settlements.length})</CardTitle></CardHeader>
        <CardContent>
          {settlements.length === 0 ? (
            <div className="text-sm text-muted-foreground p-4 text-center">لا توجد دفعات سداد بعد.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>تاريخ السداد</TableHead>
                  <TableHead>المبلغ</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>ملاحظة</TableHead>
                  <TableHead>إجراء</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {settlements.map(s => (
                  <TableRow key={s.id}>
                    <TableCell className="whitespace-nowrap">{fmtDateAr(s.settlement_date)}</TableCell>
                    <TableCell className="font-mono">{fmtNum(s.amount, 2)} ج</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={
                        s.status === "approved" ? "bg-green-100 text-green-700 border-green-300"
                        : s.status === "rejected" ? "bg-red-100 text-red-700 border-red-300"
                        : "bg-amber-100 text-amber-700 border-amber-300"
                      }>
                        {s.status === "approved" ? "معتمدة" : s.status === "rejected" ? "مرفوضة" : "بانتظار الاعتماد"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{s.note || "—"}</TableCell>
                    <TableCell>
                      {s.status === "pending" && isApprover && (
                        <div className="flex gap-1">
                          <Button size="sm" variant="default" onClick={() => approveSettlement(s)}>
                            <CheckCircle2 className="w-3 h-3 ml-1" /> اعتماد
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => rejectSettlement(s)}>رفض</Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <p className="text-xs text-muted-foreground mt-3">
            عند اعتماد دفعة سداد يتم تحديث حالة المستحق تلقائيًا. لتسجيل توريد فعلي إلى خزنة المعمل لاحقًا، يتم ذلك يدويًا من شاشة خزنة المعمل بعد الاعتماد هنا.
          </p>
        </CardContent>
      </Card>

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>تسجيل دفعة سداد</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>المبلغ (ج)</Label>
              <Input type="number" value={payForm.amount} onChange={e => setPayForm({ ...payForm, amount: e.target.value })} placeholder={`المتبقي: ${fmtNum(remaining, 2)}`} />
            </div>
            <div>
              <Label>تاريخ السداد</Label>
              <Input type="date" value={payForm.settlement_date} onChange={e => setPayForm({ ...payForm, settlement_date: e.target.value })} />
            </div>
            <div>
              <Label>ملاحظة</Label>
              <Textarea value={payForm.note} onChange={e => setPayForm({ ...payForm, note: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>إلغاء</Button>
            <Button onClick={submitPayment}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
