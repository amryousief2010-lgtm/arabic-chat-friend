import DashboardLayout from "@/components/layout/DashboardLayout";
import ModulePlaceholder from "@/components/ModulePlaceholder";
import { Wheat } from "lucide-react";

const FeedFactory = () => (
  <DashboardLayout>
    <ModulePlaceholder
      title="مصنع الأعلاف"
      description="تصنيع الأعلاف الخاصة بمراحل الإنتاج المختلفة"
      icon={Wheat}
      features={[
        "إدارة تركيبات الأعلاف (Formulas)",
        "أوامر إنتاج العلف اليومية",
        "استهلاك المواد الخام (ذرة، فول صويا...)",
        "تحاليل الجودة والقيمة الغذائية",
        "تخزين وتوزيع العلف على المزارع",
        "تكلفة الطن المنتج",
      ]}
    />
  </DashboardLayout>
);

export default FeedFactory;
