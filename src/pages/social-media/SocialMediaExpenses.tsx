import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CheckCircle2, ReceiptText, Plus, Pencil, Trash2, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import type { ExpenseRow } from "@/lib/socialMediaAnalytics";

const EXPENSE_TYPES = [
  "إعلانات Facebook",
  "إعلانات Instagram",
  "إعلانات TikTok",
  "إعلانات Google",
  "راتب موظف سوشيال",
  "تصوير ومحتوى",
  "تصميمات",
  "أدوات وبرامج",
  "مؤثرين",
  "مصروف آخر",
];

const PLATFORMS = ["Facebook", "Instagram", "TikTok", "Google", "YouTube", "متعدد", "—"];

const fmt = (n: number) => n.toLocaleString("ar-EG", { maximumFractionDigits: 2 });

type FormState = {
  id?: string;
  expense_date: string;
  expense_type: string;
  platform: string;
  campaign_name: string;
  employee_name: string;
  amount: string;
  notes: string;
  attachment_url: string;
};

const emptyForm = (): FormState => ({
  expense_date: new Date().toISOString().slice(0, 10),
  expense_type: EXPENSE_TYPES[0],
  platform: "",
  campaign_name: "",
  employee_name: "",
  amount: "",
  notes: "",
  attachment_url: "",
});

