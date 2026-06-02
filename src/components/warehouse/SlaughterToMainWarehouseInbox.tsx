import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Beef, ArrowDown, CheckCircle2, Edit } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

const qualityLabelText: Record<string, string> = {
  accepted: "مقبول",
  rejected: "مرفوض",
  quarantine: "حجر صحي",
};

interface Props {
  /** If provided, the inbox auto-selects this warehouse and hides the picker. */
  defaultWarehouseId?: string;
}

/**
 * Inbox of slaughter outputs routed to the main / finished-goods warehouses
 * (destination = 'warehouse'). Mirrors SlaughterToMeatInbox but for the main
 * warehouse path. Uses the same RPC `receive_slaughter_batch_verified`.
 */
export function SlaughterToMainWarehouseInbox({ defaultWarehouseId }: Props) {
  const { canManageWarehouses, isGeneralManager, isExecutiveManager } = useAuth();
  const canReceive = canManageWarehouses || isGeneralManager || isExecutiveManager;

  const [outputs, setOutputs] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [receiveBatch, setReceiveBatch] = useState<any | null>(null);
  const [receiveWarehouseId, setReceiveWarehouseId] = useState<string>(defaultWarehouseId || "");
  const [verifyMap, setVerifyMap] = useState<Record<string, { received_weight_kg: number; quality_status: string; notes: string }>>({});
  const [receiving, setReceiving] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchAll = async () => {
    setLoading(true);
    const [s, w] = await Promise.all([
      supabase.from("slaughter_batch_outputs")
        .select("id, batch_id, cut_name_ar, actual_weight_kg, unit_cost, quality_status, received_status, received_at, received_warehouse_id, destination, batch:slaughter_batches(batch_number, slaughter_date, status)")
        .eq("destination", "warehouse")
        .order("created_at", { ascending: false })
        .limit(500),
      supabase.from("warehouses")
        .select("id, name, type")
        .eq("type", "finished_goods")
        .order("name"),
    ]);
    if (s.data) setOutputs(s.data);
    if (w.data) setWarehouses(w.data);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const pending = useMemo(() => outputs.filter(o => o.received_status !== 'received'), [outputs]);
  const received = useMemo(() => outputs.filter(o => o.received_status === 'received'), [outputs]);

  const pendingBatches = useMemo(() => Object.values(
    pending.reduce((acc: Record<string, any>, o: any) => {
      const key = o.batch_id;
      if (!acc[key]) acc[key] = {
        batch_id: o.batch_id,
        batch_number: o.batch?.batch_number || '—',
        slaughter_date: o.batch?.slaughter_date,
        status: o.batch?.status,
        outputs: [],
      };
      acc[key].outputs.push(o);
      return acc;
    }, {})
  ) as any[], [pending]);

  const openReceive = (b: any) => {
    setReceiveBatch(b);
    const initial = defaultWarehouseId
      || warehouses.find(w => w.name?.includes('المقر') || w.name?.includes('الرئيسي'))?.id
      || warehouses[0]?.id
      || "";
    setReceiveWarehouseId(initial);
    const map: Record<string, any> = {};
    b.outputs.forEach((o: any) => {
      map[o.id] = {
        received_weight_kg: Number(o.actual_weight_kg || 0),
        quality_status: o.quality_status || 'accepted',
        notes: '',
      };
    });
    setVerifyMap(map);
  };

  const confirmReceive = async () => {
    if (!receiveBatch || !receiveWarehouseId) {
      toast.error("اختر المخزن"); return;
    }
    const items = receiveBatch.outputs.map((o: any) => ({
      id: o.id,
      received_weight_kg: verifyMap[o.id]?.received_weight_kg ?? Number(o.actual_weight_kg || 0),
      quality_status: verifyMap[o.id]?.quality_status ?? (o.quality_status || 'accepted'),
      notes: verifyMap[o.id]?.notes || null,
    }));
    setReceiving(true);
    const { data, error } = await supabase.rpc('receive_slaughter_batch_verified', {
      p_batch_id: receiveBatch.batch_id,
      p_warehouse_id: receiveWarehouseId,
      p_items: items as any,
    });
    setReceiving(false);
    if (error) { toast.error(error.message); return; }
    const r: any = data || {};
    toast.success(`تم الاستلام: ${r.received_count || 0} صنف • مضاف للمخزون: ${r.added_to_stock || 0} • ${Number(r.total_kg || 0).toFixed(2)} كجم`);
    setReceiveBatch(null);
    fetchAll();
  };

  return (
    <div className="space-y-4">
      <Card className="border-purple-300 bg-purple-50/40">
        <CardContent className="py-4 text-sm text-purple-900">
          <strong>📦 وارد المجزر إلى المخزن الرئيسي:</strong> هنا تظهر كل التقسيمات التي يرسلها مسؤول المجزر إلى المخزن الرئيسي. راجع الأوزان والجودة قبل الاعتماد، ثم اضغط «اعتماد الوارد وإضافة للمخزون» لتدخل الكميات في رصيد المخزن وتظهر في سجل الحركات بمصدر «المجزر».
        </CardContent>
      </Card>

      {loading ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">جارٍ التحميل...</CardContent></Card>
      ) : pendingBatches.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">لا توجد تقسيمات بانتظار الاستلام من المجزر</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {pendingBatches.map((b: any) => {
            const totalKg = b.outputs.reduce((s: number, o: any) => s + Number(o.actual_weight_kg || 0), 0);
            return (
              <Card key={b.batch_id} className="border-purple-300">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Beef className="w-5 h-5 text-purple-600" /> الدفعة {b.batch_number}
                        <Badge variant="outline">{b.outputs.length} صنف</Badge>
                        <Badge variant="secondary">بانتظار الاستلام</Badge>
                      </CardTitle>
                      <CardDescription>
                        تاريخ الذبح: {b.slaughter_date || '—'} • إجمالي {totalKg.toFixed(2)} كجم
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {canReceive ? (
                        <Button onClick={() => openReceive(b)} className="bg-purple-600 hover:bg-purple-700">
                          <Edit className="w-4 h-4 ml-1" /> اعتماد الوارد وإضافة للمخزون
                        </Button>
                      ) : (
                        <Badge variant="outline">عرض فقط</Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>الصنف</TableHead>
                        <TableHead>الكمية (كجم)</TableHead>
                        <TableHead>التكلفة/كجم</TableHead>
                        <TableHead>الجودة</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {b.outputs.map((o: any) => (
                        <TableRow key={o.id}>
                          <TableCell className="font-medium">{o.cut_name_ar}</TableCell>
                          <TableCell>{Number(o.actual_weight_kg).toFixed(2)}</TableCell>
                          <TableCell>{Number(o.unit_cost || 0).toFixed(2)}</TableCell>
                          <TableCell><Badge variant="outline">{qualityLabelText[o.quality_status] || "—"}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {received.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" /> سجل المستلم في المخزن الرئيسي
            </CardTitle>
            <CardDescription>آخر التقسيمات التي تم استلامها وإضافتها للمخزون</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الدفعة</TableHead>
                  <TableHead>الصنف</TableHead>
                  <TableHead>الكمية (كجم)</TableHead>
                  <TableHead>تاريخ الاستلام</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {received.slice(0, 50).map((o: any) => (
                  <TableRow key={o.id}>
                    <TableCell>{o.batch?.batch_number || '—'}</TableCell>
                    <TableCell className="font-medium">{o.cut_name_ar}</TableCell>
                    <TableCell>{Number(o.actual_weight_kg).toFixed(2)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {o.received_at ? new Date(o.received_at).toLocaleString("ar-EG") : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!receiveBatch} onOpenChange={(v) => !v && setReceiveBatch(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>تعديل الكميات واستلام الدفعة {receiveBatch?.batch_number}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {!defaultWarehouseId && (
              <div>
                <label className="text-sm font-medium mb-1 block">المخزن المستلِم</label>
                <Select value={receiveWarehouseId} onValueChange={setReceiveWarehouseId}>
                  <SelectTrigger><SelectValue placeholder="اختر المخزن الرئيسي" /></SelectTrigger>
                  <SelectContent>
                    {warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الصنف</TableHead>
                  <TableHead>الوزن المُرسل</TableHead>
                  <TableHead>الوزن المستلم فعلياً</TableHead>
                  <TableHead>الجودة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receiveBatch?.outputs.map((o: any) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-medium">{o.cut_name_ar}</TableCell>
                    <TableCell>{Number(o.actual_weight_kg).toFixed(2)}</TableCell>
                    <TableCell>
                      <Input
                        type="number" step="0.01" className="w-28"
                        value={verifyMap[o.id]?.received_weight_kg ?? 0}
                        onChange={(e) => setVerifyMap(m => ({ ...m, [o.id]: { ...m[o.id], received_weight_kg: Number(e.target.value) } }))}
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={verifyMap[o.id]?.quality_status || 'accepted'}
                        onValueChange={(v) => setVerifyMap(m => ({ ...m, [o.id]: { ...m[o.id], quality_status: v } }))}
                      >
                        <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="accepted">مقبول</SelectItem>
                          <SelectItem value="rejected">مرفوض</SelectItem>
                          <SelectItem value="quarantine">حجر صحي</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReceiveBatch(null)}>إلغاء</Button>
            <Button onClick={confirmReceive} disabled={receiving} className="bg-purple-600 hover:bg-purple-700">
              <ArrowDown className="w-4 h-4 ml-1" />
              {receiving ? "جارٍ الاستلام..." : "تأكيد الاستلام وإضافة للمخزون"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default SlaughterToMainWarehouseInbox;
