import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Bird, Plus, Pencil, Trash2, ShieldCheck, Search } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

const statusLabels: Record<string, { label: string; variant: any; cls: string }> = {
  pending: { label: "قيد التنفيذ", variant: "secondary", cls: "bg-amber-100 text-amber-800" },
  delivered: { label: "تم التسليم", variant: "default", cls: "bg-emerald-100 text-emerald-800" },
  returned: { label: "مرتجع", variant: "destructive", cls: "bg-rose-100 text-rose-800" },
  cancelled: { label: "ملغي", variant: "outline", cls: "bg-slate-100 text-slate-700" },
};

const orderSchema = z.object({
  customer_name: z.string().trim().min(2, "اسم العميل مطلوب").max(120),
  phone_primary: z.string().trim().min(7, "رقم الهاتف غير صحيح").max(25),
  phone_secondary: z.string().trim().max(25).optional().or(z.literal("")),
  governorate: z.string().trim().min(2, "المحافظة مطلوبة").max(60),
  city: z.string().trim().min(2, "المدينة مطلوبة").max(60),
  chick_age: z.string().trim().min(1, "عمر الكتكوت مطلوب").max(40),
  chick_price: z.coerce.number().min(0, "السعر غير صحيح"),
  chick_count: z.coerce.number().int().min(1, "العدد لا يقل عن 1"),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

type ChickOrder = {
  id: string;
  customer_name: string;
  phone_primary: string;
  phone_secondary: string | null;
  governorate: string;
  city: string;
  chick_age: string;
  chick_price: number;
  chick_count: number;
  total_amount: number;
  status: "pending" | "delivered" | "returned" | "cancelled";
  notes: string | null;
  created_by: string;
  created_at: string;
};

const emptyForm = {
  customer_name: "",
  phone_primary: "",
  phone_secondary: "",
  governorate: "",
  city: "",
  chick_age: "",
  chick_price: "" as any,
  chick_count: "" as any,
  notes: "",
};

const ChickOrders = () => {
  const qc = useQueryClient();
  const { role, user } = useAuth();
  const canManage = ["general_manager", "executive_manager", "sales_manager", "marketing_sales_manager"].includes(role || "");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ChickOrder | null>(null);
  const [form, setForm] = useState<typeof emptyForm>(emptyForm);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [moderatorFilter, setModeratorFilter] = useState<string>("all");
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [monthFilter, setMonthFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["chick-orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chick_orders")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as ChickOrder[];
    },
  });

  const { data: profilesMap = {} } = useQuery<Record<string, string>>({
    queryKey: ["chick-orders-profiles", orders.map((o) => o.created_by).join(",")],
    enabled: orders.length > 0,
    queryFn: async () => {
      const ids = Array.from(new Set(orders.map((o) => o.created_by).filter(Boolean)));
      if (!ids.length) return {};
      const { data, error } = await supabase.from("profiles").select("id, full_name").in("id", ids);
      if (error) throw error;
      return Object.fromEntries((data || []).map((p: any) => [p.id, p.full_name as string]));
    },
  });

  const moderatorOptions = useMemo(() => {
    const seen = new Map<string, string>();
    orders.forEach((o) => {
      if (o.created_by && !seen.has(o.created_by)) {
        seen.set(o.created_by, profilesMap[o.created_by] || "غير معروف");
      }
    });
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [orders, profilesMap]);

  const yearOptions = useMemo(() => {
    const ys = new Set<number>();
    orders.forEach((o) => ys.add(new Date(o.created_at).getUTCFullYear()));
    return Array.from(ys).sort((a, b) => b - a);
  }, [orders]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (statusFilter !== "all" && o.status !== statusFilter) return false;
      if (moderatorFilter !== "all" && o.created_by !== moderatorFilter) return false;
      const d = new Date(o.created_at);
      if (yearFilter !== "all" && d.getUTCFullYear() !== Number(yearFilter)) return false;
      if (monthFilter !== "all" && d.getUTCMonth() + 1 !== Number(monthFilter)) return false;
      if (s) {
        const hay = `${o.customer_name} ${o.phone_primary} ${o.phone_secondary || ""}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [orders, statusFilter, moderatorFilter, yearFilter, monthFilter, search]);

  const totals = useMemo(() => {
    const count = filtered.reduce((s, o) => s + o.chick_count, 0);
    const revenue = filtered.reduce((s, o) => s + Number(o.total_amount || 0), 0);
    const delivered = filtered.filter((o) => o.status === "delivered").length;
    return { rows: filtered.length, count, revenue, delivered };
  }, [filtered]);

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (o: ChickOrder) => {
    setEditing(o);
    setForm({
      customer_name: o.customer_name,
      phone_primary: o.phone_primary,
      phone_secondary: o.phone_secondary || "",
      governorate: o.governorate,
      city: o.city,
      chick_age: o.chick_age,
      chick_price: String(o.chick_price) as any,
      chick_count: String(o.chick_count) as any,
      notes: o.notes || "",
    });
    setDialogOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const parsed = orderSchema.safeParse(form);
      if (!parsed.success) {
        throw new Error(parsed.error.errors[0].message);
      }
      const payload = {
        customer_name: parsed.data.customer_name,
        phone_primary: parsed.data.phone_primary,
        phone_secondary: parsed.data.phone_secondary || null,
        governorate: parsed.data.governorate,
        city: parsed.data.city,
        chick_age: parsed.data.chick_age,
        chick_price: parsed.data.chick_price,
        chick_count: parsed.data.chick_count,
        notes: parsed.data.notes || null,
      };
      if (editing) {
        const { error } = await supabase.from("chick_orders").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("chick_orders").insert({ ...payload, created_by: user!.id });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "تم تحديث الطلب" : "تم تسجيل الطلب");
      setDialogOpen(false);
      qc.invalidateQueries({ queryKey: ["chick-orders"] });
    },
    onError: (e: any) => toast.error(e.message || "حدث خطأ"),
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("chick_orders").update({ status: status as any }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم تحديث الحالة");
      qc.invalidateQueries({ queryKey: ["chick-orders"] });
    },
    onError: (e: any) => toast.error(e.message || "غير مسموح بتغيير الحالة"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("chick_orders").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم حذف الطلب");
      setDeleteId(null);
      qc.invalidateQueries({ queryKey: ["chick-orders"] });
    },
    onError: (e: any) => toast.error(e.message || "غير مسموح بالحذف"),
  });

  return (
    <DashboardLayout>
      <Header title="طلبات الكتاكيت 🐥" subtitle="تسجيل وإدارة مبيعات الكتاكيت" />
      <div className="p-4 space-y-4 max-w-7xl mx-auto">
        {/* Hero */}
        <Card className="relative overflow-hidden border-0 shadow-xl">
          <div className="absolute inset-0 bg-gradient-to-br from-primary via-primary/90 to-accent opacity-95" />
          <div className="absolute -top-16 -left-16 w-64 h-64 rounded-full bg-white/10 blur-3xl" />
          <div className="relative p-5 text-white flex flex-wrap items-center gap-4 justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
                <Bird className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-lg font-bold">طلبات الكتاكيت</h2>
                <p className="text-xs opacity-85">
                  {canManage ? "صلاحيات إدارية كاملة - يمكنكِ تغيير الحالة والحذف" : "يمكنكِ التسجيل والتعديل - تغيير الحالة والحذف مسئولية مديرة المبيعات"}
                </p>
              </div>
            </div>
            <Button size="lg" onClick={openNew} className="bg-white text-primary hover:bg-white/90">
              <Plus className="w-4 h-4 ml-2" /> طلب جديد
            </Button>
          </div>
        </Card>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPI label="عدد الطلبات" value={totals.rows.toLocaleString()} />
          <KPI label="إجمالي الكتاكيت" value={totals.count.toLocaleString()} />
          <KPI label="الطلبات المسلّمة" value={totals.delivered.toLocaleString()} />
          <KPI label="إجمالي المبيعات" value={`${totals.revenue.toLocaleString()} ج`} accent />
        </div>

        {/* Filters */}
        <Card className="p-4">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="بحث باسم العميل أو رقم الهاتف..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pr-10"
              />
            </div>
            <Select value={yearFilter} onValueChange={setYearFilter}>
              <SelectTrigger className="w-32"><SelectValue placeholder="السنة" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل السنوات</SelectItem>
                {yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={monthFilter} onValueChange={setMonthFilter}>
              <SelectTrigger className="w-32"><SelectValue placeholder="الشهر" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الشهور</SelectItem>
                {["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"].map((n, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)}>{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={moderatorFilter} onValueChange={setModeratorFilter}>
              <SelectTrigger className="w-44"><SelectValue placeholder="المسوقة" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل المسوقات</SelectItem>
                {moderatorOptions.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الحالات</SelectItem>
                <SelectItem value="pending">قيد التنفيذ</SelectItem>
                <SelectItem value="delivered">تم التسليم</SelectItem>
                <SelectItem value="returned">مرتجع</SelectItem>
                <SelectItem value="cancelled">ملغي</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </Card>

        {/* Table */}
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">العميل</TableHead>
                  <TableHead className="text-right">الهاتف</TableHead>
                  <TableHead className="text-right">المحافظة / المدينة</TableHead>
                  <TableHead className="text-right">العمر</TableHead>
                  <TableHead className="text-right">العدد</TableHead>
                  <TableHead className="text-right">السعر</TableHead>
                  <TableHead className="text-right">الإجمالي</TableHead>
                  <TableHead className="text-right">الحالة</TableHead>
                  <TableHead className="text-right">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">جارٍ التحميل...</TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={9} className="text-center py-10 text-muted-foreground">لا توجد طلبات</TableCell></TableRow>
                ) : filtered.map((o) => {
                  const st = statusLabels[o.status];
                  return (
                    <TableRow key={o.id}>
                      <TableCell className="font-medium">{o.customer_name}</TableCell>
                      <TableCell dir="ltr" className="text-right">
                        {o.phone_primary}
                        {o.phone_secondary && <div className="text-xs text-muted-foreground">{o.phone_secondary}</div>}
                      </TableCell>
                      <TableCell>{o.governorate} / {o.city}</TableCell>
                      <TableCell>{o.chick_age}</TableCell>
                      <TableCell>{o.chick_count.toLocaleString()}</TableCell>
                      <TableCell>{Number(o.chick_price).toLocaleString()} ج</TableCell>
                      <TableCell className="font-semibold">{Number(o.total_amount).toLocaleString()} ج</TableCell>
                      <TableCell>
                        {canManage ? (
                          <Select
                            value={o.status}
                            onValueChange={(v) => statusMutation.mutate({ id: o.id, status: v })}
                          >
                            <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="pending">قيد التنفيذ</SelectItem>
                              <SelectItem value="delivered">تم التسليم</SelectItem>
                              <SelectItem value="returned">مرتجع</SelectItem>
                              <SelectItem value="cancelled">ملغي</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge className={st.cls}>{st.label}</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" onClick={() => openEdit(o)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                          {canManage && (
                            <Button size="icon" variant="ghost" onClick={() => setDeleteId(o.id)}>
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>

        {!canManage && (
          <Card className="p-4 bg-amber-50 border-amber-200 flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-amber-700 mt-0.5" />
            <div className="text-sm text-amber-900">
              يمكنكِ تسجيل الطلبات والتعديل على بياناتها، لكن <strong>تغيير حالة الطلب (تسليم/مرتجع/إلغاء) وحذف الطلبات</strong> من صلاحيات مديرة المبيعات فقط.
            </div>
          </Card>
        )}
      </div>

      {/* Form Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "تعديل طلب كتاكيت" : "طلب كتاكيت جديد"}</DialogTitle>
            <DialogDescription>أدخلي بيانات العميل وتفاصيل الطلب</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="اسم العميل *" value={form.customer_name} onChange={(v) => setForm({ ...form, customer_name: v })} />
            <Field label="رقم الهاتف *" value={form.phone_primary} onChange={(v) => setForm({ ...form, phone_primary: v })} dir="ltr" />
            <Field label="رقم آخر (اختياري)" value={form.phone_secondary} onChange={(v) => setForm({ ...form, phone_secondary: v })} dir="ltr" />
            <Field label="المحافظة *" value={form.governorate} onChange={(v) => setForm({ ...form, governorate: v })} />
            <Field label="المدينة *" value={form.city} onChange={(v) => setForm({ ...form, city: v })} />
            <Field label="عمر الكتكوت *" value={form.chick_age} onChange={(v) => setForm({ ...form, chick_age: v })} placeholder="مثال: شهر / 30 يوم" />
            <Field label="سعر الكتكوت *" value={String(form.chick_price)} onChange={(v) => setForm({ ...form, chick_price: v as any })} type="number" />
            <Field label="عدد الكتاكيت *" value={String(form.chick_count)} onChange={(v) => setForm({ ...form, chick_count: v as any })} type="number" />
            <div className="md:col-span-2">
              <Label>ملاحظات</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
            </div>
            {form.chick_price && form.chick_count && (
              <div className="md:col-span-2 p-3 rounded-lg bg-primary/5 border border-primary/20 text-sm">
                الإجمالي: <strong className="text-primary text-base">{(Number(form.chick_price) * Number(form.chick_count)).toLocaleString()} ج</strong>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>إلغاء</Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "جارٍ الحفظ..." : editing ? "حفظ التعديلات" : "تسجيل الطلب"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد حذف الطلب</AlertDialogTitle>
            <AlertDialogDescription>هذا الإجراء لا يمكن التراجع عنه.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteId && deleteMutation.mutate(deleteId)}>حذف</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
};

const KPI = ({ label, value, accent }: { label: string; value: string; accent?: boolean }) => (
  <Card className={`p-4 ${accent ? "bg-gradient-to-br from-primary to-accent text-white border-0" : ""}`}>
    <p className={`text-xs ${accent ? "opacity-90" : "text-muted-foreground"}`}>{label}</p>
    <p className="text-2xl font-bold mt-1">{value}</p>
  </Card>
);

const Field = ({ label, value, onChange, type = "text", dir, placeholder }: any) => (
  <div>
    <Label>{label}</Label>
    <Input type={type} dir={dir} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
  </div>
);

export default ChickOrders;
