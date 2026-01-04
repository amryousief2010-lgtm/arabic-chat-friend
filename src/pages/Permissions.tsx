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
  | "edit_prices"
  | "create_orders"
  | "update_order_status"
  | "view_reports"
  | "manage_sales_targets"
  | "manage_offers";

const permissionLabels: Record<PermissionKey, string> = {
  manage_employees: "إدارة الموظفين",
  manage_products: "إدارة المنتجات",
  edit_prices: "تعديل الأسعار",
  create_orders: "إنشاء الطلبات",
  update_order_status: "تحديث حالة الطلب",
  view_reports: "عرض التقارير",
  manage_sales_targets: "إدارة أهداف المبيعات",
  manage_offers: "إدارة صناديق العروض",
};

const roleLabels: Record<string, string> = {
  general_manager: "المدير العام",
  executive_manager: "المدير التنفيذي",
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
    edit_prices: false,
    create_orders: false,
    update_order_status: true,
    view_reports: false,
    manage_sales_targets: false,
    manage_offers: false,
  },
  sales_moderator: {
    manage_employees: false,
    manage_products: false,
    edit_prices: false,
    create_orders: true,
    update_order_status: false,
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
                {(Object.keys(permissionLabels) as PermissionKey[]).map((perm) => (
                  <TableRow key={perm}>
                    <TableCell className="font-medium whitespace-nowrap">
                      {permissionLabels[perm]}
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
