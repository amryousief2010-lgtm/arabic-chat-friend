import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollText, Search } from "lucide-react";
import { Link } from "react-router-dom";

interface AuditRow {
  id: string;
  order_id: string | null;
  order_number: string | null;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  changed_by_name: string | null;
  changed_at: string;
}

const fieldLabels: Record<string, string> = {
  payment_status: "حالة الدفع",
  collection_status: "حالة التحصيل",
};

const paymentVal: Record<string, string> = {
  paid: "مدفوع",
  pending: "قيد الانتظار",
  failed: "فشل",
};

const collectionVal: Record<string, string> = {
  collected: "تم التحصيل",
  not_collected: "لم يتم التحصيل",
};

const formatValue = (field: string, val: string | null) => {
  if (!val) return "-";
  if (field === "payment_status") return paymentVal[val] || val;
  if (field === "collection_status") return collectionVal[val] || val;
  return val;
};

const OrderStatusAudit = () => {
  const [search, setSearch] = useState("");
  const [filterField, setFilterField] = useState<string>("all");

  const { data: audits = [], isLoading } = useQuery({
    queryKey: ["order-status-audit"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("order_status_audit" as any)
        .select("*")
        .order("changed_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data || []) as unknown as AuditRow[];
    },
  });

  const filtered = useMemo(() => {
    return audits.filter((a) => {
      if (filterField !== "all" && a.field_name !== filterField) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase().trim();
      return (
        a.order_number?.toLowerCase().includes(q) ||
        a.changed_by_name?.toLowerCase().includes(q)
      );
    });
  }, [audits, search, filterField]);

  return (
    <DashboardLayout>
      <Header
        title="سجل تدقيق حالات الطلبات"
        subtitle="كل تغيير في حالة الدفع وحالة التحصيل مع المستخدم والوقت"
      />

      <Card className="glass-card">
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle className="flex items-center gap-2 text-base">
            <ScrollText className="w-5 h-5 text-primary" />
            السجل ({filtered.length})
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-64">
              <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="بحث برقم الطلب أو المستخدم..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pr-9"
              />
            </div>
            <Select value={filterField} onValueChange={setFilterField}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="نوع التغيير" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل التغييرات</SelectItem>
                <SelectItem value="payment_status">حالة الدفع</SelectItem>
                <SelectItem value="collection_status">حالة التحصيل</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">جارٍ التحميل...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">لا توجد تغييرات</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">رقم الطلب</TableHead>
                  <TableHead className="text-right">الحقل</TableHead>
                  <TableHead className="text-right">القيمة السابقة</TableHead>
                  <TableHead className="text-right">القيمة الجديدة</TableHead>
                  <TableHead className="text-right">بواسطة</TableHead>
                  <TableHead className="text-right">التاريخ والوقت</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono">
                      {a.order_id ? (
                        <Link to={`/orders/${a.order_id}`} className="text-primary hover:underline">
                          {a.order_number || "-"}
                        </Link>
                      ) : (
                        a.order_number || "-"
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{fieldLabels[a.field_name] || a.field_name}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatValue(a.field_name, a.old_value)}
                    </TableCell>
                    <TableCell className="font-semibold">
                      {formatValue(a.field_name, a.new_value)}
                    </TableCell>
                    <TableCell>{a.changed_by_name || "نظام"}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(a.changed_at).toLocaleString("ar-EG")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </DashboardLayout>
  );
};

export default OrderStatusAudit;
