import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { fmtNum } from "@/lib/printPdf";
import { CheckCircle2, Plus, Users, Wallet, ArrowDownToLine, Sparkles } from "lucide-react";
import { PremiumStat } from "@/components/treasury/PremiumUI";

type PM = "cash" | "vodafone_cash" | "instapay" | "bank_transfer";
type ExtStatus = "not_deposited" | "partially_deposited" | "fully_deposited";
type ExtSource = "hatching" | "chick_sales" | "general" | "other";

const PM_LBL: Record<PM, string> = { cash: "نقدي", vodafone_cash: "فودافون كاش", instapay: "إنستا باي", bank_transfer: "تحويل بنكي" };
const SRC_LBL: Record<ExtSource, string> = { hatching: "تفريخ بيض عملاء", chick_sales: "بيع كتاكيت", general: "تحصيل عام", other: "أخرى" };
const ST_LBL: Record<ExtStatus, string> = { not_deposited: "غير مورد", partially_deposited: "مورد جزئيًا", fully_deposited: "مورد بالكامل" };

interface Opening {
  id: string; balance_date: string;
  cash_amount: number; vodafone_cash_amount: number; instapay_amount: number; bank_transfer_amount: number;
  total_amount: number; notes: string | null; status: "pending" | "approved" | "rejected";
  created_by: string | null; approved_by: string | null; approved_at: string | null; created_at: string;
}
interface ExtCol {
  id: string; holder_name: string; payment_method: PM; amount: number; source: ExtSource;
  collection_date: string; notes: string | null; deposited_amount: number; status: ExtStatus;
  created_by: string | null; created_at: string;
}

const today = () => new Date().toISOString().slice(0, 10);

