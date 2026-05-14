import { useEffect, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";

interface PO { id: string; po_number: string; status: string; total: number; delivery_to: string; created_at: string; }

const CateringPurchases = () => {
  const [rows, setRows] = useState<PO[]>([]);
  useEffect(() => {
    supabase.from("catering_purchase_orders").select("*").order("created_at", { ascending: false })
      .then(({ data }) => setRows((data || []) as PO[]));
  }, []);
  return (
    <DashboardLayout>
      <Header title="أوامر الشراء" subtitle="من الموردين الخارجيين" />
      <Card><CardContent className="p-0">
        <Table>
          <TableHeader><TableRow>
            <TableHead>رقم</TableHead><TableHead>الحالة</TableHead><TableHead>الوجهة</TableHead><TableHead>الإجمالي</TableHead><TableHead>التاريخ</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center py-10 text-muted-foreground">لا توجد أوامر شراء بعد</TableCell></TableRow>
              : rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono">{p.po_number}</TableCell>
                  <TableCell><Badge variant="secondary">{p.status}</Badge></TableCell>
                  <TableCell>{p.delivery_to === "kitchen" ? "مطبخ" : "مخزن"}</TableCell>
                  <TableCell className="font-bold">{Number(p.total).toLocaleString()} ر.س</TableCell>
                  <TableCell>{new Date(p.created_at).toLocaleDateString("ar-EG")}</TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </CardContent></Card>
    </DashboardLayout>
  );
};
export default CateringPurchases;
