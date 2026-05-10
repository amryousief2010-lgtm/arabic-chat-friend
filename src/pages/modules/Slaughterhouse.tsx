import DashboardLayout from "@/components/layout/DashboardLayout";
import ModulePlaceholder from "@/components/ModulePlaceholder";
import { Beef } from "lucide-react";

const Slaughterhouse = () => (
  <DashboardLayout>
    <ModulePlaceholder
      title="المجزر وإنتاج اللحوم"
      description="إدارة عمليات الذبح والتجهيز وإنتاج اللحوم الطازجة"
      icon={Beef}
      features={[
        "استلام الطيور الحية وأوزانها",
        "تسجيل عمليات الذبح اليومية",
        "نسبة التصافي ومخرجات اللحوم",
        "التقطيع والفرز (صدور، أوراك، أجنحة...)",
        "ضبط الجودة والاشتراطات الصحية",
        "تقارير إنتاجية المجزر",
      ]}
    />
  </DashboardLayout>
);

export default Slaughterhouse;
