import { Navigate } from "react-router-dom";

// تم توحيد شاشة إدارة المخازن — أي رابط قديم لـ /modules/warehouses/management-hub
// يُعاد توجيهه إلى الشاشة الموحدة /modules/warehouses حفاظًا على التوافق.
const WarehouseManagementHub = () => {
  return <Navigate to="/modules/warehouses" replace />;
};

export default WarehouseManagementHub;
