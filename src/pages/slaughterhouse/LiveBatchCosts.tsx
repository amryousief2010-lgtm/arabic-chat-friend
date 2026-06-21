import DashboardLayout from "@/components/layout/DashboardLayout";
import LiveBatchCostsPanel from "@/components/slaughterhouse/LiveBatchCostsPanel";

export default function LiveBatchCosts() {
  return (
    <DashboardLayout>
      <div dir="rtl" className="p-4 md:p-6">
        <LiveBatchCostsPanel />
      </div>
    </DashboardLayout>
  );
}
