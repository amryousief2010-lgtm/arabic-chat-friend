import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Users,
  BarChart3,
  Settings,
  LogOut,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

const allMenuItems = [
  { icon: LayoutDashboard, label: "لوحة التحكم", path: "/", roles: ['admin', 'supervisor', 'employee'] },
  { icon: Package, label: "المنتجات", path: "/products", roles: ['admin', 'supervisor', 'employee'] },
  { icon: ShoppingCart, label: "الطلبات", path: "/orders", roles: ['admin', 'supervisor', 'employee'] },
  { icon: Users, label: "العملاء", path: "/customers", roles: ['admin', 'supervisor', 'employee'] },
  { icon: BarChart3, label: "التقارير", path: "/reports", roles: ['admin', 'supervisor'] },
  { icon: Settings, label: "الإعدادات", path: "/settings", roles: ['admin'] },
];

const AppSidebar = () => {
  const location = useLocation();
  const { role, signOut } = useAuth();

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
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`sidebar-item ${isActive ? "sidebar-item-active" : ""}`}
            >
              <item.icon className="w-5 h-5" />
              <span className="font-medium">{item.label}</span>
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
