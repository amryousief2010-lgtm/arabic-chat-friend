import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Loader2, Package } from "lucide-react";

const MOD: Record<string, string> = { meat: "اللحوم", feed: "الأعلاف", shared: "مشترك" };

export default function PackagingMaterials() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("packaging_materials").select("*").order("code");
      if (error) toast.error(error.message); else setItems(data ?? []);
      setLoading(false);
    })();
  }, []);

  return (
    <DashboardLayout>
      <div className="space-y-4 p-4">
        <div className="flex items-center gap-2">
          <Package className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold">مواد التعبئة والتغليف</h1>
        </div>
        <p className="text-muted-foreground text-sm">
          كتالوج موحد للأكياس والعلب والأطباق المستخدمة في مصنعَي اللحوم والأعلاف. التغليف يدخل في تكلفة المنتج ولا يدخل في نسبة الخلطة الغذائية.
        </p>

        <Card>
          <CardHeader><CardTitle>الأصناف ({items.length})</CardTitle></CardHeader>
          <CardContent>
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الكود</TableHead>
                    <TableHead>الاسم</TableHead>
                    <TableHead>الوحدة</TableHead>
                    <TableHead className="text-end">الرصيد</TableHead>
                    <TableHead className="text-end">سعر الوحدة</TableHead>
                    <TableHead>القسم</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="font-mono text-xs">{i.code}</TableCell>
                      <TableCell>{i.name_ar}</TableCell>
                      <TableCell>{i.unit}</TableCell>
                      <TableCell className="text-end">{Number(i.stock).toLocaleString("ar-EG")}</TableCell>
                      <TableCell className="text-end">{Number(i.unit_cost).toLocaleString("ar-EG", { maximumFractionDigits: 3 })}</TableCell>
                      <TableCell><Badge variant="outline">{MOD[i.module] ?? i.module}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
