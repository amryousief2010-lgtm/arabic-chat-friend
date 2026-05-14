import { useEffect, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Supplier { id: string; name: string; contact_person: string | null; phone: string | null; email: string | null; address: string | null; payment_terms: string | null; notes: string | null; is_active: boolean; }
const empty = { name: "", contact_person: "", phone: "", email: "", address: "", payment_terms: "cash", notes: "", is_active: true };

const CateringSuppliers = () => {
  const [rows, setRows] = useState<Supplier[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState(empty);

  const load = async () => {
    const { data, error } = await supabase.from("catering_suppliers").select("*").order("created_at", { ascending: false });
    if (error) return toast.error(error.message);
    setRows((data || []) as Supplier[]);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.name.trim()) return toast.error("الاسم مطلوب");
    if (editing) {
      const { error } = await supabase.from("catering_suppliers").update(form).eq("id", editing.id);
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase.from("catering_suppliers").insert(form);
      if (error) return toast.error(error.message);
    }
    toast.success("تم الحفظ"); setOpen(false); load();
  };
  const remove = async (id: string) => {
    if (!confirm("حذف المورد؟")) return;
    const { error } = await supabase.from("catering_suppliers").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load();
  };

  return (
    <DashboardLayout>
      <Header title="الموردون" subtitle="إدارة موردي المواد الخام" />
      <div className="mb-4">
        <Button onClick={() => { setEditing(null); setForm(empty); setOpen(true); }} className="bg-gradient-to-r from-primary to-accent gap-2">
          <Plus className="w-4 h-4" /> مورد جديد
        </Button>
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>الاسم</TableHead><TableHead>المسؤول</TableHead><TableHead>الهاتف</TableHead>
            <TableHead>شروط الدفع</TableHead><TableHead className="text-end">إجراءات</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center py-10 text-muted-foreground">لا يوجد موردون</TableCell></TableRow>
              : rows.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-semibold">{s.name}</TableCell>
                  <TableCell>{s.contact_person || "-"}</TableCell>
                  <TableCell dir="ltr" className="font-mono">{s.phone || "-"}</TableCell>
                  <TableCell>{s.payment_terms}</TableCell>
                  <TableCell className="text-end">
                    <Button variant="ghost" size="icon" onClick={() => { setEditing(s); setForm({ name: s.name, contact_person: s.contact_person || "", phone: s.phone || "", email: s.email || "", address: s.address || "", payment_terms: s.payment_terms || "cash", notes: s.notes || "", is_active: s.is_active }); setOpen(true); }}><Pencil className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => remove(s.id)} className="text-destructive"><Trash2 className="w-4 h-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </CardContent></Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>{editing ? "تعديل مورد" : "مورد جديد"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label>الاسم *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>الشخص المسؤول</Label><Input value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} /></div>
            <div><Label>الهاتف</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} dir="ltr" /></div>
            <div><Label>البريد</Label><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} dir="ltr" /></div>
            <div><Label>شروط الدفع</Label><Input value={form.payment_terms} onChange={(e) => setForm({ ...form, payment_terms: e.target.value })} placeholder="cash / net_30..." /></div>
            <div className="col-span-2"><Label>العنوان</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
            <div className="col-span-2"><Label>ملاحظات</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
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
export default CateringSuppliers;
