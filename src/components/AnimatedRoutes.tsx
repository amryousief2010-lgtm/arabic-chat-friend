import { lazy as reactLazy, Suspense } from "react";
import { Routes, Route, useLocation, Navigate } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import ProtectedRoute from "@/components/ProtectedRoute";
import PageTransition from "@/components/layout/PageTransition";
import RoleLanding from "@/components/RoleLanding";

// Wrap lazy() so that when a dynamically-imported chunk is missing (e.g. after a
// new deploy invalidated old chunk hashes), we force a single hard reload instead
// of crashing the whole app / closing the sidebar.
const lazy: typeof reactLazy = ((factory: any) =>
  reactLazy(() =>
    factory().catch((err: any) => {
      const msg = String(err?.message || err || "");
      const isChunkErr =
        msg.includes("dynamically imported module") ||
        msg.includes("Failed to fetch dynamically imported") ||
        msg.includes("Importing a module script failed") ||
        err?.name === "ChunkLoadError";
      if (isChunkErr && typeof window !== "undefined") {
        const key = "__lov_chunk_reload__";
        if (!sessionStorage.getItem(key)) {
          sessionStorage.setItem(key, String(Date.now()));
          window.location.reload();
          return { default: (() => null) as any };
        }
      }
      throw err;
    })
  )) as any;

