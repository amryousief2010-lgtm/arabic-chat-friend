import { LogOut } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { SidebarMenuSections } from "./SidebarMenuSections";
import UserAvatar from "@/components/UserAvatar";
import companyLogo from "@/assets/company-logo.jpg";

const AppSidebar = () => {
  const { signOut, user, profile } = useAuth();
  const displayName = profile?.full_name || user?.email?.split("@")[0] || "مستخدم";

  return (
    <aside className="fixed right-0 top-0 h-screen w-64 bg-sidebar text-sidebar-foreground flex flex-col shadow-2xl z-50">
      {/* Logo */}
      <div className="p-6 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center shadow-lg overflow-hidden ring-1 ring-sidebar-border">
            <img src={companyLogo} alt="شركة نعام العاصمة" className="w-full h-full object-contain p-1" />
          </div>
          <div>
            <h1 className="font-bold text-lg">شركة نعام العاصمة</h1>
            <p className="text-xs text-sidebar-foreground/60">إدارة العمليات</p>
          </div>
        </div>
      </div>

      {/* Current user */}
      <div className="px-4 py-3 border-b border-sidebar-border flex items-center gap-3">
        <UserAvatar userId={user?.id} name={displayName} className="w-9 h-9" />
        <span className="text-sm font-medium truncate">{displayName}</span>
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
