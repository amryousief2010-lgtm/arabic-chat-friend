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
import VersionBadge from "@/components/VersionBadge";
import RouteVersionGuard from "@/components/RouteVersionGuard";
import InstalledIconMismatchAlert from "@/components/InstalledIconMismatchAlert";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <PWAUpdatePrompt />
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
);

export default App;