// All page components are lazy-loaded to dramatically reduce initial bundle size.
// Each route's JS chunk is only fetched when the user navigates to it.
const Index = lazy(() => import("@/pages/Index"));
const Products = lazy(() => import("@/pages/Products"));
const ProductCosts = lazy(() => import("@/pages/ProductCosts"));
const OrderStatusAudit = lazy(() => import("@/pages/OrderStatusAudit"));
const SendMessage = lazy(() => import("@/pages/SendMessage"));
const FinancialReports = lazy(() => import("@/pages/FinancialReports"));
const Orders = lazy(() => import("@/pages/Orders"));
const Customers = lazy(() => import("@/pages/Customers"));
const Reports = lazy(() => import("@/pages/Reports"));
const Settings = lazy(() => import("@/pages/Settings"));
const Employees = lazy(() => import("@/pages/Employees"));
const NewOrder = lazy(() => import("@/pages/NewOrder"));
const WarehouseStockView = lazy(() => import("@/pages/WarehouseStockView"));
const CustomerWarehouseView = lazy(() => import("@/pages/CustomerWarehouseView"));
const ModeratorWarehouseStock = lazy(() => import("@/pages/ModeratorWarehouseStock"));
const Notifications = lazy(() => import("@/pages/Notifications"));
const DuplicateOrderApprovals = lazy(() => import("@/pages/DuplicateOrderApprovals"));
const OrderDetails = lazy(() => import("@/pages/OrderDetails"));
const Install = lazy(() => import("@/pages/Install"));
const Auth = lazy(() => import("@/pages/Auth"));
const TeamPerformance = lazy(() => import("@/pages/TeamPerformance"));
const SalesTargets = lazy(() => import("@/pages/SalesTargets"));
const OfferBoxes = lazy(() => import("@/pages/OfferBoxes"));
const Permissions = lazy(() => import("@/pages/Permissions"));
const LowStock = lazy(() => import("@/pages/LowStock"));
const OrgChart = lazy(() => import("@/pages/OrgChart"));
const NotFound = lazy(() => import("@/pages/NotFound"));
const Unauthorized = lazy(() => import("@/pages/Unauthorized"));
const ImportSalesData = lazy(() => import("@/pages/ImportSalesData"));
const RebuildMayOrders = lazy(() => import("@/pages/RebuildMayOrders"));
const ExcelComparison = lazy(() => import("@/pages/ExcelComparison"));
const OfferBoxPricingAudit = lazy(() => import("@/pages/OfferBoxPricingAudit"));
const ModeratorPerformance = lazy(() => import("@/pages/ModeratorPerformance"));
const ModeratorOrdersLog = lazy(() => import("@/pages/ModeratorOrdersLog"));
const Farm = lazy(() => import("@/pages/modules/Farm"));
const Hatchery = lazy(() => import("@/pages/modules/Hatchery"));
const HatcheryPayments = lazy(() => import("@/pages/HatcheryPayments"));
const FarmEggWaste = lazy(() => import("@/pages/FarmEggWaste"));
const FarmHatcheryDashboard = lazy(() => import("@/pages/modules/FarmHatcheryDashboard"));
const Brooding = lazy(() => import("@/pages/modules/Brooding"));
const Slaughterhouse = lazy(() => import("@/pages/modules/Slaughterhouse"));
const SlaughterPermit = lazy(() => import("@/pages/modules/SlaughterPermit"));
const MeatFactory = lazy(() => import("@/pages/modules/MeatFactory"));
const FeedFactory = lazy(() => import("@/pages/modules/FeedFactory"));
const HumanResources = lazy(() => import("@/pages/modules/HumanResources"));
const Warehouses = lazy(() => import("@/pages/modules/Warehouses"));
const RecipeDetail = lazy(() => import("@/pages/modules/feed/RecipeDetail"));
const BatchTracking = lazy(() => import("@/pages/modules/feed/BatchTracking"));
const FeedDashboard = lazy(() => import("@/pages/modules/feed/FeedDashboard"));
const FeedRecipes = lazy(() => import("@/pages/modules/feed/Recipes"));
const ManagerReview = lazy(() => import("@/pages/ManagerReview"));
const InventoryEngine = lazy(() => import("@/pages/InventoryEngine"));
const BomApproval = lazy(() => import("@/pages/BomApproval"));
const MeatFactoryBatches = lazy(() => import("@/pages/MeatFactoryBatches"));
const FeedFactoryBatches = lazy(() => import("@/pages/FeedFactoryBatches"));
const MeatBatchNew = lazy(() => import("@/pages/MeatBatchNew"));
const FeedBatchNew = lazy(() => import("@/pages/FeedBatchNew"));
const MeatBatchDetail = lazy(() => import("@/pages/MeatBatchDetail"));
const FeedBatchDetail = lazy(() => import("@/pages/FeedBatchDetail"));
const MeatFactoryDashboard = lazy(() => import("@/pages/factory/MeatFactoryDashboard"));
const FeedFactoryDashboard = lazy(() => import("@/pages/factory/FeedFactoryDashboard"));
const FeedWarehouses = lazy(() => import("@/pages/feed/FeedWarehouses"));
const MeatProductionWarehouses = lazy(() => import("@/pages/meat/MeatProductionWarehouses"));
const ManufacturingInvoices = lazy(() => import("@/pages/meat/ManufacturingInvoices"));
const FactoryOverview = lazy(() => import("@/pages/factory/FactoryOverview"));
const FactoryReports = lazy(() => import("@/pages/factory/FactoryReports"));
const FeedOrders = lazy(() => import("@/pages/modules/feed/Orders"));
const FeedIssues = lazy(() => import("@/pages/modules/feed/Issues"));
const WarehouseDashboard = lazy(() => import("@/pages/modules/warehouse/WarehouseDashboard"));
const WarehouseDetail = lazy(() => import("@/pages/modules/warehouse/WarehouseDetail"));
const InventoryImport = lazy(() => import("@/pages/modules/warehouse/InventoryImport"));
const Debug = lazy(() => import("@/pages/Debug"));
const PwaDiagnostics = lazy(() => import("@/pages/PwaDiagnostics"));
const ExecutiveDashboards = lazy(() => import("@/pages/ExecutiveDashboards"));
const CustomerWeightReport = lazy(() => import("@/pages/CustomerWeightReport"));
const ManufacturingQueue = lazy(() => import("@/pages/ManufacturingQueue"));
const StockReplenishmentLog = lazy(() => import("@/pages/StockReplenishmentLog"));
const OrderHalfKgReport = lazy(() => import("@/pages/OrderHalfKgReport"));
const CateringDashboard = lazy(() => import("@/pages/catering/CateringDashboard"));
const CateringCustomers = lazy(() => import("@/pages/catering/CateringCustomers"));
const CateringSuppliers = lazy(() => import("@/pages/catering/CateringSuppliers"));
const CateringRawMaterials = lazy(() => import("@/pages/catering/CateringRawMaterials"));
const CateringProducts = lazy(() => import("@/pages/catering/CateringProducts"));
const CateringOrders = lazy(() => import("@/pages/catering/CateringOrders"));
const NewCateringOrder = lazy(() => import("@/pages/catering/NewCateringOrder"));
const CateringKitchen = lazy(() => import("@/pages/catering/CateringKitchen"));
const CateringPurchases = lazy(() => import("@/pages/catering/CateringPurchases"));
const CateringInvoices = lazy(() => import("@/pages/catering/CateringInvoices"));
const PrivateDeliveryPricing = lazy(() => import("@/pages/PrivateDeliveryPricing"));
const FarmShipmentsLog = lazy(() => import("@/pages/FarmShipmentsLog"));
const FarmProductionImport = lazy(() => import("@/pages/FarmProductionImport"));
const QuickGuide = lazy(() => import("@/pages/QuickGuide"));
const CorrectionRequests = lazy(() => import("@/pages/CorrectionRequests"));
const CorrectionAuditLog = lazy(() => import("@/pages/CorrectionAuditLog"));
const UpdatesLog = lazy(() => import("@/pages/UpdatesLog"));
const ImportWizard = lazy(() => import("@/pages/modules/shared/ImportWizard"));
const DataQualityTasks = lazy(() => import("@/pages/modules/shared/DataQualityTasks"));
const PackagingMaterials = lazy(() => import("@/pages/modules/shared/PackagingMaterials"));
const StockSnapshotReview = lazy(() => import("@/pages/modules/shared/StockSnapshotReview"));
const StockReconciliation = lazy(() => import("@/pages/StockReconciliation"));
const PrivateDeliveryCollection = lazy(() => import("@/pages/PrivateDeliveryCollection"));
const ChickOrders = lazy(() => import("@/pages/ChickOrders"));
const MainWarehouseActivity = lazy(() => import("@/pages/MainWarehouseActivity"));

