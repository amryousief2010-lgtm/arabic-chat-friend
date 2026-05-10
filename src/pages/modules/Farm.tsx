import DashboardLayout from "@/components/layout/DashboardLayout";
import ModulePlaceholder from "@/components/ModulePlaceholder";
import { Egg } from "lucide-react";

const Farm = () => (
  <DashboardLayout>
    <ModulePlaceholder
      title="مزرعة الأمهات والإنتاج"
      description="إدارة قطعان الأمهات وإنتاج البيض المخصب"
      icon={Egg}
      features={[
        "تتبع القطعان (الأعمار، الأعداد، النفوق)",
        "سجل الإنتاج اليومي للبيض",
        "التحصينات والبرامج البيطرية",
        "استهلاك العلف والمياه",
        "تقارير معدل الإنتاج والخصوبة",
        "إدارة العنابر والبيوت",
      ]}
    />
  </DashboardLayout>
);

export default Farm;
