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
const DailyPerformanceAnalysis = lazy(() => import("@/pages/sales/DailyPerformanceAnalysis"));
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
const HatcheryLab = lazy(() => import("@/pages/modules/HatcheryLab"));
const HatcheryPayments = lazy(() => import("@/pages/HatcheryPayments"));
const HatcheryImport = lazy(() => import("@/pages/hatchery/HatcheryImport"));
const HatchBatchesImport = lazy(() => import("@/pages/hatchery/HatchBatchesImport"));
const HatchBatchesReview = lazy(() => import("@/pages/hatchery/HatchBatchesReview"));
const HatcheryCustomerStatements = lazy(() => import("@/pages/hatchery/HatcheryCustomerStatements"));
const HatchBatchEditAudit = lazy(() => import("@/pages/hatchery/HatchBatchEditAudit"));
const HatchTestData = lazy(() => import("@/pages/hatchery/HatchTestData"));
const LabCustomerReconciliation = lazy(() => import("@/pages/hatchery/LabCustomerReconciliation"));
const FarmEggWaste = lazy(() => import("@/pages/FarmEggWaste"));
const FarmHatcheryDashboard = lazy(() => import("@/pages/modules/FarmHatcheryDashboard"));
const Brooding = lazy(() => import("@/pages/modules/Brooding"));
const Slaughterhouse = lazy(() => import("@/pages/modules/Slaughterhouse"));
const SlaughterPermit = lazy(() => import("@/pages/modules/SlaughterPermit"));
const SlaughterTransfersLog = lazy(() => import("@/pages/slaughterhouse/TransfersLog"));
const ButchersPayroll = lazy(() => import("@/pages/slaughterhouse/ButchersPayroll"));
const SlaughterhouseFeedStore = lazy(() => import("@/pages/slaughterhouse/SlaughterhouseFeedStore"));
const MeatFactory = lazy(() => import("@/pages/modules/MeatFactory"));
const MeatFactoryOps = lazy(() => import("@/pages/modules/MeatFactoryOps"));
const FeedFactory = lazy(() => import("@/pages/modules/FeedFactory"));
const HumanResources = lazy(() => import("@/pages/modules/HumanResources"));
const HRDashboard = lazy(() => import("@/pages/hr/HRDashboard"));
const HREmployees = lazy(() => import("@/pages/hr/HREmployees"));
const HRWorkLocations = lazy(() => import("@/pages/hr/HRWorkLocations"));
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
const FeedSalesReturns = lazy(() => import("@/pages/feed/FeedSalesReturns"));
const FeedMonthlyReport = lazy(() => import("@/pages/feed/FeedMonthlyReport"));
const FeedInternalAccounts = lazy(() => import("@/pages/feed/FeedInternalAccounts"));
const FeedOpeningBalances = lazy(() => import("@/pages/feed/FeedOpeningBalances"));
const MeatProductionWarehouses = lazy(() => import("@/pages/meat/MeatProductionWarehouses"));
const MeatWarehouses = lazy(() => import("@/pages/meat/MeatWarehouses"));
const ManufacturingInvoices = lazy(() => import("@/pages/meat/ManufacturingInvoices"));
const MeatPurchaseInvoices = lazy(() => import("@/pages/meat/MeatPurchaseInvoices"));
const MeatFactoryOverviewDashboard = lazy(() => import("@/pages/meat/MeatFactoryOverviewDashboard"));
const MeatRecipes = lazy(() => import("@/pages/meat/MeatRecipes"));
const MeatRawInventory = lazy(() => import("@/pages/meat/MeatRawInventory"));
const MeatPackagingInventory = lazy(() => import("@/pages/meat/MeatPackagingInventory"));
const MeatFactoryReports = lazy(() => import("@/pages/meat/MeatFactoryReports"));
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
const ExecutiveDashboard = lazy(() => import("@/pages/ExecutiveDashboard"));
const OperationsGuide = lazy(() => import("@/pages/OperationsGuide"));
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
const DeliveryRoutes = lazy(() => import("@/pages/DeliveryRoutes"));
const ChickOrders = lazy(() => import("@/pages/ChickOrders"));
const MainWarehouseActivity = lazy(() => import("@/pages/MainWarehouseActivity"));
const LabTreasury = lazy(() => import("@/pages/LabTreasury"));
const MyLabCollections = lazy(() => import("@/pages/MyLabCollections"));
const SlaughterhouseCustody = lazy(() => import("@/pages/SlaughterhouseCustody"));
const MainTreasury = lazy(() => import("@/pages/MainTreasury"));
const LabHistoricalReceivables = lazy(() => import("@/pages/lab-treasury/HistoricalReceivables"));
const LabCustomerDebts = lazy(() => import("@/pages/lab-treasury/LabCustomerDebts"));
const LabCustomerStatement = lazy(() => import("@/pages/lab-treasury/LabCustomerStatement"));
const LabCustomerBalances = lazy(() => import("@/pages/lab-treasury/LabCustomerBalances"));
const PCDashboard = lazy(() => import("@/pages/private-courier/Dashboard"));
const PCPlanning = lazy(() => import("@/pages/private-courier/Planning"));
const PCRoutesPage = lazy(() => import("@/pages/private-courier/Routes"));
const PCMyDeliveries = lazy(() => import("@/pages/private-courier/MyDeliveries"));
const PCHandovers = lazy(() => import("@/pages/private-courier/Handovers"));
const PCCollections = lazy(() => import("@/pages/private-courier/Collections"));
const AiOperationsAssistant = lazy(() => import("@/pages/AiOperationsAssistant"));
const InternalMessages = lazy(() => import("@/pages/internal-messages/InternalMessages"));
const InternalMessageDetails = lazy(() => import("@/pages/internal-messages/MessageDetails"));
const SocialMediaDailyReport = lazy(() => import("@/pages/social-media/SocialMediaDailyReport"));
const SocialMediaWeeklyReport = lazy(() => import("@/pages/social-media/SocialMediaWeeklyReport"));
const SocialMediaMyReports = lazy(() => import("@/pages/social-media/SocialMediaMyReports"));
const SocialMediaReportsReview = lazy(() => import("@/pages/social-media/SocialMediaReportsReview"));

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
            <ProtectedRoute allowedRoles={['marketing_sales_manager']}>
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
          <Route path="/delivery-routes" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'private_delivery_rep']}>
              <PageTransition><DeliveryRoutes /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/private-courier" element={
            <ProtectedRoute allowedRoles={['general_manager','executive_manager','sales_manager','marketing_sales_manager','accountant','warehouse_supervisor','private_delivery_rep']}>
              <PageTransition><PCDashboard /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/private-courier/planning" element={
            <ProtectedRoute allowedRoles={['general_manager','executive_manager','sales_manager','marketing_sales_manager']}>
              <PageTransition><PCPlanning /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/private-courier/routes" element={
            <ProtectedRoute allowedRoles={['general_manager','executive_manager','sales_manager','marketing_sales_manager']}>
              <PageTransition><PCRoutesPage /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/private-courier/my-deliveries" element={
            <ProtectedRoute allowedRoles={['private_delivery_rep','general_manager','executive_manager']}>
              <PageTransition><PCMyDeliveries /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/private-courier/handovers" element={
            <ProtectedRoute allowedRoles={['general_manager','executive_manager','warehouse_supervisor','sales_manager']}>
              <PageTransition><PCHandovers /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/private-courier/collections" element={
            <ProtectedRoute allowedRoles={['general_manager','executive_manager','sales_manager','accountant']}>
              <PageTransition><PCCollections /></PageTransition>
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
          <Route path="/internal-messages" element={
            <ProtectedRoute>
              <PageTransition><InternalMessages /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/internal-messages/:id" element={
            <ProtectedRoute>
              <PageTransition><InternalMessageDetails /></PageTransition>
            </ProtectedRoute>
          } />

          <Route path="/social-media/daily" element={
            <ProtectedRoute allowedRoles={['general_manager','executive_manager','marketing_sales_manager','social_media_manager']}>
              <PageTransition><SocialMediaDailyReport /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/social-media/weekly" element={
            <ProtectedRoute allowedRoles={['general_manager','executive_manager','marketing_sales_manager','social_media_manager']}>
              <PageTransition><SocialMediaWeeklyReport /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/social-media/my-reports" element={
            <ProtectedRoute allowedRoles={['social_media_manager','general_manager','executive_manager','marketing_sales_manager']}>
              <PageTransition><SocialMediaMyReports /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/social-media/review" element={
            <ProtectedRoute allowedRoles={['general_manager','executive_manager','marketing_sales_manager']}>
              <PageTransition><SocialMediaReportsReview /></PageTransition>
            </ProtectedRoute>
          } />



          <Route path="/ai-operations-assistant" element={
            <ProtectedRoute allowedRoles={[
              'general_manager','executive_manager',
              'sales_manager','marketing_sales_manager','sales_moderator',
              'hatchery_manager','farm_manager','production_manager',
              'accountant','financial_manager','private_delivery_rep'
            ]}>
              <PageTransition><AiOperationsAssistant /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/reports" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'sales_manager', 'accountant', 'marketing_sales_manager', 'financial_manager', 'quality_manager']}>
              <PageTransition><Reports /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/sales/daily-performance-analysis" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'sales_manager', 'marketing_sales_manager', 'financial_manager', 'accountant']}>
              <PageTransition><DailyPerformanceAnalysis /></PageTransition>
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
          <Route path="/feed-factory/sales-returns" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'feed_factory_manager', 'accountant', 'financial_manager']}>
              <PageTransition><FeedSalesReturns /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/feed-factory/monthly-report" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'feed_factory_manager', 'production_manager', 'accountant', 'financial_manager', 'warehouse_supervisor']}>
              <PageTransition><FeedMonthlyReport /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/feed-factory/internal-accounts" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'feed_factory_manager', 'accountant', 'financial_manager', 'brooding_manager', 'slaughterhouse_manager', 'production_manager']}>
              <PageTransition><FeedInternalAccounts /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/feed-factory/opening-balances" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'feed_factory_manager', 'accountant', 'financial_manager']}>
              <PageTransition><FeedOpeningBalances /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/meat-factory/warehouses" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'meat_factory_manager', 'production_manager', 'financial_manager', 'warehouse_supervisor']}>
              <PageTransition><MeatProductionWarehouses /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/meat-factory/factory-warehouses" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'meat_factory_manager', 'production_manager', 'financial_manager', 'warehouse_supervisor', 'accountant']}>
              <PageTransition><MeatWarehouses /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/meat-factory/manufacturing" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'meat_factory_manager', 'production_manager']}>
              <PageTransition><ManufacturingInvoices /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/meat-factory/purchase-invoices" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'meat_factory_manager', 'production_manager', 'warehouse_supervisor', 'accountant', 'financial_manager']}>
              <PageTransition><MeatPurchaseInvoices /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/meat-factory/overview-dashboard" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'meat_factory_manager', 'production_manager', 'warehouse_supervisor', 'accountant', 'financial_manager']}>
              <PageTransition><MeatFactoryOverviewDashboard /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/meat-factory/recipes" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'meat_factory_manager', 'production_manager', 'quality_manager', 'accountant', 'financial_manager']}>
              <PageTransition><MeatRecipes /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/meat-factory/raw-inventory" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'meat_factory_manager', 'production_manager', 'quality_manager', 'accountant', 'financial_manager', 'warehouse_supervisor']}>
              <PageTransition><MeatRawInventory /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/meat-factory/packaging-inventory" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'meat_factory_manager', 'production_manager', 'warehouse_supervisor', 'accountant', 'financial_manager']}>
              <PageTransition><MeatPackagingInventory /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/meat-factory/reports" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'meat_factory_manager', 'production_manager', 'quality_manager', 'accountant', 'financial_manager', 'warehouse_supervisor']}>
              <PageTransition><MeatFactoryReports /></PageTransition>
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
          <Route path="/modules/hatchery-lab" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'hatchery_manager', 'production_manager', 'quality_manager', 'accountant']}>
              <PageTransition><HatcheryLab /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/lab-treasury" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'accountant', 'financial_manager', 'lab_treasury_keeper', 'lab_treasury_approver']}>
              <PageTransition><LabTreasury /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/lab-treasury/historical-receivables" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'lab_treasury_keeper', 'lab_treasury_approver', 'lab_external_collector', 'slaughterhouse_manager', 'slaughterhouse_custody_keeper']}>
              <PageTransition><LabHistoricalReceivables /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/lab-treasury/customer-debts" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'accountant', 'financial_manager', 'lab_treasury_keeper', 'lab_treasury_approver']}>
              <PageTransition><LabCustomerDebts /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/lab-treasury/customer-statement" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'accountant', 'financial_manager', 'lab_treasury_keeper']}>
              <PageTransition><LabCustomerStatement /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/lab-treasury/customer-balances" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'accountant', 'financial_manager', 'lab_treasury_keeper']}>
              <PageTransition><LabCustomerBalances /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/my-lab-collections" element={
            <ProtectedRoute allowedRoles={['lab_external_collector', 'general_manager', 'executive_manager', 'lab_treasury_approver']}>
              <PageTransition><MyLabCollections /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/hatchery/payments" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'hatchery_manager', 'production_manager', 'farm_manager', 'accountant', 'financial_manager']}>
              <PageTransition><HatcheryPayments /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/hatchery/import" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'hatchery_manager', 'farm_manager', 'production_manager']}>
              <PageTransition><HatcheryImport /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/hatchery/import-batches" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'hatchery_manager', 'farm_manager', 'production_manager']}>
              <PageTransition><HatchBatchesImport /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/hatchery/import-batches/review" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'hatchery_manager', 'farm_manager', 'production_manager']}>
              <PageTransition><HatchBatchesReview /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/hatchery/customer-statements" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'hatchery_manager', 'farm_manager', 'production_manager', 'accountant']}>
              <PageTransition><HatcheryCustomerStatements /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/hatchery/edit-audit" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'hatchery_manager', 'farm_manager']}>
              <PageTransition><HatchBatchEditAudit /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/hatchery/test-data" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager']}>
              <PageTransition><HatchTestData /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/hatchery/customer-reconciliation" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'hatchery_manager', 'farm_manager', 'production_manager']}>
              <PageTransition><LabCustomerReconciliation /></PageTransition>
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
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'brooding_manager', 'brooding_dashboard_viewer']}>
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
          <Route path="/modules/slaughterhouse/transfers" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'slaughterhouse_manager', 'production_manager', 'quality_manager', 'warehouse_supervisor', 'meat_factory_manager']}>
              <PageTransition><SlaughterTransfersLog /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/modules/slaughterhouse/payroll" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'slaughterhouse_manager']}>
              <PageTransition><ButchersPayroll /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/modules/slaughterhouse/feed-store" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'slaughterhouse_manager', 'warehouse_supervisor', 'feed_factory_manager', 'production_manager']}>
              <PageTransition><SlaughterhouseFeedStore /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/modules/meat-factory" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'meat_factory_manager', 'production_manager', 'quality_manager']}>
              <PageTransition><MeatFactory /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/modules/meat-factory/operations" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'meat_factory_manager']}>
              <PageTransition><MeatFactoryOps /></PageTransition>
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
          <Route path="/hr" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'hr_manager']}>
              <PageTransition><HRDashboard /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/hr/employees" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'hr_manager', 'accountant', 'financial_manager']}>
              <PageTransition><HREmployees /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/hr/work-locations" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'hr_manager']}>
              <PageTransition><HRWorkLocations /></PageTransition>
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
          <Route path="/executive-dashboard" element={
            <ProtectedRoute allowedRoles={['general_manager', 'executive_manager']}>
              <PageTransition><ExecutiveDashboard /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/operations-guide" element={
            <ProtectedRoute allowedRoles={['general_manager','executive_manager','hatchery_manager','farm_manager','meat_factory_manager','production_manager']}>
              <PageTransition><OperationsGuide /></PageTransition>
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
          <Route path="/slaughterhouse-custody" element={
            <ProtectedRoute allowedRoles={['general_manager','executive_manager','slaughterhouse_manager','lab_treasury_approver','slaughterhouse_custody_keeper']}>
              <PageTransition><SlaughterhouseCustody /></PageTransition>
            </ProtectedRoute>
          } />
          <Route path="/main-treasury" element={
            <ProtectedRoute allowedRoles={['general_manager','executive_manager','financial_manager','main_treasury_accountant' as any,'main_treasury_approver' as any]}>
              <PageTransition><MainTreasury /></PageTransition>
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
