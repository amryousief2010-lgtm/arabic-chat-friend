import { useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Boxes, Beef, Package, Activity, ClipboardList, FileText } from "lucide-react";

/**
 * المخزون الموحد لمصنع اللحوم
 * صفحة جامعة تعرض كل شاشات مخازن مصنع اللحوم كـ Tabs داخل نفس الصفحة،
 * بدون تعديل أي منطق أو بيانات داخل الشاشات الأصلية. كل تبويب يفتح الصفحة
 * الأصلية في إطار مدمج (?embed=1) فلا تتكرر القائمة الجانبية.
 */
const TABS = [
  { value: "overview", label: "نظرة عامة",            icon: Boxes,         src: "/meat-factory/inventory?embed=1" },
  { value: "raw",      label: "خامات / بهارات / تغليف", icon: Beef,          src: "/meat-factory/factory-warehouses?embed=1" },
  { value: "pack",     label: "مواد التغليف والتعبئة",  icon: Package,       src: "/meat-factory/packaging-inventory?embed=1" },
  { value: "moves",    label: "سجل الحركات",            icon: Activity,      src: "/modules/warehouses/movements-log?embed=1" },
  { value: "stock",    label: "جرد وتسوية المخزون",     icon: ClipboardList, src: "/modules/warehouses/stocktaking?embed=1" },
  { value: "reports",  label: "التقارير",               icon: FileText,      src: "/meat-factory/reports?embed=1" },
] as const;

export default function UnifiedMeatInventory() {
  const [tab, setTab] = useState<string>("overview");
  const [loaded, setLoaded] = useState<Record<string, boolean>>({ overview: true });

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Boxes className="w-7 h-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">المخزون الموحد لمصنع اللحوم</h1>
            <p className="text-sm text-muted-foreground">كل شاشات مخازن مصنع اللحوم في صفحة واحدة</p>
          </div>
        </div>

        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v);
            setLoaded((p) => ({ ...p, [v]: true }));
          }}
        >
          <TabsList className="flex flex-wrap h-auto justify-start gap-1 bg-muted/60">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="gap-2">
                <t.icon className="w-4 h-4" />
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {TABS.map((t) => (
            <TabsContent key={t.value} value={t.value} className="mt-3">
              <div className="w-full rounded-lg border bg-card overflow-hidden">
                {loaded[t.value] ? (
                  <iframe
                    src={t.src}
                    title={t.label}
                    className="w-full"
                    style={{ height: "calc(100vh - 220px)", minHeight: 600, border: 0 }}
                  />
                ) : null}
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
