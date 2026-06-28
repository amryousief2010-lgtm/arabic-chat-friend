import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ShieldCheck, X, Printer, AlertTriangle, CheckCircle2, Clock, Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";

const fmt = (n: any) => Number(n || 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 });

export default function FeedProductionApprovals({ onChanged }: { onChanged?: () => void }) {
  const { roles } = useAuth();
  const qc = useQueryClient();
  const canApprove = roles.some((r) =>
    ["general_manager", "executive_manager", "financial_manager"].includes(r),
  );

  const [rejectFor, setRejectFor] = useState<any | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);

  const pendingQ = useQuery({
    queryKey: ["feed-prod-invoices-pending"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("feed_production_invoices")
        .select("*, feed_products(name,stage), feed_production_invoice_items(*, feed_raw_materials(name,unit))")
        .eq("status", "pending_approval")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 30_000,
  });

  // 30-day baseline for outlier detection (approved only)
  const baselineQ = useQuery({
    queryKey: ["feed-prod-invoices-baseline-30d"],
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const { data, error } = await (supabase as any)
        .from("feed_production_invoices")
        .select("qty_produced,labor_cost,unit_cost")
        .eq("status", "approved")
        .gte("prod_date", since.toISOString().slice(0, 10));
      if (error) throw error;
      return data || [];
    },
  });

  const baseline = useMemo(() => {
    const rows = baselineQ.data || [];
    if (!rows.length) return { avgUnit: 0, avgLaborPerKg: 0 };
    const u = rows.reduce((s: number, r: any) => s + Number(r.unit_cost || 0), 0) / rows.length;
    const lpk =
      rows.reduce(
        (s: number, r: any) =>
          s + (Number(r.qty_produced) > 0 ? Number(r.labor_cost || 0) / Number(r.qty_produced) : 0),
        0,
      ) / rows.length;
    return { avgUnit: u, avgLaborPerKg: lpk };
  }, [baselineQ.data]);

  const flag = (p: any) => {
    const lpk = Number(p.qty_produced) > 0 ? Number(p.labor_cost || 0) / Number(p.qty_produced) : 0;
    const warns: string[] = [];
    if (baseline.avgUnit > 0 && Math.abs(Number(p.unit_cost) - baseline.avgUnit) / baseline.avgUnit > 0.25) {
      warns.push(
        `تكلفة الكيلو (${fmt(p.unit_cost)}) ${Number(p.unit_cost) > baseline.avgUnit ? "أعلى" : "أقل"} من متوسط 30 يوم (${fmt(baseline.avgUnit)}) بأكثر من 25%`,
      );
    }
    if (baseline.avgLaborPerKg > 0 && Math.abs(lpk - baseline.avgLaborPerKg) / baseline.avgLaborPerKg > 0.25) {
      warns.push(
        `أجرة التصنيع/كجم (${fmt(lpk)}) خارج متوسط 30 يوم (${fmt(baseline.avgLaborPerKg)}) بأكثر من 25%`,
      );
    }
    return warns;
  };

  const handleApprove = async (p: any) => {
    const warns = flag(p);
    if (warns.length) {
      const ok = window.confirm(
        "⚠️ تحذير: قيم خارج المعدل الطبيعي:\n\n" + warns.join("\n\n") + "\n\nهل تريد الاعتماد رغم ذلك؟",
      );
      if (!ok) return;
    } else if (!window.confirm(`اعتماد فاتورة ${p.prod_no}؟\nسيتم خصم الخامات وإضافة الإنتاج وحركة الخزنة.`)) {
      return;
    }
    setBusy(true);
    const { error } = await (supabase as any).rpc("approve_feed_production_invoice", {
      p_invoice_id: p.id,
    });
    setBusy(false);
    if (error) return toast.error(error.message || "فشل الاعتماد");
    toast.success("تم اعتماد الفاتورة وتنفيذ كل الأثر");
    qc.invalidateQueries({ queryKey: ["feed-prod-invoices-pending"] });
    qc.invalidateQueries({ queryKey: ["feed-prod-invoices"] });
    qc.invalidateQueries({ queryKey: ["feed-raw-materials"] });
    qc.invalidateQueries({ queryKey: ["feed-products"] });
    qc.invalidateQueries({ queryKey: ["feed-treasury"] });
    onChanged?.();
  };

  const submitReject = async () => {
    if (!rejectFor) return;
    if (!rejectReason.trim()) return toast.error("سبب الرفض مطلوب");
    setBusy(true);
    const { error } = await (supabase as any).rpc("reject_feed_production_invoice", {
      p_invoice_id: rejectFor.id,
      p_reason: rejectReason.trim(),
    });
    setBusy(false);
    if (error) return toast.error(error.message || "فشل الرفض");
    toast.success("تم رفض الفاتورة");
    setRejectFor(null);
    setRejectReason("");
    qc.invalidateQueries({ queryKey: ["feed-prod-invoices-pending"] });
    qc.invalidateQueries({ queryKey: ["feed-prod-invoices"] });
    onChanged?.();
  };

  const rows = pendingQ.data || [];

  return (
    <>
      <Card className="border-amber-300 bg-amber-50/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-amber-800">
            <Clock className="h-5 w-5" />
            اعتماد فواتير تصنيع الأعلاف
            {rows.length > 0 && <Badge variant="destructive">{rows.length}</Badge>}
          </CardTitle>
          <CardDescription>
            لا يتم خصم خامات أو خزنة أو تحديث تكلفة المنتج إلا بعد اعتماد المدير العام أو التنفيذي أو محمد شعلة.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {pendingQ.isLoading ? (
            <div className="text-sm text-muted-foreground">جارٍ التحميل...</div>
          ) : rows.length === 0 ? (
            <div className="flex items-center gap-2 text-green-700 bg-green-50 p-3 rounded-md border border-green-200">
              <CheckCircle2 className="h-5 w-5" />
              <span className="text-sm font-medium">لا توجد فواتير بانتظار الاعتماد.</span>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الرقم</TableHead>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>المنتج</TableHead>
                  <TableHead>الكمية</TableHead>
                  <TableHead>الخامات</TableHead>
                  <TableHead>تكلفة الخامات</TableHead>
                  <TableHead>أجرة التصنيع</TableHead>
                  <TableHead>إجمالي التكلفة</TableHead>
                  <TableHead>تكلفة الكيلو</TableHead>
                  <TableHead>تنبيه</TableHead>
                  <TableHead className="w-56">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p: any) => {
                  const itemsTotal = (p.feed_production_invoice_items || []).reduce(
                    (s: number, i: any) => s + Number(i.line_cost || 0),
                    0,
                  );
                  const warns = flag(p);
                  return (
                    <TableRow key={p.id} className={warns.length ? "bg-red-50/50" : ""}>
                      <TableCell className="font-mono text-xs">{p.prod_no}</TableCell>
                      <TableCell>{p.prod_date}</TableCell>
                      <TableCell className="font-medium">{p.feed_products?.name}</TableCell>
                      <TableCell>{fmt(p.qty_produced)} كجم</TableCell>
                      <TableCell className="text-xs">
                        {(p.feed_production_invoice_items || [])
                          .map((i: any) => `${i.feed_raw_materials?.name || ""} ${fmt(i.quantity)}`)
                          .join(" • ")}
                      </TableCell>
                      <TableCell>{fmt(itemsTotal)} ج.م</TableCell>
                      <TableCell>{fmt(p.labor_cost)} ج.م</TableCell>
                      <TableCell className="font-bold">{fmt(p.total_cost)} ج.م</TableCell>
                      <TableCell>{fmt(p.unit_cost)} ج/كجم</TableCell>
                      <TableCell>
                        {warns.length > 0 ? (
                          <div title={warns.join("\n")}>
                            <Badge variant="destructive" className="gap-1">
                              <AlertTriangle className="h-3 w-3" /> غير طبيعي
                            </Badge>
                          </div>
                        ) : (
                          <Badge variant="secondary">طبيعي</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1 flex-wrap">
                          {canApprove && (
                            <>
                              <Button
                                size="sm"
                                disabled={busy}
                                className="bg-green-600 hover:bg-green-700"
                                onClick={() => handleApprove(p)}
                              >
                                <ShieldCheck className="h-4 w-4 ml-1" /> اعتماد
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={busy}
                                onClick={() => setRejectFor(p)}
                              >
                                <X className="h-4 w-4 ml-1" /> رفض
                              </Button>
                            </>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => window.print()}
                            title="طباعة الصفحة"
                          >
                            <Printer className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          {!canApprove && rows.length > 0 && (
            <div className="text-xs text-muted-foreground mt-3">
              ⓘ صلاحية الاعتماد للمدير العام / التنفيذي / محمد شعلة فقط — أنت في وضع العرض.
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!rejectFor} onOpenChange={(o) => !o && setRejectFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>رفض فاتورة {rejectFor?.prod_no}</DialogTitle>
            <DialogDescription>اذكر سبب الرفض. لن يحدث أي تأثير على المخزون أو الخزائن.</DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="سبب الرفض..."
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectFor(null)}>
              إلغاء
            </Button>
            <Button variant="destructive" disabled={busy} onClick={submitReject}>
              تأكيد الرفض
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
