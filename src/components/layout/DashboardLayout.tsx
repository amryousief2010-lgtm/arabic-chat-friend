import { ReactNode } from "react";
import AppSidebar from "./AppSidebar";
import { useOrderNotifications } from "@/hooks/useOrderNotifications";

interface DashboardLayoutProps {
  children: ReactNode;
}

const DashboardLayout = ({ children }: DashboardLayoutProps) => {
  // Enable real-time order notifications
  useOrderNotifications();

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar />
      <main className="mr-64 p-8">
        {children}
      </main>
    </div>
  );
};

export default DashboardLayout;
