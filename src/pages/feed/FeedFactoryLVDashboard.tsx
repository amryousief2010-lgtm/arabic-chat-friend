import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Factory, TrendingUp, TrendingDown, Boxes, CheckCircle2, AlertTriangle, Wheat, ArrowRightLeft, Building2, Drumstick } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, PieChart, Pie, Cell } from "recharts";
import {
  LV_PERIOD, LV_KPI, LV_FEED_FLOW, LV_INVENTORY, LV_MONTHLY, LV_CHECKS, kpi,
} from "@/data/feedFactoryLV";

const fmtTon = (n: number) => `${Number(n).toLocaleString("en-US", { maximumFractionDigits: 3 })} طن`;
const fmtEgp = (n: number) => `${Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 })} ج.م`;

const COLORS = {
  primary: "hsl(var(--primary))",
  secondary: "hsl(var(--secondary))",
  destructive: "hsl(var(--destructive))",
  muted: "hsl(var(--muted-foreground))",
  green: "#16a34a",
  blue: "#2563eb",
  orange: "#f97316",
  purple: "#9333ea",
};

function StatCard({ icon: Icon, label, value, sub, tone = "primary" }: any) {
  const tones: Record<string, string> = {
    primary: "border-primary/40 bg-primary/5 text-primary",
    secondary: "border-secondary/40 bg-secondary/5 text-secondary",
    orange: "border-orange-500/40 bg-orange-50 text-orange-700",
    green: "border-green-500/40 bg-green-50 text-green-700",
    red: "border-destructive/40 bg-destructive/5 text-destructive",
    purple: "border-purple-500/40 bg-purple-50 text-purple-700",
  };
  return (
    <Card className={`border-2 ${tones[tone]}`}>
      <CardContent className="p-4 space-y-1">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold opacity-80">{label}</div>
          <Icon className="h-5 w-5 opacity-70" />
        </div>
        <div className="text-2xl font-bold">{value}</div>
        {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

export default function FeedFactoryLVDashboard() {
  const allPass = LV_CHECKS.every((c) => c.status === "PASS");

  const distribution = [
    { name: "مبيعات خارجية", value: kpi("external_sales_feed_ton").value, color: COLORS.blue },
    { name: "توريد مزرعة الأمهات", value: kpi("mother_farm_supply_ton").value, color: COLORS.green },
    { name: "سحب تحضين وتسمين", value: kpi("brooding_fattening_withdrawal_ton").value, color: COLORS.orange },
    { name: "سحب المجزر", value: kpi("slaughterhouse_withdrawal_ton").value, color: COLORS.purple },
    { name: "مخزون تام متبقي", value: kpi("finished_goods_inventory_ton").value, color: COLORS.muted },
  ];

  const finishedInv = LV_INVENTORY.filter((i) => i.category === "finished_goods");
  const rawInv = LV_INVENTORY.filter((i) => i.category === "raw_material");

  const flowTypeLabel: Record<string, { ar: string; tone: string }> = {
    external_sale: { ar: "بيع خارجي", tone: "bg-blue-100 text-blue-700" },
    internal_supply: { ar: "توريد داخلي", tone: "bg-green-100 text-green-700" },
    internal_withdrawal: { ar: "سحب داخلي", tone: "bg-orange-100 text-orange-700" },
    ending_inventory_finished: { ar: "مخزون متبقي", tone: "bg-muted text-muted-foreground" },
  };

  return (
    <DashboardLayout>
      <div dir="rtl" className="space-y-5 p-4">
        {/* HEADER */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Factory className="h-7 w-7 text-primary" />لوحة مصنع الأعلاف — ملف LV الرسمي</h1>
            <p className="text-sm text-muted-foreground">
              المصدر: شيتات <code className="font-mono">LV_*</code> فقط — الفترة {LV_PERIOD.start} → {LV_PERIOD.end}
            </p>
          </div>
          <Badge variant={allPass ? "default" : "destructive"} className="text-sm">
            {allPass ? (<><CheckCircle2 className="h-4 w-4 ml-1 inline" />جميع الفحوصات PASS</>) : (<><AlertTriangle className="h-4 w-4 ml-1 inline" />يوجد فحوصات لم تجتز</>)}
          </Badge>
        </div>

        {/* KPI CARDS — المؤشرات الرسمية من LV_KPI (9 مؤشرات) */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-3 gap-3">
          <StatCard icon={Factory}        tone="primary"   label="إجمالي الإنتاج"               value={fmtTon(kpi("total_feed_production_ton").value)}        sub="معدل — يشمل التام المتبقي" />
          <StatCard icon={ArrowRightLeft} tone="orange"    label="إجمالي الموزع/المباع/المسحوب" value={fmtTon(kpi("distributed_sold_transferred_ton").value)} sub="26 + 17 + 1.5 + 1" />
          <StatCard icon={Boxes}          tone="secondary" label="مخزون العلف التام المتبقي"     value={fmtTon(kpi("finished_goods_inventory_ton").value)}     sub="تسمين + باديء" />
          <StatCard icon={Boxes}          tone="purple"    label="مخزون الخامات المتبقي"         value={fmtTon(kpi("raw_material_inventory_ton").value)}       sub="بريمكس + دريس (لا يدخل الإنتاج)" />
          <StatCard icon={Boxes}          tone="green"     label="إجمالي المخزون المتبقي"        value={fmtTon(kpi("total_remaining_inventory_ton").value)}    sub="تام + خامات" />
          <StatCard icon={TrendingDown}   tone="red"       label="إجمالي مشتريات الخامات"        value={fmtEgp(kpi("raw_material_purchases_egp").value)}       sub="بياض + تسمين" />
          <StatCard icon={TrendingUp}     tone="green"     label="إجمالي المبيعات الخارجية"      value={fmtEgp(kpi("external_sales_value_egp").value)}         sub="مبيعات لعملاء خارجيين" />
          <StatCard
            icon={kpi("cash_margin_before_expenses_egp").value >= 0 ? TrendingUp : TrendingDown}
            tone={kpi("cash_margin_before_expenses_egp").value >= 0 ? "green" : "red"}
            label="هامش نقدي تقريبي قبل المصروفات"
            value={fmtEgp(kpi("cash_margin_before_expenses_egp").value)}
            sub="مبيعات خارجية − مشتريات خامات"
          />
          <StatCard
            icon={CheckCircle2}
            tone={kpi("production_balance_variance_ton").value === 0 ? "green" : "red"}
            label="فرق توازن الإنتاج"
            value={`${fmtTon(kpi("production_balance_variance_ton").value)} — ${kpi("production_balance_variance_ton").value === 0 ? "PASS" : "FAIL"}`}
            sub="46.779 = 45.5 + 1.279"
          />
        </div>

        {/* KPI CARDS — تفصيل الحركات بالطن (مرجعي) */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={TrendingUp}  tone="green"     label="مبيعات خارجية — علف تسمين" value={fmtTon(kpi("external_sales_feed_ton").value)} sub="لعملاء خارج الشركة" />
          <StatCard icon={Building2}   tone="secondary" label="توريد مزرعة الأمهات"        value={fmtTon(kpi("mother_farm_supply_ton").value)}  sub="علف بياض" />
          <StatCard icon={Wheat}       tone="purple"    label="سحب تحضين وتسمين"           value={fmtTon(kpi("brooding_fattening_withdrawal_ton").value)} sub="علف باديء" />
          <StatCard icon={Drumstick}   tone="red"       label="سحب المجزر"                  value={fmtTon(kpi("slaughterhouse_withdrawal_ton").value)} sub="علف تسمين للنعام قبل الذبح" />
        </div>

        {/* TABS */}
        <Tabs defaultValue="flow" className="space-y-4">
          <TabsList className="grid grid-cols-2 md:grid-cols-5 w-full">
            <TabsTrigger value="flow">حركة الأعلاف</TabsTrigger>
            <TabsTrigger value="inventory">المخزون المتبقي</TabsTrigger>
            <TabsTrigger value="monthly">الملخص الشهري</TabsTrigger>
            <TabsTrigger value="distribution">توزيع الإنتاج</TabsTrigger>
            <TabsTrigger value="checks">فحوصات صحة البيانات</TabsTrigger>
          </TabsList>

          {/* FLOW */}
          <TabsContent value="flow">
            <Card>
              <CardHeader>
                <CardTitle>LV_FEED_FLOW — كل حركات العلف</CardTitle>
                <CardDescription>المصدر الرسمي للحركات بالطن والكجم وقيمة الجنيه عند توفرها</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>الكود</TableHead><TableHead>النوع</TableHead><TableHead>الحركة</TableHead><TableHead>الجهة</TableHead><TableHead>الصنف</TableHead><TableHead>طن</TableHead><TableHead>كجم</TableHead><TableHead>قيمة (ج.م)</TableHead><TableHead>ملاحظات</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {LV_FEED_FLOW.map((f) => {
                      const t = flowTypeLabel[f.type];
                      return (
                        <TableRow key={f.id}>
                          <TableCell className="font-mono text-xs">{f.id}</TableCell>
                          <TableCell><span className={`px-2 py-0.5 rounded text-xs ${t.tone}`}>{t.ar}</span></TableCell>
                          <TableCell>{f.movement_ar}</TableCell>
                          <TableCell>{f.counterparty}</TableCell>
                          <TableCell>{f.feed_type}</TableCell>
                          <TableCell className="font-bold">{f.qty_ton}</TableCell>
                          <TableCell>{f.qty_kg.toLocaleString("en-US")}</TableCell>
                          <TableCell className="text-left">{f.value_egp != null ? fmtEgp(f.value_egp) : "—"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{f.notes}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* INVENTORY */}
          <TabsContent value="inventory">
            <div className="grid md:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>المخزون التام المتبقي</CardTitle>
                  <CardDescription>{fmtTon(kpi("finished_goods_inventory_ton").value)} — يدخل ضمن إجمالي الإنتاج</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader><TableRow><TableHead>الكود</TableHead><TableHead>الصنف</TableHead><TableHead>طن</TableHead><TableHead>كجم</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {finishedInv.map((i) => (
                        <TableRow key={i.id}>
                          <TableCell className="font-mono text-xs">{i.id}</TableCell>
                          <TableCell>{i.item}</TableCell>
                          <TableCell className="font-bold">{i.qty_ton}</TableCell>
                          <TableCell>{i.qty_kg.toLocaleString("en-US")}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>مخزون الخامات</CardTitle>
                  <CardDescription>{fmtTon(kpi("raw_material_inventory_ton").value)} — <span className="text-destructive font-semibold">لا يدخل ضمن إجمالي الإنتاج</span></CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader><TableRow><TableHead>الكود</TableHead><TableHead>الصنف</TableHead><TableHead>طن</TableHead><TableHead>كجم</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {rawInv.map((i) => (
                        <TableRow key={i.id}>
                          <TableCell className="font-mono text-xs">{i.id}</TableCell>
                          <TableCell>{i.item}</TableCell>
                          <TableCell className="font-bold">{i.qty_ton}</TableCell>
                          <TableCell>{i.qty_kg.toLocaleString("en-US")}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* MONTHLY */}
          <TabsContent value="monthly">
            <Card>
              <CardHeader>
                <CardTitle>LV_MONTHLY — الملخص الشهري</CardTitle>
                <CardDescription>مشتريات الخامات / المبيعات الخارجية / توريد مزرعة الأمهات</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div style={{ height: 320 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={LV_MONTHLY}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month_ar" />
                      <YAxis tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v)} />
                      <Tooltip formatter={(v: number) => fmtEgp(v)} />
                      <Legend />
                      <Bar dataKey="purchases_egp" name="مشتريات خامات" fill={COLORS.orange} />
                      <Bar dataKey="external_sales_egp" name="مبيعات خارجية" fill={COLORS.blue} />
                      <Bar dataKey="mother_farm_value_egp" name="توريد الأمهات (قيمة)" fill={COLORS.green} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>الشهر</TableHead><TableHead>مشتريات خامات (ج.م)</TableHead><TableHead>مبيعات خارجية (ج.م)</TableHead><TableHead>قيمة توريد الأمهات (ج.م)</TableHead><TableHead>طن توريد الأمهات</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {LV_MONTHLY.map((m) => (
                      <TableRow key={m.month}>
                        <TableCell className="font-semibold">{m.month_ar} <span className="text-xs text-muted-foreground font-mono">({m.month})</span></TableCell>
                        <TableCell>{fmtEgp(m.purchases_egp)}</TableCell>
                        <TableCell>{fmtEgp(m.external_sales_egp)}</TableCell>
                        <TableCell>{fmtEgp(m.mother_farm_value_egp)}</TableCell>
                        <TableCell>{m.mother_farm_ton}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-bold bg-muted/50 border-t-2">
                      <TableCell>الإجمالي</TableCell>
                      <TableCell>{fmtEgp(LV_MONTHLY.reduce((s, m) => s + m.purchases_egp, 0))}</TableCell>
                      <TableCell>{fmtEgp(LV_MONTHLY.reduce((s, m) => s + m.external_sales_egp, 0))}</TableCell>
                      <TableCell>{fmtEgp(LV_MONTHLY.reduce((s, m) => s + m.mother_farm_value_egp, 0))}</TableCell>
                      <TableCell>{LV_MONTHLY.reduce((s, m) => s + m.mother_farm_ton, 0).toFixed(3)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* DISTRIBUTION */}
          <TabsContent value="distribution">
            <div className="grid md:grid-cols-2 gap-4">
              <Card>
                <CardHeader><CardTitle>توزيع الإنتاج (طن)</CardTitle><CardDescription>46.779 طن = 45.5 موزع + 1.279 تام متبقي</CardDescription></CardHeader>
                <CardContent style={{ height: 340 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={distribution} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={110} label={(e: any) => `${e.name}: ${e.value}`}>
                        {distribution.map((d, i) => <Cell key={i} fill={d.color} />)}
                      </Pie>
                      <Tooltip formatter={(v: number) => `${v} طن`} />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>قيمة المبيعات والتوريدات (ج.م)</CardTitle></CardHeader>
                <CardContent style={{ height: 340 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart layout="vertical" data={[
                      { name: "مبيعات خارجية", v: kpi("external_sales_value_egp").value, fill: COLORS.blue },
                      { name: "توريد الأمهات (قيمة)", v: kpi("mother_farm_supply_value_egp").value, fill: COLORS.green },
                      { name: "مشتريات الخامات", v: kpi("raw_material_purchases_egp").value, fill: COLORS.orange },
                    ]}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v)} />
                      <YAxis type="category" dataKey="name" width={150} />
                      <Tooltip formatter={(v: number) => fmtEgp(v)} />
                      <Bar dataKey="v" name="القيمة" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* CHECKS */}
          <TabsContent value="checks">
            <Card>
              <CardHeader>
                <CardTitle>LV_CHECKS — فحوصات صحة البيانات</CardTitle>
                <CardDescription>لا يُعتمد أي رقم إذا كان فحصه ليس PASS</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>الكود</TableHead><TableHead>الفحص</TableHead><TableHead>القيمة</TableHead><TableHead>الوحدة</TableHead><TableHead>الحالة</TableHead><TableHead>التفصيل</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {LV_CHECKS.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-mono text-xs">{c.id}</TableCell>
                        <TableCell>{c.ar}</TableCell>
                        <TableCell className="font-bold">{c.value}</TableCell>
                        <TableCell>{c.unit}</TableCell>
                        <TableCell>
                          <Badge variant={c.status === "PASS" ? "default" : "destructive"}>
                            {c.status === "PASS" ? <CheckCircle2 className="h-3 w-3 ml-1 inline" /> : <AlertTriangle className="h-3 w-3 ml-1 inline" />}
                            {c.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{c.notes}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* KPI TABLE (RAW) */}
        <Card>
          <CardHeader>
            <CardTitle>LV_KPI — كل المؤشرات الخام</CardTitle>
            <CardDescription>نسخة كاملة من الجدول الرسمي للمؤشرات</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow>
                <TableHead>المفتاح</TableHead><TableHead>المؤشر</TableHead><TableHead>القيمة</TableHead><TableHead>الوحدة</TableHead><TableHead>المصدر</TableHead><TableHead>ملاحظات</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {LV_KPI.map((k) => (
                  <TableRow key={k.key}>
                    <TableCell className="font-mono text-xs">{k.key}</TableCell>
                    <TableCell>{k.ar}</TableCell>
                    <TableCell className="font-bold">{k.unit === "EGP" ? fmtEgp(k.value) : `${k.value}`}</TableCell>
                    <TableCell>{k.unit}</TableCell>
                    <TableCell className="text-xs">{k.source}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{k.notes}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
