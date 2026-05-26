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
import { Inbox, RefreshCw, CheckCircle2, X, Sparkles, Ban } from "lucide-react";
import { toast } from "sonner";
import { formatDate } from "@/lib/dateFormat";
import { useAuth } from "@/hooks/useAuth";

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

const statusBadge = (s: Shipment["status"]) => {
  const map: Record<string, { label: string; variant: any }> = {
    pending: { label: "بانتظار الاستلام", variant: "warning" },
    received: { label: "مستلم بالكامل", variant: "default" },
    partial: { label: "مستلم جزئياً", variant: "secondary" },
    rejected: { label: "مرفوض", variant: "destructive" },
  };
  return <Badge variant={map[s].variant}>{map[s].label}</Badge>;
};

const FarmShipmentsInbox = () => {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState<Shipment | null>(null);
  const [rejecting, setRejecting] = useState<Shipment | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [form, setForm] = useState({
    received: 0, damaged: 0, notes: "", hatch_batch_id: "",
  });
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
    // Fetch smart suggestion if not pre-set
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
    if (received > editing.egg_count) {
      toast.error("الكمية المستلمة لا يمكن أن تتجاوز المرسلة");
      return;
    }
    if (damaged < 0 || received < 0) {
      toast.error("القيم غير صحيحة");
      return;
    }

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
    if (damaged > 0) {
      toast.success(`تم تأكيد الاستلام — تم إرسال إشعار للمدير العام والتنفيذي بوجود هالك (${damaged})`);
    } else {
      toast.success("تم تأكيد الاستلام");
    }
    setEditing(null);
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

  return (
    <TooltipProvider>
    <Card className="border-primary/30">
      <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
        <CardTitle className="flex items-center gap-2">
          <Inbox className="w-5 h-5 text-primary" />
          وارد البيض من المزرعة
          {pendingCount > 0 && <Badge variant="destructive">{pendingCount}</Badge>}
        </CardTitle>
        <div className="flex items-center gap-2">
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
                  <TableHead>تاريخ الإنتاج</TableHead>
                  <TableHead>الأسرة</TableHead>
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
                  return (
                  <TableRow key={r.id}>
                    <TableCell>{r.production_date}</TableCell>
                    <TableCell className="font-semibold">{r.family_number || "-"}</TableCell>
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
                      {r.status === "pending" ? (
                        <div className="flex gap-1">
                          <Button size="sm" onClick={() => openReceive(r)}>
                            <CheckCircle2 className="w-4 h-4 ml-1" /> استلام
                          </Button>
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { setRejecting(r); setRejectReason(""); }}>
                            <Ban className="w-4 h-4" />
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">{r.receipt_notes || "—"}</span>
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

      {/* Receive dialog */}
      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>تأكيد استلام البيض</DialogTitle>
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

export default FarmShipmentsInbox;
