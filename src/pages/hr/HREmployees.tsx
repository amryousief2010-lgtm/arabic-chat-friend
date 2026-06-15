import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UsersRound, Plus, Search, Edit, History as HistoryIcon, Printer, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import PrintEmployeesAdvancesDialog from "@/components/hr/PrintEmployeesAdvancesDialog";
import EmployeeDocumentsDialog from "@/components/hr/EmployeeDocumentsDialog";

interface Location { id: string; name: string; department: string | null }
interface Employee {
  id: string; code: string; full_name: string; phone: string | null; national_id: string | null;
  job_title: string | null; department: string | null;
  current_location_id: string | null;
  employment_type: "monthly" | "daily" | "temporary";
  base_salary: number; daily_rate: number | null;
  start_date: string | null;
  status: "active" | "inactive";
  notes: string | null;
}

interface Transfer {
  id: string; transfer_date: string; reason: string | null;
  from_location_id: string | null; to_location_id: string;
}

const empTypeLabel: Record<string, string> = { monthly: "شهري", daily: "يومية", temporary: "مؤقت" };
const empTypeColor: Record<string, string> = {
  monthly: "bg-blue-500/15 text-blue-700",
  daily: "bg-amber-500/15 text-amber-700",
  temporary: "bg-purple-500/15 text-purple-700",
};

const blankForm = (): Partial<Employee> => ({
  code: "",
  full_name: "",
  phone: "",
  national_id: "",
  job_title: "",
  department: "",
  current_location_id: null,
  employment_type: "monthly",
  base_salary: 0,
  daily_rate: null,
  start_date: new Date().toISOString().slice(0, 10),
  status: "active",
  notes: "",
});

