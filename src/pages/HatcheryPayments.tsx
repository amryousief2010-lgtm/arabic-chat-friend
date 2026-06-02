import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Wallet } from "lucide-react";
import { format } from "date-fns";

interface HatchCustomer { id: string; name: string; }
interface Payment {
  id: string;
  customer_id: string;
  payment_date: string;
  amount: number;
  notes: string | null;
  created_at: string;
}

const todayISO = () => new Date().toISOString().slice(0, 10);

export default function HatcheryPayments() {
  const [customers, setCustomers] = useState<HatchCustomer[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCustomer, setFilterCustomer] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Payment | null>(null);
  const [deleting, setDeleting] = useState<Payment | null>(null);

  const [form, setForm] = useState({
    customer_id: "",
    payment_date: todayISO(),
    amount: "",
    notes: "",
  });

  const fetchAll = async () => {
    setLoading(true);
    const [{ data: cs, error: ce }, { data: ps, error: pe }] = await Promise.all([
      supabase.from("hatch_customers").select("id,name").eq("is_active", true).order("name"),
      supabase.from("hatch_customer_payments").select("*").order("payment_date", { ascending: false }),
    ]);
    if (ce) toast.error("تعذر تحميل العملاء");
    if (pe) toast.error("تعذر تحميل الدفعات");
    setCustomers(cs || []);
    setPayments((ps as Payment[]) || []);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const customerById = useMemo(() => {
    const m = new Map<string, string>();
    customers.forEach(c => m.set(c.id, c.name));
    return m;
  }, [customers]);

  const filtered = useMemo(() => {
    return payments.filter(p => {
      if (filterCustomer !== "all" && p.customer_id !== filterCustomer) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const name = (customerById.get(p.customer_id) || "").toLowerCase();
        if (!name.includes(q) && !(p.notes || "").toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [payments, filterCustomer, search, customerById]);

  const totalsByCustomer = useMemo(() => {
    const m = new Map<string, number>();
    payments.forEach(p => m.set(p.customer_id, (m.get(p.customer_id) || 0) + Number(p.amount)));
    return m;
  }, [payments]);

  const grandTotal = useMemo(
    () => filtered.reduce((s, p) => s + Number(p.amount), 0),
    [filtered]
  );

  const openCreate = () => {
    setEditing(null);
    setForm({ customer_id: "", payment_date: todayISO(), amount: "", notes: "" });
    setDialogOpen(true);
  };

  const openEdit = (p: Payment) => {
    setEditing(p);
    setForm({
      customer_id: p.customer_id,
      payment_date: p.payment_date,
      amount: String(p.amount),
      notes: p.notes || "",
    });
    setDialogOpen(true);
  };

  const submit = async () => {
    if (!form.customer_id) { toast.error("اختر العميل"); return; }
    const amt = Number(form.amount);
    if (!amt || amt <= 0) { toast.error("ادخل مبلغ صحيح"); return; }
    if (!form.payment_date) { toast.error("ادخل تاريخ الدفع"); return; }

    const payload = {
      customer_id: form.customer_id,
      payment_date: form.payment_date,
      amount: amt,
      notes: form.notes || null,
    };

    if (editing) {
      const { error } = await supabase.from("hatch_customer_payments").update(payload).eq("id", editing.id);
      if (error) { toast.error("فشل تعديل الدفعة: " + error.message); return; }
      toast.success("تم تعديل الدفعة");
    } else {
      const { error } = await supabase.from("hatch_customer_payments").insert(payload);
      if (error) { toast.error("فشل تسجيل الدفعة: " + error.message); return; }
      toast.success("تم تسجيل الدفعة");
    }
    setDialogOpen(false);
    fetchAll();
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    const { error } = await supabase.from("hatch_customer_payments").delete().eq("id", deleting.id);
    if (error) { toast.error("فشل الحذف: " + error.message); return; }
    toast.success("تم حذف الدفعة");
    setDeleting(null);
    fetchAll();
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 p-4 md:p-6" dir="rtl">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Wallet className="w-6 h-6 text-primary" />
              دفعات عملاء المعمل
            </h1>
            <p className="text-sm text-muted-foreground">تسجيل ومتابعة المبالغ المحصّلة من عملاء المعمل</p>
          </div>
          <Button onClick={openCreate}>
            <Plus className="w-4 h-4 ml-1" /> تسجيل دفعة جديدة
          </Button>
        </div>

        {/* Totals per customer */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">إجمالي المدفوع لكل عميل</CardTitle>
          </CardHeader>
          <CardContent>
            {customers.length === 0 ? (
              <p className="text-sm text-muted-foreground">لا يوجد عملاء معمل</p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {customers.map(c => {
                  const total = totalsByCustomer.get(c.id) || 0;
                  return (
                    <button
                      key={c.id}
                      onClick={() => setFilterCustomer(c.id)}
                      className={`text-right p-3 rounded-lg border transition-colors ${filterCustomer === c.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}
                    >
                      <div className="text-sm font-medium truncate">{c.name}</div>
                      <div className="text-lg font-bold text-primary mt-1">
                        {total.toLocaleString("ar-EG")} ج.م
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Filters */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">سجل الدفعات</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2 items-center">
              <Select value={filterCustomer} onValueChange={setFilterCustomer}>
                <SelectTrigger className="w-full md:w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل العملاء</SelectItem>
                  {customers.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                placeholder="بحث بالاسم أو الملاحظات..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full md:flex-1"
              />
              <Badge variant="secondary" className="text-sm">
                الإجمالي: {grandTotal.toLocaleString("ar-EG")} ج.م
              </Badge>
            </div>

            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">التاريخ</TableHead>
                    <TableHead className="text-right">العميل</TableHead>
                    <TableHead className="text-right">المبلغ</TableHead>
                    <TableHead className="text-right">ملاحظات</TableHead>
                    <TableHead className="text-right">إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-8">جاري التحميل...</TableCell></TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">لا توجد دفعات</TableCell></TableRow>
                  ) : (
                    filtered.map(p => (
                      <TableRow key={p.id}>
                        <TableCell>{format(new Date(p.payment_date), "yyyy-MM-dd")}</TableCell>
                        <TableCell className="font-medium">{customerById.get(p.customer_id) || "—"}</TableCell>
                        <TableCell className="font-bold text-primary">{Number(p.amount).toLocaleString("ar-EG")} ج.م</TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-xs truncate">{p.notes || "—"}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" onClick={() => openEdit(p)}>
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setDeleting(p)}>
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>{editing ? "تعديل دفعة" : "تسجيل دفعة جديدة"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>العميل *</Label>
              <Select value={form.customer_id} onValueChange={(v) => setForm({ ...form, customer_id: v })}>
                <SelectTrigger><SelectValue placeholder="اختر العميل" /></SelectTrigger>
                <SelectContent>
                  {customers.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>تاريخ الدفع *</Label>
              <Input
                type="date"
                value={form.payment_date}
                onChange={(e) => setForm({ ...form, payment_date: e.target.value })}
              />
            </div>
            <div>
              <Label>المبلغ (ج.م) *</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </div>
            <div>
              <Label>ملاحظات</Label>
              <Textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="اختياري"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>إلغاء</Button>
            <Button onClick={submit}>{editing ? "حفظ التعديلات" : "تسجيل"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد الحذف</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم حذف هذه الدفعة نهائياً وسيتم تحديث إجمالي العميل تلقائياً.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>حذف</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
