import { lazy } from "react";
import { useAuth } from "@/hooks/useAuth";

const HROrgStructure = lazy(() => import("@/pages/hr/HROrgStructure"));
const OrgChart = lazy(() => import("@/pages/OrgChart"));

/**
 * بيانات الموظفين مقروءة فقط للمدير العام والمدير التنفيذي ومسؤول الموارد البشرية (RLS)،
 * لذلك يرى هؤلاء الهيكل المبني من البيانات، ويرى الباقون الهيكل العام المعتاد.
 */
const OrgChartRoute = () => {
  const { isGeneralManager, isExecutiveManager, roles } = useAuth();
  const canReadHr = isGeneralManager || isExecutiveManager || roles.includes("hr_manager");
  return canReadHr ? <HROrgStructure /> : <OrgChart />;
};

export default OrgChartRoute;
