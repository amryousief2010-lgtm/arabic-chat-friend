import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Download, RefreshCw, Wallet, Check, X, Eye } from "lucide-react";
import { toast } from "sonner";
import FeedInternalPaymentDialog from "@/components/feed/FeedInternalPaymentDialog";
import { openPrintWindow } from "@/lib/printPdf";
import { useAuth } from "@/hooks/useAuth";

const fmt = (n: number) => Number(n || 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 });
const STATUS_LABEL: Record<string, string> = { pending: "بانتظار الاعتماد", approved: "معتمد", rejected: "مرفوض", cancelled: "ملغي" };
const STATUS_CLASS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800 border-amber-300",
  approved: "bg-emerald-100 text-emerald-800 border-emerald-300",
  rejected: "bg-rose-100 text-rose-800 border-rose-300",
  cancelled: "bg-gray-200 text-gray-700 border-gray-300",
};

export default function FeedInternalAccounts() {
  const [balances, setBalances] = useState<any[]>([]);
  const [supplies, setSupplies] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [dlg, setDlg] = useState(false);
  const [filter, setFilter] = useState({ dept: "all", status: "all", method: "all", from: "", to: "", ref: "" });

  const load = async () => {
    setLoading(true);
    const [b, s, p] = await Promise.all([
      supabase.from("v_feed_internal_balances" as any).select("*"),
      supabase.from("v_feed_factory_distribution" as any).select("*").neq("destination_type", "external_customer").order("sale_date", { ascending: false }),
      supabase.from("feed_internal_payments" as any).select("*").order("created_at", { ascending: false }),
    ]);
    setBalances((b.data as any[]) || []);
    setSupplies((s.data as any[]) || []);
    setPayments((p.data as any[]) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filteredPayments = payments.filter((p) => {
    if (filter.dept !== "all" && p.department_type !== filter.dept) return false;
    if (filter.status !== "all" && p.status !== filter.status) return false;
    if (filter.method !== "all" && p.payment_method !== filter.method) return false;
    if (filter.from && p.payment_date < filter.from) return false;
    if (filter.to && p.payment_date > filter.to) return false;
    if (filter.ref && !(p.reference_no || "").includes(filter.ref) && !(p.payment_no || "").includes(filter.ref)) return false;
    return true;
  });

  const filteredSupplies = supplies.filter((s) => {
    if (filter.dept === "brooding" && s.destination_type !== "brooding_feed_store") return false;
    if (filter.dept === "slaughterhouse" && s.destination_type !== "slaughterhouse_feed_store") return false;
    if (filter.from && s.sale_date < filter.from) return false;
    if (filter.to && s.sale_date > filter.to) return false;
    if (filter.ref && !(s.sale_no || "").includes(filter.ref)) return false;
    return true;
  });

  const grandSupplied = balances.reduce((s, b) => s + Number(b.total_supplied_value || 0), 0);
  const grandPaid = balances.reduce((s, b) => s + Number(b.total_paid || 0), 0);
  const grandRemaining = grandSupplied - grandPaid;

  const exportPDF = () => {
    const html = `
      <h1 style="text-align:center">حسابات الأقسام مع مصنع العلف</h1>
      <table border="1" cellpadding="6" style="width:100%;border-collapse:collapse;margin-bottom:20px">
        <tr><th>القسم</th><th>إجمالي توريد</th><th>إجمالي مسدد</th><th>المتبقي</th><th>آخر توريد</th><th>آخر سداد</th><th>الحالة</th></tr>
        ${balances.map(b => `<tr><td>${b.department_label}</td><td>${fmt(b.total_supplied_value)}</td><td>${fmt(b.total_paid)}</td><td><b>${fmt(b.remaining_debt)}</b></td><td>${b.last_supply_date||"—"}</td><td>${b.last_payment_date||"—"}</td><td>${b.account_status}</td></tr>`).join("")}
        <tr style="background:#f5f5f5;font-weight:bold"><td>الإجمالي</td><td>${fmt(grandSupplied)}</td><td>${fmt(grandPaid)}</td><td>${fmt(grandRemaining)}</td><td colspan="3"></td></tr>
      </table>
      <h2>عمليات السداد</h2>
      <table border="1" cellpadding="6" style="width:100%;border-collapse:collapse">
        <tr><th>رقم</th><th>التاريخ</th><th>القسم</th><th>المبلغ</th><th>الطريقة</th><th>الحالة</th></tr>
        ${filteredPayments.map(p => `<tr><td>${p.payment_no}</td><td>${p.payment_date}</td><td>${p.department_type}</td><td>${fmt(p.amount)}</td><td>${p.payment_method}</td><td>${p.status}</td></tr>`).join("")}
      </table>`;
    openPrintWindow(html, "حسابات-الأقسام-مع-مصنع-العلف");
  };

  return (
    <DashboardLayout>
      <div dir="rtl" className="p-4 md:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Wallet className="h-7 w-7 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">حسابات الأقسام مع مصنع العلف</h1>
              <p className="text-sm text-muted-foreground">مديونيات التوريد الداخلي والسداد بين مصنع العلف والأقسام</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={loading}><RefreshCw className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" onClick={exportPDF}><Download className="h-4 w-4 ml-1" /> PDF</Button>
            <Button size="sm" onClick={() => setDlg(true)}><Plus className="h-4 w-4 ml-1" /> تسجيل سداد</Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {balances.map((b) => (
            <Card key={b.department_type}>
              <CardHeader className="pb-2"><CardTitle className="text-base">{b.department_label}</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div className="flex justify-between"><span>إجمالي توريد:</span><b>{fmt(b.total_supplied_value)} ج.م</b></div>
                <div className="flex justify-between"><span>إجمالي مسدد:</span><b className="text-emerald-700">{fmt(b.total_paid)} ج.م</b></div>
                <div className="flex justify-between text-lg pt-1 border-t"><span>المتبقي:</span><b className={Number(b.remaining_debt)>0?"text-rose-700":"text-emerald-700"}>{fmt(b.remaining_debt)} ج.م</b></div>
                <div className="flex justify-between text-xs text-muted-foreground"><span>آخر توريد: {b.last_supply_date||"—"}</span><span>آخر سداد: {b.last_payment_date||"—"}</span></div>
                <Badge variant="outline" className="mt-1">{b.account_status}</Badge>
              </CardContent>
            </Card>
          ))}
          <Card className="bg-primary/5">
            <CardHeader className="pb-2"><CardTitle className="text-base">الإجمالي المجمع</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div className="flex justify-between"><span>إجمالي توريد:</span><b>{fmt(grandSupplied)} ج.م</b></div>
              <div className="flex justify-between"><span>إجمالي مسدد:</span><b className="text-emerald-700">{fmt(grandPaid)} ج.م</b></div>
              <div className="flex justify-between text-lg pt-1 border-t"><span>المتبقي الكلي:</span><b className={grandRemaining>0?"text-rose-700":"text-emerald-700"}>{fmt(grandRemaining)} ج.م</b></div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">فلاتر</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-sm">
              <div><Label>القسم</Label><Select value={filter.dept} onValueChange={(v)=>setFilter({...filter,dept:v})}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">الكل</SelectItem><SelectItem value="brooding">الحضانات</SelectItem><SelectItem value="slaughterhouse">المجزر</SelectItem></SelectContent></Select></div>
              <div><Label>الحالة</Label><Select value={filter.status} onValueChange={(v)=>setFilter({...filter,status:v})}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">الكل</SelectItem><SelectItem value="pending">معلق</SelectItem><SelectItem value="approved">معتمد</SelectItem><SelectItem value="rejected">مرفوض</SelectItem><SelectItem value="cancelled">ملغي</SelectItem></SelectContent></Select></div>
              <div><Label>طريقة السداد</Label><Select value={filter.method} onValueChange={(v)=>setFilter({...filter,method:v})}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">الكل</SelectItem><SelectItem value="cash">نقدي</SelectItem><SelectItem value="vodafone_cash">فودافون</SelectItem><SelectItem value="instapay">إنستا باي</SelectItem><SelectItem value="bank_transfer">تحويل</SelectItem><SelectItem value="internal_settlement">تسوية</SelectItem></SelectContent></Select></div>
              <div><Label>من</Label><Input type="date" value={filter.from} onChange={(e)=>setFilter({...filter,from:e.target.value})}/></div>
              <div><Label>إلى</Label><Input type="date" value={filter.to} onChange={(e)=>setFilter({...filter,to:e.target.value})}/></div>
              <div><Label>رقم فاتورة/إيصال</Label><Input value={filter.ref} onChange={(e)=>setFilter({...filter,ref:e.target.value})}/></div>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="payments">
          <TabsList>
            <TabsTrigger value="payments">عمليات السداد</TabsTrigger>
            <TabsTrigger value="supplies">فواتير التوريد الداخلي</TabsTrigger>
          </TabsList>
          <TabsContent value="payments">
            <Card><CardContent className="p-3 overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>رقم</TableHead><TableHead>التاريخ</TableHead><TableHead>القسم</TableHead><TableHead>المبلغ</TableHead><TableHead>الطريقة</TableHead><TableHead>المرجع</TableHead><TableHead>الحالة</TableHead><TableHead>ملاحظات</TableHead></TableRow></TableHeader>
                <TableBody>
                  {filteredPayments.map(p => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-xs">{p.payment_no}</TableCell>
                      <TableCell>{p.payment_date}</TableCell>
                      <TableCell>{p.department_type === "brooding" ? "حضانات" : "مجزر"}</TableCell>
                      <TableCell className="font-bold">{fmt(p.amount)}</TableCell>
                      <TableCell className="text-xs">{p.payment_method}</TableCell>
                      <TableCell>{p.reference_no || "—"}</TableCell>
                      <TableCell><Badge variant="outline">{p.status}</Badge></TableCell>
                      <TableCell className="text-xs">{p.notes || "—"}</TableCell>
                    </TableRow>
                  ))}
                  {filteredPayments.length===0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">لا توجد بيانات</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent></Card>
          </TabsContent>
          <TabsContent value="supplies">
            <Card><CardContent className="p-3 overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>رقم</TableHead><TableHead>التاريخ</TableHead><TableHead>الوجهة</TableHead><TableHead>الصنف</TableHead><TableHead>كمية</TableHead><TableHead>قيمة الفاتورة (مديونية)</TableHead></TableRow></TableHeader>
                <TableBody>
                  {filteredSupplies.map((s,i) => (
                    <TableRow key={s.sale_id+i}>
                      <TableCell className="font-mono text-xs">{s.sale_no}</TableCell>
                      <TableCell>{s.sale_date}</TableCell>
                      <TableCell>{s.destination_label}</TableCell>
                      <TableCell>{s.feed_name}</TableCell>
                      <TableCell>{fmt(s.quantity)} كجم</TableCell>
                      <TableCell className="font-bold text-rose-700">{fmt(s.line_total)} ج.م</TableCell>
                    </TableRow>
                  ))}
                  {filteredSupplies.length===0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">لا توجد بيانات</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent></Card>
          </TabsContent>
        </Tabs>

        <FeedInternalPaymentDialog open={dlg} onOpenChange={setDlg} department="brooding" onSaved={load} />
      </div>
    </DashboardLayout>
  );
}
