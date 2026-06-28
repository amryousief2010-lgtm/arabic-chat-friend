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
    if (!rows.length) return { avgUnit: 0, avgLaborPerKg: 0, count: 0 };
    const u = rows.reduce((s: number, r: any) => s + Number(r.unit_cost || 0), 0) / rows.length;
    const lpk =
      rows.reduce(
        (s: number, r: any) =>
          s + (Number(r.qty_produced) > 0 ? Number(r.labor_cost || 0) / Number(r.qty_produced) : 0),
        0,
      ) / rows.length;
    return { avgUnit: u, avgLaborPerKg: lpk, count: rows.length };
  }, [baselineQ.data]);

  type WarnDetail = {
    metric: "unit_cost" | "labor_per_kg";
    label: string;
    current: number;
    average: number;
    deviationPct: number;
    direction: "أعلى" | "أقل";
    sampleCount: number;
    text: string;
  };

  const flag = (p: any): WarnDetail[] => {
    const lpk = Number(p.qty_produced) > 0 ? Number(p.labor_cost || 0) / Number(p.qty_produced) : 0;
    const warns: WarnDetail[] = [];
    if (baseline.avgUnit > 0) {
      const cur = Number(p.unit_cost);
      const dev = ((cur - baseline.avgUnit) / baseline.avgUnit) * 100;
      if (Math.abs(dev) > 25) {
        const direction: "أعلى" | "أقل" = cur > baseline.avgUnit ? "أعلى" : "أقل";
        warns.push({
          metric: "unit_cost",
          label: "تكلفة الكيلو",
          current: cur,
          average: baseline.avgUnit,
          deviationPct: Math.abs(dev),
          direction,
          sampleCount: baseline.count,
          text: `سبب المراجعة: تكلفة الكيلو ${direction} عن المعتاد. القيمة الحالية = ${fmt(cur)} ج/كجم، متوسط آخر 30 يوم = ${fmt(baseline.avgUnit)} ج/كجم، نسبة الانحراف = ${fmt(Math.abs(dev))}%. تم حساب المتوسط من ${baseline.count} فواتير معتمدة.`,
        });
      }
    }
    if (baseline.avgLaborPerKg > 0) {
      const dev = ((lpk - baseline.avgLaborPerKg) / baseline.avgLaborPerKg) * 100;
      if (Math.abs(dev) > 25) {
        const direction: "أعلى" | "أقل" = lpk > baseline.avgLaborPerKg ? "أعلى" : "أقل";
        warns.push({
          metric: "labor_per_kg",
          label: "أجرة التصنيع لكل كجم",
          current: lpk,
          average: baseline.avgLaborPerKg,
          deviationPct: Math.abs(dev),
          direction,
          sampleCount: baseline.count,
          text: `سبب المراجعة: أجرة التصنيع لكل كجم ${direction === "أقل" ? "منخفضة" : "مرتفعة"} عن المعتاد. القيمة الحالية = ${fmt(lpk)} ج/كجم، متوسط آخر 30 يوم = ${fmt(baseline.avgLaborPerKg)} ج/كجم، نسبة الانحراف = ${fmt(Math.abs(dev))}%. تم حساب المتوسط من ${baseline.count} فواتير معتمدة.`,
        });
      }
    }
    return warns;
  };

  const [reviewFor, setReviewFor] = useState<{ p: any; warns: WarnDetail[] } | null>(null);
  const [reviewNote, setReviewNote] = useState("");

  const handleApprove = async (p: any) => {
    const warns = flag(p);
    if (warns.length) {
      setReviewNote("");
      setReviewFor({ p, warns });
      return;
    }
    if (!window.confirm(`اعتماد فاتورة ${p.prod_no}؟\nسيتم خصم الخامات وإضافة الإنتاج وحركة الخزنة.`)) return;
    await doApprove(p, { note: null, warns: [] });
  };

  const doApprove = async (p: any, opts: { note: string | null; warns: WarnDetail[] }) => {
    setBusy(true);
    const { error } = await (supabase as any).rpc("approve_feed_production_invoice", {
      p_invoice_id: p.id,
      p_review_note: opts.note,
      p_was_flagged: opts.warns.length > 0,
      p_flag_reasons: opts.warns.length ? opts.warns : null,
    });
    setBusy(false);
    if (error) return toast.error(error.message || "فشل الاعتماد");
    toast.success("تم اعتماد الفاتورة وتنفيذ كل الأثر");
    qc.invalidateQueries({ queryKey: ["feed-prod-invoices-pending"] });
    qc.invalidateQueries({ queryKey: ["feed-prod-invoices"] });
    qc.invalidateQueries({ queryKey: ["feed-raw-materials"] });
    qc.invalidateQueries({ queryKey: ["feed-products"] });
    qc.invalidateQueries({ queryKey: ["feed-treasury"] });
    setReviewFor(null);
    setReviewNote("");
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
                          <Popover>
                            <PopoverTrigger asChild>
                              <button type="button" className="inline-flex items-center gap-1 focus:outline-none">
                                <Badge variant="destructive" className="gap-1 cursor-pointer">
                                  <AlertTriangle className="h-3 w-3" /> يحتاج مراجعة
                                </Badge>
                                <Info className="h-3.5 w-3.5 text-amber-700" aria-label="عرض سبب المراجعة" />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-96 text-sm space-y-3" align="end">
                              <div className="font-semibold text-amber-800 flex items-center gap-1">
                                <AlertTriangle className="h-4 w-4" /> سبب المراجعة
                              </div>
                              {warns.map((w, idx) => (
                                <div key={idx} className="border-r-2 border-amber-400 pr-2 space-y-1">
                                  <div className="font-medium">{w.label} ({w.direction} من المعتاد)</div>
                                  <div className="text-xs text-muted-foreground leading-relaxed">{w.text}</div>
                                  <div className="grid grid-cols-2 gap-1 text-xs pt-1">
                                    <div>القيمة الحالية: <b>{fmt(w.current)} ج/كجم</b></div>
                                    <div>متوسط 30 يوم: <b>{fmt(w.average)} ج/كجم</b></div>
                                    <div>نسبة الانحراف: <b>{fmt(w.deviationPct)}%</b></div>
                                    <div>عدد الفواتير: <b>{w.sampleCount}</b></div>
                                  </div>
                                </div>
                              ))}
                              <div className="text-[11px] text-muted-foreground pt-1 border-t">
                                ⓘ هذا تنبيه إعلامي فقط ولا يمنع الاعتماد.
                              </div>
                            </PopoverContent>
                          </Popover>
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
