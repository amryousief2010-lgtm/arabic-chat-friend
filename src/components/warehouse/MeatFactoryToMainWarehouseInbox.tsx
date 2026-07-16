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
  const { canManageWarehouses, isGeneralManager, isExecutiveManager } = useAuth();
  const canReceive = canManageWarehouses || isGeneralManager || isExecutiveManager;

  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [receiveTx, setReceiveTx] = useState<any | null>(null);
  const [rejectTx, setRejectTx] = useState<any | null>(null);
  const [receivedQty, setReceivedQty] = useState<number>(0);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const fetchAll = async () => {
    setLoading(true);
    let q = supabase
      .from("meat_production_transfers")
      .select("id, transfer_no, quantity, unit_cost, total_cost, status, notes, created_at, received_at, destination_warehouse_id, product:meat_factory_products(name_ar), destination:warehouses!meat_production_transfers_destination_warehouse_id_fkey(name)")
      .order("created_at", { ascending: false })
      .limit(500);
    if (defaultWarehouseId) q = q.eq("destination_warehouse_id", defaultWarehouseId);
    const { data, error } = await q;
    if (error) toast.error(error.message);
    setRows(data || []);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, [defaultWarehouseId]);

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
