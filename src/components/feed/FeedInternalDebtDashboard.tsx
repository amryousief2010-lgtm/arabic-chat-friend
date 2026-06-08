import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Wallet, TrendingDown, TrendingUp, AlertCircle, Plus, CheckCircle2, Clock, RefreshCw } from "lucide-react";
import FeedInternalPaymentDialog, { Department } from "./FeedInternalPaymentDialog";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

interface Props {
  department: Department;
  title?: string;
}

const fmt = (n: number) => Number(n || 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 });

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  no_debt: { label: "لا توجد مديونية", cls: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30" },
  unpaid: { label: "مديونية قائمة", cls: "bg-rose-500/10 text-rose-700 border-rose-500/30" },
  partially_paid: { label: "مسدد جزئياً", cls: "bg-amber-500/10 text-amber-700 border-amber-500/30" },
};

export default function FeedInternalDebtDashboard({ department, title }: Props) {
  const { roles } = useAuth() as any;
  const canApprove = (roles || []).some((r: string) =>
    ["general_manager", "executive_manager", "feed_factory_manager", "accountant", "financial_manager"].includes(r),
  );

  const [balance, setBalance] = useState<any>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [dlg, setDlg] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const [b, p] = await Promise.all([
      supabase.from("v_feed_internal_balances" as any).select("*").eq("department_type", department).maybeSingle(),
      supabase.from("feed_internal_payments" as any).select("*").eq("department_type", department).order("created_at", { ascending: false }).limit(20),
    ]);
    setBalance(b.data);
    setPayments((p.data as any[]) || []);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [department]);

  const approve = async (id: string) => {
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("feed_internal_payments" as any).update({
      status: "approved",
      approved_by: u.user?.id,
      approved_at: new Date().toISOString(),
    }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("تم اعتماد السداد");
    load();
  };

  const reject = async (id: string) => {
    const reason = prompt("سبب الرفض؟") || "";
    const { error } = await supabase.from("feed_internal_payments" as any).update({
      status: "rejected", rejected_reason: reason,
    }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("تم رفض السداد");
    load();
  };

  const cancel = async (id: string) => {
    if (!confirm("إلغاء سداد معتمد — سيتم تسجيل حركة عكسية في خزنة المصنع. تأكيد؟")) return;
    const reason = prompt("سبب الإلغاء؟") || "";
    const { error } = await supabase.from("feed_internal_payments" as any).update({
      status: "cancelled", rejected_reason: reason,
    }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("تم الإلغاء بحركة عكسية");
    load();
  };

  const status = balance?.account_status || "no_debt";
  const badge = STATUS_BADGE[status] || STATUS_BADGE.no_debt;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-primary" />
            {title || `حساب ${balance?.department_label || ""} مع مصنع العلف`}
          </CardTitle>
          <div className="mt-1"><Badge variant="outline" className={badge.cls}>{badge.label}</Badge></div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}><RefreshCw className="h-4 w-4" /></Button>
          <Button size="sm" onClick={() => setDlg(true)}><Plus className="h-4 w-4 ml-1" /> تسجيل سداد</Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <KPI icon={<TrendingUp />} label="إجمالي توريد العلف" value={`${fmt(balance?.total_supplied_value)} ج.م`} color="bg-blue-500/10 text-blue-700" />
          <KPI icon={<TrendingDown />} label="إجمالي المسدد" value={`${fmt(balance?.total_paid)} ج.م`} color="bg-emerald-500/10 text-emerald-700" />
          <KPI icon={<AlertCircle />} label="المتبقي على القسم" value={`${fmt(balance?.remaining_debt)} ج.م`} color={Number(balance?.remaining_debt) > 0 ? "bg-rose-500/10 text-rose-700" : "bg-emerald-500/10 text-emerald-700"} />
          <KPI icon={<Clock />} label="فواتير غير مسددة" value={`${balance?.supply_invoices_count || 0}`} sub={balance?.pending_payments_count ? `+${balance.pending_payments_count} سداد معلق` : undefined} color="bg-amber-500/10 text-amber-700" />
        </div>
        <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
          <div className="bg-muted/40 rounded p-2">
            <div className="text-muted-foreground text-xs">آخر توريد</div>
            <div className="font-medium">{balance?.last_supply_date || "—"}</div>
          </div>
          <div className="bg-muted/40 rounded p-2">
            <div className="text-muted-foreground text-xs">آخر سداد</div>
            <div className="font-medium">{balance?.last_payment_date || "—"}</div>
          </div>
        </div>

        <h3 className="text-sm font-bold mb-2">آخر عمليات السداد</h3>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>رقم</TableHead>
                <TableHead>التاريخ</TableHead>
                <TableHead>المبلغ</TableHead>
                <TableHead>الطريقة</TableHead>
                <TableHead>المرجع</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>إجراء</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono text-xs">{p.payment_no}</TableCell>
                  <TableCell>{p.payment_date}</TableCell>
                  <TableCell className="font-bold">{fmt(p.amount)}</TableCell>
                  <TableCell><span className="text-xs">{p.payment_method}</span></TableCell>
                  <TableCell>{p.reference_no || "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={
                      p.status === "approved" ? "bg-emerald-500/10 text-emerald-700" :
                      p.status === "rejected" ? "bg-rose-500/10 text-rose-700" :
                      p.status === "cancelled" ? "bg-gray-500/10 text-gray-700" :
                      "bg-amber-500/10 text-amber-700"
                    }>{p.status}</Badge>
                  </TableCell>
                  <TableCell>
                    {canApprove && p.status === "pending" && (
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => approve(p.id)}><CheckCircle2 className="h-4 w-4 text-emerald-600" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => reject(p.id)}>✕</Button>
                      </div>
                    )}
                    {canApprove && p.status === "approved" && (
                      <Button size="sm" variant="ghost" onClick={() => cancel(p.id)} className="text-xs">عكس</Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {payments.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">لا توجد عمليات سداد</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <FeedInternalPaymentDialog
        open={dlg}
        onOpenChange={setDlg}
        department={department}
        lockDepartment
        remainingDebt={Number(balance?.remaining_debt || 0)}
        onSaved={load}
      />
    </Card>
  );
}

function KPI({ icon, label, value, sub, color }: { icon: React.ReactNode; label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="border rounded p-3">
      <div className={`inline-flex p-1.5 rounded ${color} mb-1`}>{icon}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-base font-bold">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
