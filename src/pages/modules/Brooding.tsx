import DashboardLayout from "@/components/layout/DashboardLayout";
import ModulePlaceholder from "@/components/ModulePlaceholder";
import { Bird } from "lucide-react";

const Brooding = () => (
  <DashboardLayout>
    <ModulePlaceholder
      title="التحضين والتسمين"
      description="إدارة عنابر التحضين والتسمين حتى الوزن التسويقي"
      icon={Bird}
      features={[
        "إدخال دفعات الكتاكيت في العنابر",
        "متابعة الأوزان ومعدلات النمو",
        "استهلاك العلف ومعامل التحويل (FCR)",
        "النفوق والاستبعاد اليومي",
        "البرامج العلاجية والتحصينات",
        "تقارير ربحية الدورة",
      ]}
    />
  </DashboardLayout>
);

export default Brooding;
