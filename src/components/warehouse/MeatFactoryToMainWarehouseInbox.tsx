import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Factory, ArrowDown, CheckCircle2, XCircle } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

interface Props {
  /** Optional: only show transfers destined to this warehouse. */
  defaultWarehouseId?: string;
}

/**
 * Inbox for meat-factory finished-product transfers routed to the main
 * warehouse. Quantities do NOT enter main-warehouse stock until the
 * warehouse supervisor (or GM/EM) approves each row here.
 */
export function MeatFactoryToMainWarehouseInbox({ defaultWarehouseId }: Props) {
  const { canManageWarehouses, isGeneralManager, isExecutiveManager, isProductionManager, isWarehouseSupervisor } = useAuth();
  const canReceive = canManageWarehouses || isGeneralManager || isExecutiveManager || isProductionManager || isWarehouseSupervisor;

  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [receiveTx, setReceiveTx] = useState<any | null>(null);
  const [rejectTx, setRejectTx] = useState<any | null>(null);
  const [receivedQty, setReceivedQty] = useState<number>(0);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const [mfRows, setMfRows] = useState<any[]>([]);
  const [mfReject, setMfReject] = useState<any | null>(null);
  const [mfReason, setMfReason] = useState("");

  const fetchAll = async () => {
    setLoading(true);
    let q = supabase
      .from("meat_production_transfers")
      .select("id, transfer_no, quantity, unit_cost, total_cost, status, notes, created_at, received_at, destination_warehouse_id, product:meat_factory_products(name_ar), destination:warehouses!meat_production_transfers_destination_warehouse_id_fkey(name)")
      .order("created_at", { ascending: false })
      .limit(500);
    if (defaultWarehouseId) q = q.eq("destination_warehouse_id", defaultWarehouseId);

    let q2 = supabase
      .from("mf_transfers")
      .select("id, transfer_no, transfer_date, total_value, status, notes, created_at, destination_warehouse_id, lines:mf_transfer_lines(qty, unit_cost, total, fin:meat_finished_inventory(name_ar, unit))")
      .eq("status", "awaiting_receipt")
      .order("created_at", { ascending: false })
      .limit(200);
    if (defaultWarehouseId) q2 = q2.eq("destination_warehouse_id", defaultWarehouseId);

    const [{ data, error }, { data: mfData, error: mfErr }] = await Promise.all([q, q2]);
    if (error) toast.error(error.message);
    if (mfErr) toast.error(mfErr.message);
    setRows(data || []);
    setMfRows(mfData || []);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, [defaultWarehouseId]);

  const confirmMfReceive = async (t: any) => {
    setBusy(true);
    const { error } = await supabase.rpc("receive_mf_transfer", { p_id: t.id, p_notes: null });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("تم اعتماد أمر النقل وإضافة الكميات للمخزن");
    fetchAll();
  };

  const confirmMfReject = async () => {
    if (!mfReject) return;
    if (!mfReason.trim()) { toast.error("اكتب سبب الرفض"); return; }
    setBusy(true);
    const { error } = await supabase.rpc("reject_mf_transfer", { p_id: mfReject.id, p_reason: mfReason });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("تم رفض أمر النقل وإرجاع الكميات للمصنع");
    setMfReject(null);
    fetchAll();
  };


  const pending = useMemo(() => rows.filter(r => r.status === "pending"), [rows]);
  const received = useMemo(() => rows.filter(r => r.status === "received"), [rows]);

  const openReceive = (t: any) => { setReceiveTx(t); setReceivedQty(Number(t.quantity || 0)); setNote(""); };
  const openReject = (t: any) => { setRejectTx(t); setReason(""); };

  const confirmReceive = async () => {
    if (!receiveTx) return;
    if (!receivedQty || receivedQty <= 0) { toast.error("أدخل كمية صحيحة"); return; }
    setBusy(true);
    const { error } = await supabase.rpc("receive_meat_production_transfer", {
      _transfer_id: receiveTx.id,
      _received_qty: receivedQty,
      _notes: note || null,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("تم اعتماد الوارد وإضافته للمخزون");
    setReceiveTx(null);
    fetchAll();
  };

  const confirmReject = async () => {
    if (!rejectTx) return;
    if (!reason.trim()) { toast.error("اكتب سبب الرفض"); return; }
    setBusy(true);
    const { error } = await supabase.rpc("reject_meat_production_transfer", {
      _transfer_id: rejectTx.id,
      _reason: reason,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("تم رفض الوارد وإرجاع الكميات للمصنع");
    setRejectTx(null);
    fetchAll();
  };

  return (
    <div className="space-y-4">
      <Card className="border-rose-300 bg-rose-50/40">
        <CardContent className="py-4 text-sm text-rose-900">
          <strong>🍖 وارد مصنع اللحوم للمخزن الرئيسي:</strong> أي تحويل يبعته مصنع اللحوم يظهر هنا كـ «بانتظار الاعتماد». الكميات <strong>لا تدخل رصيد المخزن الرئيسي</strong> إلا بعد أن يعتمدها مسؤول المخزن. لو الكمية المستلمة أقل من المُرسلة، الفرق يرجع تلقائياً لمخزون المصنع.
        </CardContent>
      </Card>

      {mfRows.length > 0 && (
        <Card className="border-sky-300">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ArrowDown className="w-5 h-5 text-sky-600" /> أوامر نقل منتجات تامة بانتظار الاستلام
              <Badge variant="secondary">{mfRows.length}</Badge>
            </CardTitle>
            <CardDescription>الكميات خرجت من المصنع ولن تدخل رصيد المخزن إلا بعد اعتمادك</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>رقم الأمر</TableHead>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>الأصناف</TableHead>
                  <TableHead>القيمة</TableHead>
                  <TableHead className="text-left">إجراء</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mfRows.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-xs">{t.transfer_no}</TableCell>
                    <TableCell className="text-xs">{t.transfer_date}</TableCell>
                    <TableCell className="text-xs">
                      {(t.lines || []).map((l: any, i: number) => (
                        <div key={i}>{l.fin?.name_ar} — {Number(l.qty).toFixed(2)} {l.fin?.unit || ""}</div>
                      ))}
                    </TableCell>
                    <TableCell className="font-semibold">{Number(t.total_value || 0).toFixed(2)}</TableCell>
                    <TableCell className="text-left">
                      {canReceive ? (
                        <div className="flex items-center gap-2 justify-end">
                          <Button size="sm" disabled={busy} onClick={() => confirmMfReceive(t)} className="bg-emerald-600 hover:bg-emerald-700">
                            <CheckCircle2 className="w-4 h-4 ml-1" /> اعتماد الاستلام
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => { setMfReject(t); setMfReason(""); }}>
                            <XCircle className="w-4 h-4 ml-1" /> رفض
                          </Button>
                        </div>
                      ) : (
                        <Badge variant="outline">عرض فقط</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!mfReject} onOpenChange={(v) => !v && setMfReject(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>رفض أمر النقل {mfReject?.transfer_no}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">هترجع كل كميات الأمر لمخزون المنتجات التامة بالمصنع.</p>
            <Textarea value={mfReason} onChange={(e) => setMfReason(e.target.value)} rows={3} placeholder="سبب الرفض" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMfReject(null)}>إلغاء</Button>
            <Button variant="destructive" onClick={confirmMfReject} disabled={busy}>
              <XCircle className="w-4 h-4 ml-1" /> {busy ? "جارٍ..." : "تأكيد الرفض"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {loading ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">جارٍ التحميل...</CardContent></Card>
      ) : pending.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">لا توجد تحويلات بانتظار الاعتماد من مصنع اللحوم</CardContent></Card>
      ) : (
        <Card className="border-rose-300">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Factory className="w-5 h-5 text-rose-600" /> بانتظار الاعتماد
              <Badge variant="secondary">{pending.length}</Badge>
            </CardTitle>
            <CardDescription>راجع كل تحويل واعتمده أو ارفضه</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>رقم التحويل</TableHead>
                  <TableHead>المنتج</TableHead>
                  <TableHead>الكمية</TableHead>
                  <TableHead>التكلفة/وحدة</TableHead>
                  <TableHead>الإجمالي</TableHead>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>ملاحظات</TableHead>
                  <TableHead className="text-left">إجراء</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.transfer_no}</TableCell>
                    <TableCell>{t.product?.name_ar || "—"}</TableCell>
                    <TableCell>{Number(t.quantity).toFixed(2)}</TableCell>
                    <TableCell>{Number(t.unit_cost).toFixed(2)}</TableCell>
                    <TableCell>{Number(t.total_cost).toFixed(2)}</TableCell>
                    <TableCell className="text-xs">{new Date(t.created_at).toLocaleString("ar-EG")}</TableCell>
                    <TableCell className="text-xs">{t.notes || "—"}</TableCell>
                    <TableCell className="text-left">
                      {canReceive ? (
                        <div className="flex items-center gap-2 justify-end">
                          <Button size="sm" onClick={() => openReceive(t)} className="bg-emerald-600 hover:bg-emerald-700">
                            <CheckCircle2 className="w-4 h-4 ml-1" /> اعتماد
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => openReject(t)}>
                            <XCircle className="w-4 h-4 ml-1" /> رفض
                          </Button>
                        </div>
                      ) : (
                        <Badge variant="outline">عرض فقط</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {received.length > 0 && (
        <Card className="border-emerald-300 bg-emerald-50/30">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="w-5 h-5 text-emerald-700" /> تحويلات معتمدة ومضافة للمخزون
              <Badge variant="outline">{received.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>رقم التحويل</TableHead>
                  <TableHead>المنتج</TableHead>
                  <TableHead>الكمية</TableHead>
                  <TableHead>تاريخ الاعتماد</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {received.slice(0, 100).map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.transfer_no}</TableCell>
                    <TableCell>{t.product?.name_ar || "—"}</TableCell>
                    <TableCell className="text-emerald-700 font-semibold">+{Number(t.quantity).toFixed(2)}</TableCell>
                    <TableCell className="text-xs">{t.received_at ? new Date(t.received_at).toLocaleString("ar-EG") : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Receive dialog */}
      <Dialog open={!!receiveTx} onOpenChange={(v) => !v && setReceiveTx(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>اعتماد وارد {receiveTx?.transfer_no}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm">المنتج: <strong>{receiveTx?.product?.name_ar}</strong></div>
            <div className="text-sm">الكمية المُرسلة: <strong>{Number(receiveTx?.quantity || 0).toFixed(2)}</strong></div>
            <div>
              <label className="text-sm mb-1 block">الكمية المستلمة فعلياً</label>
              <Input type="number" step="0.01" value={receivedQty} onChange={(e) => setReceivedQty(Number(e.target.value))} />
              <p className="text-xs text-muted-foreground mt-1">الفرق (إن وجد) هيرجع لمخزون مصنع اللحوم تلقائياً.</p>
            </div>
            <div>
              <label className="text-sm mb-1 block">ملاحظات (اختياري)</label>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReceiveTx(null)}>إلغاء</Button>
            <Button onClick={confirmReceive} disabled={busy} className="bg-emerald-600 hover:bg-emerald-700">
              <ArrowDown className="w-4 h-4 ml-1" /> {busy ? "جارٍ..." : "تأكيد الاستلام"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject dialog */}
      <Dialog open={!!rejectTx} onOpenChange={(v) => !v && setRejectTx(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>رفض وارد {rejectTx?.transfer_no}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">هيتم إرجاع الكمية <strong>{Number(rejectTx?.quantity || 0).toFixed(2)}</strong> لمخزون مصنع اللحوم.</p>
            <div>
              <label className="text-sm mb-1 block">سبب الرفض</label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="مثال: كمية غير مطابقة، جودة غير مقبولة، ..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTx(null)}>إلغاء</Button>
            <Button variant="destructive" onClick={confirmReject} disabled={busy}>
              <XCircle className="w-4 h-4 ml-1" /> {busy ? "جارٍ..." : "تأكيد الرفض"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default MeatFactoryToMainWarehouseInbox;
