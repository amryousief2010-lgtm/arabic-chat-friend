import { useEffect, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Trash2, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface RawMaterial { id: string; name: string; category: string | null; unit: string; unit_cost: number; stock: number; low_stock_threshold: number; supplier_id: string | null; is_active: boolean; }
interface Supplier { id: string; name: string; }
const empty = { name: "", category: "", unit: "كجم", unit_cost: 0, stock: 0, low_stock_threshold: 5, supplier_id: "", is_active: true };

const CateringRawMaterials = () => {
  const [rows, setRows] = useState<RawMaterial[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RawMaterial | null>(null);
  const [form, setForm] = useState(empty);

  const load = async () => {
    const { data, error } = await supabase.from("catering_raw_materials").select("*").order("name");
    if (error) return toast.error(error.message);
    setRows((data || []) as RawMaterial[]);
    const sup = await supabase.from("catering_suppliers").select("id, name").order("name");
    setSuppliers((sup.data || []) as Supplier[]);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.name.trim()) return toast.error("الاسم مطلوب");
    const payload = { ...form, supplier_id: form.supplier_id || null };
    if (editing) {
      const { error } = await supabase.from("catering_raw_materials").update(payload).eq("id", editing.id);
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase.from("catering_raw_materials").insert(payload);
      if (error) return toast.error(error.message);
    }
    toast.success("تم الحفظ"); setOpen(false); load();
  };
  const remove = async (id: string) => {
    if (!confirm("حذف المادة؟")) return;
    const { error } = await supabase.from("catering_raw_materials").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load();
  };

  return (
    <DashboardLayout>
      <Header title="المواد الخام" subtitle="مخزون المطبخ المركزي" />
      <div className="mb-4">
        <Button onClick={() => { setEditing(null); setForm(empty); setOpen(true); }} className="bg-gradient-to-r from-primary to-accent gap-2">
          <Plus className="w-4 h-4" /> مادة جديدة
        </Button>
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>الاسم</TableHead><TableHead>الفئة</TableHead><TableHead>الوحدة</TableHead>
            <TableHead>تكلفة الوحدة</TableHead><TableHead>الرصيد</TableHead><TableHead>الحالة</TableHead>
            <TableHead className="text-end">إجراءات</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 ? <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">لا توجد مواد بعد</TableCell></TableRow>
              : rows.map((r) => {
                const low = Number(r.stock) <= Number(r.low_stock_threshold);
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-semibold">{r.name}</TableCell>
                    <TableCell>{r.category || "-"}</TableCell>
                    <TableCell>{r.unit}</TableCell>
                    <TableCell>{Number(r.unit_cost).toLocaleString()} ر.س</TableCell>
                    <TableCell>{Number(r.stock).toLocaleString()} {r.unit}</TableCell>
                    <TableCell>
                      {low ? <Badge variant="destructive" className="gap-1"><AlertTriangle className="w-3 h-3" /> منخفض</Badge> : <Badge variant="secondary">جيد</Badge>}
                    </TableCell>
                    <TableCell className="text-end">
                      <Button variant="ghost" size="icon" onClick={() => { setEditing(r); setForm({ name: r.name, category: r.category || "", unit: r.unit, unit_cost: Number(r.unit_cost), stock: Number(r.stock), low_stock_threshold: Number(r.low_stock_threshold), supplier_id: r.supplier_id || "", is_active: r.is_active }); setOpen(true); }}><Pencil className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => remove(r.id)} className="text-destructive"><Trash2 className="w-4 h-4" /></Button>
                    </TableCell>
                  </TableRow>
                );
              })}
          </TableBody>
        </Table>
      </CardContent></Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>{editing ? "تعديل مادة" : "مادة جديدة"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label>الاسم *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>الفئة</Label><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></div>
            <div><Label>الوحدة</Label><Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></div>
            <div><Label>تكلفة الوحدة (ر.س)</Label><Input type="number" step="0.01" value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: Number(e.target.value) })} /></div>
            <div><Label>الرصيد الحالي</Label><Input type="number" step="0.01" value={form.stock} onChange={(e) => setForm({ ...form, stock: Number(e.target.value) })} /></div>
            <div><Label>حد المخزون المنخفض</Label><Input type="number" step="0.01" value={form.low_stock_threshold} onChange={(e) => setForm({ ...form, low_stock_threshold: Number(e.target.value) })} /></div>
            <div><Label>المورد</Label>
              <Select value={form.supplier_id || "none"} onValueChange={(v) => setForm({ ...form, supplier_id: v === "none" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="بدون" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">بدون</SelectItem>
                  {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={save} className="bg-gradient-to-r from-primary to-accent">حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};
export default CateringRawMaterials;
