import { LogOut } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { SidebarMenuSections } from "./SidebarMenuSections";
import companyLogo from "@/assets/company-logo.jpg";

const AppSidebar = () => {
  const { signOut } = useAuth();

  return (
    <aside className="fixed right-0 top-0 h-screen w-64 bg-sidebar text-sidebar-foreground flex flex-col shadow-2xl z-50">
      {/* Logo */}
      <div className="p-6 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-sidebar-primary flex items-center justify-center shadow-lg">
            <span className="text-sidebar-primary-foreground font-bold text-xl">ن</span>
          </div>
          <div>
            <h1 className="font-bold text-lg">شركة نعام العاصمة</h1>
            <p className="text-xs text-sidebar-foreground/60">إدارة العمليات</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <SidebarMenuSections />

      {/* Footer */}
      <div className="p-4 border-t border-sidebar-border">
        <button
          onClick={signOut}
          className="sidebar-item w-full text-destructive hover:bg-destructive/10"
        >
          <LogOut className="w-5 h-5" />
          <span className="font-medium">تسجيل الخروج</span>
        </button>
      </div>
    </aside>
  );
};

export default AppSidebar;
