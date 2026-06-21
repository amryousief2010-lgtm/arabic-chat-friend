import { useState } from "react";
import {
  Warehouse,
  Activity,
  Package,
  MapPin,
  CalendarClock,
  BookOpen,
  LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface TabItem {
  id: string;
  icon: LucideIcon;
  label: string;
  path: string;
}

const TABS: TabItem[] = [
  { id: "main", icon: Warehouse, label: "المخزن الرئيسي", path: "/warehouse-stock/main" },
  { id: "agouza", icon: Warehouse, label: "مخزن العجوزة", path: "/warehouse-stock/agouza" },
  { id: "hht", icon: Warehouse, label: "هايبر هيلثي تيست", path: "/warehouse-stock/hyper-healthy-test" },
  { id: "carrefour", icon: Warehouse, label: "هايبر كارفور", path: "/warehouse-stock/hyper-carrefour" },
  { id: "activity", icon: Activity, label: "سجل حركات المخزن الرئيسي", path: "/main-warehouse-activity" },
  { id: "opening", icon: Package, label: "الرصيد الافتتاحي للمخازن", path: "/modules/warehouses/opening-balance" },
  { id: "operational", icon: CalendarClock, label: "تواريخ بداية التشغيل الفعلي", path: "/modules/warehouses/operational-dates" },
  { id: "packaging", icon: Package, label: "مخزن التغليف والتعبئة", path: "/modules/packaging" },
  { id: "by-location", icon: MapPin, label: "المخازن حسب الموقع الجغرافي", path: "/modules/warehouses/by-location" },
  { id: "guide", icon: BookOpen, label: "دليل تشغيل المخزن الرئيسي", path: "/warehouse-stock/main/guide" },
];

const WarehouseManagementHub = () => {
  const [active, setActive] = useState<string>(TABS[0].id);
  const activeTab = TABS.find((t) => t.id === active) ?? TABS[0];

  // Build embed URL with a flag so embedded pages can hide their own chrome if they choose
  const embedUrl = `${activeTab.path}?embed=1`;

  return (
    <div className="p-4 md:p-6 space-y-4" dir="rtl">
      <div className="space-y-1">
        <h1 className="text-2xl md:text-3xl font-bold text-foreground">إدارة المخازن</h1>
        <p className="text-sm text-muted-foreground">
          اختر القسم من الأعلى ليظهر محتواه أسفل الأزرار مباشرة.
        </p>
      </div>

      {/* Horizontal scrollable tabs */}
      <div className="border-b border-border">
        <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-thin">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = tab.id === active;
            return (
              <button
                key={tab.id}
                onClick={() => setActive(tab.id)}
                className={cn(
                  "flex items-center gap-2 whitespace-nowrap px-4 py-2 rounded-lg text-sm font-medium transition-all border",
                  isActive
                    ? "bg-primary text-primary-foreground border-primary shadow-md"
                    : "bg-card text-foreground border-border hover:bg-accent hover:border-primary/40",
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Embedded page content */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <iframe
          key={activeTab.id}
          src={embedUrl}
          title={activeTab.label}
          className="w-full"
          style={{ height: "calc(100vh - 220px)", minHeight: "600px", border: "none" }}
        />
      </div>
    </div>
  );
};

export default WarehouseManagementHub;
