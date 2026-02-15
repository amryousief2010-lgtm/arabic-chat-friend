import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  Legend,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
} from "recharts";
import { GitCompareArrows, DollarSign, ShoppingCart, Target, TrendingUp } from "lucide-react";

interface ModeratorData {
  name: string;
  sales: number;
  orders: number;
  percent: number;
}

interface MonthlyData {
  month: string;
  sales: number;
  orders: number;
}

const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "0.75rem",
  direction: "rtl" as const,
};

const COLOR_A = "hsl(var(--primary))";
const COLOR_B = "hsl(var(--success))";

interface Props {
  moderators: ModeratorData[];
  monthlyData: Record<string, MonthlyData[]>;
  onClose: () => void;
}

const ModeratorComparison = ({ moderators, monthlyData, onClose }: Props) => {
  const [modA, setModA] = useState<string>(moderators[0]?.name || "");
  const [modB, setModB] = useState<string>(moderators[1]?.name || "");

  const dataA = moderators.find((m) => m.name === modA);
  const dataB = moderators.find((m) => m.name === modB);
  const monthlyA = monthlyData[modA] || [];
  const monthlyB = monthlyData[modB] || [];

  // Combined monthly chart data
  const combinedMonthly = monthlyA.map((a, i) => ({
    month: a.month,
    [`مبيعات ${modA}`]: a.sales,
    [`مبيعات ${modB}`]: monthlyB[i]?.sales || 0,
    [`طلبات ${modA}`]: a.orders,
    [`طلبات ${modB}`]: monthlyB[i]?.orders || 0,
  }));

  // Radar data for overall comparison
  const maxSales = Math.max(...moderators.map((m) => m.sales));
  const maxOrders = Math.max(...moderators.map((m) => m.orders));
  const radarData = dataA && dataB ? [
    { metric: "المبيعات", [modA]: Math.round((dataA.sales / maxSales) * 100), [modB]: Math.round((dataB.sales / maxSales) * 100) },
    { metric: "الطلبات", [modA]: Math.round((dataA.orders / maxOrders) * 100), [modB]: Math.round((dataB.orders / maxOrders) * 100) },
    { metric: "متوسط الطلب", [modA]: Math.round((dataA.sales / dataA.orders) / 20), [modB]: Math.round((dataB.sales / dataB.orders) / 20) },
    { metric: "الحصة %", [modA]: dataA.percent, [modB]: dataB.percent },
  ] : [];

  const formatSales = (v: number) => {
    if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
    if (v >= 1000) return `${(v / 1000).toFixed(0)}K`;
    return String(v);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <GitCompareArrows className="w-5 h-5 text-primary" />
          مقارنة بين موديراتورين
        </h2>
        <Button variant="ghost" size="sm" onClick={onClose}>إغلاق المقارنة</Button>
      </div>

      {/* Selectors */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="text-sm text-muted-foreground">الموديراتور الأول</label>
          <Select value={modA} onValueChange={setModA}>
            <SelectTrigger className="input-modern">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {moderators.map((m) => (
                <SelectItem key={m.name} value={m.name} disabled={m.name === modB}>{m.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-sm text-muted-foreground">الموديراتور الثاني</label>
          <Select value={modB} onValueChange={setModB}>
            <SelectTrigger className="input-modern">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {moderators.map((m) => (
                <SelectItem key={m.name} value={m.name} disabled={m.name === modA}>{m.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Stat comparison cards */}
      {dataA && dataB && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "المبيعات", valA: `${(dataA.sales / 1000000).toFixed(1)}M`, valB: `${(dataB.sales / 1000000).toFixed(1)}M`, icon: DollarSign, winner: dataA.sales > dataB.sales ? "A" : "B" },
            { label: "الطلبات", valA: dataA.orders.toLocaleString(), valB: dataB.orders.toLocaleString(), icon: ShoppingCart, winner: dataA.orders > dataB.orders ? "A" : "B" },
            { label: "متوسط الطلب", valA: `${Math.round(dataA.sales / dataA.orders)}`, valB: `${Math.round(dataB.sales / dataB.orders)}`, icon: Target, winner: (dataA.sales / dataA.orders) > (dataB.sales / dataB.orders) ? "A" : "B" },
            { label: "الحصة", valA: `${dataA.percent}%`, valB: `${dataB.percent}%`, icon: TrendingUp, winner: dataA.percent > dataB.percent ? "A" : "B" },
          ].map((stat) => (
            <Card key={stat.label} className="glass-card">
              <CardContent className="pt-4 pb-3 text-center space-y-2">
                <p className="text-xs text-muted-foreground">{stat.label}</p>
                <div className="flex items-center justify-center gap-3">
                  <span className={`text-sm font-bold ${stat.winner === "A" ? "text-primary" : "text-muted-foreground"}`}>{stat.valA}</span>
                  <span className="text-xs text-muted-foreground">vs</span>
                  <span className={`text-sm font-bold ${stat.winner === "B" ? "text-success" : "text-muted-foreground"}`}>{stat.valB}</span>
                </div>
                <div className="flex justify-center gap-1">
                  <div className={`w-2 h-2 rounded-full ${stat.winner === "A" ? "bg-primary" : "bg-muted"}`} />
                  <div className={`w-2 h-2 rounded-full ${stat.winner === "B" ? "bg-success" : "bg-muted"}`} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Monthly Sales Comparison */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-base">مقارنة المبيعات الشهرية</CardTitle>
          </CardHeader>
          <CardContent>
            {combinedMonthly.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={combinedMonthly}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={10} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickFormatter={formatSales} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v.toLocaleString()} ج.م`]} />
                  <Legend />
                  <Bar dataKey={`مبيعات ${modA}`} fill={COLOR_A} radius={[4, 4, 0, 0]} />
                  <Bar dataKey={`مبيعات ${modB}`} fill={COLOR_B} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-center text-muted-foreground py-20">لا توجد بيانات شهرية</p>
            )}
          </CardContent>
        </Card>

        {/* Monthly Orders Comparison */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-base">مقارنة الطلبات الشهرية</CardTitle>
          </CardHeader>
          <CardContent>
            {combinedMonthly.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={combinedMonthly}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={10} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v} طلب`]} />
                  <Legend />
                  <Line type="monotone" dataKey={`طلبات ${modA}`} stroke={COLOR_A} strokeWidth={3} dot={{ fill: COLOR_A }} />
                  <Line type="monotone" dataKey={`طلبات ${modB}`} stroke={COLOR_B} strokeWidth={3} dot={{ fill: COLOR_B }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-center text-muted-foreground py-20">لا توجد بيانات شهرية</p>
            )}
          </CardContent>
        </Card>

        {/* Radar Chart */}
        {radarData.length > 0 && (
          <Card className="glass-card lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">مقارنة شاملة</CardTitle>
            </CardHeader>
            <CardContent className="flex justify-center">
              <ResponsiveContainer width="100%" height={350}>
                <RadarChart data={radarData}>
                  <PolarGrid stroke="hsl(var(--border))" />
                  <PolarAngleAxis dataKey="metric" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <PolarRadiusAxis stroke="hsl(var(--muted-foreground))" fontSize={10} />
                  <Radar name={modA} dataKey={modA} stroke={COLOR_A} fill={COLOR_A} fillOpacity={0.2} strokeWidth={2} />
                  <Radar name={modB} dataKey={modB} stroke={COLOR_B} fill={COLOR_B} fillOpacity={0.2} strokeWidth={2} />
                  <Legend />
                  <Tooltip contentStyle={tooltipStyle} />
                </RadarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default ModeratorComparison;
