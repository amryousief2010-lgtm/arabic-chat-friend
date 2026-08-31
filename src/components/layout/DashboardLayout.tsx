import { ReactNode, createContext, useCallback, useContext } from "react";
import AppSidebar from "./AppSidebar";
import MobileNavigation from "./MobileNavigation";
import PullToRefreshIndicator from "./PullToRefresh";
import SwipeIndicator from "./SwipeIndicator";
import StartOfDayDialog from "@/components/StartOfDayDialog";
import ClockCalendarWidget from "@/components/ClockCalendarWidget";
import PendingApprovalsAlert from "@/components/lab-treasury/PendingApprovalsAlert";
import ExecutiveApprovalsAlert from "@/components/executive/ExecutiveApprovalsAlert";
import MegaDiscrepancyAlert from "@/components/orders/MegaDiscrepancyAlert";
import DuplicateApprovalsAlert from "@/components/orders/DuplicateApprovalsAlert";

import UnreadMessagesBanner from "@/components/internal-messages/UnreadMessagesBanner";
import MandatoryMessagesGate from "@/components/internal-messages/MandatoryMessagesGate";
import { useOrderNotifications } from "@/hooks/useOrderNotifications";
import { useDailyReminders } from "@/hooks/useDailyReminders";
import { useInternalMessageRealtime } from "@/hooks/useInternalMessageRealtime";
import { useUserPresence } from "@/hooks/useUserPresence";

import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { useSwipeNavigation } from "@/hooks/useSwipeNavigation";
import { useQueryClient } from "@tanstack/react-query";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSidebarCollapsed } from "@/hooks/useSidebarCollapsed";
import SidebarToggleButton from "./SidebarToggleButton";

interface DashboardLayoutProps {
  children: ReactNode;
}

const DashboardLayoutContext = createContext(false);

export const useInsideDashboardLayout = () => useContext(DashboardLayoutContext);

const DashboardLayout = ({ children }: DashboardLayoutProps) => {
  // Prevent duplicated chrome when a page renders its own DashboardLayout
  // inside the automatic one provided by the router.
  const alreadyInsideLayout = useInsideDashboardLayout();
  if (alreadyInsideLayout) return <>{children}</>;
  return <DashboardLayoutInner>{children}</DashboardLayoutInner>;
};

const DashboardLayoutInner = ({ children }: DashboardLayoutProps) => {
  // Embed mode: when loaded inside an iframe/tab via ?embed=1, render only the
  // children without sidebar/header/widgets so the parent app shell is not duplicated.
  const isEmbed = typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("embed") === "1";

  // Enable real-time order notifications + daily/weekly role reminders
  useOrderNotifications();
  useDailyReminders();
  useInternalMessageRealtime();
  useUserPresence();


  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const { collapsed: sidebarCollapsed, toggle: toggleSidebar } = useSidebarCollapsed();

  const handleRefresh = useCallback(async () => {
    // Invalidate all queries to refresh data
    await queryClient.invalidateQueries();
    // Small delay for better UX
    await new Promise(resolve => setTimeout(resolve, 500));
  }, [queryClient]);

  const { containerRef, isRefreshing, pullDistance } = usePullToRefresh({
    onRefresh: handleRefresh,
    isEnabled: isMobile,
  });

  // Enable swipe navigation on mobile
  const { currentIndex, totalPages, canGoNext, canGoPrev } = useSwipeNavigation({
    isEnabled: isMobile,
  });

  if (isEmbed) {
    return (
      <DashboardLayoutContext.Provider value={true}>
        <div className="min-h-screen bg-background">
          <main className="p-4 md:p-6">{children}</main>
        </div>
      </DashboardLayoutContext.Provider>
    );
  }

  return (
    <DashboardLayoutContext.Provider value={true}>
    <div className="min-h-screen bg-background">
      <PendingApprovalsAlert />
      <ExecutiveApprovalsAlert />
      <MegaDiscrepancyAlert />
      <DuplicateApprovalsAlert />


      {/* Desktop Sidebar (collapsible, state persisted in LocalStorage) */}
      <div className={sidebarCollapsed ? "hidden" : "hidden md:block"}>
        <AppSidebar />
      </div>
      <SidebarToggleButton collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
      
      {/* Mobile Bottom Navigation */}
      <MobileNavigation />
      
      {/* Main Content with Pull to Refresh */}
      <main 
        ref={containerRef}
        className={`${sidebarCollapsed ? "" : "md:mr-64"} p-4 md:p-8 pb-32 md:pb-8 relative overflow-auto`}
        style={{ 
          minHeight: 'calc(100vh - 4rem)',
          transform: pullDistance > 0 ? `translateY(${pullDistance}px)` : undefined,
          transition: pullDistance === 0 ? 'transform 0.2s ease-out' : undefined,
        }}
      >
        <PullToRefreshIndicator 
          pullDistance={pullDistance}
          isRefreshing={isRefreshing}
        />
        <MandatoryMessagesGate />
        <UnreadMessagesBanner />
        {children}
        
        {/* Swipe Navigation Indicator */}
        {isMobile && currentIndex !== -1 && (
          <SwipeIndicator 
            currentIndex={currentIndex}
            totalPages={totalPages}
            canGoNext={canGoNext}
            canGoPrev={canGoPrev}
          />
        )}
      </main>

      {/* Floating Clock + Calendar widget (visible to all users on every page) */}
      <ClockCalendarWidget />
    </div>
    </DashboardLayoutContext.Provider>
  );
};

export default DashboardLayout;
