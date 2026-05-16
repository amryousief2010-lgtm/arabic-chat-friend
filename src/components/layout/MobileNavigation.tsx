import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Bell,
  Menu,
  Target,
  Warehouse,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useUnreadNotifications } from "@/hooks/useUnreadNotifications";
import { findModeratorByName } from "@/constants/moderators";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import MobileSidebarContent from "./MobileSidebarContent";

const MobileNavigation = () => {
  const location = useLocation();
  const { role, profile } = useAuth();
  const { unreadCount, urgentUnreadCount } = useUnreadNotifications();
  const [open, setOpen] = useState(false);

  const isModerator = role === 'sales_moderator';
  const modSlug = isModerator ? findModeratorByName(profile?.full_name)?.slug : undefined;

  const quickNavItems = isModerator
    ? [
        { icon: ShoppingCart, label: "طلباتي", path: "/orders" },
        { icon: Target, label: "التارجت", path: "/sales-targets" },
        { icon: Warehouse, label: "المخزون", path: "/modules/warehouses" },
      ]
    : [
        { icon: LayoutDashboard, label: "الرئيسية", path: "/" },
        { icon: Package, label: "المنتجات", path: "/products" },
        { icon: ShoppingCart, label: "الطلبات", path: "/orders" },
        { icon: Bell, label: "الإشعارات", path: "/notifications", badge: unreadCount, urgent: urgentUnreadCount > 0 },
      ];

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-sidebar border-t-2 border-sidebar-border z-50 md:hidden shadow-[0_-4px_20px_rgba(0,0,0,0.15)]" style={{ paddingBottom: 'env(safe-area-inset-bottom, 16px)' }}>
      <nav className="flex items-center justify-around h-18 min-h-[72px] px-2">
        {quickNavItems.map((item: any) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex flex-col items-center justify-center gap-1 p-2 rounded-lg transition-colors relative ${
                isActive 
                  ? "text-sidebar-primary" 
                  : "text-sidebar-foreground/70 hover:text-sidebar-foreground"
              }`}
            >
              <item.icon className={`w-5 h-5 ${isActive ? "scale-110" : ""} transition-transform`} />
              <span className="text-[10px] font-medium">{item.label}</span>
              {item.badge && item.badge > 0 && (
                <Badge
                  variant="destructive"
                  className={`absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[10px] ${item.urgent ? 'animate-pulse ring-2 ring-destructive/60' : ''}`}
                >
                  {item.badge > 99 ? '99+' : item.badge}
                </Badge>
              )}
            </Link>
          );
        })}
        
        {/* Menu Button */}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <button
              className="flex flex-col items-center justify-center gap-1 p-2 rounded-lg transition-colors text-sidebar-foreground/70 hover:text-sidebar-foreground"
            >
              <Menu className="w-5 h-5" />
              <span className="text-[10px] font-medium">المزيد</span>
            </button>
          </SheetTrigger>
          <SheetContent side="right" className="w-72 p-0 bg-sidebar">
            <MobileSidebarContent onClose={() => setOpen(false)} />
          </SheetContent>
        </Sheet>
      </nav>
    </div>
  );
};

export default MobileNavigation;
