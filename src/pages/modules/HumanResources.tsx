import DashboardLayout from "@/components/layout/DashboardLayout";
import ModulePlaceholder from "@/components/ModulePlaceholder";
import { UsersRound } from "lucide-react";

const HumanResources = () => (
  <DashboardLayout>
    <ModulePlaceholder
      title="الموارد البشرية والموظفين"
      description="إدارة شؤون الموظفين والرواتب والحضور"
      icon={UsersRound}
      features={[
        "ملفات الموظفين والمستندات",
        "الحضور والانصراف والإجازات",
        "الرواتب والبدلات والخصومات",
        "تقييم الأداء الدوري",
        "العقود والتجديدات",
        "هيكل تنظيمي وإدارات",
      ]}
    />
  </DashboardLayout>
);

export default HumanResources;
