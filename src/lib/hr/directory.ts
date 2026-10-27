import { HR_DEPARTMENTS, findDepartmentByName } from "@/lib/hr/jobCatalogue";

/** بيانات العرض فقط — لا مرتبات ولا أرقام هواتف */
export interface DirectoryEmployee {
  id: string;
  code: string;
  full_name: string;
  job_title: string | null;
  department: string | null;
  current_location_id: string | null;
  status: "active" | "inactive";
  pay_day: number;
  user_id?: string | null;
  photo_url?: string | null;
  is_suspended?: boolean;
  start_date?: string | null;
}

export const UNASSIGNED_DEPARTMENT = "بدون قسم";

/** الحرف الأول للاسم بعد حذف الألقاب (م/ ، أ/ ، أ.) */
export const initialOf = (name?: string | null) => {
  const n = (name || "").trim().replace(/^(م|أ|د)\s*[/.]\s*/, "");
  return n ? n.charAt(0) : "م";
};

export const departmentLabel = (d?: string | null) => (d || "").trim() || UNASSIGNED_DEPARTMENT;

/** ترتيب الأقسام كما في الكتالوج المعتمد، ثم الأقسام غير المعروفة أبجديًا، ثم «بدون قسم» */
const deptOrder = (name: string) => {
  if (name === UNASSIGNED_DEPARTMENT) return 10_000;
  const i = HR_DEPARTMENTS.findIndex((d) => d.name === name);
  return i === -1 ? 5_000 : i;
};

export interface DepartmentGroup {
  name: string;
  code: string | null;
  active: DirectoryEmployee[];
  inactive: DirectoryEmployee[];
}

/** تجميع الموظفين حسب القسم الفعلي في البيانات (الهيكل يُبنى من بيانات الموظفين لا من قائمة ثابتة) */
export const groupByDepartment = (employees: DirectoryEmployee[]): DepartmentGroup[] => {
  const map = new Map<string, DepartmentGroup>();
  for (const e of employees) {
    const name = departmentLabel(e.department);
    if (!map.has(name)) map.set(name, { name, code: findDepartmentByName(name)?.code ?? null, active: [], inactive: [] });
    const g = map.get(name)!;
    (e.status === "active" ? g.active : g.inactive).push(e);
  }
  const byName = (a: DirectoryEmployee, b: DirectoryEmployee) => a.full_name.localeCompare(b.full_name, "ar");
  return Array.from(map.values())
    .map((g) => ({ ...g, active: g.active.sort(byName), inactive: g.inactive.sort(byName) }))
    .sort((a, b) => deptOrder(a.name) - deptOrder(b.name) || a.name.localeCompare(b.name, "ar"));
};

export type StatusFilter = "active" | "inactive" | "all";

export const filterDirectory = (
  employees: DirectoryEmployee[],
  opts: { search?: string; department?: string; status?: StatusFilter },
) => {
  const q = (opts.search || "").trim().toLowerCase();
  return employees.filter((e) => {
    if (opts.status && opts.status !== "all" && e.status !== opts.status) return false;
    if (opts.department && opts.department !== "all" && departmentLabel(e.department) !== opts.department) return false;
    if (!q) return true;
    return [e.full_name, e.code, e.job_title || "", e.department || ""].some((s) => s.toLowerCase().includes(q));
  });
};

export interface PayDaySummary { day: number; count: number; departments: string[] }

/** ملخص مواعيد القبض (عرض فقط — التعديل في PR منفصل) */
export const summarizePayDays = (employees: DirectoryEmployee[]): PayDaySummary[] => {
  const map = new Map<number, { count: number; depts: Set<string> }>();
  for (const e of employees) {
    if (e.status !== "active") continue;
    const m = map.get(e.pay_day) || { count: 0, depts: new Set<string>() };
    m.count++;
    m.depts.add(departmentLabel(e.department));
    map.set(e.pay_day, m);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a - b)
    .map(([day, m]) => ({ day, count: m.count, departments: Array.from(m.depts).sort((a, b) => deptOrder(a) - deptOrder(b)) }));
};

/** الإدارة العليا كما اعتمدها المدير العام — لا يُستخدم لقب «المالك» */
export const LEADERSHIP = [
  { name: "عمرو يوسف", title: "المدير العام" },
  { name: "أ. أحمد الجمل", title: "المدير التنفيذي" },
] as const;
