import { Navigate } from "react-router-dom";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import DeliverySummary from "@/components/orders/DeliverySummary";
import { useAuth } from "@/hooks/useAuth";
import { findModeratorByName, findModeratorBySlug } from "@/constants/moderators";

// شاشة مراجعة فقط (Read-only) لأوردرات هاجر — مخصّصة لحساب نورا.
// ممنوع أي تعديل أو حذف من هنا؛ العرض فقط لأغراض المراجعة،
// ولا تختلط بأوردرات نورا نفسها (الفلترة على المسوقة "هاجر"/"منال").
const HagarOrdersReview = () => {
  const { profile, user, isGeneralManager, isExecutiveManager } = useAuth();

  const isNoura =
    findModeratorByName(profile?.full_name)?.slug === "noura" ||
    (user?.email || "").toLowerCase().startsWith("noura");
  const allowed = isNoura || isGeneralManager || isExecutiveManager;

  if (!allowed) return <Navigate to="/orders" replace />;

  const hagar = findModeratorBySlug("manal");

  return (
    <DashboardLayout>
      <Header title="مراجعة أوردرات هاجر" subtitle="عرض للمراجعة فقط — لا يمكن التعديل أو الحذف" />
      <DeliverySummary
        mode="group"
        moderator={hagar}
        badgeLabel="أوردرات هاجر"
        readOnlyNote="مراجعة فقط (بدون تعديل)"
      />
    </DashboardLayout>
  );
};

export default HagarOrdersReview;
