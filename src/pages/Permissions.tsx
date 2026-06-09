import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";

type PermissionKey =
  | "manage_employees"
  | "manage_products"
  | "manage_stock"
  | "edit_prices"
  | "create_orders"
  | "update_order_status"
  | "view_reports"
  | "manage_sales_targets"
  | "manage_offers";

const permissionDetails: Record<PermissionKey, { label: string; description: string }> = {
  manage_employees: {
    label: "إدارة الموظفين",
    description: "إضافة وتعديل وحذف حسابات الموظفين وتغيير أدوارهم",
  },
  manage_products: {
    label: "إدارة المنتجات",
    description: "إضافة منتجات جديدة وتعديل بياناتها وحذفها",
  },
  manage_stock: {
    label: "إدارة المخزون",
    description: "إضافة وتخفيض كميات المنتجات حسب رصيد المستودع",
  },
  edit_prices: {
    label: "تعديل الأسعار",
    description: "تغيير أسعار المنتجات في النظام",
  },
  create_orders: {
    label: "إنشاء الطلبات",
    description: "إنشاء طلبات جديدة للعملاء",
  },
  update_order_status: {
    label: "تحديث حالة الطلب",
    description: "تغيير حالة الطلب (المدراء لجميع الطلبات - المندوب لطلباته فقط)",
  },
  view_reports: {
    label: "عرض التقارير",
    description: "الوصول إلى تقارير المبيعات والأداء المالي",
  },
  manage_sales_targets: {
    label: "إدارة أهداف المبيعات",
    description: "تحديد الأهداف الشهرية للمندوبين ومتابعة تحقيقها",
  },
  manage_offers: {
    label: "إدارة صناديق العروض",
    description: "إنشاء وتعديل صناديق العروض الترويجية",
  },
};

const roleLabels: Record<string, string> = {
  general_manager: "المدير العام",
  executive_manager: "المدير التنفيذي",
  production_manager: "مدير الإنتاج والتشغيل",
  marketing_sales_manager: "مدير المبيعات",
  financial_manager: "المدير المالي",
  quality_manager: "مدير الجودة",
  sales_manager: "مدير المبيعات",
  sales_moderator: "مندوب مبيعات",
  accountant: "المحاسب",
  warehouse_supervisor: "مشرف المخزن",
};

const rolesOrder = [
  "general_manager",
  "executive_manager",
  "sales_manager",
  "accountant",
  "warehouse_supervisor",
  "sales_moderator",
] as const;

const permissionsMatrix: Record<(typeof rolesOrder)[number], Record<PermissionKey, boolean>> = {
  general_manager: {
    manage_employees: true,
    manage_products: true,
    manage_stock: true,
    edit_prices: true,
    create_orders: true,
    update_order_status: true,
    view_reports: true,
    manage_sales_targets: true,
    manage_offers: true,
  },
  executive_manager: {
    manage_employees: false,
    manage_products: true,
    manage_stock: true,
    edit_prices: true,
    create_orders: true,
    update_order_status: true,
    view_reports: true,
    manage_sales_targets: true,
    manage_offers: true,
  },
  sales_manager: {
    manage_employees: false,
    manage_products: true,
    manage_stock: false,
    edit_prices: true,
    create_orders: true,
    update_order_status: false,
    view_reports: true,
    manage_sales_targets: true,
    manage_offers: true,
  },
  accountant: {
    manage_employees: false,
    manage_products: false,
    manage_stock: false,
    edit_prices: true,
    create_orders: false,
    update_order_status: false,
    view_reports: true,
    manage_sales_targets: false,
    manage_offers: false,
  },
  warehouse_supervisor: {
    manage_employees: false,
    manage_products: true,
    manage_stock: true,
    edit_prices: false,
    create_orders: false,
    update_order_status: false,
    view_reports: true,
    manage_sales_targets: false,
    manage_offers: false,
  },
  sales_moderator: {
    manage_employees: false,
    manage_products: false,
    manage_stock: false,
    edit_prices: false,
    create_orders: true,
    update_order_status: true, // Only for their own orders
    view_reports: false,
    manage_sales_targets: false,
    manage_offers: false,
  },
};

const YesNoBadge = ({ value }: { value: boolean }) => (
  <Badge variant={value ? "secondary" : "outline"}>
    {value ? "نعم" : "لا"}
  </Badge>
);

export default function Permissions() {
  const { role } = useAuth();

  return (
    <DashboardLayout>
      <Header title="الصلاحيات" subtitle="عرض صلاحيات كل دور في النظام" />

      <Card className="glass-card">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>مصفوفة الصلاحيات</CardTitle>
          {role && (
            <Badge variant="default">دورك الحالي: {roleLabels[role] ?? role}</Badge>
          )}
        </CardHeader>
        <CardContent>
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">الصلاحية</TableHead>
                  {rolesOrder.map((r) => (
                    <TableHead key={r} className="whitespace-nowrap">
                      {roleLabels[r]}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(Object.keys(permissionDetails) as PermissionKey[]).map((perm) => (
                  <TableRow key={perm}>
                    <TableCell className="min-w-[200px]">
                      <div className="font-medium">{permissionDetails[perm].label}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {permissionDetails[perm].description}
                      </div>
                    </TableCell>
                    {rolesOrder.map((r) => (
                      <TableCell key={r}>
                        <YesNoBadge value={permissionsMatrix[r][perm]} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </DashboardLayout>
  );
}
