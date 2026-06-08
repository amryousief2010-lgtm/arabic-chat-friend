import { ReactNode, useCallback } from "react";
import AppSidebar from "./AppSidebar";
import MobileNavigation from "./MobileNavigation";
import PullToRefreshIndicator from "./PullToRefresh";
import SwipeIndicator from "./SwipeIndicator";
import StartOfDayDialog from "@/components/StartOfDayDialog";
import ClockCalendarWidget from "@/components/ClockCalendarWidget";
import PendingApprovalsAlert from "@/components/lab-treasury/PendingApprovalsAlert";
import UnreadMessagesBanner from "@/components/internal-messages/UnreadMessagesBanner";
import { useOrderNotifications } from "@/hooks/useOrderNotifications";
import { useDailyReminders } from "@/hooks/useDailyReminders";
import { useInternalMessageRealtime } from "@/hooks/useInternalMessageRealtime";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { useSwipeNavigation } from "@/hooks/useSwipeNavigation";
import { useQueryClient } from "@tanstack/react-query";
import { useIsMobile } from "@/hooks/use-mobile";

interface DashboardLayoutProps {
  children: ReactNode;
}

const DashboardLayout = ({ children }: DashboardLayoutProps) => {
  // Enable real-time order notifications + daily/weekly role reminders
  useOrderNotifications();
  useDailyReminders();
  useInternalMessageRealtime();

  const queryClient = useQueryClient();
  const isMobile = useIsMobile();

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

  return (
    <div className="min-h-screen bg-background">
      <StartOfDayDialog />
      <PendingApprovalsAlert />
      {/* Desktop Sidebar */}
      <div className="hidden md:block">
        <AppSidebar />
      </div>
      
      {/* Mobile Bottom Navigation */}
      <MobileNavigation />
      
      {/* Main Content with Pull to Refresh */}
      <main 
        ref={containerRef}
        className="md:mr-64 p-4 md:p-8 pb-32 md:pb-8 relative overflow-auto"
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
  );
};

export default DashboardLayout;
