import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Crown, UserCog, Users } from "lucide-react";
import { HrHeader, IconBadge, EmployeeAvatar, Chip, deptColor, deptIcon } from "@/components/hr/redesign/HrUi";
import { Button } from "@/components/ui/button";
import { useHrDirectory } from "@/hooks/useHrDirectory";
import { BRAND, BRAND_GRADIENT, SCALE, tint } from "@/lib/hr/brand";
import { LEADERSHIP, initialOf, type DirectoryEmployee } from "@/lib/hr/directory";
import { buildFlowchart } from "@/lib/hr/flowchart";

const LINE = tint(BRAND.purple, 0.35);
const VLine = ({ h = SCALE.lg }: { h?: number }) => <div className="mx-auto" style={{ width: 2, height: h, background: LINE }} />;

const LeaderNode = ({ name, title, icon: Icon }: { name: string; title: string; icon: any }) => (
  <div className="bg-card rounded-2xl flex items-center gap-3 mx-auto shadow-sm" data-testid="leader-node"
    style={{ padding: `${SCALE.md}px ${SCALE.lg}px`, border: `2px solid ${BRAND.magenta}`, width: 300 }}>
    <div className="flex items-center justify-center rounded-full text-white font-bold shrink-0" style={{ width: SCALE.xxl - SCALE.md, height: SCALE.xxl - SCALE.md, background: BRAND_GRADIENT, fontSize: SCALE.md + 4 }}>{initialOf(name)}</div>
    <div className="min-w-0">
      <div className="font-extrabold text-lg" style={{ color: BRAND.purple }}>{name}</div>
      <div className="text-xs text-muted-foreground inline-flex items-center gap-1"><Icon className="w-3 h-3" />{title}</div>
    </div>
  </div>
);

const PersonNode = ({ m, dept, head, linkable = true }: { m: DirectoryEmployee; dept: string; head?: boolean; linkable?: boolean }) => {
  const color = deptColor(dept);
  return (
    <Link to={linkable ? `/hr/employees/${m.id}` : "#"} onClick={linkable ? undefined : (e) => e.preventDefault()} data-testid={head ? "head-node" : "staff-node"}
      className="bg-card rounded-xl flex items-center gap-2 hover:shadow-md transition-shadow"
      style={{ padding: SCALE.sm, border: `1.5px solid ${head ? color : tint(color, 0.35)}`, background: head ? tint(color, 0.06) : undefined }}>
      <EmployeeAvatar employeeId={m.id} userId={m.user_id} name={m.full_name} size={head ? SCALE.xl + SCALE.xs : SCALE.xl - SCALE.xs} />
      <span className="min-w-0 flex-1">
        <span className="block font-bold truncate text-sm" style={{ color: head ? BRAND.purple : undefined }}>{m.full_name}</span>
        <span className="block text-xs truncate" style={{ color }}>{m.job_title || "لم يُحدَّد المسمى"}</span>
        <span className="block text-[11px] text-muted-foreground truncate">{dept}</span>
      </span>
      {m.status !== "active" && <Chip color={BRAND.orange}>غير نشط</Chip>}
    </Link>
  );
};

