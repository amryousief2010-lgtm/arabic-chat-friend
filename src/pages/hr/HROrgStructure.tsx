import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Users, ChevronDown, Crown, UserCog } from "lucide-react";
import { HrHeader, IconBadge, EmployeeAvatar, Chip, deptColor, deptIcon } from "@/components/hr/redesign/HrUi";
import { Button } from "@/components/ui/button";
import { useHrDirectory } from "@/hooks/useHrDirectory";
import { BRAND, BRAND_GRADIENT, SCALE, tint } from "@/lib/hr/brand";
import { LEADERSHIP, groupByDepartment, initialOf } from "@/lib/hr/directory";

const Connector = () => <div className="mx-auto" style={{ width: 2, height: SCALE.lg, background: tint(BRAND.purple, 0.25) }} />;

const LeaderCard = ({ name, title, icon: Icon }: { name: string; title: string; icon: any }) => (
  <div className="bg-card rounded-2xl flex items-center gap-3 mx-auto" style={{ padding: `${SCALE.md}px ${SCALE.lg}px`, border: `1.5px solid ${BRAND.magenta}`, minWidth: 260 }}>
    <div className="flex items-center justify-center rounded-full text-white font-bold" style={{ width: SCALE.xl, height: SCALE.xl, background: BRAND_GRADIENT }}>{initialOf(name)}</div>
    <div>
      <div className="font-extrabold" style={{ color: BRAND.purple }}>{name}</div>
      <div className="text-xs text-muted-foreground inline-flex items-center gap-1"><Icon className="w-3 h-3" />{title}</div>
    </div>
  </div>
);

/** الهيكل التنظيمي — يُبنى تلقائيًا من بيانات الموظفين (القسم والمسمى) بدل قائمة أسماء ثابتة */
const HROrgStructure = () => {
  const { employees, loading } = useHrDirectory();
  const groups = useMemo(() => groupByDepartment(employees), [employees]);
  const [open, setOpen] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  return (
    <DashboardLayout>
      <div className="space-y-6" dir="rtl">
        <HrHeader
          title="الهيكل التنظيمي"
          subtitle="الإدارة العليا والأقسام — يتحدّث تلقائيًا من بيانات الموظفين"
          actions={<Button variant="outline" onClick={() => setShowInactive((v) => !v)} data-testid="toggle-inactive">
            {showInactive ? "إخفاء غير النشطين" : "إظهار غير النشطين"}
          </Button>}
        />

        <section className="bg-card border rounded-3xl" style={{ padding: SCALE.xl }}>
          <LeaderCard name={LEADERSHIP[0].name} title={LEADERSHIP[0].title} icon={Crown} />
          <Connector />
          <LeaderCard name={LEADERSHIP[1].name} title={LEADERSHIP[1].title} icon={UserCog} />
          <Connector />
          <div style={{ height: 2, background: tint(BRAND.purple, 0.15), margin: `0 ${SCALE.xl}px ${SCALE.lg}px` }} />

          {loading ? <div className="text-center text-muted-foreground py-10">جارٍ التحميل...</div> : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" style={{ gap: SCALE.md }}>
              {groups.map((g) => {
                const color = deptColor(g.name);
                const isOpen = open === g.name;
                const members = showInactive ? [...g.active, ...g.inactive] : g.active;
                return (
                  <div key={g.name} className={isOpen ? "col-span-full" : ""}>
                    <button type="button" onClick={() => setOpen(isOpen ? null : g.name)} data-testid="dept-tile"
                      className="w-full bg-card border rounded-2xl flex flex-col items-center text-center hover:shadow-md transition-shadow"
                      style={{ padding: SCALE.md, gap: SCALE.sm, borderColor: isOpen ? color : undefined }}>
                      <IconBadge icon={deptIcon(g.code)} color={color} />
                      <span className="font-bold" style={{ color: BRAND.purple }}>{g.name}</span>
                      <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                        <Users className="w-3 h-3" />{g.active.length} موظف
                        {g.inactive.length > 0 && <> · {g.inactive.length} غير نشط</>}
                        <ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                      </span>
                    </button>
                    {isOpen && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 mt-3" style={{ gap: SCALE.sm }}>
                        {members.length === 0 && <div className="text-sm text-muted-foreground col-span-full text-center py-4">لا يوجد موظفون نشطون في هذا القسم</div>}
                        {members.map((m) => (
                          <Link key={m.id} to={`/hr/employees/${m.id}`} className="flex items-center gap-3 border rounded-xl hover:bg-muted/40" style={{ padding: SCALE.sm }}>
                            <EmployeeAvatar employeeId={m.id} userId={m.user_id} name={m.full_name} size={SCALE.xl - SCALE.xs} />
                            <span className="min-w-0">
                              <span className="block font-semibold truncate">{m.full_name}</span>
                              <span className="block text-xs text-muted-foreground truncate">{m.job_title || "لم يُحدَّد المسمى"}</span>
                            </span>
                            {m.status !== "active" && <Chip color={BRAND.orange} className="mr-auto">غير نشط</Chip>}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </DashboardLayout>
  );
};

export default HROrgStructure;
