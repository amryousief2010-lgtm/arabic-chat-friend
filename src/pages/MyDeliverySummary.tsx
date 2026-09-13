import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import DeliverySummary from "@/components/orders/DeliverySummary";
import { useAuth } from "@/hooks/useAuth";
import { findModeratorByName } from "@/constants/moderators";

// ملخص توصيل الأوردرات — كل موظفة ترى أوردراتها هي فقط (عرض للمتابعة، بدون تعديل).
const MyDeliverySummary = () => {
  const { profile, user, isGeneralManager, isExecutiveManager, isSalesManager } = useAuth();
  const canSeeAll = isGeneralManager || isExecutiveManager || isSalesManager;
  const moderator = findModeratorByName(profile?.full_name);

  return (
    <DashboardLayout>
      <Header
        title="ملخص توصيل الأوردرات"
        subtitle={canSeeAll
          ? "متابعة حالة التوصيل لكل أوردرات المسوقات — عرض فقط بدون تعديل"
          : "متابعة حالة التوصيل لأوردراتك — عرض فقط بدون تعديل"}
      />
      {canSeeAll ? (
        <DeliverySummary
          mode="all"
          badgeLabel="كل المسوقات"
          readOnlyNote="عرض للمتابعة فقط"
        />
      ) : (
        <DeliverySummary
          mode="own"
          moderator={moderator}
          userId={user?.id}
          badgeLabel={moderator?.displayName || profile?.full_name || "أوردراتي"}
          readOnlyNote="عرض للمتابعة فقط"
        />
      )}
    </DashboardLayout>
  );
};

export default MyDeliverySummary;
