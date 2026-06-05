import { useEffect, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
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
import { Plus, Wallet, ArrowDownToLine, Upload } from "lucide-react";

type PM = "cash" | "vodafone_cash" | "instapay" | "bank_transfer";
type ExtStatus = "not_deposited" | "partially_deposited" | "fully_deposited";
type ExtSource = "hatching" | "chick_sales" | "general" | "other";

const PM_LBL: Record<PM, string> = { cash: "نقدي", vodafone_cash: "فودافون كاش", instapay: "إنستا باي", bank_transfer: "تحويل بنكي" };
const SRC_LBL: Record<ExtSource, string> = { hatching: "تفريخ بيض عملاء", chick_sales: "بيع كتاكيت", general: "تحصيل عام", other: "أخرى" };
const ST_LBL: Record<ExtStatus, string> = { not_deposited: "غير مورد", partially_deposited: "مورد جزئيًا", fully_deposited: "مورد بالكامل" };

interface Row {
  id: string; holder_name: string; payment_method: PM; amount: number; source: ExtSource;
  collection_date: string; notes: string | null; deposited_amount: number; status: ExtStatus;
  created_by: string | null; created_at: string;
}

const today = () => new Date().toISOString().slice(0, 10);

export default function MyLabCollections() {
  const { user, profile } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [form, setForm] = useState({
    payment_method: "vodafone_cash" as PM, amount: "" as any,
    source: "hatching" as ExtSource, collection_date: today(), notes: "",
  });
  const [receipt, setReceipt] = useState<File | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [depDlg, setDepDlg] = useState<{ open: boolean; row: Row | null; amount: any; method: PM; date: string; notes: string }>(
    { open: false, row: null, amount: "", method: "vodafone_cash", date: today(), notes: "" });

  async function load() {
    if (!user) return;
    const { data, error } = await (supabase as any)
      .from("lab_treasury_external_collections")
      .select("*").eq("created_by", user.id)
      .order("created_at", { ascending: false }).limit(500);
    if (error) { toast.error("فشل التحميل: " + error.message); return; }
    setRows((data || []) as Row[]);
  }
  useEffect(() => { load(); }, [user?.id]);

  async function uploadReceiptIfAny(): Promise<string | null> {
    if (!receipt || !user) return null;
    const path = `lab-external/${user.id}/${Date.now()}-${receipt.name}`;
    const { error } = await (supabase as any).storage.from("receipts").upload(path, receipt, { upsert: false });
    if (error) { toast.error("فشل رفع الإيصال: " + error.message); return null; }
    const { data } = (supabase as any).storage.from("receipts").getPublicUrl(path);
    return data?.publicUrl || null;
  }

  async function submit() {
    const amt = Number(form.amount || 0);
    if (amt <= 0) { toast.error("المبلغ مطلوب"); return; }
    if (!profile?.full_name) { toast.error("لا يوجد اسم في الملف الشخصي"); return; }
    const receipt_url = await uploadReceiptIfAny();
    const notes = (form.notes || "") + (receipt_url ? `\nإيصال: ${receipt_url}` : "");
    const { error } = await (supabase as any).from("lab_treasury_external_collections").insert({
      holder_name: profile.full_name,
      payment_method: form.payment_method, amount: amt, source: form.source,
      collection_date: form.collection_date, notes: notes || null, created_by: user!.id,
    });
    if (error) { toast.error("فشل التسجيل: " + error.message); return; }
    toast.success("تم تسجيل تحصيلك");
    setForm({ payment_method: "vodafone_cash", amount: "", source: "hatching", collection_date: today(), notes: "" });
    setReceipt(null);
    load();
  }

  async function submitDeposit() {
    const r = depDlg.row; if (!r) return;
    const amt = Number(depDlg.amount || 0);
    const remaining = r.amount - r.deposited_amount;
    if (amt <= 0 || amt > remaining + 0.001) { toast.error(`المتبقي ${fmtNum(remaining, 2)} فقط`); return; }
    const { error } = await (supabase as any).from("lab_treasury_external_deposits").insert({
      external_collection_id: r.id, amount: amt, payment_method: depDlg.method,
      deposit_date: depDlg.date, notes: depDlg.notes || null, created_by: user!.id,
    });
    if (error) { toast.error("فشل تسجيل التوريد: " + error.message); return; }
    toast.success("تم تسجيل التوريد — بانتظار اعتماد الإدارة");
    setDepDlg({ open: false, row: null, amount: "", method: "vodafone_cash", date: today(), notes: "" });
    load();
  }

  const filtered = rows.filter((r) => filterStatus === "all" || r.status === filterStatus);
  const totalCollected = rows.reduce((s, r) => s + r.amount, 0);
  const totalDeposited = rows.reduce((s, r) => s + r.deposited_amount, 0);
  const totalOutstanding = totalCollected - totalDeposited;

  return (
    <DashboardLayout>
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-3">
          <Wallet className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">تحصيلاتي لخزنة المعمل</h1>
            <div className="text-sm text-muted-foreground">{profile?.full_name}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">إجمالي ما حصّلته</div><div className="text-2xl font-bold font-mono">{fmtNum(totalCollected, 2)}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">المورَّد للخزنة</div><div className="text-2xl font-bold font-mono text-green-600">{fmtNum(totalDeposited, 2)}</div></CardContent></Card>
          <Card className="border-orange-300/50"><CardContent className="p-4"><div className="text-xs text-muted-foreground">المتبقي عليّ غير مورد</div><div className="text-2xl font-bold font-mono text-orange-600">{fmtNum(totalOutstanding, 2)}</div></CardContent></Card>
        </div>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Plus className="w-4 h-4" />تسجيل تحصيل جديد</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
              <div className="md:col-span-2"><Label>صورة إثبات (اختياري)</Label>
                <Input type="file" accept="image/*,application/pdf" onChange={(e) => setReceipt(e.target.files?.[0] || null)} />
              </div>
              <div className="md:col-span-3"><Label>ملاحظات</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            </div>
            <Button onClick={submit}><Upload className="w-4 h-4 ml-1" />تسجيل التحصيل</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>تحصيلاتي</CardTitle>
            <div className="mt-2">
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
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
                <TableHead>التاريخ</TableHead><TableHead>المصدر</TableHead><TableHead>طريقة الدفع</TableHead>
                <TableHead>المبلغ</TableHead><TableHead>المورَّد</TableHead><TableHead>المتبقي</TableHead>
                <TableHead>الحالة</TableHead><TableHead>إجراء</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {filtered.map((r) => {
                  const rem = r.amount - r.deposited_amount;
                  return (
                    <TableRow key={r.id}>
                      <TableCell>{r.collection_date}</TableCell>
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
                            <ArrowDownToLine className="w-4 h-4 ml-1" />طلب توريد
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {!filtered.length && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">لا توجد تحصيلات</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Alert>
          <AlertTitle>ملاحظة</AlertTitle>
          <AlertDescription className="text-xs">
            كل توريد تسجله يكون بانتظار اعتماد إدارة خزنة المعمل (السيد الجمل/المدير العام/التنفيذي) قبل أن يدخل ضمن الرصيد الرسمي للخزنة.
          </AlertDescription>
        </Alert>

        <Dialog open={depDlg.open} onOpenChange={(o) => setDepDlg({ ...depDlg, open: o })}>
          <DialogContent>
            <DialogHeader><DialogTitle>تسجيل توريد للخزنة</DialogTitle></DialogHeader>
            {depDlg.row && (
              <div className="space-y-3">
                <div className="text-sm">المتبقي: <b className="font-mono">{fmtNum(depDlg.row.amount - depDlg.row.deposited_amount, 2)}</b></div>
                <div><Label>المبلغ الموَرَّد</Label><Input type="number" step="0.01" value={depDlg.amount} onChange={(e) => setDepDlg({ ...depDlg, amount: e.target.value })} /></div>
                <div><Label>طريقة الدفع</Label>
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
              <Button onClick={submitDeposit}>تسجيل التوريد</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
