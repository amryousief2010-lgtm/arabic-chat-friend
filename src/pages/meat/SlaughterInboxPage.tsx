import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { SlaughterToMeatInbox } from "@/components/meat/SlaughterToMeatInbox";

export default function SlaughterInboxPage() {
  return (
    <DashboardLayout>
      <Header title="وارد المجزر" subtitle="استلام اللحوم المرسلة مباشرة من المجزر إلى مصنع اللحوم بتكلفة الدفعة" />
      <div className="p-4">
        <SlaughterToMeatInbox />
      </div>
    </DashboardLayout>
  );
}
