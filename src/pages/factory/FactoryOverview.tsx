import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import StatCard from "@/components/dashboard/StatCard";
import FactoryFilters, { defaultFilterState, FactoryFilterState } from "@/components/factory/FactoryFilters";
import { useFactoryData } from "@/hooks/useFactoryData";
import { Factory, Wheat, Banknote, Package, CheckCircle, AlertTriangle, Clock } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import DashboardLayout from "@/components/layout/DashboardLayout";

const PURPLE = "#7c3aed"; const ORANGE = "#ea580c";

export default function FactoryOverview() {
  const [f, setF] = useState<FactoryFilterState>(defaultFilterState());
  const { meat, feed, meatCons, meatPack, feedCons, movs, items } = useFactoryData(f.from, f.to);

  const k = useMemo(() => {
    const meatClosed = meat.filter((b: any) => b.status === "closed");
    const feedClosed = feed.filter((b: any) => b.status === "closed");
    const productionValue =
      meatClosed.reduce((s: number, b: any) => s + Number(b.total_cost || 0), 0) +
      feedClosed.reduce((s: number, b: any) => s + Number(b.total_cost || 0), 0);
    const rawValueConsumed =
      meatCons.reduce((s: number, c: any) => s + Number(c.line_total || 0), 0) +
      meatPack.reduce((s: number, c: any) => s + Number(c.line_total || 0), 0) +
      feedCons.reduce((s: number, c: any) => s + Number(c.total_cost || 0), 0);
    const finishedReceived = movs.filter((m: any) => m.movement_type === "production_in").reduce((s: number, m: any) => s + Number(m.total_cost || 0), 0);
    const batchesClosed = meatClosed.length + feedClosed.length;
    const pendingApproval = meat.filter((b: any) => b.status === "under_review").length + feed.filter((b: any) => b.status === "under_review").length;
    const reviewIssues = items.filter((i: any) => Number(i.unit_cost) === 0 && Number(i.stock) > 0).length;
    const inventoryValuation = items.reduce((s: number, i: any) => s + Number(i.stock || 0) * Number(i.unit_cost || 0), 0);
    return { productionValue, rawValueConsumed, finishedReceived, batchesClosed, pendingApproval, reviewIssues, inventoryValuation };
  }, [meat, feed, meatCons, meatPack, feedCons, movs, items]);

  const split = [
    { name: "Meat", value: meat.filter((b: any) => b.status === "closed").reduce((s: number, b: any) => s + Number(b.total_cost || 0), 0) },
    { name: "Feed", value: feed.filter((b: any) => b.status === "closed").reduce((s: number, b: any) => s + Number(b.total_cost || 0), 0) },
  ];

  return (
    <DashboardLayout>
    <div dir="rtl" className="p-4 md:p-6 space-y-4">
      <h1 className="text-2xl font-bold">نظرة عامة على المصانع</h1>
      <FactoryFilters value={f} onChange={setF} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard title="قيمة الإنتاج" value={k.productionValue.toLocaleString("en-US", { maximumFractionDigits: 0 })} icon={Banknote} iconColor="bg-primary" />
        <StatCard title="قيمة المواد المستهلكة" value={k.rawValueConsumed.toLocaleString("en-US", { maximumFractionDigits: 0 })} icon={Package} iconColor="bg-secondary" />
        <StatCard title="قيمة الإنتاج التام المستلم" value={k.finishedReceived.toLocaleString("en-US", { maximumFractionDigits: 0 })} icon={CheckCircle} iconColor="bg-success" />
        <StatCard title="إجمالي تقييم المخزون" value={k.inventoryValuation.toLocaleString("en-US", { maximumFractionDigits: 0 })} icon={Banknote} iconColor="bg-accent" />
        <StatCard title="دفعات مغلقة" value={k.batchesClosed} icon={CheckCircle} to="/factories/reports?tab=batches" />
        <StatCard title="بانتظار الاعتماد" value={k.pendingApproval} icon={Clock} iconColor="bg-warning" />
        <StatCard title="مشاكل جودة بيانات" value={k.reviewIssues} icon={AlertTriangle} iconColor="bg-destructive" to="/factories/reports?tab=pending" />
        <StatCard title="مصانع نشطة" value={2} icon={Factory} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card><CardHeader><CardTitle className="text-base">تكلفة الإنتاج: لحوم مقابل أعلاف</CardTitle></CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer><BarChart data={split}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis /><Tooltip /><Bar dataKey="value" fill={PURPLE} /></BarChart></ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">روابط سريعة</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 text-sm">
            <Link to="/meat-factory/dashboard" className="p-3 border rounded hover:bg-muted flex items-center gap-2"><Factory className="h-4 w-4" /> لوحة اللحوم</Link>
            <Link to="/feed-factory/dashboard" className="p-3 border rounded hover:bg-muted flex items-center gap-2"><Wheat className="h-4 w-4" /> لوحة الأعلاف</Link>
            <Link to="/factories/reports" className="p-3 border rounded hover:bg-muted flex items-center gap-2"><Package className="h-4 w-4" /> تقارير الإنتاج</Link>
            <Link to="/inventory" className="p-3 border rounded hover:bg-muted flex items-center gap-2"><Package className="h-4 w-4" /> محرك المخزون</Link>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">إشعار حوكمة</CardTitle></CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-1">
          <p>• كل تغيير على المخزون يجب أن يمر عبر <code>inventory_movements</code> فقط.</p>
          <p>• التعديلات أو العكس (reversal) تتم بحركة عكسية، وليس بالحذف.</p>
          <p>• BOM v2 لم يتم تفعيلها تلقائياً. الفاتورة 164 لا تزال needs_review.</p>
          <p>• بيانات الاختبار (TEST-DISPATCH) محفوظة في النظام ومستبعدة افتراضياً من المؤشرات.</p>
        </CardContent>
      </Card>
    </div>
  );
}
