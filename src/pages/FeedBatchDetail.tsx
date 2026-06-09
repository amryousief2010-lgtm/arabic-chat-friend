import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowRight, Loader2, Wheat, AlertTriangle, Printer, FileText } from "lucide-react";
import { exportBatchPDF } from "@/utils/exportBatchPDF";
import { openPrintWindow, escapeHtml, fmtNum, fmtDate } from "@/lib/printPdf";

export default function FeedBatchDetail() {
  const { id } = useParams<{ id: string }>();
  const [batch, setBatch] = useState<any>(null);
  const [cons, setCons] = useState<any[]>([]);
  const [items, setItems] = useState<Record<string, any>>({});
  const [movs, setMovs] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [whs, setWhs] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<any>({});

  const load = async () => {
    if (!id) return;
    const [b, c, w, a] = await Promise.all([
      supabase.from("feed_production_batches").select("*").eq("id", id).single(),
      supabase.from("feed_batch_consumption").select("*, raw_material:feed_raw_materials(name,unit)").eq("batch_id", id),
      supabase.from("warehouses").select("id,name"),
      supabase.from("production_batch_audit" as any).select("*").eq("batch_id", id).eq("module", "feed").order("performed_at", { ascending: false }),
    ]);
    if (b.error) return toast.error(b.error.message);
    setBatch(b.data); setCons(c.data || []); setWhs(w.data || []); setAudit((a.data as any) || []);
    setFields({
      target_warehouse_id: b.data?.target_warehouse_id || "",
      finished_inventory_item_id: b.data?.finished_inventory_item_id || "",
      actual_quantity: b.data?.actual_quantity ?? "",
      labor_cost: (b.data as any)?.labor_cost ?? "",
      service_cost: (b.data as any)?.service_cost ?? "",
      other_cost: (b.data as any)?.other_cost ?? "",
      waste_qty: (b.data as any)?.waste_qty ?? "",
      waste_cost: (b.data as any)?.waste_cost ?? "",
    });
    const itemIds = Array.from(new Set((c.data || []).map((r: any) => r.inventory_item_id).filter(Boolean)));
    if (itemIds.length) {
      const { data: ii } = await supabase.from("inventory_items").select("id,name,stock,reserved_qty,blocked_qty,unit_cost").in("id", itemIds);
      const map: Record<string, any> = {};
      (ii || []).forEach((x: any) => map[x.id] = x);
      setItems(map);
    }
    const { data: mv } = await supabase.from("inventory_movements").select("*").eq("reference_type", "feed_batch").eq("reference_id", id).order("created_at");
    setMovs(mv || []);
  };
  useEffect(() => { load(); }, [id]);

  const isLocked = batch && ["closed", "cancelled"].includes(batch.status);
  const editable = batch && ["draft", "planned", "under_review"].includes(batch.status);

  const rpc = async (fn: string, args: any) => {
    setBusy(true);
    const { error } = await supabase.rpc(fn as any, args);
    setBusy(false);
    if (error) { toast.error(`${fn}: ${error.message}`); return false; }
    toast.success("تمت العملية"); load(); return true;
  };

  const saveFields = async () => {
    await rpc("fd_feed_set_fields", {
      p_batch_id: id,
      p_target_warehouse_id: fields.target_warehouse_id || null,
      p_finished_item_id: fields.finished_inventory_item_id || null,
      p_actual_qty: fields.actual_quantity === "" ? null : Number(fields.actual_quantity),
      p_labor_cost: fields.labor_cost === "" ? null : Number(fields.labor_cost),
      p_service_cost: fields.service_cost === "" ? null : Number(fields.service_cost),
      p_other_cost: fields.other_cost === "" ? null : Number(fields.other_cost),
      p_waste_qty: fields.waste_qty === "" ? null : Number(fields.waste_qty),
      p_waste_cost: fields.waste_cost === "" ? null : Number(fields.waste_cost),
    });
  };

  const printInvoice = () => {
    const totalCost = Number(batch.total_cost || 0);
    const actualQty = Number(batch.actual_quantity || 0);
    const costPerKg = batch.cost_per_kg ? Number(batch.cost_per_kg) : (actualQty > 0 ? totalCost / actualQty : 0);
    const labor = Number((batch as any).labor_cost || 0);
    const service = Number((batch as any).service_cost || 0);
    const other = Number((batch as any).other_cost || 0);
    const waste = Number((batch as any).waste_cost || 0);
    const matsCost = cons.reduce((s, r: any) => s + Number(r.total_cost || 0), 0);

    const rows = cons.map((r: any, i: number) => `
      <tr>
        <td class="num">${i + 1}</td>
        <td>${escapeHtml(r.raw_material?.name)}</td>
        <td class="num">${fmtNum(r.actual_qty ?? r.quantity, 3)}</td>
        <td>${escapeHtml(r.raw_material?.unit || "كجم")}</td>
        <td class="num">${fmtNum(r.unit_cost, 4)}</td>
        <td class="num">${fmtNum(r.total_cost, 2)}</td>
      </tr>`).join("");

    const body = `
      <header>
        <div>
          <h1>فاتورة تصنيع أعلاف</h1>
          <div class="en">Feed Manufacturing Invoice</div>
        </div>
        <div class="meta">
          <div><b>رقم الدفعة:</b> ${escapeHtml(batch.batch_number)}</div>
          <div><b>الحالة:</b> ${escapeHtml(batch.status)}</div>
          <div><b>BOM:</b> v${escapeHtml(batch.bom_version ?? "—")}</div>
          <div><b>تاريخ الإنشاء:</b> ${fmtDate(batch.created_at)}</div>
          <div><b>تاريخ الطباعة:</b> ${fmtDate(new Date().toISOString())}</div>
        </div>
      </header>

      <div class="stats">
        <div class="stat"><div class="k">الكمية المخططة</div><div class="v">${fmtNum(batch.target_quantity, 2)} كجم</div></div>
        <div class="stat"><div class="k">الكمية الفعلية</div><div class="v">${fmtNum(actualQty, 2)} كجم</div></div>
        <div class="stat"><div class="k">إجمالي التكلفة</div><div class="v">${fmtNum(totalCost, 2)} ج.م</div></div>
        <div class="stat"><div class="k">تكلفة/كجم</div><div class="v">${fmtNum(costPerKg, 4)} ج.م</div></div>
      </div>

      <h2>بنود المواد الخام المستهلكة</h2>
      <table>
        <thead><tr><th>#</th><th>المادة</th><th>الكمية</th><th>الوحدة</th><th>تكلفة/وحدة</th><th>الإجمالي</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6" style="text-align:center;padding:14px;color:#888">لا توجد بنود</td></tr>`}</tbody>
        <tfoot><tr><td colspan="5" style="text-align:left;font-weight:bold;background:#f5edff">إجمالي تكلفة المواد</td><td class="num" style="font-weight:bold;background:#f5edff">${fmtNum(matsCost, 2)}</td></tr></tfoot>
      </table>

      <h2>تفصيل التكاليف الإضافية</h2>
      <table>
        <thead><tr><th>البند</th><th>القيمة (ج.م)</th></tr></thead>
        <tbody>
          <tr><td>تكلفة المواد الخام</td><td class="num">${fmtNum(matsCost, 2)}</td></tr>
          <tr><td>تكلفة العمالة</td><td class="num">${fmtNum(labor, 2)}</td></tr>
          <tr><td>تكلفة الخدمات</td><td class="num">${fmtNum(service, 2)}</td></tr>
          <tr><td>تكاليف أخرى</td><td class="num">${fmtNum(other, 2)}</td></tr>
          <tr><td>تكلفة الفاقد</td><td class="num">${fmtNum(waste, 2)}</td></tr>
          <tr style="background:#6b46c1;color:#fff;font-weight:bold"><td>الإجمالي الكلي</td><td class="num">${fmtNum(totalCost, 2)}</td></tr>
        </tbody>
      </table>

      <h2>التوقيعات</h2>
      <table>
        <thead><tr><th style="width:33%">المُصنّع</th><th style="width:33%">مراجع الجودة</th><th style="width:33%">المدير المسؤول</th></tr></thead>
        <tbody><tr><td style="height:60px"></td><td></td><td></td></tr></tbody>
      </table>
    `;
    openPrintWindow(`فاتورة تصنيع ${batch.batch_number}`, body);
  };



  const renderBlocker = (r: any) => {
    if (!r.inventory_item_id) return <Badge variant="destructive">لا يوجد ربط مخزن</Badge>;
    const it = items[r.inventory_item_id];
    if (!it) return null;
    const avail = Number(it.stock) - Number(it.reserved_qty || 0) - Number(it.blocked_qty || 0);
    const need = Number(r.actual_qty ?? r.quantity);
    if (Number(it.unit_cost) === 0 && Number(it.stock) > 0) return <Badge variant="destructive">تكلفة صفرية</Badge>;
    if (avail < need) return <Badge variant="destructive">مخزون غير كافٍ ({avail})</Badge>;
    return <Badge variant="secondary">متاح {avail}</Badge>;
  };

  if (!batch) return <div className="p-6"><Loader2 className="h-5 w-5 animate-spin" /></div>;





  return (
    <div dir="rtl" className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Link to="/feed-factory/batches"><Button variant="ghost" size="sm"><ArrowRight className="h-4 w-4 ml-1" />رجوع</Button></Link>
        <Wheat className="h-6 w-6 text-primary" />
        <div className="flex-1">
          <h1 className="text-xl font-bold">{batch.batch_number}</h1>
          <p className="text-xs text-muted-foreground">BOM v{batch.bom_version ?? "—"} • مخطط {batch.target_quantity} كجم</p>
        </div>
        <Badge className="text-base">{batch.status}</Badge>
        <Button size="sm" variant="outline" onClick={() => exportBatchPDF({ factory: "Feed Factory", batch, consumption: cons, movements: movs, audit })}>
          <Printer className="h-4 w-4 ml-1" />طباعة PDF
        </Button>
      </div>

      {isLocked && <div className="bg-muted border rounded p-3 text-sm flex items-center gap-2"><AlertTriangle className="h-4 w-4" />الدفعة مغلقة/ملغاة — للقراءة فقط</div>}

      <Card>
        <CardHeader><CardTitle>الحقول الأساسية</CardTitle></CardHeader>
        <CardContent className="grid md:grid-cols-3 gap-3">
          <div><Label>المخزن المستهدف</Label>
            <Select disabled={!editable} value={fields.target_warehouse_id} onValueChange={v => setFields({ ...fields, target_warehouse_id: v })}>
              <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
              <SelectContent>{whs.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>المنتج التام (Inventory ID)</Label><Input disabled={!editable} value={fields.finished_inventory_item_id} onChange={e => setFields({ ...fields, finished_inventory_item_id: e.target.value })} /></div>
          <div><Label>الكمية الفعلية (كجم)</Label><Input disabled={!editable} type="number" value={fields.actual_quantity} onChange={e => setFields({ ...fields, actual_quantity: e.target.value })} /></div>
          <div><Label>تكلفة العمالة</Label><Input disabled={!editable} type="number" value={fields.labor_cost} onChange={e => setFields({ ...fields, labor_cost: e.target.value })} /></div>
          <div><Label>تكلفة الخدمات</Label><Input disabled={!editable} type="number" value={fields.service_cost} onChange={e => setFields({ ...fields, service_cost: e.target.value })} /></div>
          <div><Label>تكاليف أخرى</Label><Input disabled={!editable} type="number" value={fields.other_cost} onChange={e => setFields({ ...fields, other_cost: e.target.value })} /></div>
          <div><Label>كمية الفاقد</Label><Input disabled={!editable} type="number" value={fields.waste_qty} onChange={e => setFields({ ...fields, waste_qty: e.target.value })} /></div>
          <div><Label>تكلفة الفاقد</Label><Input disabled={!editable} type="number" value={fields.waste_cost} onChange={e => setFields({ ...fields, waste_cost: e.target.value })} /></div>
          <div className="flex items-end"><Button disabled={!editable || busy} onClick={saveFields}>حفظ الحقول</Button></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>بنود الاستهلاك (Snapshot)</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>المادة</TableHead><TableHead>مخطط</TableHead><TableHead>فعلي</TableHead><TableHead>تكلفة/وحدة</TableHead><TableHead>الإجمالي</TableHead><TableHead>المتاح</TableHead></TableRow></TableHeader>
            <TableBody>
              {cons.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">لا توجد بنود</TableCell></TableRow>}
              {cons.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell>{r.raw_material?.name}</TableCell>
                  <TableCell>{Number(r.quantity).toFixed(3)}</TableCell>
                  <TableCell>
                    {editable ? (
                      <Input type="number" defaultValue={r.actual_qty} className="w-24"
                        onBlur={e => { const v = Number(e.target.value); if (v !== Number(r.actual_qty)) rpc("fd_feed_edit_consumption_qty", { p_line_id: r.id, p_actual_qty: v }); }} />
                    ) : Number(r.actual_qty ?? 0).toFixed(3)}
                  </TableCell>
                  <TableCell>{Number(r.unit_cost).toFixed(4)}</TableCell>
                  <TableCell>{Number(r.total_cost || 0).toFixed(2)}</TableCell>
                  <TableCell>{renderBlocker(r)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex gap-2 flex-wrap">
        {["draft", "planned"].includes(batch.status) && <Button disabled={busy} onClick={() => rpc("feed_batch_submit_review", { p_batch_id: id })}>إرسال للمراجعة</Button>}
        {batch.status === "under_review" && <Button disabled={busy} onClick={() => rpc("feed_batch_approve", { p_batch_id: id, p_override_negative: false })}>اعتماد</Button>}
        {batch.status === "approved" && <Button disabled={busy} onClick={() => rpc("feed_batch_close", { p_batch_id: id })}>إغلاق + ترحيل للمخزون</Button>}
        {batch && !isLocked && <Button variant="destructive" disabled={busy} onClick={() => { const r = prompt("سبب الإلغاء"); if (r) rpc("feed_batch_cancel", { p_batch_id: id, p_reason: r }); }}>إلغاء</Button>}
      </div>

      <Card>
        <CardHeader><CardTitle>التكاليف</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div><b>إجمالي التكلفة:</b> {Number(batch.total_cost || 0).toFixed(2)}</div>
          <div><b>تكلفة/كجم:</b> {batch.cost_per_kg ? Number(batch.cost_per_kg).toFixed(4) : "—"}</div>
          <div><b>فعلي:</b> {batch.actual_quantity ?? "—"} كجم</div>
          <div><b>مخطط:</b> {batch.target_quantity} كجم</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>حركات المخزون المُولّدة ({movs.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>#</TableHead><TableHead>النوع</TableHead><TableHead>الكمية</TableHead><TableHead>تكلفة</TableHead><TableHead>إجمالي</TableHead></TableRow></TableHeader>
            <TableBody>
              {movs.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-4">لا توجد حركات بعد</TableCell></TableRow>}
              {movs.map(m => (
                <TableRow key={m.id}>
                  <TableCell className="font-mono text-xs">{m.movement_no}</TableCell>
                  <TableCell><Badge variant="outline">{m.movement_type}</Badge></TableCell>
                  <TableCell>{Number(m.quantity).toFixed(3)}</TableCell>
                  <TableCell>{Number(m.unit_cost).toFixed(4)}</TableCell>
                  <TableCell>{Number(m.total_cost || 0).toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>سجل التدقيق</CardTitle></CardHeader>
        <CardContent>
          {audit.length === 0 ? <div className="text-sm text-muted-foreground">لا يوجد</div> : (
            <ol className="space-y-2 text-xs">
              {audit.map((e: any) => (
                <li key={e.id} className="border rounded p-2">
                  <div><b>{e.action}</b> {e.old_status} → {e.new_status} • {new Date(e.performed_at).toLocaleString("ar-EG")}</div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
