import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRight, Check, CalendarDays, MapPin, Lock, Link2, Briefcase, Hash, CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import JobTitleField from "@/components/hr/JobTitleField";
import DepartmentField from "@/components/hr/DepartmentField";
import { HrHeader, Chip, EmployeeAvatar, brandButtonStyle } from "@/components/hr/redesign/HrUi";
import { DIRECTORY_COLUMNS, type HrLocation } from "@/hooks/useHrDirectory";
import { BRAND, SCALE, tint } from "@/lib/hr/brand";
import { departmentLabel, type DirectoryEmployee } from "@/lib/hr/directory";
import { formatDate } from "@/lib/dateFormat";

interface Transfer { id: string; transfer_date: string; from_location_id: string | null; to_location_id: string; reason: string | null }

const Panel = ({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) => (
  <section className="bg-card border rounded-2xl" style={{ padding: SCALE.lg }}>
    <h3 className="font-bold flex items-center gap-2 mb-3" style={{ color: BRAND.purple }}>
      <Icon className="w-4 h-4" style={{ color: BRAND.magenta }} />{title}
    </h3>
    {children}
  </section>
);

/** ملف الموظف: بيانات وظيفية فقط — الصورة الشخصية مشتركة مع كل أقسام النظام */
const HREmployeeProfile = () => {
  const { id } = useParams<{ id: string }>();
  const { user, isGeneralManager, isExecutiveManager, roles } = useAuth();
  const canManage = isGeneralManager || isExecutiveManager || roles.includes("hr_manager");
  const [emp, setEmp] = useState<DirectoryEmployee | null>(null);
  const [form, setForm] = useState({ department: "", job_title: "", current_location_id: "" });
  const [locations, setLocations] = useState<HrLocation[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const [e, l, t] = await Promise.all([
        (supabase as any).from("hr_employees").select(DIRECTORY_COLUMNS).eq("id", id).maybeSingle(),
        supabase.from("hr_work_locations").select("id, name, department").order("sort_order"),
        supabase.from("hr_employee_transfers").select("id, transfer_date, from_location_id, to_location_id, reason")
          .eq("employee_id", id).order("transfer_date", { ascending: false }),
      ]);
      const row = (e.data || null) as DirectoryEmployee | null;
      setEmp(row);
      setForm({ department: row?.department || "", job_title: row?.job_title || "", current_location_id: row?.current_location_id || "" });
      setLocations((l.data || []) as HrLocation[]);
      setTransfers((t.data || []) as Transfer[]);
      setLoading(false);
    })();
  }, [id]);

  const locName = (lid?: string | null) => locations.find((l) => l.id === lid)?.name || "—";
  const dirty = !!emp && (form.department !== (emp.department || "") || form.job_title !== (emp.job_title || "")
    || form.current_location_id !== (emp.current_location_id || ""));

  const save = async () => {
    if (!emp) return;
    setSaving(true);
    const payload = {
      department: form.department || null,
      job_title: form.job_title.trim() || null,
      current_location_id: form.current_location_id || null,
    };
    const { error } = await supabase.from("hr_employees").update(payload).eq("id", emp.id);
    if (!error) {
      await supabase.from("hr_audit_log").insert({
        entity_type: "hr_employee", entity_id: emp.id, employee_id: emp.id, action: "update",
        before_data: { department: emp.department, job_title: emp.job_title, current_location_id: emp.current_location_id } as any,
        after_data: payload as any, performed_by: user?.id,
      });
      setEmp({ ...emp, ...payload });
      toast.success("تم حفظ بيانات الموظف");
    } else {
      toast.error("تعذّر الحفظ: " + error.message);
    }
    setSaving(false);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6" dir="rtl">
        <HrHeader
          title="ملف الموظف"
          subtitle="بيانات وظيفية فقط — الصورة الشخصية مشتركة مع كل أقسام النظام"
          actions={<>
            <Button asChild variant="outline"><Link to="/hr/employees"><ArrowRight className="w-4 h-4 ml-1" />رجوع للموظفين</Link></Button>
            {canManage && emp && (
              <Button onClick={save} disabled={!dirty || saving} style={brandButtonStyle} data-testid="profile-save">
                <Check className="w-4 h-4 ml-1" />{saving ? "جارٍ الحفظ..." : "حفظ التعديلات"}
              </Button>
            )}
          </>}
        />

        {loading ? (
          <div className="text-center text-muted-foreground py-16">جارٍ التحميل...</div>
        ) : !emp ? (
          <div className="text-center text-muted-foreground py-16">لم يُعثر على الموظف</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.618fr)_minmax(0,1fr)]" style={{ gap: SCALE.lg }}>
            <section className="bg-card border rounded-2xl overflow-hidden">
              <div className="flex items-center" style={{ gap: SCALE.lg, padding: SCALE.lg, background: `linear-gradient(135deg, ${tint(BRAND.magenta, 0.08)}, ${tint(BRAND.orange, 0.08)})` }}>
                <EmployeeAvatar employeeId={emp.id} userId={emp.user_id} name={emp.full_name} size={SCALE.xxl + SCALE.md} />
                <div className="min-w-0 space-y-1">
                  <h2 className="text-2xl font-extrabold" style={{ color: BRAND.purple }} data-testid="profile-name">{emp.full_name}</h2>
                  <div className="text-sm text-muted-foreground flex flex-wrap gap-x-3">
                    <span className="inline-flex items-center gap-1"><Hash className="w-3.5 h-3.5" />{emp.code}</span>
                    <span>{departmentLabel(emp.department)}</span>
                    <span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{locName(emp.current_location_id)}</span>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {emp.job_title ? <Chip><Briefcase className="w-3 h-3" />{emp.job_title}</Chip> : <Chip color={BRAND.orange}>لم يُحدَّد المسمى</Chip>}
                    {emp.user_id
                      ? <Chip color={BRAND.purple}><Link2 className="w-3 h-3" />الصورة مرتبطة بحساب الدخول</Chip>
                      : <Chip color={BRAND.orange}>غير مرتبط بحساب دخول</Chip>}
                    <Chip color={emp.status === "active" ? BRAND.purple : BRAND.orange}>{emp.status === "active" ? "نشط" : "غير نشط"}</Chip>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2" style={{ gap: SCALE.md, padding: SCALE.lg }}>
                <div className="space-y-2">
                  <Label>القسم</Label>
                  {canManage ? <DepartmentField value={form.department} onChange={(v) => setForm({ ...form, department: v })} /> : <div>{departmentLabel(emp.department)}</div>}
                </div>
                <div className="space-y-2">
                  <Label>مكان العمل</Label>
                  {canManage ? (
                    <Select value={form.current_location_id || "__none__"} onValueChange={(v) => setForm({ ...form, current_location_id: v === "__none__" ? "" : v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">بدون مكان عمل</SelectItem>
                        {locations.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : <div>{locName(emp.current_location_id)}</div>}
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>المسمى الوظيفي <span className="text-xs text-muted-foreground">(اختياري)</span></Label>
                  {canManage ? <JobTitleField value={form.job_title} department={form.department} onChange={(v) => setForm({ ...form, job_title: v })} /> : <div>{emp.job_title || "—"}</div>}
                </div>
              </div>
            </section>

            <div className="space-y-4">
              <Panel title="موعد القبض" icon={CalendarDays}>
                <div className="flex items-center gap-3">
                  <span className="text-2xl font-extrabold rounded-xl" style={{ color: BRAND.purple, background: tint(BRAND.purple), padding: `${SCALE.xs}px ${SCALE.md}px` }}>{emp.pay_day}</span>
                  <span className="text-sm text-muted-foreground inline-flex items-center gap-1"><Lock className="w-3.5 h-3.5" />يُحسب تلقائيًا من القسم ومكان العمل</span>
                </div>
              </Panel>
              <Panel title="سجل التنقلات" icon={MapPin}>
                {transfers.length === 0 ? <p className="text-sm text-muted-foreground">لا توجد تنقلات مسجلة</p> : (
                  <ul className="space-y-2 text-sm">
                    {transfers.map((t) => (
                      <li key={t.id} className="flex gap-2">
                        <span className="font-mono text-muted-foreground">{formatDate(t.transfer_date)}</span>
                        <span>— {t.from_location_id ? `من ${locName(t.from_location_id)} إلى ` : "بداية العمل في "}{locName(t.to_location_id)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
              {emp.start_date && (
                <Panel title="تاريخ بداية العمل" icon={CalendarClock}>
                  <span className="font-mono">{formatDate(emp.start_date)}</span>
                </Panel>
              )}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default HREmployeeProfile;
