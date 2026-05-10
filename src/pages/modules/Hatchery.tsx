import DashboardLayout from "@/components/layout/DashboardLayout";
import ModulePlaceholder from "@/components/ModulePlaceholder";
import { FlaskConical } from "lucide-react";

const Hatchery = () => (
  <DashboardLayout>
    <ModulePlaceholder
      title="المعمل وتفريغ الكتاكيت"
      description="إدارة عمليات التفقيس وإنتاج الكتاكيت"
      icon={FlaskConical}
      features={[
        "إدخال دفعات البيض للمعمل",
        "متابعة دورات التفقيس (التحضين والفقس)",
        "تسجيل أعداد الكتاكيت الناتجة والفرز",
        "نسبة الفقس ومؤشرات الجودة",
        "جدولة عمليات التفريغ",
        "تقارير الإنتاج اليومية والشهرية",
      ]}
    />
  </DashboardLayout>
);

export default Hatchery;
