import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Eye, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Order {
  id: string; order_number: string; customer_name_snapshot: string; sales_team: string;
  delivery_date: string | null; delivery_time: string | null; status: string; total: number;
  payment_method: string; payment_status: string; created_at: string;
}

const STATUS: Record<string, { label: string; color: string }> = {
  new: { label: "جديد", color: "bg-blue-500 text-white" },
  in_kitchen: { label: "بالمطبخ", color: "bg-amber-500 text-white" },
  ready: { label: "جاهز", color: "bg-purple-500 text-white" },
  dispatched: { label: "خرج للتوصيل", color: "bg-cyan-500 text-white" },
  delivered: { label: "تم التسليم", color: "bg-emerald-500 text-white" },
  cancelled: { label: "ملغي", color: "bg-destructive text-destructive-foreground" },
};

const CateringOrders = () => {
  const [rows, setRows] = useState<Order[]>([]);

  const load = async () => {
    const { data, error } = await supabase.from("catering_orders").select("*").order("created_at", { ascending: false });
    if (error) return toast.error(error.message);
    setRows((data || []) as Order[]);
  };
  useEffect(() => { load(); }, []);

  const updateStatus = async (id: string, status: string) => {
    const { error } = await supabase.from("catering_orders").update({ status }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("تم تحديث الحالة"); load();
  };

  const remove = async (id: string) => {
    if (!confirm("حذف الطلب؟")) return;
    const { error } = await supabase.from("catering_orders").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load();
  };

  return (
    <DashboardLayout>
      <Header title="طلبات الكاترينج" subtitle="جميع الطلبات الواردة من المبيعات" />
      <div className="mb-4">
        <Button asChild className="bg-gradient-to-r from-primary to-accent gap-2">
          <Link to="/catering/orders/new"><Plus className="w-4 h-4" /> طلب جديد</Link>
        </Button>
      </div>
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>رقم</TableHead><TableHead>العميل</TableHead><TableHead>القسم</TableHead>
            <TableHead>تاريخ التسليم</TableHead><TableHead>الإجمالي</TableHead><TableHead>الدفع</TableHead>
            <TableHead>الحالة</TableHead><TableHead className="text-end">إجراءات</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 ? <TableRow><TableCell colSpan={8} className="text-center py-10 text-muted-foreground">لا توجد طلبات بعد</TableCell></TableRow>
              : rows.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-mono text-xs">{o.order_number}</TableCell>
                  <TableCell className="font-semibold">{o.customer_name_snapshot}</TableCell>
                  <TableCell><Badge variant="secondary">{o.sales_team === "b2b" ? "شركات" : "أفراد"}</Badge></TableCell>
                  <TableCell>{o.delivery_date ? `${o.delivery_date}${o.delivery_time ? " " + o.delivery_time.slice(0, 5) : ""}` : "-"}</TableCell>
                  <TableCell className="font-bold text-primary">{Number(o.total).toLocaleString()} ر.س</TableCell>
                  <TableCell><Badge variant="outline">{o.payment_method === "bank_transfer" ? "تحويل" : o.payment_method === "cash" ? "نقدي" : "آجل"}</Badge></TableCell>
                  <TableCell>
                    <select className="bg-background border rounded px-2 py-1 text-xs" value={o.status} onChange={(e) => updateStatus(o.id, e.target.value)}>
                      {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                  </TableCell>
                  <TableCell className="text-end">
                    <Button variant="ghost" size="icon" onClick={() => remove(o.id)} className="text-destructive"><Trash2 className="w-4 h-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </CardContent></Card>
    </DashboardLayout>
  );
};
export default CateringOrders;