export function OpeningBalancesPanel() {
  const { user, isGeneralManager, isExecutiveManager } = useAuth();
  const isManager = isGeneralManager || isExecutiveManager;
  const [rows, setRows] = useState<Opening[]>([]);
  const [form, setForm] = useState({
    balance_date: today(), cash_amount: "" as any, vodafone_cash_amount: "" as any,
    instapay_amount: "" as any, bank_transfer_amount: "" as any, notes: "",
  });

  async function load() {
    const { data } = await (supabase as any)
      .from("lab_treasury_opening_balances")
      .select("*").order("balance_date", { ascending: false }).limit(200);
    setRows((data || []) as Opening[]);
  }
  useEffect(() => { load(); }, []);

  async function submit() {
    const c = Number(form.cash_amount || 0), v = Number(form.vodafone_cash_amount || 0),
      i = Number(form.instapay_amount || 0), b = Number(form.bank_transfer_amount || 0);
    if (c + v + i + b <= 0) { toast.error("أدخل قيمة لرصيد واحد على الأقل"); return; }
    const { error } = await (supabase as any).from("lab_treasury_opening_balances").insert({
      balance_date: form.balance_date,
      cash_amount: c, vodafone_cash_amount: v, instapay_amount: i, bank_transfer_amount: b,
      notes: form.notes || null, created_by: user?.id,
    });
    if (error) { toast.error("فشل التسجيل: " + error.message); return; }
    toast.success("تم تسجيل الرصيد الافتتاحي — بانتظار الاعتماد");
    setForm({ balance_date: today(), cash_amount: "", vodafone_cash_amount: "", instapay_amount: "", bank_transfer_amount: "", notes: "" });
    load();
  }

  async function approve(r: Opening) {
    const { error } = await (supabase as any).from("lab_treasury_opening_balances")
      .update({ status: "approved", approved_by: user?.id, approved_at: new Date().toISOString() })
      .eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    toast.success("تم اعتماد الرصيد الافتتاحي"); load();
  }
  async function reject(r: Opening) {
    const reason = prompt("سبب الرفض:") || "";
    if (reason.trim().length < 3) { toast.error("سبب الرفض مطلوب"); return; }
    const { error } = await (supabase as any).from("lab_treasury_opening_balances")
      .update({ status: "rejected", rejected_by: user?.id, rejected_at: new Date().toISOString(), rejection_reason: reason })
      .eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    load();
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Plus className="w-4 h-4" />تسجيل رصيد افتتاحي جديد</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><Label>التاريخ</Label><Input type="date" value={form.balance_date} onChange={(e) => setForm({ ...form, balance_date: e.target.value })} /></div>
            <div><Label>نقدي</Label><Input type="number" step="0.01" value={form.cash_amount} onChange={(e) => setForm({ ...form, cash_amount: e.target.value })} /></div>
            <div><Label>فودافون كاش</Label><Input type="number" step="0.01" value={form.vodafone_cash_amount} onChange={(e) => setForm({ ...form, vodafone_cash_amount: e.target.value })} /></div>
            <div><Label>إنستا باي</Label><Input type="number" step="0.01" value={form.instapay_amount} onChange={(e) => setForm({ ...form, instapay_amount: e.target.value })} /></div>
            <div><Label>تحويل بنكي</Label><Input type="number" step="0.01" value={form.bank_transfer_amount} onChange={(e) => setForm({ ...form, bank_transfer_amount: e.target.value })} /></div>
          </div>
          <div><Label>ملاحظات</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          <div className="text-sm text-muted-foreground">الإجمالي: <b>{fmtNum(
            Number(form.cash_amount || 0) + Number(form.vodafone_cash_amount || 0) + Number(form.instapay_amount || 0) + Number(form.bank_transfer_amount || 0), 2)}</b></div>
          <Button onClick={submit}>حفظ (بانتظار الاعتماد)</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>الأرصدة الافتتاحية المسجلة</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>التاريخ</TableHead><TableHead>نقدي</TableHead><TableHead>فودافون</TableHead>
              <TableHead>إنستا</TableHead><TableHead>بنك</TableHead><TableHead>الإجمالي</TableHead>
              <TableHead>الحالة</TableHead><TableHead>إجراء</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.balance_date}</TableCell>
                  <TableCell className="font-mono">{fmtNum(r.cash_amount, 2)}</TableCell>
                  <TableCell className="font-mono">{fmtNum(r.vodafone_cash_amount, 2)}</TableCell>
                  <TableCell className="font-mono">{fmtNum(r.instapay_amount, 2)}</TableCell>
                  <TableCell className="font-mono">{fmtNum(r.bank_transfer_amount, 2)}</TableCell>
                  <TableCell className="font-mono font-semibold">{fmtNum(r.total_amount, 2)}</TableCell>
                  <TableCell>
                    <Badge variant={r.status === "approved" ? "default" : r.status === "rejected" ? "destructive" : "secondary"}>
                      {r.status === "approved" ? "معتمد" : r.status === "rejected" ? "مرفوض" : "بانتظار"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {isManager && r.status === "pending" && (
                      <div className="flex gap-1">
                        <Button size="sm" onClick={() => approve(r)}>اعتماد</Button>
                        <Button size="sm" variant="destructive" onClick={() => reject(r)}>رفض</Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!rows.length && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">لا توجد أرصدة افتتاحية</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Alert>
        <AlertTitle>ملاحظة</AlertTitle>
        <AlertDescription className="text-xs">
          الرصيد الافتتاحي يظهر في لوحة الخزنة عند اعتماده من المدير العام أو المدير التنفيذي، ولا يدخل ضمن سجل الحركات اليومية.
        </AlertDescription>
      </Alert>
    </div>
  );
}

export function ExternalCollectionsPanel() {
  const { user } = useAuth();
  const [rows, setRows] = useState<ExtCol[]>([]);
  const [filterHolder, setFilterHolder] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [form, setForm] = useState({
    holder_name: "", payment_method: "vodafone_cash" as PM, amount: "" as any,
    source: "hatching" as ExtSource, collection_date: today(), notes: "",
  });
  const [depDlg, setDepDlg] = useState<{ open: boolean; row: ExtCol | null; amount: any; method: PM; date: string; notes: string }>(
    { open: false, row: null, amount: "", method: "cash", date: today(), notes: "" });

  async function load() {
    const { data } = await (supabase as any)
      .from("lab_treasury_external_collections")
      .select("*").order("created_at", { ascending: false }).limit(500);
    setRows((data || []) as ExtCol[]);
  }
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const ch = supabase
      .channel("lab-ext-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "lab_treasury_external_collections" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "lab_treasury_external_deposits" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  async function submit() {
    if (!form.holder_name.trim()) { toast.error("اسم الشخص مطلوب"); return; }
    const amt = Number(form.amount || 0);
    if (amt <= 0) { toast.error("المبلغ يجب أن يكون أكبر من صفر"); return; }
    const { error } = await (supabase as any).from("lab_treasury_external_collections").insert({
      holder_name: form.holder_name.trim(), payment_method: form.payment_method,
      amount: amt, source: form.source, collection_date: form.collection_date,
      notes: form.notes || null, created_by: user?.id,
    });
    if (error) { toast.error("فشل التسجيل: " + error.message); return; }
    toast.success("تم تسجيل التحصيل الخارجي");
    setForm({ holder_name: "", payment_method: "vodafone_cash", amount: "", source: "hatching", collection_date: today(), notes: "" });
    load();
  }

  async function submitDeposit() {
    const r = depDlg.row; if (!r) return;
    const amt = Number(depDlg.amount || 0);
    const remaining = r.amount - r.deposited_amount;
    if (amt <= 0) { toast.error("المبلغ مطلوب"); return; }
    if (amt > remaining + 0.001) { toast.error(`المتبقي ${fmtNum(remaining, 2)} فقط`); return; }
    const { error } = await (supabase as any).from("lab_treasury_external_deposits").insert({
      external_collection_id: r.id, amount: amt, payment_method: depDlg.method,
      deposit_date: depDlg.date, notes: depDlg.notes || null, created_by: user?.id,
    });
    if (error) { toast.error("فشل التوريد: " + error.message); return; }
    toast.success("تم إنشاء حركة توريد بانتظار الاعتماد");
    setDepDlg({ open: false, row: null, amount: "", method: "cash", date: today(), notes: "" });
    load();
  }

  const filtered = rows.filter((r) =>
    (!filterHolder.trim() || r.holder_name.includes(filterHolder.trim())) &&
    (filterStatus === "all" || r.status === filterStatus));

  const totalOutstanding = rows.reduce((s, r) => s + (r.amount - r.deposited_amount), 0);
  const totalCollected = rows.reduce((s, r) => s + r.amount, 0);
  const totalDeposited = rows.reduce((s, r) => s + r.deposited_amount, 0);

  const byHolder: Record<string, number> = {};
  const byMethod: Record<string, number> = {};
  rows.forEach((r) => {
    const out = r.amount - r.deposited_amount;
    if (out > 0) {
      byHolder[r.holder_name] = (byHolder[r.holder_name] || 0) + out;
      byMethod[r.payment_method] = (byMethod[r.payment_method] || 0) + out;
    }
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">إجمالي التحصيلات</div><div className="text-2xl font-bold font-mono">{fmtNum(totalCollected, 2)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">تم توريده</div><div className="text-2xl font-bold font-mono text-green-600">{fmtNum(totalDeposited, 2)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">المتبقي خارج الخزنة</div><div className="text-2xl font-bold font-mono text-orange-600">{fmtNum(totalOutstanding, 2)}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Users className="w-4 h-4" />تسجيل تحصيل خارجي / عُهدة</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div><Label>اسم الشخص</Label><Input value={form.holder_name} onChange={(e) => setForm({ ...form, holder_name: e.target.value })} placeholder="مثال: محمد شعلة" /></div>
            <div><Label>طريقة التحصيل</Label>
              <Select value={form.payment_method} onValueChange={(v) => setForm({ ...form, payment_method: v as PM })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{(Object.keys(PM_LBL) as PM[]).map((k) => <SelectItem key={k} value={k}>{PM_LBL[k]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>المبلغ</Label><Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
            <div><Label>مصدر المبلغ</Label>
              <Select value={form.source} onValueChange={(v) => setForm({ ...form, source: v as ExtSource })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{(Object.keys(SRC_LBL) as ExtSource[]).map((k) => <SelectItem key={k} value={k}>{SRC_LBL[k]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>التاريخ</Label><Input type="date" value={form.collection_date} onChange={(e) => setForm({ ...form, collection_date: e.target.value })} /></div>
            <div className="md:col-span-3"><Label>ملاحظات</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <Button onClick={submit}><Plus className="w-4 h-4 ml-1" />تسجيل التحصيل</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>سجل التحصيلات الخارجية</CardTitle>
          <div className="flex flex-wrap gap-2 mt-2">
            <Input placeholder="بحث بالاسم" value={filterHolder} onChange={(e) => setFilterHolder(e.target.value)} className="w-48" />
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الحالات</SelectItem>
                {(Object.keys(ST_LBL) as ExtStatus[]).map((k) => <SelectItem key={k} value={k}>{ST_LBL[k]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>التاريخ</TableHead><TableHead>الشخص</TableHead><TableHead>المصدر</TableHead>
              <TableHead>طريقة الدفع</TableHead><TableHead>المبلغ</TableHead>
              <TableHead>تم توريده</TableHead><TableHead>المتبقي</TableHead>
              <TableHead>الحالة</TableHead><TableHead>إجراء</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.map((r) => {
                const rem = r.amount - r.deposited_amount;
                return (
                  <TableRow key={r.id}>
                    <TableCell>{r.collection_date}</TableCell>
                    <TableCell className="font-semibold">{r.holder_name}</TableCell>
                    <TableCell>{SRC_LBL[r.source]}</TableCell>
                    <TableCell>{PM_LBL[r.payment_method]}</TableCell>
                    <TableCell className="font-mono">{fmtNum(r.amount, 2)}</TableCell>
                    <TableCell className="font-mono text-green-600">{fmtNum(r.deposited_amount, 2)}</TableCell>
                    <TableCell className="font-mono text-orange-600">{fmtNum(rem, 2)}</TableCell>
                    <TableCell>
                      <Badge variant={r.status === "fully_deposited" ? "default" : r.status === "partially_deposited" ? "secondary" : "outline"}>
                        {ST_LBL[r.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {rem > 0 && (
                        <Button size="sm" onClick={() => setDepDlg({ open: true, row: r, amount: rem, method: r.payment_method, date: today(), notes: "" })}>
                          <ArrowDownToLine className="w-4 h-4 ml-1" />توريد
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {!filtered.length && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">لا توجد تحصيلات</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardHeader><CardTitle className="text-sm">المتبقي حسب الشخص</CardTitle></CardHeader>
          <CardContent>
            <Table><TableBody>
              {Object.entries(byHolder).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                <TableRow key={k}><TableCell>{k}</TableCell><TableCell className="text-end font-mono font-semibold">{fmtNum(v, 2)}</TableCell></TableRow>
              ))}
              {!Object.keys(byHolder).length && <TableRow><TableCell className="text-center text-muted-foreground">لا يوجد متبقي</TableCell></TableRow>}
            </TableBody></Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">المتبقي حسب طريقة الدفع</CardTitle></CardHeader>
          <CardContent>
            <Table><TableBody>
              {(Object.keys(PM_LBL) as PM[]).map((k) => (
                <TableRow key={k}><TableCell>{PM_LBL[k]}</TableCell><TableCell className="text-end font-mono">{fmtNum(byMethod[k] || 0, 2)}</TableCell></TableRow>
              ))}
            </TableBody></Table>
          </CardContent>
        </Card>
      </div>

      <Dialog open={depDlg.open} onOpenChange={(o) => setDepDlg({ ...depDlg, open: o })}>
        <DialogContent>
          <DialogHeader><DialogTitle>توريد تحصيل خارجي إلى الخزنة</DialogTitle></DialogHeader>
          {depDlg.row && (
            <div className="space-y-3">
              <div className="text-sm">
                <div>الشخص: <b>{depDlg.row.holder_name}</b></div>
                <div>المتبقي: <b className="font-mono">{fmtNum(depDlg.row.amount - depDlg.row.deposited_amount, 2)}</b></div>
              </div>
              <div><Label>المبلغ الموَرَّد</Label><Input type="number" step="0.01" value={depDlg.amount} onChange={(e) => setDepDlg({ ...depDlg, amount: e.target.value })} /></div>
              <div><Label>طريقة الدفع الفعلية في الخزنة</Label>
                <Select value={depDlg.method} onValueChange={(v) => setDepDlg({ ...depDlg, method: v as PM })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{(Object.keys(PM_LBL) as PM[]).map((k) => <SelectItem key={k} value={k}>{PM_LBL[k]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>تاريخ التوريد</Label><Input type="date" value={depDlg.date} onChange={(e) => setDepDlg({ ...depDlg, date: e.target.value })} /></div>
              <div><Label>ملاحظات</Label><Textarea value={depDlg.notes} onChange={(e) => setDepDlg({ ...depDlg, notes: e.target.value })} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDepDlg({ ...depDlg, open: false })}>إلغاء</Button>
            <Button onClick={submitDeposit}><CheckCircle2 className="w-4 h-4 ml-1" />توريد (بانتظار الاعتماد)</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function ExternalSummaryCard() {
  const [s, setS] = useState({ outstanding: 0, collected: 0, deposited: 0 });
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data } = await (supabase as any).from("v_lab_external_summary").select("*").maybeSingle();
      if (alive && data) setS({ outstanding: Number(data.total_outstanding || 0), collected: Number(data.total_collected || 0), deposited: Number(data.total_deposited || 0) });
    };
    load();
    const ch = supabase.channel("lab-ext-sum")
      .on("postgres_changes", { event: "*", schema: "public", table: "lab_treasury_external_collections" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "lab_treasury_external_deposits" }, load)
      .subscribe();
    return () => { alive = false; supabase.removeChannel(ch); };
  }, []);
  return (
    <PremiumStat
      tone="warning"
      icon={<Wallet />}
      title="تحصيلات خارجية غير موَرَّدة"
      value={fmtNum(s.outstanding, 2)}
      hint={`محصّل: ${fmtNum(s.collected, 0)} · موَرَّد: ${fmtNum(s.deposited, 0)}`}
    />
  );
}

export function TotalLabFundsCard({ officialTotal }: { officialTotal: number }) {
  const [out, setOut] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data } = await (supabase as any).from("v_lab_external_summary").select("total_outstanding").maybeSingle();
      if (alive && data) setOut(Number(data.total_outstanding || 0));
    };
    load();
    const ch = supabase.channel("lab-ext-total")
      .on("postgres_changes", { event: "*", schema: "public", table: "lab_treasury_external_collections" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "lab_treasury_external_deposits" }, load)
      .subscribe();
    return () => { alive = false; supabase.removeChannel(ch); };
  }, []);
  return (
    <PremiumStat
      tone="primary"
      highlight
      icon={<Sparkles />}
      title="إجمالي أموال المعمل"
      value={fmtNum(officialTotal + out, 2)}
      hint="خزنة + عُهَد خارجية"
    />
  );
}
