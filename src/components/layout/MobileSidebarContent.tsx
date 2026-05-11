import { LogOut } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { SidebarMenuSections } from "./SidebarMenuSections";
import companyLogo from "@/assets/company-logo.jpg";

interface MobileSidebarContentProps {
  onClose: () => void;
}

const MobileSidebarContent = ({ onClose }: MobileSidebarContentProps) => {
  const { signOut } = useAuth();

  const handleLogout = () => {
    onClose();
    signOut();
  };

  return (
    <div className="h-full flex flex-col text-sidebar-foreground">
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

      {/* Navigation */}
      <SidebarMenuSections onItemClick={onClose} />

      {/* Footer */}
      <div className="p-4 border-t border-sidebar-border">
        <button
          onClick={handleLogout}
          className="sidebar-item w-full text-destructive hover:bg-destructive/10"
        >
          <LogOut className="w-5 h-5" />
          <span className="font-medium">تسجيل الخروج</span>
        </button>
      </div>
    </div>
  );
};

export default MobileSidebarContent;