export default function SocialMediaExpenses() {
  const { user, roles, isGeneralManager, isExecutiveManager } = useAuth();
  const canApprove = !!(isGeneralManager || isExecutiveManager || (roles || []).includes("marketing_sales_manager"));

  const [rows, setRows] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [monthFilter, setMonthFilter] = useState<string>(() => new Date().toISOString().slice(0, 7));
  const [statusFilter, setStatusFilter] = useState<"all" | "approved" | "pending">("all");
  const [dlgOpen, setDlgOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());

  const load = async () => {
    setLoading(true);
    const [year, month] = monthFilter.split("-").map(Number);
    const from = `${year}-${String(month).padStart(2, "0")}-01`;
    const nextMonth = new Date(year, month, 0);
    const to = `${year}-${String(month).padStart(2, "0")}-${String(nextMonth.getDate()).padStart(2, "0")}`;
    const { data, error } = await supabase
      .from("social_media_expenses")
      .select("*")
      .gte("expense_date", from)
      .lte("expense_date", to)
      .order("expense_date", { ascending: false });
    setLoading(false);
    if (error) {
      toast({ title: "خطأ في تحميل المصروفات", description: error.message, variant: "destructive" });
      return;
    }
    setRows((data || []).map((d: any) => ({ ...d, amount: Number(d.amount || 0) })));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthFilter]);

  const filtered = useMemo(() => {
    if (statusFilter === "approved") return rows.filter((r) => r.is_approved);
    if (statusFilter === "pending") return rows.filter((r) => !r.is_approved);
    return rows;
  }, [rows, statusFilter]);

  const totals = useMemo(() => {
    const approved = rows.filter((r) => r.is_approved).reduce((s, r) => s + r.amount, 0);
    const pending = rows.filter((r) => !r.is_approved).reduce((s, r) => s + r.amount, 0);
    return { approved, pending, all: approved + pending };
  }, [rows]);

  const openNew = () => { setForm(emptyForm()); setDlgOpen(true); };
  const openEdit = (r: ExpenseRow) => {
    setForm({
      id: r.id,
      expense_date: r.expense_date,
      expense_type: r.expense_type,
      platform: r.platform || "",
      campaign_name: r.campaign_name || "",
      employee_name: r.employee_name || "",
      amount: String(r.amount),
      notes: r.notes || "",
      attachment_url: r.attachment_url || "",
    });
    setDlgOpen(true);
  };

  const save = async () => {
    if (!form.expense_type || !form.expense_date || !form.amount) {
      toast({ title: "بيانات ناقصة", description: "التاريخ والنوع والقيمة إجبارية", variant: "destructive" });
      return;
    }
    const payload: any = {
      expense_date: form.expense_date,
      expense_type: form.expense_type,
      platform: form.platform || null,
      campaign_name: form.campaign_name || null,
      employee_name: form.employee_name || null,
      amount: Number(form.amount),
      notes: form.notes || null,
      attachment_url: form.attachment_url || null,
    };
    if (form.id) {
      const { error } = await supabase.from("social_media_expenses").update(payload).eq("id", form.id);
      if (error) { toast({ title: "فشل التحديث", description: error.message, variant: "destructive" }); return; }
      toast({ title: "تم التحديث ✅" });
    } else {
      payload.created_by = user?.id ?? null;
      const { error } = await supabase.from("social_media_expenses").insert(payload);
      if (error) { toast({ title: "فشل الحفظ", description: error.message, variant: "destructive" }); return; }
      toast({ title: "تم إضافة المصروف ✅" });
    }
    setDlgOpen(false);
    load();
  };

  const approve = async (r: ExpenseRow) => {
    if (!canApprove) return;
    if (!confirm(`اعتماد المصروف بقيمة ${fmt(r.amount)} ج.م؟ بعد الاعتماد لن يمكن تعديله.`)) return;
    const { error } = await supabase
      .from("social_media_expenses")
      .update({ is_approved: true, approved_by: user?.id, approved_at: new Date().toISOString() })
      .eq("id", r.id);
    if (error) { toast({ title: "فشل الاعتماد", description: error.message, variant: "destructive" }); return; }
    toast({ title: "تم الاعتماد ✅" });
    load();
  };

  const remove = async (r: ExpenseRow) => {
    if (r.is_approved) { toast({ title: "لا يمكن حذف مصروف معتمد", variant: "destructive" }); return; }
    if (!confirm("حذف المصروف نهائيًا؟")) return;
    const { error } = await supabase.from("social_media_expenses").delete().eq("id", r.id);
    if (error) { toast({ title: "فشل الحذف", description: error.message, variant: "destructive" }); return; }
    toast({ title: "تم الحذف" });
    load();
  };

  return (
    <DashboardLayout>
      <div className="space-y-4 p-4" dir="rtl">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <ReceiptText className="h-6 w-6 text-orange-600" />
            <h1 className="text-2xl font-bold">مصروفات السوشيال ميديا</h1>
          </div>
          <Dialog open={dlgOpen} onOpenChange={setDlgOpen}>
            <DialogTrigger asChild>
              <Button onClick={openNew} className="gap-1"><Plus className="h-4 w-4" /> إضافة مصروف</Button>
            </DialogTrigger>
            <DialogContent dir="rtl" className="max-w-lg">
              <DialogHeader><DialogTitle>{form.id ? "تعديل مصروف" : "مصروف جديد"}</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-1"><Label>التاريخ *</Label><Input type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} /></div>
                <div className="col-span-1"><Label>القيمة (ج.م) *</Label><Input type="number" min={0} step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
                <div className="col-span-2"><Label>نوع المصروف *</Label>
                  <Select value={form.expense_type} onValueChange={(v) => setForm({ ...form, expense_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {EXPENSE_TYPES.map((t) => (<SelectItem key={t} value={t}>{t}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-1"><Label>المنصة</Label>
                  <Select value={form.platform || "none"} onValueChange={(v) => setForm({ ...form, platform: v === "none" ? "" : v })}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">—</SelectItem>
                      {PLATFORMS.map((p) => (<SelectItem key={p} value={p}>{p}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-1"><Label>اسم الحملة</Label><Input value={form.campaign_name} onChange={(e) => setForm({ ...form, campaign_name: e.target.value })} /></div>
                <div className="col-span-2"><Label>اسم الموظف</Label><Input value={form.employee_name} onChange={(e) => setForm({ ...form, employee_name: e.target.value })} /></div>
                <div className="col-span-2"><Label>رابط المرفق (اختياري)</Label><Input placeholder="https://..." value={form.attachment_url} onChange={(e) => setForm({ ...form, attachment_url: e.target.value })} /></div>
                <div className="col-span-2"><Label>ملاحظات</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} /></div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDlgOpen(false)}>إلغاء</Button>
                <Button onClick={save}>حفظ</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">مصروفات معتمدة (تدخل في نسبة 5%)</div><div className="text-2xl font-bold text-green-700">{fmt(totals.approved)} ج.م</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">قيد المراجعة</div><div className="text-2xl font-bold text-amber-700">{fmt(totals.pending)} ج.م</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">الإجمالي</div><div className="text-2xl font-bold">{fmt(totals.all)} ج.م</div></CardContent></Card>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4 grid grid-cols-2 md:grid-cols-3 gap-3">
            <div><Label>الشهر</Label><Input type="month" value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} /></div>
            <div><Label>الحالة</Label>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="approved">معتمد</SelectItem>
                  <SelectItem value="pending">قيد المراجعة</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardHeader><CardTitle>سجل المصروفات ({filtered.length})</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>المنصة</TableHead>
                  <TableHead>الحملة</TableHead>
                  <TableHead>الموظف</TableHead>
                  <TableHead className="text-center">القيمة</TableHead>
                  <TableHead className="text-center">الحالة</TableHead>
                  <TableHead className="text-center">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && <TableRow><TableCell colSpan={8} className="text-center">جاري التحميل...</TableCell></TableRow>}
                {!loading && filtered.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">لا توجد مصروفات في هذا الشهر</TableCell></TableRow>}
                {filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.expense_date}</TableCell>
                    <TableCell>{r.expense_type}</TableCell>
                    <TableCell>{r.platform || "—"}</TableCell>
                    <TableCell>{r.campaign_name || "—"}</TableCell>
                    <TableCell>{r.employee_name || "—"}</TableCell>
                    <TableCell className="text-center font-mono">{fmt(r.amount)}</TableCell>
                    <TableCell className="text-center">
                      {r.is_approved
                        ? <Badge className="bg-green-100 text-green-800 border border-green-300">معتمد</Badge>
                        : <Badge className="bg-amber-100 text-amber-800 border border-amber-300">قيد المراجعة</Badge>}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex justify-center gap-1">
                        {!r.is_approved && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => openEdit(r)}><Pencil className="h-3 w-3" /></Button>
                            {canApprove && <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => approve(r)}><CheckCircle2 className="h-3 w-3" /></Button>}
                            <Button size="sm" variant="destructive" onClick={() => remove(r)}><Trash2 className="h-3 w-3" /></Button>
                          </>
                        )}
                        {r.is_approved && <span className="text-xs text-green-700 flex items-center gap-1"><ShieldCheck className="h-3 w-3" /> مؤمّن</span>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
