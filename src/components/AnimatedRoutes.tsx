import { Routes, Route, useLocation, Navigate } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import ProtectedRoute from "@/components/ProtectedRoute";
import PageTransition from "@/components/layout/PageTransition";
import Index from "@/pages/Index";
import Products from "@/pages/Products";
import Orders from "@/pages/Orders";
import Customers from "@/pages/Customers";
import Reports from "@/pages/Reports";
import Settings from "@/pages/Settings";
import Employees from "@/pages/Employees";
import NewOrder from "@/pages/NewOrder";
import Notifications from "@/pages/Notifications";
import OrderDetails from "@/pages/OrderDetails";
import Install from "@/pages/Install";
import Auth from "@/pages/Auth";
import TeamPerformance from "@/pages/TeamPerformance";
import SalesTargets from "@/pages/SalesTargets";
import OfferBoxes from "@/pages/OfferBoxes";

import Permissions from "@/pages/Permissions";
import LowStock from "@/pages/LowStock";
import OrgChart from "@/pages/OrgChart";
import NotFound from "@/pages/NotFound";
import ImportSalesData from "@/pages/ImportSalesData";
import ModeratorPerformance from "@/pages/ModeratorPerformance";
import ModeratorOrdersLog from "@/pages/ModeratorOrdersLog";
import Farm from "@/pages/modules/Farm";
import Hatchery from "@/pages/modules/Hatchery";
import FarmHatcheryDashboard from "@/pages/modules/FarmHatcheryDashboard";
import Brooding from "@/pages/modules/Brooding";
import Slaughterhouse from "@/pages/modules/Slaughterhouse";
import MeatFactory from "@/pages/modules/MeatFactory";
import FeedFactory from "@/pages/modules/FeedFactory";
import HumanResources from "@/pages/modules/HumanResources";
import Warehouses from "@/pages/modules/Warehouses";
import RecipeDetail from "@/pages/modules/feed/RecipeDetail";
import BatchTracking from "@/pages/modules/feed/BatchTracking";
import WarehouseDashboard from "@/pages/modules/warehouse/WarehouseDashboard";
import InventoryImport from "@/pages/modules/warehouse/InventoryImport";
import Debug from "@/pages/Debug";
import ExecutiveDashboards from "@/pages/ExecutiveDashboards";

const RedirectWithQuery = ({ to }: { to: string }) => {
  const location = useLocation();
  return <Navigate to={{ pathname: to, search: location.search, hash: location.hash }} replace />;
};

const AnimatedRoutes = () => {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/auth" element={
          <PageTransition><Auth /></PageTransition>
        } />
        <Route path="/debug" element={
          <PageTransition><Debug /></PageTransition>
        } />
        <Route path="/farm" element={<RedirectWithQuery to="/modules/farm" />} />
        <Route path="/hatchery" element={<RedirectWithQuery to="/modules/hatchery" />} />
        <Route path="/" element={
          <ProtectedRoute>
            <PageTransition><Index /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/products" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'sales_manager', 'sales_moderator', 'warehouse_supervisor', 'marketing_sales_manager', 'quality_manager']}>
            <PageTransition><Products /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/orders" element={
          <ProtectedRoute>
            <PageTransition><Orders /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/orders/new" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'sales_manager', 'sales_moderator', 'marketing_sales_manager']}>
            <PageTransition><NewOrder /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/orders/moderator/:slug" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'sales_manager', 'sales_moderator', 'marketing_sales_manager']}>
            <PageTransition><ModeratorOrdersLog /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/orders/:id" element={
          <ProtectedRoute>
            <PageTransition><OrderDetails /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/customers" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'sales_manager', 'sales_moderator', 'marketing_sales_manager']}>
            <PageTransition><Customers /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/notifications" element={
          <ProtectedRoute>
            <PageTransition><Notifications /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/reports" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'sales_manager', 'accountant', 'marketing_sales_manager', 'financial_manager', 'quality_manager']}>
            <PageTransition><Reports /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/employees" element={
          <ProtectedRoute allowedRoles={['general_manager']}>
            <PageTransition><Employees /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/org-chart" element={
          <ProtectedRoute>
            <PageTransition><OrgChart /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/settings" element={
          <ProtectedRoute allowedRoles={['general_manager']}>
            <PageTransition><Settings /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/team-performance" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'sales_manager', 'marketing_sales_manager']}>
            <PageTransition><TeamPerformance /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/sales-targets" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'sales_manager', 'sales_moderator', 'marketing_sales_manager']}>
            <PageTransition><SalesTargets /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/offer-boxes" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'sales_manager', 'sales_moderator', 'marketing_sales_manager']}>
            <PageTransition><OfferBoxes /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/permissions" element={
          <ProtectedRoute>
            <PageTransition><Permissions /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/low-stock" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'sales_manager', 'warehouse_supervisor', 'marketing_sales_manager', 'production_manager', 'quality_manager', 'sales_moderator']}>
            <PageTransition><LowStock /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/install" element={
          <PageTransition><Install /></PageTransition>
        } />
        <Route path="/import-sales" element={
          <ProtectedRoute allowedRoles={['general_manager']}>
            <PageTransition><ImportSalesData /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/moderator-performance" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'sales_manager', 'marketing_sales_manager']}>
            <PageTransition><ModeratorPerformance /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/modules/farm" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'farm_manager', 'production_manager', 'quality_manager']}>
            <PageTransition><Farm /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/modules/hatchery" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'hatchery_manager', 'production_manager', 'quality_manager']}>
            <PageTransition><Hatchery /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/modules/farm-hatchery-dashboard" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'farm_manager', 'hatchery_manager', 'production_manager', 'quality_manager']}>
            <PageTransition><FarmHatcheryDashboard /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/modules/brooding" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'brooding_manager', 'production_manager', 'quality_manager']}>
            <PageTransition><Brooding /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/modules/slaughterhouse" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'slaughterhouse_manager', 'production_manager', 'quality_manager']}>
            <PageTransition><Slaughterhouse /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/modules/meat-factory" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'meat_factory_manager', 'production_manager', 'quality_manager']}>
            <PageTransition><MeatFactory /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/modules/feed-factory" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'feed_factory_manager', 'production_manager', 'quality_manager']}>
            <PageTransition><FeedFactory /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/modules/hr" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'hr_manager']}>
            <PageTransition><HumanResources /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/modules/warehouses" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'warehouse_supervisor', 'production_manager', 'quality_manager', 'sales_moderator']}>
            <PageTransition><Warehouses /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/modules/warehouses/dashboard" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'warehouse_supervisor', 'production_manager', 'quality_manager', 'sales_moderator']}>
            <PageTransition><WarehouseDashboard /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/modules/warehouses/import" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'warehouse_supervisor', 'production_manager', 'quality_manager']}>
            <PageTransition><InventoryImport /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/modules/feed-factory/recipes/:id" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'feed_factory_manager', 'production_manager', 'quality_manager']}>
            <PageTransition><RecipeDetail /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/modules/feed-factory/batches/:id" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'feed_factory_manager', 'production_manager', 'quality_manager']}>
            <PageTransition><BatchTracking /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/executive-dashboards" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'sales_manager', 'marketing_sales_manager', 'financial_manager', 'accountant']}>
            <PageTransition><ExecutiveDashboards /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="*" element={
          <PageTransition><NotFound /></PageTransition>
        } />
      </Routes>
    </AnimatePresence>
  );
};

export default AnimatedRoutes;
