import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UsersRound, MapPin, Wallet, CalendarCheck, Receipt, Award, BarChart3, Settings as SettingsIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

const HRDashboard = () => {
  const { isGeneralManager, isExecutiveManager, hasRole } = useAuth();
  const canView = isGeneralManager || isExecutiveManager || hasRole("hr_manager");

  const [stats, setStats] = useState({ active: 0, inactive: 0, locations: 0, totalBaseSalary: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!canView) return;
    (async () => {
      const [emps, locs] = await Promise.all([
        supabase.from("hr_employees").select("status, base_salary"),
        supabase.from("hr_work_locations").select("id").eq("is_active", true),
      ]);
      const rows = (emps.data || []) as { status: string; base_salary: number }[];
      setStats({
        active: rows.filter((r) => r.status === "active").length,
        inactive: rows.filter((r) => r.status === "inactive").length,
        locations: (locs.data || []).length,
        totalBaseSalary: rows.filter((r) => r.status === "active").reduce((s, r) => s + Number(r.base_salary || 0), 0),
      });
      setLoading(false);
    })();
  }, [canView]);

  if (!canView) {
    return (
      <DashboardLayout>
        <Card>
          <CardHeader>
            <CardTitle>غير مصرح</CardTitle>
            <CardDescription>هذه الصفحة متاحة للمدير العام والتنفيذي ومدير الموارد البشرية فقط.</CardDescription>
          </CardHeader>
        </Card>
      </DashboardLayout>
    );
  }

  const fmt = new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 0 });

  const StatCard = ({ icon: Icon, label, value, hint, color }: any) => (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start gap-3">
          <div className={`w-11 h-11 rounded-xl ${color} flex items-center justify-center shrink-0`}>
            <Icon className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <div className="text-sm text-muted-foreground">{label}</div>
            <div className="text-2xl font-bold mt-1">{loading ? "..." : value}</div>
            {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  const QuickLink = ({ to, icon: Icon, label, desc, disabled }: any) => (
    <Link to={disabled ? "#" : to} className={disabled ? "pointer-events-none opacity-50" : ""}>
      <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
        <CardContent className="pt-6 flex items-start gap-3">
          <Icon className="w-6 h-6 text-primary shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="font-semibold">{label}</div>
            <div className="text-xs text-muted-foreground mt-1">{desc}</div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
            <UsersRound className="w-7 h-7 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">شؤون الموظفين</h1>
            <p className="text-muted-foreground mt-1">إدارة الموظفين، أماكن العمل، السلف، الرواتب والحضور</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon={UsersRound} color="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
            label="الموظفون النشطون" value={fmt.format(stats.active)} hint={`${fmt.format(stats.inactive)} غير نشط`} />
          <StatCard icon={MapPin} color="bg-blue-500/15 text-blue-700 dark:text-blue-400"
            label="أماكن العمل" value={fmt.format(stats.locations)} hint="نشطة" />
          <StatCard icon={Wallet} color="bg-amber-500/15 text-amber-700 dark:text-amber-400"
            label="إجمالي المرتبات الأساسية" value={fmt.format(stats.totalBaseSalary) + " ج"} hint="للموظفين النشطين" />
          <StatCard icon={Receipt} color="bg-purple-500/15 text-purple-700 dark:text-purple-400"
            label="السلف هذا الشهر" value="—" hint="قريبًا (المرحلة 2)" />
        </div>

        <div>
          <h2 className="text-xl font-bold mb-3">الوصول السريع</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <QuickLink to="/hr/employees" icon={UsersRound} label="بيانات الموظفين" desc="إضافة وتعديل وعرض بيانات كل موظف" />
            <QuickLink to="/hr/work-locations" icon={MapPin} label="أماكن العمل والأقسام" desc="إدارة الأقسام التي يعمل بها الموظفون" />
            <QuickLink to="#" icon={CalendarCheck} label="حضور وغياب الموظفين" desc="قريبًا — المرحلة 2" disabled />
            <QuickLink to="#" icon={Receipt} label="سلف الموظفين" desc="قريبًا — المرحلة 2" disabled />
            <QuickLink to="#" icon={Award} label="خصومات وإضافي ومكافآت" desc="قريبًا — المرحلة 2" disabled />
            <QuickLink to="#" icon={BarChart3} label="بيان الرواتب الشهري" desc="قريبًا — المرحلة 3" disabled />
            <QuickLink to="#" icon={SettingsIcon} label="إعدادات الرواتب" desc="قريبًا — المرحلة 3" disabled />
            <QuickLink to="/modules/hr" icon={UsersRound} label="حسابات دخول الموظفين" desc="تغيير كلمة السر والإيميل" />
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default HRDashboard;
