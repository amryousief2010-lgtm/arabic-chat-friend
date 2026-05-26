import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { Inbox, RefreshCw, CheckCircle2, Sparkles, Ban, FileText, FileSpreadsheet, Eye, Printer } from "lucide-react";
import { toast } from "sonner";
import { formatDate } from "@/lib/dateFormat";
import { useAuth } from "@/hooks/useAuth";
import * as XLSX from "xlsx";

interface Shipment {
  id: string;
  production_id: string | null;
  family_id: string | null;
  family_number: string | null;
  production_date: string;
  egg_count: number;
  status: "pending" | "received" | "partial" | "rejected";
  received_egg_count: number | null;
  damaged_count: number | null;
  received_at: string | null;
  receipt_notes: string | null;
  rejection_reason: string | null;
  hatch_batch_id: string | null;
  suggested_batch_id: string | null;
  created_at: string;
}

const shipNo = (id: string) => `SH-${id.slice(0, 6).toUpperCase()}`;

const STATUS_AR: Record<Shipment["status"], string> = {
  pending: "بانتظار الاستلام",
  received: "مستلم بالكامل",
  partial: "مستلم جزئياً",
  rejected: "مرفوض",
};

const statusBadge = (s: Shipment["status"]) => {
  const map: Record<string, any> = {
    pending: "warning",
    received: "default",
    partial: "secondary",
    rejected: "destructive",
  };
  return <Badge variant={map[s]}>{STATUS_AR[s]}</Badge>;
};

