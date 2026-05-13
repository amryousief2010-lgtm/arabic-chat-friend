import { Bell, Search, LogOut, Shield, User } from "lucide-react";
import companyLogo from "@/assets/company-logo.jpg";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { useUnreadNotifications } from "@/hooks/useUnreadNotifications";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";

interface HeaderProps {
  title: string;
  subtitle?: string;
}

const roleLabels: Record<string, string> = {
  general_manager: 'المدير العام',
  executive_manager: 'المدير التنفيذي',
  sales_manager: 'مدير المبيعات',
  sales_moderator: 'مندوب مبيعات',
  accountant: 'المحاسب',
  warehouse_supervisor: 'مشرف المخزن',
};

const roleBadgeVariants: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  general_manager: 'default',
  executive_manager: 'default',
  sales_manager: 'secondary',
  sales_moderator: 'outline',
  accountant: 'secondary',
  warehouse_supervisor: 'secondary',
};

const Header = ({ title, subtitle }: HeaderProps) => {
  const { user, role, signOut } = useAuth();
  const navigate = useNavigate();

  const getUserInitial = () => {
    if (user?.user_metadata?.full_name) {
      return user.user_metadata.full_name.charAt(0);
    }
    return user?.email?.charAt(0).toUpperCase() || 'م';
  };

  const getUserName = () => {
    if (user?.user_metadata?.full_name) {
      return user.user_metadata.full_name;
    }
    return user?.email?.split('@')[0] || 'مستخدم';
  };

  return (
    <header className="flex items-center justify-between mb-8">
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-white dark:bg-white shadow-md ring-1 ring-border dark:ring-white/20 overflow-hidden flex items-center justify-center shrink-0">
          <img src={companyLogo} alt="شركة نعام العاصمة" className="w-full h-full object-contain p-1" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-foreground">{title}</h1>
          {subtitle && (
            <p className="text-muted-foreground mt-1">{subtitle}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="بحث..."
            className="pr-10 w-64 input-modern"
          />
        </div>

        <Button variant="outline" size="icon" className="relative">
          <Bell className="w-5 h-5" />
          <span className="absolute -top-1 -left-1 w-4 h-4 bg-secondary text-secondary-foreground text-xs rounded-full flex items-center justify-center">
            3
          </span>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-3 hover:opacity-80 transition-opacity">
              <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-semibold">
                {getUserInitial()}
              </div>
              <div className="text-sm text-right">
                <p className="font-semibold">{getUserName()}</p>
                {role && (
                  <Badge variant={roleBadgeVariants[role]} className="text-xs">
                    {roleLabels[role]}
                  </Badge>
                )}
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuLabel className="flex items-center gap-2">
              <User className="w-4 h-4" />
              حسابي
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {role && (
              <>
                <DropdownMenuItem
                  className="flex items-center gap-2"
                  onSelect={() => navigate("/permissions")}
                >
                  <Shield className="w-4 h-4" />
                  الصلاحية: {roleLabels[role] ?? role} (عرض التفاصيل)
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem 
              onClick={signOut}
              className="flex items-center gap-2 text-destructive focus:text-destructive"
            >
              <LogOut className="w-4 h-4" />
              تسجيل الخروج
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
};

export default Header;
