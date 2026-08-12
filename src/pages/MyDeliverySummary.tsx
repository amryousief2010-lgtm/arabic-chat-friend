import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import DeliverySummary from "@/components/orders/DeliverySummary";
import { useAuth } from "@/hooks/useAuth";
import { findModeratorByName } from "@/constants/moderators";

// ملخص توصيل الأوردرات — كل موظفة ترى أوردراتها هي فقط (عرض للمتابعة، بدون تعديل).
const MyDeliverySummary = () => {
  const { profile, user } = useAuth();
  const moderator = findModeratorByName(profile?.full_name);

  return (
    <DashboardLayout>
      <Header
        title="ملخص توصيل الأوردرات"
        subtitle="متابعة حالة التوصيل لأوردراتك — عرض فقط بدون تعديل"
      />
      <DeliverySummary
        mode="own"
        moderator={moderator}
        userId={user?.id}
        badgeLabel={moderator?.displayName || profile?.full_name || "أوردراتي"}
        readOnlyNote="عرض للمتابعة فقط"
      />
    </DashboardLayout>
  );
};

export default MyDeliverySummary;