/** الهيكل التنظيمي كمخطط انسيابي: المدير العام ← المدير التنفيذي ← رؤساء الأقسام ← الموظفون */
const HROrgStructure = ({ publicView = false }: { publicView?: boolean }) => {
  const { employees, loading, unavailable } = useHrDirectory({ source: publicView ? "public" : "table" });
  const [showInactive, setShowInactive] = useState(false);
  const depts = useMemo(() => buildFlowchart(employees, { showInactive }), [employees, showInactive]);
  const COL = 236;
  const PER_ROW = 4;
  const rows = useMemo(() => {
    const out: typeof depts[] = [];
    for (let i = 0; i < depts.length; i += PER_ROW) out.push(depts.slice(i, i + PER_ROW));
    return out;
  }, [depts]);

  return (
    <DashboardLayout>
      <div className="space-y-6" dir="rtl">
        <HrHeader
          title="الهيكل التنظيمي"
          subtitle="مخطط الشركة — الأسماء والمسميات والصور تتحدّث تلقائيًا من بيانات الموظفين"
          actions={<Button variant="outline" onClick={() => setShowInactive((v) => !v)} data-testid="toggle-inactive">
            {showInactive ? "إخفاء غير النشطين" : "إظهار غير النشطين"}
          </Button>}
        />

        <section className="bg-card border rounded-3xl overflow-x-auto" style={{ padding: SCALE.xl }}>
          <div className="mx-auto" style={{ width: "max-content", minWidth: "100%" }}>
            <LeaderNode name={LEADERSHIP[0].name} title={LEADERSHIP[0].title} icon={Crown} />
            <VLine />
            <LeaderNode name={LEADERSHIP[1].name} title={LEADERSHIP[1].title} icon={UserCog} />
            <VLine />
            {loading ? <div className="text-center text-muted-foreground py-10">جارٍ التحميل...</div> : unavailable ? (
              <div className="text-center text-muted-foreground py-10">تعذّر تحميل الهيكل الحي — <Link to="/org-chart/legacy" className="underline">عرض الهيكل العام</Link></div>
            ) : (
              <div data-testid="flow-departments">
              {rows.map((row, ri) => (
              <div key={ri}>
              {ri > 0 && <VLine h={SCALE.lg} />}
              <div className="flex justify-center items-start" style={{ gap: SCALE.md }}>
                {row.map((d, i) => {
                  const color = deptColor(d.name);
                  const first = i === 0, last = i === row.length - 1;
                  return (
                    <div key={d.name} style={{ width: COL }} className="shrink-0 relative" data-testid="flow-dept">
                      {/* الخط الأفقي الواصل بين الأقسام */}
                      <div className="absolute top-0" style={{ height: 2, background: LINE, right: first ? "50%" : -SCALE.md / 2, left: last ? "50%" : -SCALE.md / 2 }} />
                      <VLine h={SCALE.md} />
                      <div className="rounded-xl flex items-center justify-center gap-2 text-white font-bold" style={{ background: color, padding: `${SCALE.xs + 2}px ${SCALE.sm}px` }}>
                        <IconBadge icon={deptIcon(d.code)} color="rgba(255,255,255,.22)" size={SCALE.lg} />
                        <span className="truncate">{d.name}</span>
                        <span className="text-[11px] font-normal opacity-90 inline-flex items-center gap-0.5"><Users className="w-3 h-3" />{d.staff.filter((s) => s.status === "active").length + (d.head ? 1 : 0)}</span>
                      </div>
                      <VLine h={SCALE.sm} />
                      {d.head ? <PersonNode m={d.head} dept={d.name} head linkable={!publicView} /> : (
                        <div className="text-center text-xs text-muted-foreground border border-dashed rounded-xl" style={{ padding: SCALE.sm }}>لم يُحدَّد رئيس القسم</div>
                      )}
                      {d.staff.length > 0 && (
                        <div className="relative" style={{ marginRight: SCALE.md, paddingTop: SCALE.sm }}>
                          <div className="absolute" style={{ right: -SCALE.sm, top: 0, bottom: SCALE.lg, width: 2, background: LINE }} />
                          <div className="space-y-2">
                            {d.staff.map((m) => (
                              <div key={m.id} className="relative">
                                <div className="absolute" style={{ right: -SCALE.sm, top: "50%", width: SCALE.sm, height: 2, background: LINE }} />
                                <PersonNode m={m} dept={d.name} linkable={!publicView} />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {!showInactive && d.inactiveCount > 0 && <div className="text-center text-[11px] text-muted-foreground mt-2">+ {d.inactiveCount} غير نشط</div>}
                    </div>
                  );
                })}
              </div>
              </div>
              ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </DashboardLayout>
  );
};

export default HROrgStructure;
