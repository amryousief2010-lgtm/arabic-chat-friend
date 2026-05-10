import DashboardLayout from "@/components/layout/DashboardLayout";
import ModulePlaceholder from "@/components/ModulePlaceholder";
import { Factory } from "lucide-react";

const MeatFactory = () => (
  <DashboardLayout>
    <ModulePlaceholder
      title="مصنع اللحوم - تصنيع المنتجات"
      description="تصنيع المنتجات المصنعة من اللحوم (نقانق، برجر، شاورما...)"
      icon={Factory}
      features={[
        "إدارة وصفات المنتجات (BOM)",
        "أوامر الإنتاج والدفعات",
        "استهلاك المواد الخام والتعبئة",
        "ضبط جودة المنتج النهائي",
        "تواريخ الإنتاج والصلاحية",
        "تكلفة المنتج وتحليل الهامش",
      ]}
    />
  </DashboardLayout>
);

export default MeatFactory;
