import { useEffect, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";

const CateringInvoices = () => {
  const [mfg, setMfg] = useState<Array<{ id: string; invoice_number: string; total_cost: number; created_at: string }>>([]);
  const [sales, setSales] = useState<Array<{ id: string; invoice_number: string; total: number; payment_status: string; created_at: string }>>([]);

  useEffect(() => {
    supabase.from("catering_manufacturing_invoices").select("*").order("created_at", { ascending: false })
      .then(({ data }) => setMfg((data || []) as typeof mfg));
    supabase.from("catering_sales_invoices").select("*").order("created_at", { ascending: false })
      .then(({ data }) => setSales((data || []) as typeof sales));
  }, []);

  return (
    <DashboardLayout>
      <Header title="الفواتير" subtitle="فواتير التصنيع وفواتير البيع" />
      <Tabs defaultValue="sales">
        <TabsList className="mb-4">
          <TabsTrigger value="sales">فواتير البيع</TabsTrigger>
          <TabsTrigger value="mfg">فواتير التصنيع</TabsTrigger>
        </TabsList>
        <TabsContent value="sales">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>رقم</TableHead><TableHead>الإجمالي</TableHead><TableHead>الدفع</TableHead><TableHead>التاريخ</TableHead></TableRow></TableHeader>
              <TableBody>
                {sales.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center py-10 text-muted-foreground">لا توجد فواتير بيع بعد</TableCell></TableRow>
                  : sales.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="font-mono">{i.invoice_number}</TableCell>
                      <TableCell className="font-bold">{Number(i.total).toLocaleString()} ر.س</TableCell>
                      <TableCell><Badge variant={i.payment_status === "paid" ? "default" : "secondary"}>{i.payment_status}</Badge></TableCell>
                      <TableCell>{new Date(i.created_at).toLocaleDateString("ar-EG")}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
        <TabsContent value="mfg">
          <Card><CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>رقم</TableHead><TableHead>التكلفة الإجمالية</TableHead><TableHead>التاريخ</TableHead></TableRow></TableHeader>
              <TableBody>
                {mfg.length === 0 ? <TableRow><TableCell colSpan={3} className="text-center py-10 text-muted-foreground">لا توجد فواتير تصنيع بعد</TableCell></TableRow>
                  : mfg.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="font-mono">{i.invoice_number}</TableCell>
                      <TableCell className="font-bold">{Number(i.total_cost).toLocaleString()} ر.س</TableCell>
                      <TableCell>{new Date(i.created_at).toLocaleDateString("ar-EG")}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </DashboardLayout>
  );
};
export default CateringInvoices;
