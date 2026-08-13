import { Navigate } from "react-router-dom";
import Orders from "@/pages/Orders";
import { useAuth } from "@/hooks/useAuth";
import { findModeratorByName } from "@/constants/moderators";

// شاشة مراجعة فقط لأوردرات هاجر — مخصّصة لحساب نورا.
// تعيد استخدام نفس مكوّن عرض الأوردرات (كروت صفحة الطلبات) مع تمرير أوردرات هاجر فقط.
const HagarOrdersReview = () => {
  const { profile, user, isGeneralManager, isExecutiveManager } = useAuth();

  const isNoura =
    findModeratorByName(profile?.full_name)?.slug === "noura" ||
    (user?.email || "").toLowerCase().startsWith("noura");
  const allowed = isNoura || isGeneralManager || isExecutiveManager;

  if (!allowed) return <Navigate to="/orders" replace />;

  return <Orders reviewModeratorGroup="هاجر" />;
};

export default HagarOrdersReview;
