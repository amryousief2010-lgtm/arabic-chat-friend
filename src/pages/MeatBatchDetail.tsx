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
import { ArrowRight, Loader2, Factory, AlertTriangle } from "lucide-react";

export default function MeatBatchDetail() {
  const { id } = useParams<{ id: string }>();
  const [batch, setBatch] = useState<any>(null);
  const [cons, setCons] = useState<any[]>([]);
  const [pack, setPack] = useState<any[]>([]);
  const [items, setItems] = useState<Record<string, any>>({});
  const [movs, setMovs] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [whs, setWhs] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<any>({});

  const load = async () => {
    if (!id) return;
    const [b, c, p, w, a] = await Promise.all([
      supabase.from("meat_factory_batches").select("*").eq("id", id).single(),
      supabase.from("meat_factory_batch_consumption").select("*").eq("batch_id", id),
      supabase.from("meat_factory_batch_packaging").select("*").eq("batch_id", id),
      supabase.from("warehouses").select("id,name"),
      supabase.from("production_batch_audit" as any).select("*").eq("batch_id", id).eq("module", "meat").order("performed_at", { ascending: false }),
    ]);
    if (b.error) return toast.error(b.error.message);
    setBatch(b.data); setCons(c.data || []); setPack(p.data || []); setWhs(w.data || []); setAudit((a.data as any) || []);
    setFields({
      target_warehouse_id: b.data?.target_warehouse_id || "",
      finished_inventory_item_id: b.data?.finished_inventory_item_id || "",
      actual_qty: b.data?.actual_qty ?? "",
      labor_cost: b.data?.labor_cost ?? "",
      service_cost: b.data?.service_cost ?? "",
      other_cost: (b.data as any)?.other_expenses ?? "",
      waste_qty: b.data?.waste_qty ?? "",
      waste_cost: b.data?.waste_cost ?? "",
    });
    const itemIds = Array.from(new Set([...(c.data || []), ...(p.data || [])].map((r: any) => r.inventory_item_id).filter(Boolean)));
    if (itemIds.length) {
      const { data: ii } = await supabase.from("inventory_items").select("id,name,stock,reserved_qty,blocked_qty,unit_cost").in("id", itemIds);
      const map: Record<string, any> = {};
      (ii || []).forEach((x: any) => map[x.id] = x);
      setItems(map);
    }
    const { data: mv } = await supabase.from("inventory_movements").select("*").eq("reference_type", "meat_batch").eq("reference_id", id).order("created_at");
    setMovs(mv || []);
  };
  useEffect(() => { load(); }, [id]);

  const isLocked = batch && ["closed", "cancelled"].includes(batch.status);
  const editable = batch && ["draft", "under_review"].includes(batch.status);

  const rpc = async (fn: string, args: any) => {
    setBusy(true);
    const { error } = await supabase.rpc(fn as any, args);
    setBusy(false);
    if (error) { toast.error(`${fn}: ${error.message}`); return false; }
    toast.success("تمت العملية"); load(); return true;
  };

  const saveFields = async () => {
    const args: any = { p_batch_id: id };
    for (const k of ["target_warehouse_id", "finished_inventory_item_id", "actual_qty", "labor_cost", "service_cost", "waste_qty", "waste_cost"]) {
      if (fields[k] !== "" && fields[k] !== null) args[`p_${k.replace("actual_qty", "actual_qty")}`] = fields[k];
    }
    args.p_target_warehouse_id = fields.target_warehouse_id || null;
    args.p_finished_item_id = fields.finished_inventory_item_id || null;
    args.p_actual_qty = fields.actual_qty === "" ? null : Number(fields.actual_qty);
    args.p_labor_cost = fields.labor_cost === "" ? null : Number(fields.labor_cost);
    args.p_service_cost = fields.service_cost === "" ? null : Number(fields.service_cost);
    args.p_other_expenses = fields.other_cost === "" ? null : Number(fields.other_cost);
    args.p_waste_qty = fields.waste_qty === "" ? null : Number(fields.waste_qty);
    args.p_waste_cost = fields.waste_cost === "" ? null : Number(fields.waste_cost);
    await rpc("fd_meat_set_fields", args);
  };

  const editActual = async (line_id: string, qty: number) => {
    await rpc("fd_meat_edit_consumption_qty", { p_line_id: line_id, p_actual_qty: qty });
  };

  if (!batch) return <div className="p-6"><Loader2 className="h-5 w-5 animate-spin" /></div>;

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

  return (
    <div dir="rtl" className="p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Link to="/meat-factory/batches"><Button variant="ghost" size="sm"><ArrowRight className="h-4 w-4 ml-1" />رجوع</Button></Link>
        <Factory className="h-6 w-6 text-primary" />
        <div className="flex-1">
          <h1 className="text-xl font-bold">{batch.batch_number} — {batch.product_name_ar}</h1>
          <p className="text-xs text-muted-foreground">منتج {batch.product_code} • BOM v{batch.bom_version}</p>
        </div>
        <Badge className="text-base">{batch.status}</Badge>
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
          <div><Label>المنتج التام (Inventory ID)</Label>
            <Input disabled={!editable} value={fields.finished_inventory_item_id} onChange={e => setFields({ ...fields, finished_inventory_item_id: e.target.value })} />
          </div>
          <div><Label>الكمية الفعلية ({batch.unit})</Label>
            <Input disabled={!editable} type="number" value={fields.actual_qty} onChange={e => setFields({ ...fields, actual_qty: e.target.value })} />
          </div>
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
            <TableHeader><TableRow>
              <TableHead>المادة</TableHead><TableHead>كود</TableHead><TableHead>مخطط</TableHead><TableHead>فعلي</TableHead><TableHead>تكلفة/وحدة</TableHead><TableHead>الإجمالي</TableHead><TableHead>المتاح</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {cons.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">لا توجد بنود</TableCell></TableRow>}
              {cons.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell>{r.material_name_ar}</TableCell>
                  <TableCell>{r.material_code}</TableCell>
                  <TableCell>{Number(r.quantity).toFixed(3)} {r.unit}</TableCell>
                  <TableCell>
                    {editable ? (
                      <Input type="number" defaultValue={r.actual_qty} className="w-24"
                        onBlur={e => { const v = Number(e.target.value); if (v !== Number(r.actual_qty)) editActual(r.id, v); }} />
                    ) : Number(r.actual_qty ?? 0).toFixed(3)}
                  </TableCell>
                  <TableCell>{Number(r.unit_cost).toFixed(4)}</TableCell>
                  <TableCell>{Number(r.line_total).toFixed(2)}</TableCell>
                  <TableCell>{renderBlocker(r)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {pack.length > 0 && (
        <Card>
          <CardHeader><CardTitle>بنود التغليف</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>الاسم</TableHead><TableHead>الكمية</TableHead><TableHead>تكلفة/وحدة</TableHead><TableHead>الإجمالي</TableHead><TableHead>المتاح</TableHead></TableRow></TableHeader>
              <TableBody>
                {pack.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.packaging_name_ar}</TableCell>
                    <TableCell>{Number(r.quantity).toFixed(2)} {r.unit}</TableCell>
                    <TableCell>{Number(r.unit_cost).toFixed(4)}</TableCell>
                    <TableCell>{Number(r.line_total).toFixed(2)}</TableCell>
                    <TableCell>{renderBlocker(r)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-2 flex-wrap">
        {batch.status === "draft" && <Button disabled={busy} onClick={() => rpc("meat_batch_submit_review", { p_batch_id: id })}>إرسال للمراجعة</Button>}
        {batch.status === "under_review" && <Button disabled={busy} onClick={() => rpc("meat_batch_approve", { p_batch_id: id, p_override_negative: false })}>اعتماد</Button>}
        {batch.status === "approved" && <Button disabled={busy} onClick={() => rpc("meat_batch_close", { p_batch_id: id })}>إغلاق + ترحيل للمخزون</Button>}
        {batch && !isLocked && <Button variant="destructive" disabled={busy} onClick={() => { const r = prompt("سبب الإلغاء"); if (r) rpc("meat_batch_cancel", { p_batch_id: id, p_reason: r }); }}>إلغاء</Button>}
      </div>

      <Card>
        <CardHeader><CardTitle>التكاليف</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div><b>تكلفة المواد:</b> {Number(batch.materials_cost || 0).toFixed(2)}</div>
          <div><b>تكلفة التغليف:</b> {Number(batch.packaging_cost || 0).toFixed(2)}</div>
          <div><b>إجمالي التكلفة:</b> {Number(batch.total_cost || 0).toFixed(2)}</div>
          <div><b>تكلفة/وحدة:</b> {batch.cost_per_unit ? Number(batch.cost_per_unit).toFixed(4) : "—"}</div>
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
                  {e.payload && <pre className="bg-muted/40 rounded p-1 mt-1">{JSON.stringify(e.payload)}</pre>}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