const RedirectWithQuery = ({ to }: { to: string }) => {
  const location = useLocation();
  return <Navigate to={{ pathname: to, search: location.search, hash: location.hash }} replace />;
};

const RouteFallback = () => (
  <div className="flex items-center justify-center min-h-[60vh] w-full">
    <div className="h-10 w-10 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
  </div>
);

const AnimatedRoutes = () => {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait">
      <Suspense fallback={<RouteFallback />}>
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
          <Route path="/chick-orders" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'sales_manager', 'sales_moderator', 'marketing_sales_manager', 'accountant', 'financial_manager']}>
              <PageTransition><ChickOrders /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/orders/new" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'sales_manager', 'sales_moderator', 'marketing_sales_manager']}>
              <PageTransition><NewOrder /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/duplicate-order-approvals" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'marketing_sales_manager', 'sales_manager']}>
              <PageTransition><DuplicateOrderApprovals /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/warehouse-stock" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'sales_manager', 'sales_moderator', 'marketing_sales_manager', 'warehouse_supervisor']}>
              <PageTransition><WarehouseStockView /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/warehouse-stock/agouza" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'sales_manager', 'sales_moderator', 'marketing_sales_manager', 'warehouse_supervisor', 'agouza_warehouse_keeper']}>
              <PageTransition><WarehouseStockView scope="agouza" /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/private-delivery-collection" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'warehouse_supervisor']}>
              <PageTransition><PrivateDeliveryCollection /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/warehouse-stock/main" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'sales_manager', 'sales_moderator', 'marketing_sales_manager', 'warehouse_supervisor']}>
              <PageTransition><WarehouseStockView scope="main" /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/warehouse-stock/hyper-healthy-test" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'warehouse_supervisor']}>
              <PageTransition>
                <CustomerWarehouseView
                  warehouseName="هايبر هيلثي تيست"
                  pageTitle="مخزن هايبر هيلثي تيست"
                  pageSubtitle="توريد ومرتجع منتجات هايبر هيلثي تيست — يُخصم/يُضاف تلقائياً من المخزن الرئيسي"
                />
              </PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/warehouse-stock/hyper-carrefour" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'warehouse_supervisor']}>
              <PageTransition>
                <CustomerWarehouseView
                  warehouseName="هايبر كارفور"
                  pageTitle="مخزن هايبر كارفور"
                  pageSubtitle="توريد ومرتجع منتجات هايبر كارفور — يُخصم/يُضاف تلقائياً من المخزن الرئيسي"
                />
              </PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/warehouse-stock/moderator/:slug" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'sales_manager', 'sales_moderator', 'marketing_sales_manager', 'warehouse_supervisor']}>
              <PageTransition><ModeratorWarehouseStock /></PageTransition>
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
          <Route path="/feed-factory/warehouses" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'feed_factory_manager', 'production_manager', 'financial_manager', 'warehouse_supervisor']}>
              <PageTransition><FeedWarehouses /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/meat-factory/warehouses" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'meat_factory_manager', 'production_manager', 'financial_manager', 'warehouse_supervisor']}>
              <PageTransition><MeatProductionWarehouses /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/meat-factory/manufacturing" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'meat_factory_manager', 'production_manager']}>
              <PageTransition><ManufacturingInvoices /></PageTransition>
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
          <Route path="/hatchery/payments" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'hatchery_manager', 'production_manager', 'farm_manager', 'accountant', 'financial_manager']}>
              <PageTransition><HatcheryPayments /></PageTransition>
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
          <Route path="/farm-egg-waste" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'farm_manager', 'production_manager', 'quality_manager']}>
              <PageTransition><FarmEggWaste /></PageTransition>
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
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'warehouse_supervisor', 'production_manager', 'quality_manager', 'sales_moderator', 'agouza_warehouse_keeper']}>
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
          <Route path="/main-warehouse-activity" element={
            <ProtectedRoute allowedRoles={['general_manager','executive_manager','warehouse_supervisor']}>
              <PageTransition><MainWarehouseActivity /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/unauthorized" element={
            <PageTransition><Unauthorized /></PageTransition>
          } />
          <Route path="*" element={
            <PageTransition><NotFound /></PageTransition>
          } />
        </Routes>
      </Suspense>
    </AnimatePresence>
  );
};

export default AnimatedRoutes;
