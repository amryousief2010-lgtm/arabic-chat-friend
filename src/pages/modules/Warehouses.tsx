import DashboardLayout from "@/components/layout/DashboardLayout";
import ModulePlaceholder from "@/components/ModulePlaceholder";
import { Warehouse } from "lucide-react";

const Warehouses = () => (
  <DashboardLayout>
    <ModulePlaceholder
      title="المخازن"
      description="إدارة المخازن المتعددة وحركة المخزون"
      icon={Warehouse}
      features={[
        "مخازن متعددة (مواد خام، منتج تام، علف، أدوية...)",
        "حركة الإذن (إضافة / صرف / تحويل)",
        "الجرد الدوري وتسوية الفروقات",
        "تتبع تواريخ الصلاحية",
        "تنبيهات الحد الأدنى",
        "تقارير حركة المخزون",
      ]}
    />
  </DashboardLayout>
);

export default Warehouses;
