import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Users,
  BarChart3,
  Settings,
  LogOut,
  Bell,
  Warehouse,
  UsersRound,
  Target,
  Gift,
} from "lucide-react";
import { useAuth, AppRole } from "@/hooks/useAuth";
import { useUnreadNotifications } from "@/hooks/useUnreadNotifications";
import { Badge } from "@/components/ui/badge";

const allMenuItems: { 
  icon: React.ElementType; 
  label: string; 
  path: string; 
  roles: AppRole[] 
}[] = [
  { 
    icon: LayoutDashboard, 
    label: "لوحة التحكم", 
    path: "/", 
    roles: ['general_manager', 'executive_manager', 'sales_manager', 'sales_moderator', 'accountant', 'warehouse_supervisor'] 
  },
  { 
    icon: Package, 
    label: "المنتجات", 
    path: "/products", 
    roles: ['general_manager', 'executive_manager', 'sales_manager', 'sales_moderator', 'warehouse_supervisor'] 
  },
  { 
    icon: ShoppingCart, 
    label: "الطلبات", 
    path: "/orders", 
    roles: ['general_manager', 'executive_manager', 'sales_manager', 'sales_moderator', 'accountant', 'warehouse_supervisor'] 
  },
  { 
    icon: Users, 
    label: "العملاء", 
    path: "/customers", 
    roles: ['general_manager', 'executive_manager', 'sales_manager', 'sales_moderator'] 
  },
  { 
    icon: Bell, 
    label: "الإشعارات", 
    path: "/notifications", 
    roles: ['general_manager', 'executive_manager', 'sales_manager', 'sales_moderator', 'accountant', 'warehouse_supervisor'] 
  },
  { 
    icon: BarChart3, 
    label: "التقارير", 
    path: "/reports", 
    roles: ['general_manager', 'executive_manager', 'sales_manager', 'accountant'] 
  },
  { 
    icon: UsersRound, 
    label: "أداء الفريق", 
    path: "/team-performance", 
    roles: ['general_manager', 'executive_manager', 'sales_manager'] 
  },
  { 
    icon: Target, 
    label: "أهداف المبيعات", 
    path: "/sales-targets", 
    roles: ['general_manager', 'executive_manager', 'sales_manager'] 
  },
  { 
    icon: Gift, 
    label: "صناديق العروض", 
    path: "/offer-boxes", 
    roles: ['general_manager', 'executive_manager', 'sales_manager', 'sales_moderator'] 
  },
  { 
    icon: Users, 
    label: "الموظفين", 
    path: "/employees", 
    roles: ['general_manager'] 
  },
  { 
    icon: Settings, 
    label: "الإعدادات", 
    path: "/settings", 
    roles: ['general_manager'] 
  },
];

const AppSidebar = () => {
  const location = useLocation();
  const { role, signOut } = useAuth();
  const { unreadCount } = useUnreadNotifications();

  const menuItems = allMenuItems.filter(item => 
    role && item.roles.includes(role)
  );

  return (
    <aside className="fixed right-0 top-0 h-screen w-64 bg-sidebar text-sidebar-foreground flex flex-col shadow-2xl z-50">
      {/* Logo */}
      <div className="p-6 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-sidebar-primary flex items-center justify-center shadow-lg">
            <span className="text-sidebar-primary-foreground font-bold text-xl">ن</span>
          </div>
          <div>
            <h1 className="font-bold text-lg">نعام العاصمة</h1>
            <p className="text-xs text-sidebar-foreground/60">نظام المبيعات</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
        {menuItems.map((item) => {
          const isActive = location.pathname === item.path;
          const showBadge = item.path === '/notifications' && unreadCount > 0;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`sidebar-item ${isActive ? "sidebar-item-active" : ""}`}
            >
              <item.icon className="w-5 h-5" />
              <span className="font-medium flex-1">{item.label}</span>
              {showBadge && (
                <Badge variant="destructive" className="h-5 min-w-5 px-1.5 text-xs">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </Badge>
              )}
            </Link>
          );
        })}
      </nav>

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
