import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { NotificationSettingsProvider } from "@/hooks/useNotificationSettings";
import ProtectedRoute from "@/components/ProtectedRoute";
import Index from "./pages/Index";
import Products from "./pages/Products";
import Orders from "./pages/Orders";
import Customers from "./pages/Customers";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import Employees from "./pages/Employees";
import NewOrder from "./pages/NewOrder";
import Notifications from "./pages/Notifications";
import OrderDetails from "./pages/OrderDetails";
import Install from "./pages/Install";
import Auth from "./pages/Auth";
import TeamPerformance from "./pages/TeamPerformance";
import SalesTargets from "./pages/SalesTargets";
import OfferBoxes from "./pages/OfferBoxes";
import SeedUsers from "./pages/SeedUsers";
import Permissions from "./pages/Permissions";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <NotificationSettingsProvider>
            <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route path="/" element={
              <ProtectedRoute>
                <Index />
              </ProtectedRoute>
            } />
            <Route path="/products" element={
              <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'sales_manager', 'sales_moderator', 'warehouse_supervisor']}>
                <Products />
              </ProtectedRoute>
            } />
            <Route path="/orders" element={
              <ProtectedRoute>
                <Orders />
              </ProtectedRoute>
            } />
            <Route path="/orders/new" element={
              <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'sales_manager', 'sales_moderator']}>
                <NewOrder />
              </ProtectedRoute>
            } />
            <Route path="/orders/:id" element={
              <ProtectedRoute>
                <OrderDetails />
              </ProtectedRoute>
            } />
            <Route path="/customers" element={
              <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'sales_manager', 'sales_moderator']}>
                <Customers />
              </ProtectedRoute>
            } />
            <Route path="/notifications" element={
              <ProtectedRoute>
                <Notifications />
              </ProtectedRoute>
            } />
            <Route path="/reports" element={
              <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'sales_manager', 'accountant']}>
                <Reports />
              </ProtectedRoute>
            } />
            <Route path="/employees" element={
              <ProtectedRoute allowedRoles={['general_manager']}>
                <Employees />
              </ProtectedRoute>
            } />
            <Route path="/settings" element={
              <ProtectedRoute allowedRoles={['general_manager']}>
                <Settings />
              </ProtectedRoute>
            } />
            <Route path="/team-performance" element={
              <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'sales_manager']}>
                <TeamPerformance />
              </ProtectedRoute>
            } />
            <Route path="/sales-targets" element={
              <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'sales_manager']}>
                <SalesTargets />
              </ProtectedRoute>
            } />
            <Route path="/offer-boxes" element={
              <ProtectedRoute allowedRoles={['general_manager', 'executive_manager', 'sales_manager', 'sales_moderator']}>
                <OfferBoxes />
              </ProtectedRoute>
            } />
            <Route path="/permissions" element={
              <ProtectedRoute>
                <Permissions />
              </ProtectedRoute>
            } />
            <Route path="/install" element={<Install />} />
            <Route path="/seed-users" element={<SeedUsers />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
            </Routes>
          </NotificationSettingsProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
