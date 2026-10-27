import { DirectoryEmployee, groupByDepartment } from "@/lib/hr/directory";

/**
 * لا يوجد عمود «يتبع لـ» (reports_to / manager_id) في hr_employees،
 * لذلك يُشتق خط التبعية من القسم + المسمى الوظيفي:
 * رئيس القسم = أول موظف نشط مسماه يحوي «مدير/مديرة/رئيس»، وإلا «مشرف/مشرفة».
 * باقي موظفي القسم يتبعونه، ورؤساء الأقسام يتبعون المدير التنفيذي.
 */
const HEAD_PRIMARY = /(مدير|مديرة|رئيس|رئيسة)/;
const HEAD_SECONDARY = /(مشرف|مشرفة)/;

export interface FlowDepartment {
  name: string;
  code: string | null;
  head: DirectoryEmployee | null;
  staff: DirectoryEmployee[];
  inactiveCount: number;
}

export const pickHead = (members: DirectoryEmployee[]): DirectoryEmployee | null =>
  members.find((m) => HEAD_PRIMARY.test(m.job_title || "")) ||
  members.find((m) => HEAD_SECONDARY.test(m.job_title || "")) ||
  null;

export const buildFlowchart = (employees: DirectoryEmployee[], opts: { showInactive?: boolean } = {}): FlowDepartment[] =>
  groupByDepartment(employees).map((g) => {
    const head = pickHead(g.active);
    const pool = opts.showInactive ? [...g.active, ...g.inactive] : g.active;
    return { name: g.name, code: g.code, head, staff: pool.filter((m) => m.id !== head?.id), inactiveCount: g.inactive.length };
  });
