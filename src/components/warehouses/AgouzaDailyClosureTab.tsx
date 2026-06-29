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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { LockKeyhole, Unlock, CalendarDays, Loader2 } from "lucide-react";
import { formatDateTime } from "@/lib/dateFormat";

type Closure = {
  id: string;
  closure_date: string;
  status: "open" | "closed" | "reopened";
  opening_treasury: number;
  total_sales: number;
  total_cash_in: number;
  total_cash_out: number;
  total_expenses: number;
  total_handover: number;
  closing_treasury: number;
  expected_treasury: number;
  variance: number;
  notes: string | null;
  closed_by: string | null;
  closed_at: string | null;
  reopened_by: string | null;
  reopened_at: string | null;
  reopen_reason: string | null;
};

const fmt = (n: number | null) =>
  new Intl.NumberFormat("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  open: { label: "مفتوح", cls: "bg-sky-100 text-sky-800" },
  closed: { label: "مُقفل", cls: "bg-emerald-100 text-emerald-800" },
  reopened: { label: "أعيد فتحه", cls: "bg-amber-100 text-amber-800" },
};

export default function AgouzaDailyClosureTab() {
  const { isGeneralManager, isExecutiveManager } = useAuth();
  const { toast } = useToast();
  const canApprove = !!(isGeneralManager || isExecutiveManager);

  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [summary, setSummary] = useState<any>(null);
  const [actual, setActual] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const [closures, setClosures] = useState<Closure[]>([]);
  const [reopenFor, setReopenFor] = useState<Closure | null>(null);
  const [reopenReason, setReopenReason] = useState("");

  async function loadSummary() {
    const { data, error } = await supabase.rpc("get_agouza_daily_summary", { p_date: date });
    if (error) toast({ title: "خطأ", description: error.message, variant: "destructive" });
    setSummary(data);
  }

  async function loadClosures() {
    const { data } = await supabase
      .from("agouza_daily_closures")
      .select("*")
      .order("closure_date", { ascending: false })
      .limit(60);
    setClosures((data as Closure[]) || []);
  }

  useEffect(() => {
    loadSummary();
  }, [date]);
  useEffect(() => {
    loadClosures();
  }, []);

  const currentClosure = closures.find((c) => c.closure_date === date);
  const expected = summary ? Number(summary.expected_treasury) : 0;
  const variance = actual !== "" ? parseFloat(actual) - expected : 0;

  async function doClose() {
    const v = parseFloat(actual);
    if (!Number.isFinite(v) || v < 0) {
      toast({ title: "أدخل رصيداً صحيحاً", variant: "destructive" });
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("agouza_daily_closure_close", {
      p_date: date,
      p_actual_balance: v,
      p_notes: notes || null,
    });
    setBusy(false);
    if (error) return toast({ title: "خطأ", description: error.message, variant: "destructive" });
    toast({ title: "تم إقفال اليوم" });
    setActual("");
    setNotes("");
    loadSummary();
    loadClosures();
  }

  async function doReopen() {
    if (!reopenFor || !reopenReason.trim()) {
      toast({ title: "السبب مطلوب", variant: "destructive" });
      return;
    }
    const { error } = await supabase.rpc("agouza_daily_closure_reopen", {
      p_date: reopenFor.closure_date,
      p_reason: reopenReason,
    });
    if (error) return toast({ title: "خطأ", description: error.message, variant: "destructive" });
    toast({ title: "تم إعادة الفتح" });
    setReopenFor(null);
    setReopenReason("");
    loadSummary();
    loadClosures();
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5" />
            الإقفال اليومي - خزنة العجوزة
          </CardTitle>
          <CardDescription>
            أقفل اليوم لتجميد الحركات. بعد الإقفال لا يستطيع مسؤول العجوزة تعديل أو إضافة حركة. إعادة الفتح للمدير العام/التنفيذي فقط.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label>تاريخ اليوم</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="md:col-span-2 flex items-end">
              {currentClosure && (
                <Badge className={STATUS_BADGE[currentClosure.status].cls + " text-sm py-1 px-3"}>
                  حالة هذا اليوم: {STATUS_BADGE[currentClosure.status].label}
                </Badge>
              )}
            </div>
          </div>

          {summary && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { l: "رصيد أول اليوم", v: summary.opening_treasury, c: "bg-slate-50" },
                { l: "إيرادات اليوم", v: summary.total_cash_in, c: "bg-emerald-50" },
                { l: "مصروفات+صرف", v: Number(summary.total_cash_out) + Number(summary.total_expenses), c: "bg-rose-50" },
                { l: "مبيعات اليوم", v: summary.total_sales, c: "bg-sky-50" },
                { l: "توريد معلق", v: summary.handover_pending, c: "bg-amber-50" },
                { l: "توريد معتمد", v: summary.handover_approved, c: "bg-emerald-50" },
                { l: "توريد مرفوض", v: summary.handover_rejected, c: "bg-rose-50" },
                { l: "الرصيد المتوقع", v: summary.expected_treasury, c: "bg-primary/10 font-bold" },
              ].map((k) => (
                <div key={k.l} className={`rounded-lg p-3 border ${k.c}`}>
                  <div className="text-xs text-muted-foreground">{k.l}</div>
                  <div className="text-lg font-bold">{fmt(Number(k.v))}</div>
                </div>
              ))}
            </div>
          )}

          {(!currentClosure || currentClosure.status !== "closed") && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end border-t pt-4">
              <div>
                <Label>الرصيد الفعلي بالخزنة *</Label>
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
                    variance === 0 ? "" : variance > 0 ? "text-emerald-700" : "text-rose-700"
                  }`}
                />
              </div>
              <Button onClick={doClose} disabled={busy} className="bg-emerald-600 hover:bg-emerald-700">
                {busy && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
                <LockKeyhole className="ml-2 h-4 w-4" />
                إقفال اليوم
              </Button>
              <div className="md:col-span-3">
                <Label>ملاحظة الإقفال</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
              </div>
            </div>
          )}

          {currentClosure?.status === "closed" && (
            <div className="border-t pt-4">
              <div className="text-sm text-emerald-800 bg-emerald-50 p-3 rounded">
                ✅ تم إقفال هذا اليوم بتاريخ {formatDateTime(currentClosure.closed_at!)} — الرصيد الفعلي {fmt(currentClosure.closing_treasury)} — الفرق {fmt(currentClosure.variance)}
              </div>
              {canApprove && (
                <Button
                  variant="outline"
                  className="mt-3"
                  onClick={() => setReopenFor(currentClosure)}
                >
                  <Unlock className="ml-2 h-4 w-4" />
                  إعادة فتح اليوم (Override)
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>سجل الإقفالات اليومية</CardTitle>
        </CardHeader>
        <CardContent>
          {closures.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">لا توجد إقفالات بعد</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>اليوم</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>افتتاحي</TableHead>
                    <TableHead>إيرادات</TableHead>
                    <TableHead>مصروفات</TableHead>
                    <TableHead>توريد معتمد</TableHead>
                    <TableHead>متوقع</TableHead>
                    <TableHead>فعلي</TableHead>
                    <TableHead>الفرق</TableHead>
                    <TableHead>وقت الإقفال</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {closures.map((c) => {
                    const b = STATUS_BADGE[c.status];
                    return (
                      <TableRow key={c.id}>
                        <TableCell>{c.closure_date}</TableCell>
                        <TableCell><Badge className={b.cls}>{b.label}</Badge></TableCell>
                        <TableCell>{fmt(c.opening_treasury)}</TableCell>
                        <TableCell>{fmt(c.total_cash_in)}</TableCell>
                        <TableCell>{fmt(Number(c.total_cash_out) + Number(c.total_expenses))}</TableCell>
                        <TableCell>{fmt(c.total_handover)}</TableCell>
                        <TableCell>{fmt(c.expected_treasury)}</TableCell>
                        <TableCell>{fmt(c.closing_treasury)}</TableCell>
                        <TableCell className={c.variance === 0 ? "" : c.variance > 0 ? "text-emerald-700" : "text-rose-700"}>
                          {fmt(c.variance)}
                        </TableCell>
                        <TableCell className="text-xs">{c.closed_at ? formatDateTime(c.closed_at) : "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!reopenFor} onOpenChange={(o) => !o && setReopenFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إعادة فتح يوم مُقفل</DialogTitle>
            <DialogDescription>
              يتم تسجيل سبب الـ Override في سجل التدقيق. ({reopenFor?.closure_date})
            </DialogDescription>
          </DialogHeader>
          <Textarea value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} rows={3} placeholder="سبب إعادة الفتح..." />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReopenFor(null)}>إلغاء</Button>
            <Button onClick={doReopen}>تأكيد إعادة الفتح</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
