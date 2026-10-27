import { Link, useLocation } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  Users, Network, CalendarDays, MapPin, ShoppingCart, Megaphone, Scissors, Factory, Egg, Sprout, Wallet,
  Warehouse, Truck, Headphones, ShieldCheck, Crown, Building2, Monitor, UserCog, Briefcase,
} from "lucide-react";
import UserAvatar from "@/components/UserAvatar";
import { BRAND, BRAND_CYCLE, BRAND_GRADIENT, SCALE, tint } from "@/lib/hr/brand";
import { initialOf } from "@/lib/hr/directory";
import { cn } from "@/lib/utils";

/** أيقونة احترافية لكل قسم معتمد */
export const DEPT_ICONS: Record<string, LucideIcon> = {
  executive: Crown, sales: ShoppingCart, customer_service: Headphones, shipping: Truck, marketing: Megaphone,
  finance: Wallet, operations: Factory, farm: Sprout, hatchery: Egg, slaughterhouse: Scissors,
  meat_factory: Factory, warehouses: Warehouse, support: Building2, hr: UserCog, it: Monitor, services: ShieldCheck,
};
export const deptIcon = (code?: string | null): LucideIcon => (code && DEPT_ICONS[code]) || Briefcase;

/** لون ثابت من ألوان الشعار لكل قسم */
export const deptColor = (key: string) => {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return BRAND_CYCLE[h % BRAND_CYCLE.length];
};

export const IconBadge = ({ icon: Icon, color, size = SCALE.xl }: { icon: LucideIcon; color: string; size?: number }) => (
  <div
    className="flex items-center justify-center shrink-0 text-white"
    style={{ width: size, height: size, borderRadius: SCALE.sm, background: color }}
  >
    <Icon style={{ width: size / 1.618, height: size / 1.618 }} strokeWidth={1.8} />
  </div>
);

/** صورة الموظف: صورة الحساب ← صورة ملف الموظف ← الحرف الأول بتدرّج الشعار */
export const EmployeeAvatar = ({
  employeeId, userId, name, size = SCALE.xl, className,
}: { employeeId?: string | null; userId?: string | null; name: string; size?: number; className?: string }) => (
  <div className={cn("relative shrink-0", className)} style={{ width: size, height: size }} data-testid="employee-avatar">
    <UserAvatar
      employeeId={employeeId}
      userId={userId}
      name={initialOf(name)}
      className="w-full h-full"
      fallbackClassName="text-white font-bold"
      fallbackStyle={{ background: BRAND_GRADIENT, fontSize: size / 2.618 }}
    />
  </div>
);

export const StatTile = ({ icon, value, label, hint, color }: { icon: LucideIcon; value: React.ReactNode; label: string; hint?: string; color: string }) => (
  <div className="bg-card border rounded-2xl flex items-center gap-4" style={{ padding: SCALE.lg }}>
    <IconBadge icon={icon} color={color} />
    <div className="min-w-0">
      <div className="text-3xl font-extrabold leading-tight" style={{ color: BRAND.purple }}>{value}</div>
      <div className="text-sm text-muted-foreground">{label}</div>
      {hint && <div className="text-xs text-muted-foreground/80">{hint}</div>}
    </div>
  </div>
);

export const Chip = ({ children, color = BRAND.magenta, className }: { children: React.ReactNode; color?: string; className?: string }) => (
  <span
    className={cn("inline-flex items-center gap-1 rounded-full text-xs font-semibold whitespace-nowrap", className)}
    style={{ background: tint(color), color, padding: `${SCALE.xs / 1.5}px ${SCALE.sm}px` }}
  >
    {children}
  </span>
);

const NAV = [
  { to: "/hr/employees", label: "الموظفون", icon: Users },
  { to: "/org-chart", label: "الهيكل التنظيمي", icon: Network },
  { to: "/hr/payday", label: "مواعيد القبض", icon: CalendarDays },
  { to: "/hr/work-locations", label: "أماكن العمل", icon: MapPin },
];

/** رأس شاشات الموارد البشرية الموحّد + تنقّل بين الشاشات */
export const HrHeader = ({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) => {
  const { pathname } = useLocation();
  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-extrabold" style={{ color: BRAND.purple }}>{title}</h1>
          {subtitle && <p className="text-muted-foreground mt-1">{subtitle}</p>}
        </div>
        {actions && <div className="flex gap-2 flex-wrap">{actions}</div>}
      </div>
      <nav className="flex gap-2 flex-wrap" aria-label="أقسام الموارد البشرية">
        {NAV.map((n) => {
          const active = pathname === n.to || (n.to === "/hr/employees" && pathname.startsWith("/hr/employees/"));
          return (
            <Link
              key={n.to}
              to={n.to}
              className="inline-flex items-center gap-2 rounded-full border text-sm font-semibold transition-colors"
              style={{
                padding: `${SCALE.xs}px ${SCALE.md}px`,
                background: active ? BRAND_GRADIENT : undefined,
                color: active ? "#fff" : BRAND.purple,
                borderColor: active ? "transparent" : tint(BRAND.purple, 0.2),
              }}
            >
              <n.icon className="w-4 h-4" />{n.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
};

export const brandButtonStyle: React.CSSProperties = { background: BRAND_GRADIENT, color: "#fff", border: 0 };
