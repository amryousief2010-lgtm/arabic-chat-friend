import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ClipboardCheck, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { formatDateTime } from "@/lib/dateFormat";

type Recon = {
  id: string;
  recon_no: string | null;
  recon_date: string;
  recon_kind: string;
  system_balance: number | null;
  actual_balance: number | null;
  variance: number | null;
  notes: string | null;
  status: "draft" | "submitted" | "approved" | "rejected";
  submitted_by: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_reason: string | null;
};

const fmt = (n: number | null) =>
  new Intl.NumberFormat("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  draft: { label: "مسودة", cls: "bg-muted text-muted-foreground" },
  submitted: { label: "بانتظار الاعتماد", cls: "bg-amber-100 text-amber-800" },
  approved: { label: "معتمدة", cls: "bg-emerald-100 text-emerald-800" },
  rejected: { label: "مرفوضة", cls: "bg-rose-100 text-rose-800" },
};

export default function AgouzaReconciliationTab() {
  const { user, isGeneralManager, isExecutiveManager } = useAuth();
  const { toast } = useToast();
  const canApprove = !!(isGeneralManager || isExecutiveManager);

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Recon[]>([]);
  const [summary, setSummary] = useState<any>(null);

  const today = new Date().toISOString().slice(0, 10);
  const [reconDate, setReconDate] = useState<string>(today);
  const [actual, setActual] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const [rejectFor, setRejectFor] = useState<Recon | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("agouza_warehouse_reconciliations")
      .select("*")
      .order("recon_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) toast({ title: "خطأ", description: error.message, variant: "destructive" });
    setRows((data as Recon[]) || []);
    setLoading(false);
  }

  async function loadSummary() {
    const { data, error } = await supabase.rpc("get_agouza_daily_summary", { p_date: reconDate });
    if (!error) setSummary(data);
  }

  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    loadSummary();
  }, [reconDate]);

  async function submit() {
    const v = parseFloat(actual);
    if (!Number.isFinite(v) || v < 0) {
      toast({ title: "خطأ", description: "أدخل رصيداً فعلياً صحيحاً", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.rpc("create_agouza_reconciliation", {
      p_recon_date: reconDate,
      p_actual_balance: v,
      p_notes: notes || null,
      p_kind: "treasury",
    });
    setSubmitting(false);
    if (error) {
      toast({ title: "خطأ", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "تم", description: "تم تسجيل المطابقة بانتظار الاعتماد" });
    setActual("");
    setNotes("");
    load();
  }

  async function approve(id: string) {
    const { error } = await supabase.rpc("approve_agouza_reconciliation", { p_id: id });
    if (error) return toast({ title: "خطأ", description: error.message, variant: "destructive" });
    toast({ title: "تم الاعتماد" });
    load();
  }

  async function reject() {
    if (!rejectFor) return;
    if (!rejectReason.trim()) {
      toast({ title: "السبب مطلوب", variant: "destructive" });
      return;
    }
    const { error } = await supabase.rpc("reject_agouza_reconciliation", {
      p_id: rejectFor.id,
      p_reason: rejectReason,
    });
    if (error) return toast({ title: "خطأ", description: error.message, variant: "destructive" });
    toast({ title: "تم الرفض" });
    setRejectFor(null);
    setRejectReason("");
    load();
  }

  const expected = summary ? Number(summary.expected_treasury) : 0;
  const variance = actual !== "" ? parseFloat(actual) - expected : 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5" />
            مطابقة وجرد خزنة العجوزة
          </CardTitle>
          <CardDescription>
            أدخل الرصيد الفعلي للخزنة ليتم حساب الفرق مقابل الرصيد المتوقع تلقائياً، ثم يعتمد المدير العام/التنفيذي.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <Label>تاريخ المطابقة</Label>
              <Input type="date" value={reconDate} onChange={(e) => setReconDate(e.target.value)} />
            </div>
            <div>
              <Label>الرصيد المتوقع (نظام)</Label>
              <Input value={fmt(expected)} readOnly className="font-bold" />
            </div>
            <div>
              <Label>الرصيد الفعلي *</Label>
              <Input
                type="number"
                step="0.01"
                value={actual}
                onChange={(e) => setActual(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div>
              <Label>الفرق</Label>
              <Input
                value={fmt(variance)}
                readOnly
                className={`font-bold ${
                  variance === 0
                    ? ""
                    : variance > 0
                    ? "text-emerald-700"
                    : "text-rose-700"
                }`}
              />
            </div>
          </div>
          <div>
            <Label>ملاحظة / سبب الفرق</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          <Button onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
            تسجيل المطابقة
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>سجل المطابقات</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">جاري التحميل...</div>
          ) : rows.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">لا توجد مطابقات</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الرقم</TableHead>
                    <TableHead>التاريخ</TableHead>
                    <TableHead>النظام</TableHead>
                    <TableHead>الفعلي</TableHead>
                    <TableHead>الفرق</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>ملاحظة</TableHead>
                    <TableHead>إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const b = STATUS_BADGE[r.status];
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-xs">{r.recon_no}</TableCell>
                        <TableCell>{r.recon_date}</TableCell>
                        <TableCell>{fmt(r.system_balance)}</TableCell>
                        <TableCell>{fmt(r.actual_balance)}</TableCell>
                        <TableCell
                          className={
                            (r.variance || 0) === 0
                              ? ""
                              : (r.variance || 0) > 0
                              ? "text-emerald-700"
                              : "text-rose-700"
                          }
                        >
                          {fmt(r.variance)}
                        </TableCell>
                        <TableCell>
                          <Badge className={b.cls}>{b.label}</Badge>
                        </TableCell>
                        <TableCell className="max-w-[240px] truncate" title={r.notes || ""}>
                          {r.notes || (r.rejected_reason ? `❌ ${r.rejected_reason}` : "—")}
                        </TableCell>
                        <TableCell>
                          {canApprove && r.status === "submitted" && (
                            <div className="flex gap-1">
                              <Button size="sm" variant="default" onClick={() => approve(r.id)}>
                                <CheckCircle2 className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => setRejectFor(r)}
                              >
                                <XCircle className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!rejectFor} onOpenChange={(o) => !o && setRejectFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>رفض المطابقة</DialogTitle>
            <DialogDescription>سبب الرفض إلزامي</DialogDescription>
          </DialogHeader>
          <Textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={3} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectFor(null)}>إلغاء</Button>
            <Button variant="destructive" onClick={reject}>تأكيد الرفض</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
