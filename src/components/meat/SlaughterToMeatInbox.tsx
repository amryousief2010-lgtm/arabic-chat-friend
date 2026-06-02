import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Beef, ArrowDown, Printer, FileSpreadsheet, Edit, CheckCircle2 } from "lucide-react";
import * as XLSX from "xlsx";
import { useAuth } from "@/hooks/useAuth";
import companyLogo from "@/assets/company-logo.jpg";

const qualityLabelText: Record<string, string> = {
  accepted: "مقبول",
  rejected: "مرفوض",
  quarantine: "حجر صحي",
};

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

function printBatch(b: any) {
  const totalKg = b.outputs.reduce((s: number, o: any) => s + Number(o.actual_weight_kg || 0), 0);
  const totalCost = b.outputs.reduce((s: number, o: any) => s + Number(o.actual_weight_kg || 0) * Number(o.unit_cost || 0), 0);
  const rows = b.outputs.map((o: any, i: number) => `
    <tr><td>${i + 1}</td><td>${esc(o.cut_name_ar)}</td><td>${Number(o.actual_weight_kg).toFixed(2)}</td>
    <td>${Number(o.unit_cost || 0).toFixed(2)}</td>
    <td>${(Number(o.actual_weight_kg) * Number(o.unit_cost || 0)).toFixed(2)}</td>
    <td>${esc(qualityLabelText[o.quality_status] || "—")}</td></tr>`).join("");
  const html = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"/>
    <title>وارد مصنع اللحوم - دفعة ${esc(b.batch_number)}</title>
    <style>
      @page { size: A4; margin: 14mm; }
      body { font-family: "Cairo","Segoe UI", Tahoma, Arial, sans-serif; color: #111; }
      .header { display:flex; align-items:center; justify-content:space-between; border-bottom: 2px solid #c2410c; padding-bottom: 10px; margin-bottom: 14px; }
      .header img { height: 70px; }
      h1 { margin: 0; color: #c2410c; }
      .meta { display:grid; grid-template-columns: repeat(3, 1fr); gap:8px; margin-bottom:12px; font-size: 13px; }
      .meta div { background:#fff7ed; padding:8px; border-radius:6px; }
      table { width:100%; border-collapse: collapse; font-size: 13px; }
      th, td { border:1px solid #ccc; padding:6px 8px; text-align:right; }
      th { background:#fed7aa; }
      tfoot td { font-weight:bold; background:#fafafa; }
      .sign { display:grid; grid-template-columns: repeat(3,1fr); gap:16px; margin-top:28px; font-size:12px; }
      .sign div { border-top:1px solid #333; padding-top:6px; text-align:center; }
      @media print { .no-print { display:none; } }
      .bar { text-align:center; margin-bottom:10px; }
      .bar button { padding:8px 18px; font-size:14px; cursor:pointer; }
    </style></head><body>
    <div class="bar no-print"><button onclick="window.print()">طباعة / حفظ PDF</button></div>
    <div class="header">
      <img src="${companyLogo}" />
      <div style="text-align:center">
        <h1>إيصال وارد إلى مصنع اللحوم</h1>
        <p>كابيتال أوستريش — ${new Date().toLocaleString("ar-EG")}</p>
      </div>
      <div style="width:70px"></div>
    </div>
    <div class="meta">
      <div><strong>رقم الدفعة:</strong> ${esc(b.batch_number)}</div>
      <div><strong>تاريخ الذبح:</strong> ${esc(b.slaughter_date || "—")}</div>
      <div><strong>عدد الأصناف:</strong> ${b.outputs.length}</div>
      <div><strong>إجمالي الوزن:</strong> ${totalKg.toFixed(2)} كجم</div>
      <div><strong>إجمالي التكلفة:</strong> ${totalCost.toFixed(2)} ج.م</div>
      <div><strong>الوجهة:</strong> مخزن خامات مصنع اللحوم</div>
    </div>
    <table>
      <thead><tr><th>م</th><th>الصنف</th><th>الوزن (كجم)</th><th>التكلفة/كجم</th><th>الإجمالي</th><th>الجودة</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="2">الإجماليات</td><td>${totalKg.toFixed(2)}</td><td>—</td><td>${totalCost.toFixed(2)}</td><td></td></tr></tfoot>
    </table>
    <div class="sign"><div>مسؤول مصنع اللحوم</div><div>مشرف الإنتاج</div><div>المراجعة</div></div>
    <script>window.addEventListener('load',()=>setTimeout(()=>window.print(),400));</script>
    </body></html>`;
  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) return;
  w.document.open(); w.document.write(html); w.document.close();
}

function exportBatchExcel(b: any) {
  const rows = b.outputs.map((o: any, i: number) => ({
    "م": i + 1,
    "الصنف": o.cut_name_ar || "",
    "الوزن (كجم)": Number(o.actual_weight_kg || 0),
    "التكلفة/كجم": Number(o.unit_cost || 0),
    "الإجمالي": Number(o.actual_weight_kg || 0) * Number(o.unit_cost || 0),
    "الجودة": qualityLabelText[o.quality_status] || "",
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "وارد مصنع اللحوم");
  XLSX.writeFile(wb, `وارد-مصنع-اللحوم-${b.batch_number}.xlsx`);
}

export function SlaughterToMeatInbox() {
  const { canManageMeatFactory } = useAuth();
  const [outputs, setOutputs] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [receiveBatch, setReceiveBatch] = useState<any | null>(null);
  const [receiveWarehouseId, setReceiveWarehouseId] = useState<string>("");
  const [verifyMap, setVerifyMap] = useState<Record<string, { received_weight_kg: number; quality_status: string; notes: string }>>({});
  const [receiving, setReceiving] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchAll = async () => {
    setLoading(true);
    const [s, w] = await Promise.all([
      supabase.from("slaughter_batch_outputs")
        .select("id, batch_id, cut_name_ar, actual_weight_kg, unit_cost, quality_status, received_status, received_at, received_warehouse_id, destination, batch:slaughter_batches(batch_number, slaughter_date, status)")
        .eq("destination", "meat_factory")
        .order("created_at", { ascending: false })
        .limit(300),
      supabase.from("warehouses").select("id, name, type").or("name.ilike.%مصنع اللحوم%,type.eq.raw_materials"),
    ]);
    if (s.data) setOutputs(s.data);
    if (w.data) setWarehouses(w.data);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const pending = outputs.filter(o => o.received_status !== 'received');
  const received = outputs.filter(o => o.received_status === 'received');

  const pendingBatches = Object.values(
    pending.reduce((acc: Record<string, any>, o: any) => {
      const key = o.batch_id;
      if (!acc[key]) acc[key] = {
        batch_id: o.batch_id, batch_number: o.batch?.batch_number || '—',
        slaughter_date: o.batch?.slaughter_date, status: o.batch?.status, outputs: [],
      };
      acc[key].outputs.push(o);
      return acc;
    }, {})
  ) as any[];

  const openReceive = (b: any) => {
    setReceiveBatch(b);
    const meatWh = warehouses.find(w => w.name?.includes('مصنع اللحوم')) || warehouses[0];
    setReceiveWarehouseId(meatWh?.id || "");
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
      <Card className="border-orange-300 bg-orange-50/40">
        <CardContent className="py-4 text-sm text-orange-900">
          <strong>📦 وارد المجزر إلى مصنع اللحوم:</strong> هنا تظهر كل التقسيمات التي يرسلها مسؤول المجزر إلى مصنع اللحوم. يمكنك مراجعة الأوزان والجودة قبل الاعتماد، تعديل الكمية المستلمة فعلياً، وطباعة إيصال استلام. بمجرد الضغط على «استلام» تُضاف الكميات تلقائياً إلى مخزن خامات مصنع اللحوم.
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
              <Card key={b.batch_id} className="border-orange-300">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Beef className="w-5 h-5 text-orange-600" /> الدفعة {b.batch_number}
                        <Badge variant="outline">{b.outputs.length} صنف</Badge>
                      </CardTitle>
                      <CardDescription>
                        تاريخ الذبح: {b.slaughter_date || '—'} • إجمالي {totalKg.toFixed(2)} كجم
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Button variant="outline" size="sm" onClick={() => printBatch(b)}>
                        <Printer className="w-4 h-4 ml-1" /> طباعة / PDF
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => exportBatchExcel(b)}>
                        <FileSpreadsheet className="w-4 h-4 ml-1 text-emerald-600" /> Excel
                      </Button>
                      {canManageMeatFactory && (
                        <Button onClick={() => openReceive(b)} className="bg-orange-600 hover:bg-orange-700">
                          <Edit className="w-4 h-4 ml-1" /> تعديل / استلام
                        </Button>
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
              <CheckCircle2 className="w-5 h-5 text-emerald-600" /> سجل المستلم في مصنع اللحوم
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
            <div>
              <label className="text-sm font-medium mb-1 block">المخزن المستلِم</label>
              <Select value={receiveWarehouseId} onValueChange={setReceiveWarehouseId}>
                <SelectTrigger><SelectValue placeholder="اختر مخزن خامات مصنع اللحوم" /></SelectTrigger>
                <SelectContent>
                  {warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
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
            <Button onClick={confirmReceive} disabled={receiving} className="bg-orange-600 hover:bg-orange-700">
              <ArrowDown className="w-4 h-4 ml-1" />
              {receiving ? "جارٍ الاستلام..." : "تأكيد الاستلام وإضافة للمخزون"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
