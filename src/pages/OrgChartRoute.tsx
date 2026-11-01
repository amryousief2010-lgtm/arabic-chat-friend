import { lazy } from "react";
import { useAuth } from "@/hooks/useAuth";

const HROrgStructure = lazy(() => import("@/pages/hr/HROrgStructure"));

/**
 * المدير العام والتنفيذي ومسؤول الموارد البشرية يقرؤون جدول الموظفين مباشرة (مع رابط ملف الموظف).
 * باقي المستخدمين يرون نفس المخطط من الدالة الآمنة hr_avatar_directory() — بدون رواتب أو هواتف.
 * الهيكل القديم متاح على /org-chart/legacy.
 */
const OrgChartRoute = () => {
  const { isGeneralManager, isExecutiveManager, roles } = useAuth();
  const canReadHr = isGeneralManager || isExecutiveManager || roles.includes("hr_manager");
  return <HROrgStructure publicView={!canReadHr} />;
};

export default OrgChartRoute;