const HREmployees = () => {
  const { user, isGeneralManager, isExecutiveManager, roles } = useAuth();
  const canManage = isGeneralManager || isExecutiveManager || roles.includes("hr_manager");
  const canViewDocs =
    canManage || roles.includes("accountant") || roles.includes("financial_manager");

  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("active");
  const [locFilter, setLocFilter] = useState<string>("all");
  const [docFilter, setDocFilter] = useState<
    "all" | "id_yes" | "id_no" | "contract_yes" | "contract_no" | "missing"
  >("all");

  const [editing, setEditing] = useState<Employee | null>(null);
  const [form, setForm] = useState<Partial<Employee>>(blankForm());
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [historyOf, setHistoryOf] = useState<Employee | null>(null);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [printOpen, setPrintOpen] = useState(false);

  const [docsOf, setDocsOf] = useState<Employee | null>(null);
  const [docsSummary, setDocsSummary] = useState<
    Record<string, { id: boolean; contract: boolean }>
  >({});

  const load = async () => {
    setLoading(true);
    const [emp, loc] = await Promise.all([
      supabase.from("hr_employees").select("*").order("code"),
      supabase.from("hr_work_locations").select("id, name, department").eq("is_active", true).order("sort_order"),
    ]);
    setEmployees((emp.data || []) as Employee[]);
    setLocations((loc.data || []) as Location[]);

    if (canViewDocs) {
      const { data: docs } = await supabase
        .from("hr_employee_documents")
        .select("employee_id, document_type")
        .eq("is_active", true);
      const map: Record<string, { id: boolean; contract: boolean }> = {};
      (docs || []).forEach((d: any) => {
        if (!map[d.employee_id]) map[d.employee_id] = { id: false, contract: false };
        if (d.document_type === "national_id_card") map[d.employee_id].id = true;
        if (d.document_type === "work_contract") map[d.employee_id].contract = true;
      });
      setDocsSummary(map);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const locById = useMemo(() => {
    const m = new Map<string, Location>();
    locations.forEach((l) => m.set(l.id, l));
    return m;
  }, [locations]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter((e) => {
      if (statusFilter !== "all" && e.status !== statusFilter) return false;
      if (locFilter !== "all" && e.current_location_id !== locFilter) return false;
      if (docFilter !== "all") {
        const ds = docsSummary[e.id] || { id: false, contract: false };
        if (docFilter === "id_yes" && !ds.id) return false;
        if (docFilter === "id_no" && ds.id) return false;
        if (docFilter === "contract_yes" && !ds.contract) return false;
        if (docFilter === "contract_no" && ds.contract) return false;
        if (docFilter === "missing" && ds.id && ds.contract) return false;
      }
      if (!q) return true;
      return (
        e.code.toLowerCase().includes(q) ||
        e.full_name.toLowerCase().includes(q) ||
        (e.phone || "").includes(q) ||
        (e.job_title || "").toLowerCase().includes(q)
      );
    });
  }, [employees, search, statusFilter, locFilter, docFilter, docsSummary]);

  const openCreate = () => {
    setEditing(null);
    setForm(blankForm());
    setOpen(true);
  };

  const openEdit = (e: Employee) => {
    setEditing(e);
    setForm({ ...e });
    setOpen(true);
  };

  const generateCode = async () => {
    const { data } = await supabase
      .from("hr_employees")
      .select("code")
      .ilike("code", "EMP-%")
      .order("code", { ascending: false })
      .limit(1);
    const last = data?.[0]?.code || "EMP-0000";
    const n = parseInt(last.replace("EMP-", ""), 10) || 0;
    setForm((f) => ({ ...f, code: `EMP-${String(n + 1).padStart(4, "0")}` }));
  };

  const save = async () => {
    if (!canManage) return;
    if (!form.code?.trim() || !form.full_name?.trim()) {
      toast.error("الكود والاسم مطلوبان");
      return;
    }
    if (form.employment_type === "monthly" && Number(form.base_salary || 0) <= 0) {
      toast.error("المرتب الأساسي مطلوب للموظف الشهري");
      return;
    }
    if (form.employment_type === "daily" && Number(form.daily_rate || 0) <= 0) {
      toast.error("قيمة اليومية مطلوبة لعامل اليومية");
      return;
    }

    setSaving(true);
    try {
      const payload: any = {
        code: form.code!.trim(),
        full_name: form.full_name!.trim(),
        phone: form.phone || null,
        national_id: form.national_id || null,
        job_title: form.job_title || null,
        department: form.department || null,
        current_location_id: form.current_location_id || null,
        employment_type: form.employment_type,
        base_salary: Number(form.base_salary || 0),
        daily_rate: form.daily_rate ? Number(form.daily_rate) : null,
        start_date: form.start_date || null,
        status: form.status,
        notes: form.notes || null,
      };

      if (editing) {
        const { error } = await supabase.from("hr_employees").update(payload).eq("id", editing.id);
        if (error) throw error;
        await supabase.from("hr_audit_log").insert({
          entity_type: "hr_employee",
          entity_id: editing.id,
          employee_id: editing.id,
          action: "update",
          before_data: editing as any,
          after_data: { ...editing, ...payload } as any,
          performed_by: user?.id,
        });
        toast.success("تم تحديث بيانات الموظف");
      } else {
        payload.created_by = user?.id;
        const { data, error } = await supabase.from("hr_employees").insert(payload).select().single();
        if (error) throw error;
        await supabase.from("hr_audit_log").insert({
          entity_type: "hr_employee",
          entity_id: (data as any).id,
          employee_id: (data as any).id,
          action: "create",
          after_data: data as any,
          performed_by: user?.id,
        });
        toast.success("تم إضافة الموظف");
      }
      setOpen(false);
      await load();
    } catch (e: any) {
      const msg = e?.message || "خطأ غير معروف";
      if (msg.includes("hr_employees_code_key")) {
        toast.error("كود الموظف مستخدم بالفعل");
      } else {
        toast.error("فشل الحفظ: " + msg);
      }
    } finally {
      setSaving(false);
    }
  };

  const openHistory = async (e: Employee) => {
    setHistoryOf(e);
    const { data } = await supabase
      .from("hr_employee_transfers")
      .select("*")
      .eq("employee_id", e.id)
      .order("transfer_date", { ascending: false });
    setTransfers((data || []) as Transfer[]);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
              <UsersRound className="w-7 h-7 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">بيانات الموظفين</h1>
              <p className="text-muted-foreground mt-1">إضافة وتعديل بيانات كل موظف ومكان عمله</p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" onClick={() => setPrintOpen(true)}>
              <Printer className="w-4 h-4 ml-1" />طباعة بيان الموظفين والسلف
            </Button>
            {canManage && (
              <Button onClick={openCreate}><Plus className="w-4 h-4 ml-1" />إضافة موظف</Button>
            )}
          </div>
        </div>

        <PrintEmployeesAdvancesDialog
          open={printOpen}
          onOpenChange={setPrintOpen}
          employees={employees}
          locations={locations}
        />

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <CardTitle>قائمة الموظفين ({filtered.length})</CardTitle>
              <div className="flex gap-2 flex-wrap">
                <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل الحالات</SelectItem>
                    <SelectItem value="active">نشط</SelectItem>
                    <SelectItem value="inactive">غير نشط</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={locFilter} onValueChange={setLocFilter}>
                  <SelectTrigger className="w-48"><SelectValue placeholder="كل الأماكن" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل أماكن العمل</SelectItem>
                    {locations.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {canViewDocs && (
                  <Select value={docFilter} onValueChange={(v: any) => setDocFilter(v)}>
                    <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">كل المستندات</SelectItem>
                      <SelectItem value="id_yes">بطاقة مرفوعة</SelectItem>
                      <SelectItem value="id_no">بطاقة غير مرفوعة</SelectItem>
                      <SelectItem value="contract_yes">عقد مرفوع</SelectItem>
                      <SelectItem value="contract_no">عقد غير مرفوع</SelectItem>
                      <SelectItem value="missing">مستندات ناقصة</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                <div className="relative w-64">
                  <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input placeholder="بحث بالكود أو الاسم أو الهاتف..." value={search} onChange={(e) => setSearch(e.target.value)} className="pr-9" />
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الكود</TableHead>
                    <TableHead>الاسم</TableHead>
                    <TableHead>الوظيفة</TableHead>
                    <TableHead>مكان العمل</TableHead>
                    <TableHead>نوع التعيين</TableHead>
                    <TableHead>المرتب / اليومية</TableHead>
                    <TableHead>الهاتف</TableHead>
                    {canViewDocs && <TableHead>المستندات</TableHead>}
                    <TableHead>الحالة</TableHead>
                    <TableHead className="text-left">إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow><TableCell colSpan={canViewDocs ? 10 : 9} className="text-center py-8 text-muted-foreground">جارٍ التحميل...</TableCell></TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={canViewDocs ? 10 : 9} className="text-center py-8 text-muted-foreground">لا يوجد موظفون مطابقون</TableCell></TableRow>
                  ) : (
                    filtered.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="font-mono text-xs">{e.code}</TableCell>
                        <TableCell className="font-medium">{e.full_name}</TableCell>
                        <TableCell>{e.job_title || "—"}</TableCell>
                        <TableCell>{e.current_location_id ? locById.get(e.current_location_id)?.name || "—" : "—"}</TableCell>
                        <TableCell>
                          <Badge className={empTypeColor[e.employment_type]}>{empTypeLabel[e.employment_type]}</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {e.employment_type === "daily"
                            ? `${Number(e.daily_rate || 0).toLocaleString("ar-EG")} / يوم`
                            : `${Number(e.base_salary).toLocaleString("ar-EG")} / شهر`}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{e.phone || "—"}</TableCell>
                        {canViewDocs && (
                          <TableCell>
                            {(() => {
                              const ds = docsSummary[e.id] || { id: false, contract: false };
                              return (
                                <button
                                  type="button"
                                  onClick={() => setDocsOf(e)}
                                  className="flex flex-col gap-0.5 text-xs hover:opacity-80"
                                  title="عرض / رفع المستندات"
                                >
                                  <span className={ds.id ? "text-emerald-700" : "text-muted-foreground"}>
                                    بطاقة {ds.id ? "✅" : "❌"}
                                  </span>
                                  <span className={ds.contract ? "text-emerald-700" : "text-muted-foreground"}>
                                    عقد {ds.contract ? "✅" : "❌"}
                                  </span>
                                </button>
                              );
                            })()}
                          </TableCell>
                        )}
                        <TableCell>
                          {e.status === "active"
                            ? <Badge className="bg-emerald-500/15 text-emerald-700">نشط</Badge>
                            : <Badge variant="outline" className="text-muted-foreground">غير نشط</Badge>}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1 justify-end">
                            <Button size="sm" variant="ghost" onClick={() => openHistory(e)} title="سجل النقل">
                              <HistoryIcon className="w-4 h-4" />
                            </Button>
                            {canViewDocs && (
                              <Button size="sm" variant="ghost" onClick={() => setDocsOf(e)} title="المستندات">
                                <FileText className="w-4 h-4" />
                              </Button>
                            )}
                            {canManage && (
                              <Button size="sm" variant="outline" onClick={() => openEdit(e)}>
                                <Edit className="w-3.5 h-3.5 ml-1" />تعديل
                              </Button>
                            )}
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
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "تعديل بيانات الموظف" : "إضافة موظف جديد"}</DialogTitle>
            <DialogDescription>كل الحقول المعلّمة بـ * مطلوبة</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>كود الموظف *</Label>
              <div className="flex gap-2">
                <Input value={form.code || ""} onChange={(e) => setForm({ ...form, code: e.target.value })} className="font-mono" />
                {!editing && <Button type="button" variant="outline" onClick={generateCode}>توليد</Button>}
              </div>
            </div>
            <div>
              <Label>اسم الموظف *</Label>
              <Input value={form.full_name || ""} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </div>
            <div>
              <Label>الهاتف</Label>
              <Input value={form.phone || ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} dir="ltr" />
            </div>
            <div>
              <Label>الرقم القومي</Label>
              <Input value={form.national_id || ""} onChange={(e) => setForm({ ...form, national_id: e.target.value })} dir="ltr" />
            </div>
            <div>
              <Label>الوظيفة</Label>
              <Input value={form.job_title || ""} onChange={(e) => setForm({ ...form, job_title: e.target.value })} />
            </div>
            <div>
              <Label>القسم</Label>
              <Input value={form.department || ""} onChange={(e) => setForm({ ...form, department: e.target.value })} />
            </div>
            <div>
              <Label>مكان العمل الحالي</Label>
              <Select value={form.current_location_id || ""} onValueChange={(v) => setForm({ ...form, current_location_id: v || null })}>
                <SelectTrigger><SelectValue placeholder="اختر مكان العمل" /></SelectTrigger>
                <SelectContent>
                  {locations.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>نوع التعيين *</Label>
              <Select value={form.employment_type} onValueChange={(v: any) => setForm({ ...form, employment_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">شهري</SelectItem>
                  <SelectItem value="daily">يومية</SelectItem>
                  <SelectItem value="temporary">مؤقت</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>المرتب الأساسي (شهري)</Label>
              <Input type="number" step="0.01" value={form.base_salary ?? ""} onChange={(e) => setForm({ ...form, base_salary: parseFloat(e.target.value) || 0 })} />
            </div>
            <div>
              <Label>قيمة اليومية</Label>
              <Input type="number" step="0.01" value={form.daily_rate ?? ""} onChange={(e) => setForm({ ...form, daily_rate: e.target.value ? parseFloat(e.target.value) : null })} />
            </div>
            <div>
              <Label>تاريخ بداية العمل</Label>
              <Input type="date" value={form.start_date || ""} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
            </div>
            <div>
              <Label>الحالة</Label>
              <Select value={form.status} onValueChange={(v: any) => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">نشط</SelectItem>
                  <SelectItem value="inactive">غير نشط</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <Label>ملاحظات</Label>
              <Textarea value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={save} disabled={saving}>{saving ? "جارٍ الحفظ..." : (editing ? "حفظ التعديلات" : "إضافة")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Transfer history */}
      <Dialog open={!!historyOf} onOpenChange={(o) => !o && setHistoryOf(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>سجل نقل الموظف</DialogTitle>
            <DialogDescription>{historyOf && <>{historyOf.full_name} ({historyOf.code})</>}</DialogDescription>
          </DialogHeader>
          {transfers.length === 0 ? (
            <p className="text-center text-muted-foreground py-6">لا توجد عمليات نقل مسجلة</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>من</TableHead>
                  <TableHead>إلى</TableHead>
                  <TableHead>السبب</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transfers.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-xs">{t.transfer_date}</TableCell>
                    <TableCell>{t.from_location_id ? locById.get(t.from_location_id)?.name || "—" : "—"}</TableCell>
                    <TableCell className="font-medium">{locById.get(t.to_location_id)?.name || "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{t.reason || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default HREmployees;
