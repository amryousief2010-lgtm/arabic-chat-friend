import { lazy, Suspense } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Loader2 } from "lucide-react";

const WarehouseReceiptsTab = lazy(() => import("@/components/warehouses/WarehouseReceiptsTab"));

export default function SlaughterMeatReceiptsFollowUp() {
  return (
    <DashboardLayout>
      <div className="space-y-4" dir="rtl">
        <Suspense fallback={<div className="py-10 text-center"><Loader2 className="w-6 h-6 animate-spin inline" /></div>}>
          <WarehouseReceiptsTab
            followUp
            warehouseName="المجزر ومصنع اللحوم — متابعة"
            startDate="2026-07-07"
          />
        </Suspense>
      </div>
    </DashboardLayout>
  );
}
