import { Routes, Route, useLocation, Navigate } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import ProtectedRoute from "@/components/ProtectedRoute";
import PageTransition from "@/components/layout/PageTransition";
import Index from "@/pages/Index";
import Products from "@/pages/Products";
import ProductCosts from "@/pages/ProductCosts";
import OrderStatusAudit from "@/pages/OrderStatusAudit";
import SendMessage from "@/pages/SendMessage";
import FinancialReports from "@/pages/FinancialReports";
import Orders from "@/pages/Orders";
import Customers from "@/pages/Customers";
import Reports from "@/pages/Reports";
import Settings from "@/pages/Settings";
import Employees from "@/pages/Employees";
import NewOrder from "@/pages/NewOrder";
import WarehouseStockView from "@/pages/WarehouseStockView";
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
import Unauthorized from "@/pages/Unauthorized";
import ImportSalesData from "@/pages/ImportSalesData";
import RebuildMayOrders from "@/pages/RebuildMayOrders";
import ExcelComparison from "@/pages/ExcelComparison";
import OfferBoxPricingAudit from "@/pages/OfferBoxPricingAudit";
import ModeratorPerformance from "@/pages/ModeratorPerformance";
import ModeratorOrdersLog from "@/pages/ModeratorOrdersLog";
import Farm from "@/pages/modules/Farm";
import Hatchery from "@/pages/modules/Hatchery";
import FarmHatcheryDashboard from "@/pages/modules/FarmHatcheryDashboard";
import Brooding from "@/pages/modules/Brooding";
import Slaughterhouse from "@/pages/modules/Slaughterhouse";
import SlaughterPermit from "@/pages/modules/SlaughterPermit";
import MeatFactory from "@/pages/modules/MeatFactory";
import FeedFactory from "@/pages/modules/FeedFactory";
import HumanResources from "@/pages/modules/HumanResources";
import Warehouses from "@/pages/modules/Warehouses";
import RecipeDetail from "@/pages/modules/feed/RecipeDetail";
import BatchTracking from "@/pages/modules/feed/BatchTracking";
import FeedDashboard from "@/pages/modules/feed/FeedDashboard";
import FeedRecipes from "@/pages/modules/feed/Recipes";
import ManagerReview from "@/pages/ManagerReview";
import InventoryEngine from "@/pages/InventoryEngine";
import BomApproval from "@/pages/BomApproval";
import MeatFactoryBatches from "@/pages/MeatFactoryBatches";
import FeedFactoryBatches from "@/pages/FeedFactoryBatches";
import MeatBatchNew from "@/pages/MeatBatchNew";
import FeedBatchNew from "@/pages/FeedBatchNew";
import MeatBatchDetail from "@/pages/MeatBatchDetail";
import FeedBatchDetail from "@/pages/FeedBatchDetail";
import MeatFactoryDashboard from "@/pages/factory/MeatFactoryDashboard";
import FeedFactoryDashboard from "@/pages/factory/FeedFactoryDashboard";
import FactoryOverview from "@/pages/factory/FactoryOverview";
import FactoryReports from "@/pages/factory/FactoryReports";
import FeedOrders from "@/pages/modules/feed/Orders";
import FeedIssues from "@/pages/modules/feed/Issues";
import WarehouseDashboard from "@/pages/modules/warehouse/WarehouseDashboard";
import WarehouseDetail from "@/pages/modules/warehouse/WarehouseDetail";
import InventoryImport from "@/pages/modules/warehouse/InventoryImport";
import Debug from "@/pages/Debug";
import PwaDiagnostics from "@/pages/PwaDiagnostics";
import ExecutiveDashboards from "@/pages/ExecutiveDashboards";
import CustomerWeightReport from "@/pages/CustomerWeightReport";
import ManufacturingQueue from "@/pages/ManufacturingQueue";
import StockReplenishmentLog from "@/pages/StockReplenishmentLog";
import OrderHalfKgReport from "@/pages/OrderHalfKgReport";
import CateringDashboard from "@/pages/catering/CateringDashboard";
import CateringCustomers from "@/pages/catering/CateringCustomers";
import CateringSuppliers from "@/pages/catering/CateringSuppliers";
import CateringRawMaterials from "@/pages/catering/CateringRawMaterials";
import CateringProducts from "@/pages/catering/CateringProducts";
import CateringOrders from "@/pages/catering/CateringOrders";
import NewCateringOrder from "@/pages/catering/NewCateringOrder";
import CateringKitchen from "@/pages/catering/CateringKitchen";
import CateringPurchases from "@/pages/catering/CateringPurchases";
import CateringInvoices from "@/pages/catering/CateringInvoices";
import PrivateDeliveryPricing from "@/pages/PrivateDeliveryPricing";
import FarmShipmentsLog from "@/pages/FarmShipmentsLog";
import FarmProductionImport from "@/pages/FarmProductionImport";
import QuickGuide from "@/pages/QuickGuide";
import RoleLanding from "@/components/RoleLanding";
import CorrectionRequests from "@/pages/CorrectionRequests";
import CorrectionAuditLog from "@/pages/CorrectionAuditLog";
import UpdatesLog from "@/pages/UpdatesLog";
import ImportWizard from "@/pages/modules/shared/ImportWizard";
import DataQualityTasks from "@/pages/modules/shared/DataQualityTasks";
import PackagingMaterials from "@/pages/modules/shared/PackagingMaterials";
import StockSnapshotReview from "@/pages/modules/shared/StockSnapshotReview";
import StockReconciliation from "@/pages/StockReconciliation";

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
          <ProtectedRoute allowedRoles={['general_manager']}>
            <PageTransition><Debug /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/pwa-diagnostics" element={
          <ProtectedRoute allowedRoles={['general_manager']}>
            <PageTransition><PwaDiagnostics /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/farm" element={<RedirectWithQuery to="/modules/farm" />} />
        <Route path="/hatchery" element={<RedirectWithQuery to="/modules/hatchery" />} />
        <Route path="/" element={<RoleLanding />} />
        <Route path="/quick-guide" element={
          <ProtectedRoute><PageTransition><QuickGuide /></PageTransition></ProtectedRoute>
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
        <Route path="/warehouse-stock" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'sales_manager', 'sales_moderator', 'marketing_sales_manager', 'warehouse_supervisor']}>
            <PageTransition><WarehouseStockView /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/orders/moderator/:slug" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'sales_manager', 'sales_moderator', 'marketing_sales_manager', 'private_delivery_rep']}>
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
        <Route path="/reports/excel-comparison" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'sales_manager', 'accountant', 'marketing_sales_manager', 'financial_manager']}>
            <PageTransition><ExcelComparison /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/reports/offer-box-pricing-audit" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'sales_manager', 'accountant', 'financial_manager']}>
            <PageTransition><OfferBoxPricingAudit /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/reports/customer-weight" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'sales_manager', 'accountant', 'marketing_sales_manager', 'financial_manager', 'warehouse_supervisor']}>
            <PageTransition><CustomerWeightReport /></PageTransition>
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
        <Route path="/manager-review" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'meat_factory_manager', 'feed_factory_manager', 'quality_manager', 'accountant', 'financial_manager', 'warehouse_supervisor']}>
            <PageTransition><ManagerReview /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/inventory" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'warehouse_supervisor', 'meat_factory_manager', 'feed_factory_manager', 'production_manager', 'accountant', 'financial_manager', 'quality_manager']}>
            <PageTransition><InventoryEngine /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/stock-reconciliation" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'warehouse_supervisor']}>
            <PageTransition><StockReconciliation /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/bom-approval" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'accountant', 'financial_manager', 'meat_factory_manager', 'feed_factory_manager', 'quality_manager']}>
            <PageTransition><BomApproval /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/meat-factory/batches" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'meat_factory_manager', 'production_manager', 'quality_manager']}>
            <PageTransition><MeatFactoryBatches /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/meat-factory/batches/new" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'meat_factory_manager', 'production_manager']}>
            <PageTransition><MeatBatchNew /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/feed-factory/batches/new" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'feed_factory_manager', 'production_manager']}>
            <PageTransition><FeedBatchNew /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/feed-factory/batches" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'feed_factory_manager', 'production_manager', 'quality_manager']}>
            <PageTransition><FeedFactoryBatches /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/meat-factory/batches/:id" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'meat_factory_manager', 'production_manager', 'quality_manager']}>
            <PageTransition><MeatBatchDetail /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/feed-factory/batches/:id" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'feed_factory_manager', 'production_manager', 'quality_manager']}>
            <PageTransition><FeedBatchDetail /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/meat-factory/dashboard" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'meat_factory_manager', 'production_manager', 'quality_manager', 'accountant', 'financial_manager']}>
            <PageTransition><MeatFactoryDashboard /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/feed-factory/dashboard" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'feed_factory_manager', 'production_manager', 'quality_manager', 'accountant', 'financial_manager']}>
            <PageTransition><FeedFactoryDashboard /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/factories/overview" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'meat_factory_manager', 'feed_factory_manager', 'production_manager', 'accountant', 'financial_manager']}>
            <PageTransition><FactoryOverview /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/factories/reports" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'meat_factory_manager', 'feed_factory_manager', 'production_manager', 'accountant', 'financial_manager', 'quality_manager']}>
            <PageTransition><FactoryReports /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/manufacturing-queue" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'sales_manager', 'warehouse_supervisor', 'production_manager', 'quality_manager']}>
            <PageTransition><ManufacturingQueue /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/stock-replenishment-log" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'sales_manager', 'warehouse_supervisor', 'production_manager', 'accountant']}>
            <PageTransition><StockReplenishmentLog /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/reports/order-half-kg" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'sales_manager', 'accountant', 'warehouse_supervisor', 'marketing_sales_manager']}>
            <PageTransition><OrderHalfKgReport /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/product-costs" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'accountant', 'financial_manager']}>
            <PageTransition><ProductCosts /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/order-status-audit" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'sales_manager', 'accountant', 'financial_manager', 'marketing_sales_manager']}>
            <PageTransition><OrderStatusAudit /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/send-message" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'sales_manager', 'financial_manager', 'accountant']}>
            <PageTransition><SendMessage /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/financial-reports" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'accountant', 'financial_manager', 'sales_manager']}>
            <PageTransition><FinancialReports /></PageTransition>
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
        <Route path="/rebuild-may-orders" element={
          <ProtectedRoute allowedRoles={['general_manager']}>
            <PageTransition><RebuildMayOrders /></PageTransition>
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
        <Route path="/farm-shipments-log" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'farm_manager', 'hatchery_manager', 'production_manager', 'quality_manager']}>
            <PageTransition><FarmShipmentsLog /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/farm-production-import" element={
          <ProtectedRoute allowedRoles={['general_manager']}>
            <PageTransition><FarmProductionImport /></PageTransition>
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
        <Route path="/modules/slaughterhouse/permit" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'slaughterhouse_manager', 'production_manager', 'quality_manager']}>
            <PageTransition><SlaughterPermit /></PageTransition>
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
        <Route path="/modules/feed-factory/dashboard" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'feed_factory_manager', 'production_manager', 'quality_manager']}>
            <PageTransition><FeedDashboard /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/modules/feed-factory/recipes" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'feed_factory_manager', 'production_manager', 'quality_manager']}>
            <PageTransition><FeedRecipes /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/modules/feed-factory/orders" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'feed_factory_manager', 'production_manager', 'quality_manager']}>
            <PageTransition><FeedOrders /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/modules/feed-factory/issues" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'feed_factory_manager', 'production_manager', 'quality_manager', 'warehouse_supervisor']}>
            <PageTransition><FeedIssues /></PageTransition>
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
          <ProtectedRoute allowedRoles={['general_manager']}>
            <PageTransition><InventoryImport /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/modules/warehouses/:id" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'warehouse_supervisor', 'production_manager', 'quality_manager', 'sales_moderator']}>
            <PageTransition><WarehouseDetail /></PageTransition>
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
        <Route path="/private-delivery-pricing" element={
          <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'sales_manager', 'accountant', 'marketing_sales_manager', 'private_delivery_rep', 'sales_moderator']}>
            <PageTransition><PrivateDeliveryPricing /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/correction-requests" element={
          <ProtectedRoute allowedRoles={['general_manager','executive_manager','slaughterhouse_manager','farm_manager','hatchery_manager','brooding_manager','meat_factory_manager','feed_factory_manager','warehouse_supervisor','production_manager','quality_manager']}>
            <PageTransition><CorrectionRequests /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/correction-audit" element={
          <ProtectedRoute allowedRoles={['general_manager','executive_manager']}>
            <PageTransition><CorrectionAuditLog /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/updates-log" element={
          <ProtectedRoute><PageTransition><UpdatesLog /></PageTransition></ProtectedRoute>
        } />
        <Route path="/modules/import-wizard" element={
          <ProtectedRoute allowedRoles={['general_manager','executive_manager','warehouse_supervisor','meat_factory_manager','feed_factory_manager']}>
            <PageTransition><ImportWizard /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/modules/data-quality" element={
          <ProtectedRoute allowedRoles={['general_manager','executive_manager','warehouse_supervisor','meat_factory_manager','feed_factory_manager','quality_manager','accountant','production_manager']}>
            <PageTransition><DataQualityTasks /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/modules/packaging" element={
          <ProtectedRoute allowedRoles={['general_manager','executive_manager','warehouse_supervisor','meat_factory_manager','feed_factory_manager','production_manager','accountant']}>
            <PageTransition><PackagingMaterials /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/modules/stock-snapshots" element={
          <ProtectedRoute allowedRoles={['general_manager','executive_manager','warehouse_supervisor']}>
            <PageTransition><StockSnapshotReview /></PageTransition>
          </ProtectedRoute>
        } />
        <Route path="/unauthorized" element={
          <PageTransition><Unauthorized /></PageTransition>
        } />
        <Route path="*" element={
          <PageTransition><NotFound /></PageTransition>
        } />
      </Routes>
    </AnimatePresence>
  );
};

export default AnimatedRoutes;
