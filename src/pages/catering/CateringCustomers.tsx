import { useEffect, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Trash2, User, Building2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Customer {
  id: string; name: string; customer_type: string; phone: string; phone2: string | null;
  email: string | null; city: string | null; address: string | null; tax_number: string | null;
  payment_terms: string | null; notes: string | null; total_orders: number; total_spent: number;
}

const empty = { name: "", customer_type: "individual", phone: "", phone2: "", email: "", city: "", address: "", tax_number: "", payment_terms: "on_delivery", notes: "" };

const CateringCustomers = () => {
  const [rows, setRows] = useState<Customer[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState(empty);
  const [search, setSearch] = useState("");

  const load = async () => {
    const { data, error } = await supabase.from("catering_customers").select("*").order("created_at", { ascending: false });
    if (error) { toast.error(error.message); return; }
    setRows((data || []) as Customer[]);
  };
  useEffect(() => { load(); }, []);

  const startEdit = (c: Customer) => {
    setEditing(c);
    setForm({
      name: c.name, customer_type: c.customer_type, phone: c.phone, phone2: c.phone2 ?? "",
      email: c.email ?? "", city: c.city ?? "", address: c.address ?? "", tax_number: c.tax_number ?? "",
      payment_terms: c.payment_terms ?? "on_delivery", notes: c.notes ?? "",
    });
    setOpen(true);
  };
  const startNew = () => { setEditing(null); setForm(empty); setOpen(true); };

  const save = async () => {
    if (!form.name.trim() || !form.phone.trim()) { toast.error("الاسم والهاتف مطلوبان"); return; }
    const payload = { ...form, phone2: form.phone2 || null, email: form.email || null };
    const { data: { user } } = await supabase.auth.getUser();
    if (editing) {
      const { error } = await supabase.from("catering_customers").update(payload).eq("id", editing.id);
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase.from("catering_customers").insert({ ...payload, created_by: user?.id });
      if (error) return toast.error(error.message);
    }
    toast.success("تم الحفظ"); setOpen(false); load();
  };

  const remove = async (id: string) => {
    if (!confirm("حذف العميل نهائيًا؟")) return;
    const { error } = await supabase.from("catering_customers").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("تم الحذف"); load();
  };

  const filtered = rows.filter((r) => !search || r.name.includes(search) || r.phone.includes(search));

  return (
    <DashboardLayout>
      <Header title="عملاء Sugar in Space" subtitle="أفراد وشركات" />
      <div className="flex gap-3 mb-4">
        <Input placeholder="بحث بالاسم أو الهاتف..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-md" />
        <Button onClick={startNew} className="bg-gradient-to-r from-primary to-accent gap-2">
          <Plus className="w-4 h-4" /> عميل جديد
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>النوع</TableHead><TableHead>الاسم</TableHead><TableHead>الهاتف</TableHead>
                <TableHead>المدينة</TableHead><TableHead>الطلبات</TableHead><TableHead>إجمالي المشتريات</TableHead>
                <TableHead className="text-end">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-10">لا يوجد عملاء بعد</TableCell></TableRow>
              ) : filtered.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Badge variant={c.customer_type === "company" ? "default" : "secondary"} className="gap-1">
                      {c.customer_type === "company" ? <Building2 className="w-3 h-3" /> : <User className="w-3 h-3" />}
                      {c.customer_type === "company" ? "شركة" : "فرد"}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-semibold">{c.name}</TableCell>
                  <TableCell dir="ltr" className="font-mono">{c.phone}</TableCell>
                  <TableCell>{c.city || "-"}</TableCell>
                  <TableCell>{c.total_orders}</TableCell>
                  <TableCell>{Number(c.total_spent).toLocaleString()} ر.س</TableCell>
                  <TableCell className="text-end">
                    <Button variant="ghost" size="icon" onClick={() => startEdit(c)}><Pencil className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => remove(c.id)} className="text-destructive"><Trash2 className="w-4 h-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{editing ? "تعديل عميل" : "عميل جديد"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>النوع *</Label>
              <Select value={form.customer_type} onValueChange={(v) => setForm({ ...form, customer_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="individual">فرد</SelectItem><SelectItem value="company">شركة</SelectItem></SelectContent>
              </Select>
            </div>
            <div><Label>الاسم *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>الهاتف *</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} dir="ltr" /></div>
            <div><Label>هاتف ثانٍ</Label><Input value={form.phone2} onChange={(e) => setForm({ ...form, phone2: e.target.value })} dir="ltr" /></div>
            <div><Label>البريد</Label><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} dir="ltr" /></div>
            <div><Label>المدينة</Label><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
            <div className="col-span-2"><Label>العنوان</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
            {form.customer_type === "company" && (
              <div><Label>الرقم الضريبي</Label><Input value={form.tax_number} onChange={(e) => setForm({ ...form, tax_number: e.target.value })} dir="ltr" /></div>
            )}
            <div><Label>شروط الدفع</Label>
              <Select value={form.payment_terms} onValueChange={(v) => setForm({ ...form, payment_terms: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="prepaid">دفع مسبق</SelectItem>
                  <SelectItem value="on_delivery">عند التسليم</SelectItem>
                  <SelectItem value="net_15">آجل 15 يوم</SelectItem>
                  <SelectItem value="net_30">آجل 30 يوم</SelectItem>
                </SelectContent>
              </Select>
            </div>
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

export default CateringCustomers;
