import { ReactNode } from "react";
import AppSidebar from "./AppSidebar";
import MobileNavigation from "./MobileNavigation";
import { useOrderNotifications } from "@/hooks/useOrderNotifications";

interface DashboardLayoutProps {
  children: ReactNode;
}

const DashboardLayout = ({ children }: DashboardLayoutProps) => {
  // Enable real-time order notifications
  useOrderNotifications();

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop Sidebar */}
      <div className="hidden md:block">
        <AppSidebar />
      </div>
      
      {/* Mobile Bottom Navigation */}
      <MobileNavigation />
      
      {/* Main Content */}
      <main className="md:mr-64 p-4 md:p-8 pb-24 md:pb-8">
        {children}
      </main>
    </div>
  );
};

export default DashboardLayout;
