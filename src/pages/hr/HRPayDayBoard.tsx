import { useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Link } from "react-router-dom";
import { CalendarDays, Lock } from "lucide-react";
import { HrHeader, StatTile, EmployeeAvatar, Chip, deptColor } from "@/components/hr/redesign/HrUi";
import { useHrDirectory } from "@/hooks/useHrDirectory";
import { BRAND, BRAND_CYCLE, SCALE, tint } from "@/lib/hr/brand";
import { departmentLabel, summarizePayDays } from "@/lib/hr/directory";

/** مواعيد القبض — عرض فقط. تعديل يوم القبض خارج نطاق هذه الشاشة (مقترح منفصل). لا تظهر المرتبات. */
const HRPayDayBoard = () => {
  const { employees, loading } = useHrDirectory();
  const [day, setDay] = useState<number | "all">("all");
  const summary = useMemo(() => summarizePayDays(employees), [employees]);
  const rows = useMemo(
    () => employees.filter((e) => e.status === "active" && (day === "all" || e.pay_day === day))
      .sort((a, b) => a.pay_day - b.pay_day || departmentLabel(a.department).localeCompare(departmentLabel(b.department), "ar")),
    [employees, day],
  );

  return (
    <DashboardLayout>
      <div className="space-y-6" dir="rtl">
        <HrHeader
          title="مواعيد القبض"
          subtitle="يُحسب يوم القبض تلقائيًا من القسم ومكان العمل — هذه الشاشة للعرض فقط"
          actions={<Chip color={BRAND.purple}><Lock className="w-3 h-3" />التعديل من صلاحية المدير العام</Chip>}
        />

        <div className="grid grid-cols-1 md:grid-cols-3" style={{ gap: SCALE.md }}>
          {summary.map((s, i) => (
            <button key={s.day} type="button" onClick={() => setDay(day === s.day ? "all" : s.day)} className="text-right"
              style={{ outline: day === s.day ? `2px solid ${BRAND.magenta}` : undefined, borderRadius: 16 }}>
              <StatTile icon={CalendarDays} color={BRAND_CYCLE[i % 3]} value={`يوم ${s.day}`}
                label={`${s.count} موظفًا نشطًا`} hint={s.departments.join("، ")} />
            </button>
          ))}
        </div>

        <section className="bg-card border rounded-2xl overflow-hidden">
          <div className="grid grid-cols-[2fr_1fr_1fr_auto] text-xs text-muted-foreground border-b" style={{ padding: `${SCALE.sm}px ${SCALE.lg}px` }}>
            <span>الموظف</span><span>القسم</span><span>مكان القبض</span><span>يوم القبض</span>
          </div>
          {loading ? <div className="p-10 text-center text-muted-foreground">جارٍ التحميل...</div> : rows.map((e) => (
            <div key={e.id} className="grid grid-cols-[2fr_1fr_1fr_auto] items-center border-b last:border-0" style={{ padding: `${SCALE.sm}px ${SCALE.lg}px` }}>
              <Link to={`/hr/employees/${e.id}`} className="flex items-center gap-3 min-w-0">
                <EmployeeAvatar employeeId={e.id} userId={e.user_id} name={e.full_name} size={SCALE.lg + SCALE.sm} />
                <span className="min-w-0">
                  <span className="block font-semibold truncate" style={{ color: BRAND.purple }}>{e.full_name}</span>
                  <span className="block text-xs text-muted-foreground truncate">{e.job_title || "—"}</span>
                </span>
              </Link>
              <span><Chip color={deptColor(departmentLabel(e.department))}>{departmentLabel(e.department)}</Chip></span>
              <span className="text-sm text-muted-foreground inline-flex items-center gap-1"><Lock className="w-3 h-3" />تلقائي</span>
              <span className="text-lg font-extrabold rounded-lg text-center" style={{ color: BRAND.purple, background: tint(BRAND.purple), minWidth: SCALE.xl, padding: `2px ${SCALE.sm}px` }}>{e.pay_day}</span>
            </div>
          ))}
        </section>
      </div>
    </DashboardLayout>
  );
};

export default HRPayDayBoard;
