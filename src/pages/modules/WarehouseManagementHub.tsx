import { Link } from "react-router-dom";
import {
  Warehouse,
  Activity,
  Package,
  MapPin,
  CalendarClock,
  BookOpen,
  LucideIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth, AppRole } from "@/hooks/useAuth";

interface HubCard {
  icon: LucideIcon;
  label: string;
  path: string;
  desc?: string;
  roles?: AppRole[];
}

interface HubGroup {
  title: string;
  cards: HubCard[];
}

const GROUPS: HubGroup[] = [
  {
    title: "المخازن الرئيسية",
    cards: [
      { icon: Warehouse, label: "المخزن الرئيسي", path: "/warehouse-stock/main", desc: "إدارة وعرض رصيد المخزن الرئيسي" },
      { icon: Warehouse, label: "مخزن العجوزة", path: "/warehouse-stock/agouza", desc: "إدارة رصيد مخزن العجوزة" },
      { icon: Warehouse, label: "هايبر هيلثي تيست", path: "/warehouse-stock/hyper-healthy-test", desc: "مخزن العميل — هايبر هيلثي تيست" },
      { icon: Warehouse, label: "هايبر كارفور", path: "/warehouse-stock/hyper-carrefour", desc: "مخزن العميل — هايبر كارفور" },
    ],
  },
  {
    title: "حركة وتشغيل المخزون",
    cards: [
      { icon: Activity, label: "سجل حركات المخزن الرئيسي", path: "/main-warehouse-activity", desc: "كل الحركات الواردة والصادرة" },
      { icon: Package, label: "الرصيد الافتتاحي للمخازن", path: "/modules/warehouses/opening-balance", desc: "إدارة الأرصدة الافتتاحية لكل مخزن" },
      { icon: CalendarClock, label: "تواريخ بداية التشغيل الفعلي", path: "/modules/warehouses/operational-dates", desc: "ضبط تواريخ بداية التشغيل" },
    ],
  },
  {
    title: "مخازن مساعدة",
    cards: [
      { icon: Package, label: "مخزن التغليف والتعبئة", path: "/modules/packaging", desc: "إدارة مواد التغليف والتعبئة" },
      { icon: MapPin, label: "المخازن حسب الموقع الجغرافي", path: "/modules/warehouses/by-location", desc: "عرض المخازن مرتبة جغرافياً" },
    ],
  },
  {
    title: "أدلة وتشغيل",
    cards: [
      { icon: BookOpen, label: "دليل تشغيل المخزن الرئيسي", path: "/warehouse-stock/main/guide", desc: "خطوات تشغيل المخزن الرئيسي" },
    ],
  },
];

const WarehouseManagementHub = () => {
  const { hasAnyRole } = useAuth();

  return (
    <div className="p-4 md:p-6 space-y-8" dir="rtl">
      <div className="space-y-1">
        <h1 className="text-2xl md:text-3xl font-bold text-foreground">إدارة المخازن</h1>
        <p className="text-sm text-muted-foreground">
          لوحة موحّدة لكل صفحات المخازن — اختر الصفحة التي تريد فتحها.
        </p>
      </div>

      {GROUPS.map((group) => (
        <section key={group.title} className="space-y-3">
          <h2 className="text-lg md:text-xl font-semibold text-foreground border-r-4 border-primary pr-3">
            {group.title}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {group.cards
              .filter((c) => !c.roles || hasAnyRole(c.roles))
              .map((card) => {
                const Icon = card.icon;
                return (
                  <Link key={card.path} to={card.path} className="group">
                    <Card className="h-full transition-all hover:shadow-lg hover:border-primary/50 hover:-translate-y-0.5">
                      <CardHeader className="pb-2">
                        <div className="flex items-center gap-3">
                          <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                            <Icon className="w-5 h-5" />
                          </div>
                          <CardTitle className="text-base font-bold">{card.label}</CardTitle>
                        </div>
                      </CardHeader>
                      {card.desc && (
                        <CardContent className="pt-0">
                          <p className="text-xs text-muted-foreground leading-relaxed">{card.desc}</p>
                        </CardContent>
                      )}
                    </Card>
                  </Link>
                );
              })}
          </div>
        </section>
      ))}
    </div>
  );
};

export default WarehouseManagementHub;
