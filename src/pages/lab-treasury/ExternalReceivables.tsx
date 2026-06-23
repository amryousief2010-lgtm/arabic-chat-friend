import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { fmtNum, openPrintWindow, escapeHtml } from "@/lib/printPdf";
import { Plus, Printer, FileSpreadsheet, Wallet, ArrowRight, Eye, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

type Party = "main_treasury" | "slaughter_custody" | "other";
type Status = "unpaid" | "partial" | "paid";
type Dest = "lab" | "main_treasury" | "slaughter_custody" | "other";

const PARTY_LBL: Record<Party, string> = {
  main_treasury: "الخزنة الرئيسية",
  slaughter_custody: "خزنة عهدة المجزر",
  other: "أخرى",
};
const ST_LBL: Record<Status, string> = { unpaid: "غير مسدد", partial: "مسدد جزئيًا", paid: "مسدد بالكامل" };
const ST_CLS: Record<Status, string> = {
  unpaid: "bg-red-100 text-red-700 border-red-300",
  partial: "bg-amber-100 text-amber-700 border-amber-300",
  paid: "bg-green-100 text-green-700 border-green-300",
};
const DEST_LBL: Record<Dest, string> = {
  lab: "خزنة المعمل والحضانات",
  main_treasury: "الخزنة الرئيسية",
  slaughter_custody: "خزنة عهدة المجزر",
  other: "أخرى",
};
const PM_LBL: Record<string, string> = {
  cash: "نقدي", vodafone_cash: "فودافون كاش", instapay: "إنستا باي", bank_transfer: "تحويل بنكي",
};

interface Receivable {
  id: string; party: Party; party_label: string | null; entry_date: string;
  description: string; amount: number; paid_amount: number; status: Status;
  notes: string | null; source_type: string | null; source_id: string | null;
  created_by: string | null; created_at: string;
}
interface Settlement {
  id: string; receivable_id: string; amount: number; settlement_date: string;
  destination_treasury: Dest; payment_method: string; notes: string | null;
  lab_movement_id: string | null; created_by: string | null; created_at: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const fmtDateAr = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("ar-EG-u-nu-latn");

interface Props { embedded?: boolean }
export default function ExternalReceivables({ embedded = false }: Props) {
  const navigate = useNavigate();
  const { user, isGeneralManager, isExecutiveManager, roles } = useAuth();
  const canWrite = isGeneralManager || isExecutiveManager || (roles || []).includes("lab_treasury_approver");

  const [rows, setRows] = useState<Receivable[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [loading, setLoading] = useState(true);

  // filters
  const [fParty, setFParty] = useState<string>("all");
  const [fStatus, setFStatus] = useState<string>("all");
  const [fFrom, setFFrom] = useState<string>("");
  const [fTo, setFTo] = useState<string>("");
  const [fSearch, setFSearch] = useState<string>("");

  // add dialog
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({
    party: "main_treasury" as Party, party_label: "",
    entry_date: today(), description: "", amount: "" as any, notes: "",
  });

  // pay dialog
  const [payDlg, setPayDlg] = useState<{ open: boolean; row: Receivable | null;
    amount: any; destination: Dest; payment_method: string;
    settlement_date: string; notes: string }>({
    open: false, row: null, amount: "", destination: "lab",
    payment_method: "cash", settlement_date: today(), notes: "",
  });

  // details dialog
  const [viewDlg, setViewDlg] = useState<{ open: boolean; row: Receivable | null }>({ open: false, row: null });

  async function load() {
    setLoading(true);
    const [r1, r2] = await Promise.all([
      (supabase as any).from("lab_treasury_external_receivables")
        .select("*").order("entry_date", { ascending: false }).limit(1000),
      (supabase as any).from("lab_treasury_external_receivable_settlements")
        .select("*").order("created_at", { ascending: false }).limit(2000),
    ]);
    if (r1.error) toast.error("فشل تحميل المستحقات: " + r1.error.message);
    setRows((r1.data || []) as Receivable[]);
    setSettlements((r2.data || []) as Settlement[]);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => rows.filter(r => {
    if (fParty !== "all" && r.party !== fParty) return false;
    if (fStatus !== "all" && r.status !== fStatus) return false;
    if (fFrom && r.entry_date < fFrom) return false;
    if (fTo && r.entry_date > fTo) return false;
    if (fSearch && !(`${r.description} ${r.party_label || ""} ${r.notes || ""}`).includes(fSearch)) return false;
    return true;
  }), [rows, fParty, fStatus, fFrom, fTo, fSearch]);

  const totals = useMemo(() => {
    const t = filtered.reduce((s, r) => ({
      total: s.total + Number(r.amount || 0),
      paid: s.paid + Number(r.paid_amount || 0),
      open: s.open + (r.status !== "paid" ? 1 : 0),
    }), { total: 0, paid: 0, open: 0 });
    return { ...t, remaining: t.total - t.paid };
  }, [filtered]);

  const grouped = useMemo(() => {
    const g: Record<Party, Receivable[]> = { main_treasury: [], slaughter_custody: [], other: [] };
    for (const r of filtered) g[r.party].push(r);
    return g;
  }, [filtered]);

  async function submitAdd() {
    const amt = Number(addForm.amount || 0);
    if (!(amt > 0)) return toast.error("المبلغ مطلوب");
    if (!addForm.description.trim()) return toast.error("البيان مطلوب");
    const { error } = await (supabase as any).from("lab_treasury_external_receivables").insert({
      party: addForm.party,
      party_label: addForm.party_label || PARTY_LBL[addForm.party],
      entry_date: addForm.entry_date,
      description: addForm.description.trim(),
      amount: amt,
      notes: addForm.notes || null,
      created_by: user?.id ?? null,
    });
    if (error) return toast.error("تعذر الإضافة: " + error.message);
    toast.success("تمت إضافة المستحق");
    setAddOpen(false);
    setAddForm({ party: "main_treasury", party_label: "", entry_date: today(), description: "", amount: "", notes: "" });
    load();
  }

  async function submitPay() {
    const r = payDlg.row; if (!r) return;
    const amt = Number(payDlg.amount || 0);
    const remaining = r.amount - r.paid_amount;
    if (!(amt > 0)) return toast.error("أدخل مبلغ سداد صحيح");
    if (amt > remaining + 0.001) return toast.error(`المتبقي ${fmtNum(remaining, 2)} فقط`);

    let labMovementId: string | null = null;
    if (payDlg.destination === "lab") {
      const { data: m, error: mErr } = await (supabase as any)
        .from("lab_treasury_movements").insert({
          movement_type: "income",
          movement_date: payDlg.settlement_date,
          income_category: "other",
          amount: amt,
          payment_method: payDlg.payment_method,
          customer_name: r.party_label || PARTY_LBL[r.party],
          description: `سداد مستحقات خزنة المعمل عند ${r.party_label || PARTY_LBL[r.party]} — ${r.description}`,
          notes: payDlg.notes || null,
          status: "pending",
          created_by: user?.id ?? null,
        }).select("id").single();
      if (mErr) return toast.error("تعذر تسجيل الإيراد: " + mErr.message);
      labMovementId = m?.id || null;
    }

    const { error } = await (supabase as any).from("lab_treasury_external_receivable_settlements").insert({
      receivable_id: r.id,
      amount: amt,
      settlement_date: payDlg.settlement_date,
      destination_treasury: payDlg.destination,
      payment_method: payDlg.payment_method,
      notes: payDlg.notes || null,
      lab_movement_id: labMovementId,
      created_by: user?.id ?? null,
    });
    if (error) return toast.error("تعذر تسجيل الدفعة: " + error.message);

    toast.success(payDlg.destination === "lab"
      ? "تم تسجيل السداد + إيراد بانتظار الاعتماد في خزنة المعمل"
      : "تم تسجيل السداد");
    setPayDlg({ ...payDlg, open: false, row: null, amount: "", notes: "" });
    load();
  }

  async function deleteReceivable(r: Receivable) {
    if (!canWrite) return;
    const paidCount = settlements.filter(s => s.receivable_id === r.id).length;
    if (paidCount > 0) return toast.error("لا يمكن حذف مستحق له دفعات سداد");
    if (!confirm(`حذف المستحق: ${r.description}?`)) return;
    const { error } = await (supabase as any).from("lab_treasury_external_receivables").delete().eq("id", r.id);
    if (error) return toast.error(error.message);
    toast.success("تم الحذف");
    load();
  }

  function exportExcel() {
    const head = ["#","التاريخ","الجهة","البيان","المبلغ","المسدد","المتبقي","الحالة","ملاحظات"].join(",");
    const lines = filtered.map((r, i) => [
      i+1, r.entry_date,
      `"${(r.party_label || PARTY_LBL[r.party]).replace(/"/g,'""')}"`,
      `"${r.description.replace(/"/g,'""')}"`,
      Number(r.amount), Number(r.paid_amount),
      Number(r.amount) - Number(r.paid_amount),
      ST_LBL[r.status],
      `"${(r.notes || "").replace(/"/g,'""')}"`,
    ].join(","));
    const totalsLine = ["","","","الإجمالي", totals.total, totals.paid, totals.remaining, "", ""].join(",");
    const csv = "\uFEFF" + [head, ...lines, totalsLine].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `lab_external_receivables_${today()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function printReport() {
    const sections = (Object.keys(grouped) as Party[]).map(p => {
      const list = grouped[p];
      if (!list.length) return "";
      const sum = list.reduce((s, r) => s + Number(r.amount), 0);
      const paid = list.reduce((s, r) => s + Number(r.paid_amount), 0);
      const rem = sum - paid;
      const trs = list.map((r, i) => `
        <tr>
          <td>${i+1}</td>
          <td>${escapeHtml(fmtDateAr(r.entry_date))}</td>
          <td>${escapeHtml(r.description)}</td>
          <td class="num">${fmtNum(r.amount, 2)}</td>
          <td class="num">${fmtNum(r.paid_amount, 2)}</td>
          <td class="num">${fmtNum(r.amount - r.paid_amount, 2)}</td>
          <td>${ST_LBL[r.status]}</td>
          <td>${escapeHtml(r.notes || "—")}</td>
        </tr>`).join("");
      return `<h2>${PARTY_LBL[p]} (${list.length})</h2>
        <table><thead><tr><th>#</th><th>التاريخ</th><th>البيان</th><th>المبلغ</th><th>المسدد</th><th>المتبقي</th><th>الحالة</th><th>ملاحظات</th></tr></thead>
        <tbody>${trs}
        <tr style="background:#f5edff;font-weight:bold">
          <td colspan="3" style="text-align:left">إجمالي ${PARTY_LBL[p]}</td>
          <td class="num">${fmtNum(sum,2)}</td>
          <td class="num">${fmtNum(paid,2)}</td>
          <td class="num">${fmtNum(rem,2)}</td>
          <td colspan="2"></td>
        </tr></tbody></table>`;
    }).join("");
    const body = `
      <header><div><h1>تقرير مستحقات خزنة المعمل عند الغير</h1>
      <div class="en">Lab Treasury Receivables Held by Others</div></div>
      <div class="meta">تاريخ: ${new Date().toLocaleString("ar-EG-u-nu-latn")}</div></header>
      <div class="stats">
        <div class="stat"><div class="k">إجمالي المستحقات</div><div class="v num">${fmtNum(totals.total,2)} ج</div></div>
        <div class="stat"><div class="k">المسدد</div><div class="v num">${fmtNum(totals.paid,2)} ج</div></div>
        <div class="stat"><div class="k">المتبقي</div><div class="v num">${fmtNum(totals.remaining,2)} ج</div></div>
        <div class="stat"><div class="k">بنود مفتوحة</div><div class="v">${totals.open}</div></div>
      </div>
      ${sections}
      <div style="margin-top:18px;font-size:10px;color:#777">
        هذا التقرير لا يؤثر على رصيد خزنة المعمل الحالي إلا عند تسجيل سداد فعلي.
      </div>`;
    openPrintWindow("تقرير مستحقات خزنة المعمل عند الغير", body);
  }

  const content = (
    <div className="container mx-auto p-4 space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          {!embedded && (
            <Button variant="outline" size="sm" onClick={() => navigate("/lab-treasury")}>
              <ArrowRight className="w-4 h-4 ml-1" /> رجوع
            </Button>
          )}
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Wallet className="w-6 h-6 text-primary" /> مستحقات خزنة المعمل عند الغير
            </h1>
            <p className="text-xs text-muted-foreground mt-1">
              مبالغ تخص خزنة المعمل موجودة أو مستحقة عند خزائن أخرى — لا تؤثر على رصيد المعمل إلا عند السداد الفعلي.
            </p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={printReport}><Printer className="w-4 h-4 ml-1" />طباعة</Button>
          <Button variant="outline" size="sm" onClick={exportExcel}><FileSpreadsheet className="w-4 h-4 ml-1" />Excel</Button>
          {canWrite && (
            <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="w-4 h-4 ml-1" />إضافة مستحق</Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">إجمالي المستحقات</div>
          <div className="text-2xl font-bold text-primary mt-1 font-mono">{fmtNum(totals.total,2)} ج</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">المسدد</div>
          <div className="text-2xl font-bold text-green-600 mt-1 font-mono">{fmtNum(totals.paid,2)} ج</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">المتبقي</div>
          <div className="text-2xl font-bold text-amber-600 mt-1 font-mono">{fmtNum(totals.remaining,2)} ج</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">بنود مفتوحة</div>
          <div className="text-2xl font-bold mt-1">{totals.open}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">فلاتر</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <div><Label className="text-xs">الجهة</Label>
              <Select value={fParty} onValueChange={setFParty}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {(Object.keys(PARTY_LBL) as Party[]).map(p => <SelectItem key={p} value={p}>{PARTY_LBL[p]}</SelectItem>)}
                </SelectContent>
              </Select></div>
            <div><Label className="text-xs">الحالة</Label>
              <Select value={fStatus} onValueChange={setFStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {(Object.keys(ST_LBL) as Status[]).map(s => <SelectItem key={s} value={s}>{ST_LBL[s]}</SelectItem>)}
                </SelectContent>
              </Select></div>
            <div><Label className="text-xs">من تاريخ</Label><Input type="date" value={fFrom} onChange={e => setFFrom(e.target.value)} /></div>
            <div><Label className="text-xs">إلى تاريخ</Label><Input type="date" value={fTo} onChange={e => setFTo(e.target.value)} /></div>
            <div><Label className="text-xs">بحث في البيان</Label><Input value={fSearch} onChange={e => setFSearch(e.target.value)} placeholder="..." /></div>
          </div>
        </CardContent>
      </Card>

      {loading ? <div className="p-8 text-center text-muted-foreground">جارٍ التحميل…</div> :
       (Object.keys(grouped) as Party[]).map(p => grouped[p].length > 0 && (
        <Card key={p}>
          <CardHeader><CardTitle className="text-base flex items-center justify-between">
            <span>{PARTY_LBL[p]} ({grouped[p].length})</span>
            <span className="text-sm text-muted-foreground font-normal">
              إجمالي: <b className="font-mono">{fmtNum(grouped[p].reduce((s,r)=>s+Number(r.amount),0),2)} ج</b>
              {" — متبقي: "}
              <b className="font-mono text-amber-600">{fmtNum(grouped[p].reduce((s,r)=>s+Number(r.amount)-Number(r.paid_amount),0),2)} ج</b>
            </span>
          </CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>التاريخ</TableHead><TableHead>البيان</TableHead>
                <TableHead>المبلغ</TableHead><TableHead>المسدد</TableHead><TableHead>المتبقي</TableHead>
                <TableHead>الحالة</TableHead><TableHead>المصدر</TableHead><TableHead>إجراءات</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {grouped[p].map(r => {
                  const rem = Number(r.amount) - Number(r.paid_amount);
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap">{fmtDateAr(r.entry_date)}</TableCell>
                      <TableCell>{r.description}</TableCell>
                      <TableCell className="font-mono">{fmtNum(r.amount, 2)}</TableCell>
                      <TableCell className="font-mono text-green-600">{fmtNum(r.paid_amount, 2)}</TableCell>
                      <TableCell className="font-mono text-amber-600">{fmtNum(rem, 2)}</TableCell>
                      <TableCell><Badge variant="outline" className={ST_CLS[r.status]}>{ST_LBL[r.status]}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.source_type ? "مرتبط" : "يدوي"}</TableCell>
                      <TableCell>
                        <div className="flex gap-1 flex-wrap">
                          <Button size="sm" variant="outline" onClick={() => setViewDlg({ open: true, row: r })}>
                            <Eye className="w-3 h-3 ml-1" />تفاصيل
                          </Button>
                          {canWrite && rem > 0 && (
                            <Button size="sm" onClick={() => setPayDlg({
                              open: true, row: r, amount: rem, destination: "lab",
                              payment_method: "cash", settlement_date: today(), notes: "",
                            })}>
                              <Plus className="w-3 h-3 ml-1" />تسجيل دفعة سداد
                            </Button>
                          )}
                          {canWrite && r.paid_amount === 0 && (
                            <Button size="sm" variant="outline" onClick={() => deleteReceivable(r)}>
                              <Trash2 className="w-3 h-3 text-red-600" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
       ))}
      {!loading && filtered.length === 0 && (
        <Card><CardContent className="p-8 text-center text-muted-foreground">لا توجد مستحقات مطابقة للفلاتر</CardContent></Card>
      )}

      {/* Add receivable */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>إضافة مستحق جديد</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>الجهة</Label>
              <Select value={addForm.party} onValueChange={(v) => setAddForm({ ...addForm, party: v as Party })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(PARTY_LBL) as Party[]).map(p => <SelectItem key={p} value={p}>{PARTY_LBL[p]}</SelectItem>)}
                </SelectContent>
              </Select></div>
            <div><Label>وصف الجهة (اختياري)</Label>
              <Input value={addForm.party_label} onChange={e => setAddForm({ ...addForm, party_label: e.target.value })}
                placeholder={PARTY_LBL[addForm.party]} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>التاريخ</Label><Input type="date" value={addForm.entry_date} onChange={e => setAddForm({ ...addForm, entry_date: e.target.value })} /></div>
              <div><Label>المبلغ (ج)</Label><Input type="number" step="0.01" value={addForm.amount} onChange={e => setAddForm({ ...addForm, amount: e.target.value })} /></div>
            </div>
            <div><Label>البيان</Label><Input value={addForm.description} onChange={e => setAddForm({ ...addForm, description: e.target.value })} /></div>
            <div><Label>ملاحظات</Label><Textarea value={addForm.notes} onChange={e => setAddForm({ ...addForm, notes: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>إلغاء</Button>
            <Button onClick={submitAdd}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pay dialog */}
      <Dialog open={payDlg.open} onOpenChange={(o) => setPayDlg({ ...payDlg, open: o })}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>تسجيل دفعة سداد</DialogTitle></DialogHeader>
          {payDlg.row && (
            <div className="space-y-3">
              <div className="text-sm bg-muted/40 p-2 rounded">
                <div><b>الجهة:</b> {payDlg.row.party_label || PARTY_LBL[payDlg.row.party]}</div>
                <div><b>البيان:</b> {payDlg.row.description}</div>
                <div><b>المتبقي:</b> <span className="font-mono">{fmtNum(payDlg.row.amount - payDlg.row.paid_amount, 2)} ج</span></div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>مبلغ السداد</Label><Input type="number" step="0.01" value={payDlg.amount} onChange={e => setPayDlg({ ...payDlg, amount: e.target.value })} /></div>
                <div><Label>تاريخ السداد</Label><Input type="date" value={payDlg.settlement_date} onChange={e => setPayDlg({ ...payDlg, settlement_date: e.target.value })} /></div>
              </div>
              <div><Label>الخزنة المستلمة للسداد</Label>
                <Select value={payDlg.destination} onValueChange={(v) => setPayDlg({ ...payDlg, destination: v as Dest })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(DEST_LBL) as Dest[]).map(d => <SelectItem key={d} value={d}>{DEST_LBL[d]}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground mt-1">
                  عند اختيار "خزنة المعمل" يتم إنشاء إيراد بانتظار الاعتماد تلقائيًا. باقي الخيارات تسجل السداد فقط دون إنشاء حركة خزنة.
                </p>
              </div>
              <div><Label>طريقة الدفع</Label>
                <Select value={payDlg.payment_method} onValueChange={(v) => setPayDlg({ ...payDlg, payment_method: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(PM_LBL).map(([k,v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select></div>
              <div><Label>ملاحظات</Label><Textarea value={payDlg.notes} onChange={e => setPayDlg({ ...payDlg, notes: e.target.value })} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayDlg({ ...payDlg, open: false })}>إلغاء</Button>
            <Button onClick={submitPay}>تسجيل السداد</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Details */}
      <Dialog open={viewDlg.open} onOpenChange={(o) => setViewDlg({ ...viewDlg, open: o })}>
        <DialogContent dir="rtl" className="max-w-2xl">
          <DialogHeader><DialogTitle>تفاصيل المستحق</DialogTitle></DialogHeader>
          {viewDlg.row && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><b>الجهة:</b> {viewDlg.row.party_label || PARTY_LBL[viewDlg.row.party]}</div>
                <div><b>التاريخ:</b> {fmtDateAr(viewDlg.row.entry_date)}</div>
                <div><b>المبلغ:</b> <span className="font-mono">{fmtNum(viewDlg.row.amount,2)} ج</span></div>
                <div><b>المسدد:</b> <span className="font-mono text-green-600">{fmtNum(viewDlg.row.paid_amount,2)} ج</span></div>
                <div><b>المتبقي:</b> <span className="font-mono text-amber-600">{fmtNum(viewDlg.row.amount - viewDlg.row.paid_amount,2)} ج</span></div>
                <div><b>الحالة:</b> <Badge variant="outline" className={ST_CLS[viewDlg.row.status]}>{ST_LBL[viewDlg.row.status]}</Badge></div>
              </div>
              <div><b>البيان:</b> {viewDlg.row.description}</div>
              {viewDlg.row.notes && <div><b>ملاحظات:</b> {viewDlg.row.notes}</div>}
              {viewDlg.row.source_type && (
                <div className="text-xs text-muted-foreground">
                  مصدر: {viewDlg.row.source_type} {viewDlg.row.source_id ? `(${viewDlg.row.source_id.slice(0,8)})` : ""}
                </div>
              )}
              <div className="mt-3">
                <h3 className="font-bold mb-1">دفعات السداد</h3>
                {(() => {
                  const list = settlements.filter(s => s.receivable_id === viewDlg.row!.id);
                  if (!list.length) return <div className="text-muted-foreground text-xs">لا توجد دفعات.</div>;
                  return (
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead>التاريخ</TableHead><TableHead>المبلغ</TableHead>
                        <TableHead>الخزنة</TableHead><TableHead>طريقة الدفع</TableHead><TableHead>ملاحظات</TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {list.map(s => (
                          <TableRow key={s.id}>
                            <TableCell>{fmtDateAr(s.settlement_date)}</TableCell>
                            <TableCell className="font-mono">{fmtNum(s.amount,2)}</TableCell>
                            <TableCell>{DEST_LBL[s.destination_treasury]}</TableCell>
                            <TableCell>{PM_LBL[s.payment_method] || s.payment_method}</TableCell>
                            <TableCell className="text-xs">{s.notes || "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  );
                })()}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );

  return embedded ? content : <DashboardLayout>{content}</DashboardLayout>;
}