const esc = (v: any) => String(v ?? "—").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const FarmShipmentsInbox = () => {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState<Shipment | null>(null);
  const [detail, setDetail] = useState<Shipment | null>(null);
  const [rejecting, setRejecting] = useState<Shipment | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [form, setForm] = useState({ received: 0, damaged: 0, dead: 0, notes: "", hatch_batch_id: "" });
  const [confirmMatch, setConfirmMatch] = useState(false);
  const [suggestedId, setSuggestedId] = useState<string | null>(null);

  const { data: rows = [], isLoading, refetch } = useQuery({
    queryKey: ["farm-to-hatchery-shipments", showAll],
    queryFn: async () => {
      let q = (supabase as any)
        .from("farm_to_hatchery_shipments")
        .select("*")
        .order("production_date", { ascending: false })
        .limit(500);
      if (!showAll) q = q.eq("status", "pending");
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as Shipment[];
    },
  });

  const { data: batches = [] } = useQuery({
    queryKey: ["hatch_batches_for_link"],
    queryFn: async () => {
      const { data } = await supabase.from("hatch_batches")
        .select("id, batch_number, receive_date, status")
        .neq("status", "completed")
        .order("receive_date", { ascending: false }).limit(100);
      return data || [];
    },
  });

  // Lookup for ANY linked batch (also completed) — needed to render batch number in the table
  const { data: allBatches = [] } = useQuery({
    queryKey: ["hatch_batches_lookup_all"],
    queryFn: async () => {
      const { data } = await supabase.from("hatch_batches").select("id, batch_number");
      return data || [];
    },
  });
  const batchNoById = useMemo(() => {
    const m = new Map<string, string>();
    allBatches.forEach((b: any) => m.set(b.id, b.batch_number));
    return m;
  }, [allBatches]);

  useEffect(() => {
    const channel = supabase
      .channel("farm-shipments-inbox")
      .on("postgres_changes", { event: "*", schema: "public", table: "farm_to_hatchery_shipments" }, () => {
        qc.invalidateQueries({ queryKey: ["farm-to-hatchery-shipments"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc]);

  const pendingCount = rows.filter(r => r.status === "pending").length;

  const openReceive = async (r: Shipment) => {
    setEditing(r);
    setForm({
      received: r.egg_count,
      damaged: 0,
      notes: "",
      hatch_batch_id: r.hatch_batch_id || r.suggested_batch_id || "",
    });
    setSuggestedId(r.suggested_batch_id || null);
    if (!r.hatch_batch_id && !r.suggested_batch_id) {
      const { data } = await (supabase as any).rpc("suggest_hatch_batch_for_shipment", { p_shipment_id: r.id });
      if (data) {
        setSuggestedId(data);
        setForm(f => ({ ...f, hatch_batch_id: data }));
      }
    }
  };

  const computedStatus: Shipment["status"] = useMemo(() => {
    if (!editing) return "received";
    const received = Number(form.received) || 0;
    const damaged = Number(form.damaged) || 0;
    if (received <= 0) return "rejected";
    if (received < editing.egg_count || damaged > 0) return "partial";
    return "received";
  }, [editing, form.received, form.damaged]);

  const confirmReceive = async () => {
    if (!editing) return;
    const received = Number(form.received) || 0;
    const damaged = Number(form.damaged) || 0;
    if (received > editing.egg_count) { toast.error("الكمية المستلمة لا يمكن أن تتجاوز المرسلة"); return; }
    if (damaged < 0 || received < 0) { toast.error("القيم غير صحيحة"); return; }

    const { error } = await (supabase as any)
      .from("farm_to_hatchery_shipments")
      .update({
        status: computedStatus,
        received_egg_count: received,
        damaged_count: damaged,
        received_at: new Date().toISOString(),
        received_by: profile?.id ?? null,
        receipt_notes: form.notes || null,
        hatch_batch_id: form.hatch_batch_id || null,
      })
      .eq("id", editing.id);
    if (error) { toast.error(error.message); return; }
    toast.success(damaged > 0
      ? `تم تأكيد الاستلام — تم إرسال إشعار للمدير العام والتنفيذي بوجود هالك (${damaged})`
      : "تم تأكيد الاستلام");
    setEditing(null);
    setDetail(null);
    refetch();
  };

  const confirmReject = async () => {
    if (!rejecting) return;
    if (!rejectReason.trim()) { toast.error("يجب كتابة سبب الرفض"); return; }
    const { error } = await (supabase as any)
      .from("farm_to_hatchery_shipments")
      .update({
        status: "rejected",
        received_egg_count: 0,
        damaged_count: rejecting.egg_count,
        received_at: new Date().toISOString(),
        received_by: profile?.id ?? null,
        rejection_reason: rejectReason.trim(),
      })
      .eq("id", rejecting.id);
    if (error) { toast.error(error.message); return; }
    toast.success("تم رفض الشحنة");
    setRejecting(null);
    setRejectReason("");
    refetch();
  };

  // ===== Exports =====
  const exportExcel = () => {
    const data = rows.map(r => ({
      "رقم الشحنة": shipNo(r.id),
      "تاريخ الإنتاج": r.production_date,
      "الأسرة": r.family_number || "",
      "رقم الدفعة": r.hatch_batch_id ? (batchNoById.get(r.hatch_batch_id) || "") : "",
      "المرسل (بيضة)": r.egg_count,
      "المستلم": r.received_egg_count ?? "",
      "التالف": r.damaged_count ?? "",
      "الحالة": STATUS_AR[r.status],
      "وقت الاستلام": r.received_at ? formatDate(r.received_at) : "",
      "ملاحظات": r.receipt_notes || "",
      "سبب الرفض": r.rejection_reason || "",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "وارد المزرعة");
    XLSX.writeFile(wb, `وارد-المزرعة-${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success("تم تصدير ملف Excel");
  };

  const openPrint = (html: string) => {
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) { toast.error("لم يتم فتح نافذة الطباعة - تحقق من الحاجب"); return; }
    w.document.write(html);
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 350);
  };

  const reportShellStyles = `
    <style>
      @page { size: A4; margin: 14mm; }
      * { box-sizing: border-box; }
      body { font-family: "Cairo","Tahoma",sans-serif; direction: rtl; color:#1a1a2e; margin:0; padding:0; }
      .head { display:flex; justify-content:space-between; align-items:flex-end; border-bottom:3px solid #6d28d9; padding-bottom:10px; margin-bottom:14px; }
      .brand h1 { margin:0; font-size:20px; color:#6d28d9; }
      .brand p { margin:2px 0 0; font-size:11px; color:#555; }
      .meta { font-size:11px; color:#444; text-align:left; }
      .summary { display:grid; grid-template-columns: repeat(4, 1fr); gap:8px; margin-bottom:14px; }
      .kpi { border:1px solid #e5e7eb; border-radius:8px; padding:8px 10px; background:#faf7ff; }
      .kpi .l { font-size:10px; color:#6b7280; }
      .kpi .v { font-size:16px; font-weight:700; color:#1a1a2e; margin-top:2px; }
      table { width:100%; border-collapse: collapse; font-size:11px; }
      th, td { border:1px solid #d1d5db; padding:6px 8px; text-align:right; }
      thead { background:#6d28d9; color:#fff; }
      tbody tr:nth-child(even) { background:#fafafa; }
      .b-pending { background:#fef3c7; color:#92400e; padding:2px 6px; border-radius:6px; font-size:10px; }
      .b-received { background:#d1fae5; color:#065f46; padding:2px 6px; border-radius:6px; font-size:10px; }
      .b-partial { background:#dbeafe; color:#1e40af; padding:2px 6px; border-radius:6px; font-size:10px; }
      .b-rejected { background:#fee2e2; color:#991b1b; padding:2px 6px; border-radius:6px; font-size:10px; }
      .foot { margin-top:18px; display:flex; justify-content:space-between; font-size:11px; color:#444; }
      .sig { border-top:1px solid #999; padding-top:6px; min-width:180px; text-align:center; }
      h2 { color:#6d28d9; font-size:14px; margin: 16px 0 8px; }
      .detail-grid { display:grid; grid-template-columns: 1fr 1fr; gap:6px 14px; font-size:12px; }
      .detail-grid div { padding:6px 8px; border-bottom:1px dotted #ddd; }
      .detail-grid b { color:#6d28d9; }
    </style>`;

  const exportListPdf = () => {
    const total = rows.reduce((s, r) => s + r.egg_count, 0);
    const totalRec = rows.reduce((s, r) => s + (r.received_egg_count || 0), 0);
    const totalDmg = rows.reduce((s, r) => s + (r.damaged_count || 0), 0);
    const pending = rows.filter(r => r.status === "pending").length;

    const body = `
      <div class="head">
        <div class="brand">
          <h1>تقرير وارد البيض من المزرعة</h1>
          <p>شركة نعم العاصمة — معمل التفريخ</p>
        </div>
        <div class="meta">
          تاريخ التقرير: ${new Date().toLocaleString("ar-EG-u-nu-latn")}<br/>
          عدد السجلات: ${rows.length} ${showAll ? "(الكل)" : "(معلقة فقط)"}
        </div>
      </div>
      <div class="summary">
        <div class="kpi"><div class="l">إجمالي المرسل</div><div class="v">${total.toLocaleString()}</div></div>
        <div class="kpi"><div class="l">إجمالي المستلم</div><div class="v">${totalRec.toLocaleString()}</div></div>
        <div class="kpi"><div class="l">إجمالي التالف</div><div class="v">${totalDmg.toLocaleString()}</div></div>
        <div class="kpi"><div class="l">شحنات معلقة</div><div class="v">${pending.toLocaleString()}</div></div>
      </div>
      <table>
        <thead><tr>
          <th>#</th><th>رقم الشحنة</th><th>التاريخ</th><th>الأسرة</th><th>رقم الدفعة</th>
          <th>المرسل</th><th>المستلم</th><th>التالف</th><th>الحالة</th><th>وقت الاستلام</th>
        </tr></thead>
        <tbody>
          ${rows.map((r, i) => `
            <tr>
              <td>${i + 1}</td>
              <td><b>${shipNo(r.id)}</b></td>
              <td>${esc(r.production_date)}</td>
              <td>${esc(r.family_number)}</td>
              <td>${esc(r.hatch_batch_id ? batchNoById.get(r.hatch_batch_id) : "—")}</td>
              <td>${r.egg_count.toLocaleString()}</td>
              <td>${r.received_egg_count ?? "—"}</td>
              <td>${r.damaged_count ?? "—"}</td>
              <td><span class="b-${r.status}">${STATUS_AR[r.status]}</span></td>
              <td>${r.received_at ? formatDate(r.received_at) : "—"}</td>
            </tr>`).join("")}
        </tbody>
      </table>
      <div class="foot">
        <div class="sig">المسؤول عن الاستلام</div>
        <div class="sig">مشرف المعمل</div>
        <div class="sig">المدير التنفيذي</div>
      </div>`;
    openPrint(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>وارد المزرعة</title>${reportShellStyles}</head><body>${body}</body></html>`);
  };

  const exportSinglePdf = (r: Shipment) => {
    const batchNo = r.hatch_batch_id ? batchNoById.get(r.hatch_batch_id) : null;
    const body = `
      <div class="head">
        <div class="brand">
          <h1>تفاصيل شحنة بيض — ${shipNo(r.id)}</h1>
          <p>شركة نعم العاصمة — معمل التفريخ</p>
        </div>
        <div class="meta">
          تاريخ الطباعة: ${new Date().toLocaleString("ar-EG-u-nu-latn")}
        </div>
      </div>
      <h2>بيانات الشحنة</h2>
      <div class="detail-grid">
        <div><b>رقم الشحنة:</b> ${shipNo(r.id)}</div>
        <div><b>الحالة:</b> <span class="b-${r.status}">${STATUS_AR[r.status]}</span></div>
        <div><b>تاريخ الإنتاج:</b> ${esc(r.production_date)}</div>
        <div><b>الأسرة:</b> ${esc(r.family_number)}</div>
        <div><b>رقم الدفعة بالمعمل:</b> ${esc(batchNo || "غير مربوطة")}</div>
        <div><b>تاريخ التسجيل:</b> ${formatDate(r.created_at)}</div>
      </div>
      <h2>الكميات</h2>
      <div class="detail-grid">
        <div><b>المرسل من المزرعة:</b> ${r.egg_count.toLocaleString()} بيضة</div>
        <div><b>المستلم فعلياً:</b> ${r.received_egg_count ?? "—"}</div>
        <div><b>التالف / المكسور:</b> ${r.damaged_count ?? "—"}</div>
        <div><b>الفرق:</b> ${r.status !== "pending" ? (r.egg_count - (r.received_egg_count || 0) - (r.damaged_count || 0)) : "—"}</div>
        <div><b>وقت الاستلام:</b> ${r.received_at ? formatDate(r.received_at) : "—"}</div>
      </div>
      ${r.receipt_notes ? `<h2>ملاحظات الاستلام</h2><p>${esc(r.receipt_notes)}</p>` : ""}
      ${r.rejection_reason ? `<h2>سبب الرفض</h2><p style="color:#991b1b">${esc(r.rejection_reason)}</p>` : ""}
      <div class="foot">
        <div class="sig">المسؤول عن الاستلام</div>
        <div class="sig">مشرف المعمل</div>
        <div class="sig">المدير التنفيذي</div>
      </div>`;
    openPrint(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>${shipNo(r.id)}</title>${reportShellStyles}</head><body>${body}</body></html>`);
  };

  return (
    <TooltipProvider>
    <Card className="border-primary/30">
      <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
        <CardTitle className="flex items-center gap-2">
          <Inbox className="w-5 h-5 text-primary" />
          وارد البيض من المزرعة
          {pendingCount > 0 && <Badge variant="destructive">{pendingCount}</Badge>}
        </CardTitle>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={exportListPdf} disabled={rows.length === 0}>
            <FileText className="w-4 h-4 ml-1" /> PDF
          </Button>
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={rows.length === 0}>
            <FileSpreadsheet className="w-4 h-4 ml-1" /> Excel
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowAll(s => !s)}>
            {showAll ? "عرض المعلق فقط" : "عرض الكل"}
          </Button>
          <Button variant="outline" size="icon" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-center text-sm text-muted-foreground py-6">جاري التحميل...</p>
        ) : rows.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-6">
            {showAll ? "لا توجد شحنات" : "لا توجد شحنات معلقة 🎉"}
          </p>
        ) : (
          <div className="overflow-auto max-h-[600px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>رقم الشحنة</TableHead>
                  <TableHead>تاريخ الإنتاج</TableHead>
                  <TableHead>الأسرة</TableHead>
                  <TableHead>رقم الدفعة</TableHead>
                  <TableHead>المرسل</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>المستلم</TableHead>
                  <TableHead>التالف</TableHead>
                  <TableHead>وقت الاستلام</TableHead>
                  <TableHead>إجراء</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(r => {
                  const diff = (r.egg_count) - (r.received_egg_count ?? 0) - (r.damaged_count ?? 0);
                  const batchNo = r.hatch_batch_id ? batchNoById.get(r.hatch_batch_id) : null;
                  return (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs font-semibold text-primary">{shipNo(r.id)}</TableCell>
                    <TableCell>{r.production_date}</TableCell>
                    <TableCell className="font-semibold">{r.family_number || "-"}</TableCell>
                    <TableCell>
                      {batchNo ? <Badge variant="secondary">{batchNo}</Badge> : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>{r.egg_count}</TableCell>
                    <TableCell>
                      <Tooltip>
                        <TooltipTrigger asChild><span>{statusBadge(r.status)}</span></TooltipTrigger>
                        <TooltipContent>
                          <div className="text-xs">
                            مرسل: {r.egg_count} · مستلم: {r.received_egg_count ?? "-"} · تالف: {r.damaged_count ?? "-"}
                            {r.status !== "pending" && <> · فرق: {diff}</>}
                            {r.rejection_reason && <div>سبب الرفض: {r.rejection_reason}</div>}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </TableCell>
                    <TableCell>{r.received_egg_count ?? "-"}</TableCell>
                    <TableCell>{r.damaged_count ?? "-"}</TableCell>
                    <TableCell className="text-xs">
                      {r.received_at ? formatDate(r.received_at) : "-"}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 flex-wrap">
                        <Button size="sm" variant="outline" onClick={() => setDetail(r)}>
                          <Eye className="w-4 h-4 ml-1" /> تفاصيل
                        </Button>
                        {r.status === "pending" && (
                          <>
                            <Button size="sm" onClick={() => openReceive(r)}>
                              <CheckCircle2 className="w-4 h-4 ml-1" /> استلام
                            </Button>
                            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { setRejecting(r); setRejectReason(""); }}>
                              <Ban className="w-4 h-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {/* Detail dialog */}
      <Dialog open={!!detail} onOpenChange={(v) => !v && setDetail(null)}>
        <DialogContent dir="rtl" className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span>تفاصيل الشحنة</span>
              {detail && <Badge variant="outline" className="font-mono">{shipNo(detail.id)}</Badge>}
              {detail && statusBadge(detail.status)}
            </DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <DetailRow label="تاريخ الإنتاج" value={detail.production_date} />
                <DetailRow label="الأسرة" value={detail.family_number || "—"} />
                <DetailRow label="رقم الدفعة بالمعمل"
                  value={detail.hatch_batch_id ? (batchNoById.get(detail.hatch_batch_id) || "غير معروف") : "غير مربوطة"} />
                <DetailRow label="تاريخ التسجيل" value={formatDate(detail.created_at)} />
                <DetailRow label="المرسل من المزرعة" value={`${detail.egg_count.toLocaleString()} بيضة`} />
                <DetailRow label="المستلم فعلياً" value={detail.received_egg_count ?? "—"} />
                <DetailRow label="التالف / المكسور" value={detail.damaged_count ?? "—"} />
                <DetailRow label="وقت الاستلام" value={detail.received_at ? formatDate(detail.received_at) : "—"} />
              </div>
              {detail.receipt_notes && (
                <div className="bg-muted/50 p-3 rounded text-xs">
                  <strong>ملاحظات الاستلام: </strong>{detail.receipt_notes}
                </div>
              )}
              {detail.rejection_reason && (
                <div className="bg-destructive/10 text-destructive p-3 rounded text-xs">
                  <strong>سبب الرفض: </strong>{detail.rejection_reason}
                </div>
              )}
            </div>
          )}
          <DialogFooter className="gap-2 flex-wrap">
            <Button variant="outline" onClick={() => detail && exportSinglePdf(detail)}>
              <Printer className="w-4 h-4 ml-1" /> طباعة التفاصيل
            </Button>
            {detail?.status === "pending" && (
              <Button onClick={() => { const r = detail; setDetail(null); openReceive(r!); }}>
                <CheckCircle2 className="w-4 h-4 ml-1" /> تأكيد الاستلام
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Receive dialog */}
      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>تأكيد استلام البيض — {editing && shipNo(editing.id)}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="text-sm bg-muted p-2 rounded">
                أسرة <strong>{editing.family_number}</strong> · تاريخ {editing.production_date} · مرسل: <strong>{editing.egg_count}</strong> بيضة
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>المستلم فعلياً</Label>
                  <Input type="number" min={0} max={editing.egg_count} value={form.received}
                    onChange={(e) => setForm({ ...form, received: +e.target.value })} />
                </div>
                <div>
                  <Label>تالف / مكسور</Label>
                  <Input type="number" min={0} max={editing.egg_count} value={form.damaged}
                    onChange={(e) => setForm({ ...form, damaged: +e.target.value })} />
                </div>
              </div>
              <div className="flex items-center justify-between text-xs bg-accent/30 p-2 rounded">
                <span>الحالة المحسوبة:</span>
                {statusBadge(computedStatus)}
              </div>
              <div>
                <Label className="flex items-center gap-1">
                  ربط بدفعة معمل
                  {suggestedId && form.hatch_batch_id === suggestedId && (
                    <Badge variant="secondary" className="text-[10px] gap-1"><Sparkles className="w-3 h-3" />مقترح</Badge>
                  )}
                </Label>
                <Select value={form.hatch_batch_id || "none"} onValueChange={(v) => setForm({ ...form, hatch_batch_id: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="بدون ربط" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">بدون ربط</SelectItem>
                    {batches.map((b: any) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.batch_number} — {b.receive_date}
                        {b.id === suggestedId && " ⭐"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {batches.length === 0 && (
                  <p className="text-xs text-muted-foreground mt-1">لا توجد دفع معمل مفتوحة — أنشئ دفعة من صفحة المعمل أولاً.</p>
                )}
              </div>
              <div>
                <Label>ملاحظات</Label>
                <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={confirmReceive}>تأكيد الاستلام</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject dialog */}
      <Dialog open={!!rejecting} onOpenChange={(v) => { if (!v) { setRejecting(null); setRejectReason(""); } }}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive">رفض شحنة المزرعة</DialogTitle>
          </DialogHeader>
          {rejecting && (
            <div className="space-y-3">
              <div className="text-sm bg-destructive/10 p-2 rounded">
                أسرة <strong>{rejecting.family_number}</strong> · {rejecting.production_date} · {rejecting.egg_count} بيضة
              </div>
              <div>
                <Label>سبب الرفض <span className="text-destructive">*</span></Label>
                <Textarea required value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="مثلاً: البيض كله مكسور / تالف بالكامل / خطأ في التسجيل..." />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="destructive" onClick={confirmReject}>
              <Ban className="w-4 h-4 ml-1" /> تأكيد الرفض
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
    </TooltipProvider>
  );
};

const DetailRow = ({ label, value }: { label: string; value: any }) => (
  <div className="flex justify-between gap-2 border-b border-dashed border-border/50 pb-1">
    <span className="text-muted-foreground">{label}</span>
    <span className="font-semibold">{value}</span>
  </div>
);

export default FarmShipmentsInbox;
