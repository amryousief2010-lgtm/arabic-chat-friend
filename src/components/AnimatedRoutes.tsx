import { Routes, Route, useLocation } from "react-router-dom";
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
import SeedUsers from "@/pages/SeedUsers";
import Permissions from "@/pages/Permissions";
import LowStock from "@/pages/LowStock";
import NotFound from "@/pages/NotFound";
import ImportSalesData from "@/pages/ImportSalesData";
import ModeratorPerformance from "@/pages/ModeratorPerformance";
import Farm from "@/pages/modules/Farm";
import Hatchery from "@/pages/modules/Hatchery";
import Brooding from "@/pages/modules/Brooding";
import Slaughterhouse from "@/pages/modules/Slaughterhouse";
import MeatFactory from "@/pages/modules/MeatFactory";
import FeedFactory from "@/pages/modules/FeedFactory";
import HumanResources from "@/pages/modules/HumanResources";
import Warehouses from "@/pages/modules/Warehouses";

const AnimatedRoutes = () => {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/auth" element={
          <PageTransition><Auth /></PageTransition>
        } />
        <Route path="/" element={
          <ProtectedRoute>
            <PageTransition><Index /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/products" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'sales_manager', 'sales_moderator', 'warehouse_supervisor']}>
            <PageTransition><Products /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/orders" element={
          <ProtectedRoute>
            <PageTransition><Orders /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/orders/new" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'sales_manager', 'sales_moderator']}>
            <PageTransition><NewOrder /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/orders/:id" element={
          <ProtectedRoute>
            <PageTransition><OrderDetails /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/customers" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'sales_manager', 'sales_moderator']}>
            <PageTransition><Customers /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/notifications" element={
          <ProtectedRoute>
            <PageTransition><Notifications /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/reports" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'sales_manager', 'accountant']}>
            <PageTransition><Reports /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/employees" element={
          <ProtectedRoute allowedRoles={['general_manager']}>
            <PageTransition><Employees /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/settings" element={
          <ProtectedRoute allowedRoles={['general_manager']}>
            <PageTransition><Settings /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/team-performance" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'sales_manager']}>
            <PageTransition><TeamPerformance /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/sales-targets" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'sales_manager']}>
            <PageTransition><SalesTargets /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/offer-boxes" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'sales_manager', 'sales_moderator']}>
            <PageTransition><OfferBoxes /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/permissions" element={
          <ProtectedRoute>
            <PageTransition><Permissions /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/low-stock" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'sales_manager', 'warehouse_supervisor']}>
            <PageTransition><LowStock /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/install" element={
          <PageTransition><Install /></PageTransition>
        } />
        {import.meta.env.DEV && (
          <Route path="/seed-users" element={
            <PageTransition><SeedUsers /></PageTransition>
          } />
        )}
        <Route path="/import-sales" element={
          <ProtectedRoute allowedRoles={['general_manager']}>
            <PageTransition><ImportSalesData /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/moderator-performance" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'sales_manager']}>
            <PageTransition><ModeratorPerformance /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/modules/farm" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager']}>
            <PageTransition><Farm /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/modules/hatchery" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager']}>
            <PageTransition><Hatchery /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/modules/brooding" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager']}>
            <PageTransition><Brooding /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/modules/slaughterhouse" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager']}>
            <PageTransition><Slaughterhouse /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/modules/meat-factory" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager']}>
            <PageTransition><MeatFactory /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/modules/feed-factory" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager']}>
            <PageTransition><FeedFactory /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/modules/hr" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager']}>
            <PageTransition><HumanResources /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/modules/warehouses" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'warehouse_supervisor']}>
            <PageTransition><Warehouses /></PageTransition>
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
