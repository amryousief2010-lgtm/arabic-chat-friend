import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { NotificationSettingsProvider } from "@/hooks/useNotificationSettings";
import { TestDataProvider } from "@/hooks/useTestDataFilter";
import AnimatedRoutes from "@/components/AnimatedRoutes";
import PWAUpdatePrompt from "@/components/PWAUpdatePrompt";
import UpdateToastNotifier from "@/components/UpdateToastNotifier";
import VersionBadge from "@/components/VersionBadge";
import RouteVersionGuard from "@/components/RouteVersionGuard";
import InstalledIconMismatchAlert from "@/components/InstalledIconMismatchAlert";
import AppErrorBoundary from "@/components/AppErrorBoundary";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Returning to the app was refetching every query and reloading whole pages.
      // Realtime hooks still invalidate the queries they own. A screen that
      // needs a refresh on focus sets refetchOnWindowFocus: true itself.
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      refetchOnMount: true,
      staleTime: 2 * 60 * 1000,
    },
  },
});

const App = () => (
  <AppErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <PWAUpdatePrompt />
        <UpdateToastNotifier />
        <VersionBadge />
        <BrowserRouter>
          <RouteVersionGuard />
          <InstalledIconMismatchAlert />
          <AuthProvider>
            <NotificationSettingsProvider>
              <TestDataProvider>
                <AnimatedRoutes />
              </TestDataProvider>
            </NotificationSettingsProvider>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </AppErrorBoundary>
);

export default App;
