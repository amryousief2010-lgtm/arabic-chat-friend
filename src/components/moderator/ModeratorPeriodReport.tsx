import { useEffect, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  BRAND_ORANGE,
  BRAND_PURPLE,
  CANCELLED_ORDERS_LABEL,
  REGISTERED_ORDERS_LABEL,
  REPORT_PRESETS,
  bestSlugs,
  formatReportPeriod,
  mapModeratorPeriodReport,
  resolveReportRange,
  totalKg,
  viewerMaySeeConversationMetrics,
  visibleMetrics,
  type MetricDef,
  type ModeratorPeriodReport,
  type ReportPreset,
} from "@/lib/moderatorPeriodReport";

const digits = (metric: MetricDef) =>
  metric.id === "value" || metric.id === "aov" ? 0
    : metric.id.endsWith("Reply") || metric.id === "conversion" || metric.id === "answerRate" ? 1
    : metric.id.startsWith("kg") ? 2 : 0;

const show = (metric: MetricDef, value: number | null) =>
  value == null ? "—" : value.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: digits(metric), minimumFractionDigits: digits(metric) });

export function ModeratorPeriodReportView({
  report,
  loading,
  error,
  preset,
  from,
  to,
  onPreset,
  onFrom,
  onTo,
}: {
  report: ModeratorPeriodReport | null;
  loading: boolean;
  error: string | null;
  preset: ReportPreset;
  from: string;
  to: string;
  onPreset: (preset: ReportPreset) => void;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
}) {
  const metrics = report ? visibleMetrics(report) : [];
  return (
    <section dir="rtl" className="mb-8 space-y-4" aria-label="تقرير أداء الموديراتور للفترة">
      <Card className="glass-card border-[#A4288A]/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-base" style={{ color: BRAND_PURPLE }}>تقرير الفترة</CardTitle>
          <p className="text-xs text-muted-foreground">يُحسب على الخادم بتوقيت القاهرة. «تصدير PDF» يطبع هذه الفترة، لا كل سنة 2026.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {REPORT_PRESETS.map((item) => (
              <Button key={item.value} type="button" size="sm" variant={preset === item.value ? "default" : "outline"} onClick={() => onPreset(item.value)}>
                {item.label}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">من
              <Input type="date" dir="ltr" value={from} onChange={(e) => onFrom(e.target.value)} className="w-44" />
            </label>
            <label className="text-sm">إلى
              <Input type="date" dir="ltr" value={to} onChange={(e) => onTo(e.target.value)} className="w-44" />
            </label>
            <span className="text-sm font-medium" style={{ color: BRAND_ORANGE }}>{formatReportPeriod({ from, to })}</span>
          </div>
        </CardContent>
      </Card>

      {loading && <Card><CardContent className="pt-6"><Skeleton className="h-40 w-full" /></CardContent></Card>}
      {!loading && error && <Card><CardContent className="pt-6 text-sm text-destructive">{error}</CardContent></Card>}
      {!loading && !error && report && report.moderators.length === 0 && (
        <Card><CardContent className="pt-6 text-sm text-muted-foreground">لا توجد بنات في هذه الفترة.</CardContent></Card>
      )}
      {!loading && !error && report && report.moderators.length > 0 && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {report.moderators.map((row) => {
              const cancelledBest = bestSlugs(report.moderators, { id: "cancelled", label: CANCELLED_ORDERS_LABEL, conversation: false, lowerIsBetter: true, value: (r) => r.ordersCancelled }).includes(row.slug);
              return (
                <Card key={row.slug} className="glass-card">
                  <CardHeader className="pb-2"><CardTitle className="text-base">{row.name}</CardTitle></CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">{REGISTERED_ORDERS_LABEL}</p>
                      <p className="text-2xl font-bold" style={{ color: BRAND_PURPLE }}>{row.ordersRegistered.toLocaleString("ar-EG-u-nu-latn")}</p>
                    </div>
                    <div style={cancelledBest ? { background: "#fff1eb", color: BRAND_PURPLE, boxShadow: `inset 0 0 0 2px ${BRAND_ORANGE}`, borderRadius: 8, padding: 8 } : undefined}>
                      <p className="text-xs text-muted-foreground">{CANCELLED_ORDERS_LABEL}</p>
                      <p className="text-xl font-bold">{row.ordersCancelled == null ? "—" : row.ordersCancelled.toLocaleString("ar-EG-u-nu-latn")}{cancelledBest ? " الأفضل" : ""}</p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <Card className="glass-card">
            <CardHeader><CardTitle className="text-base">مقارنة البنات</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="text-white" style={{ background: BRAND_PURPLE }}>
                    <th className="p-2 text-right">المؤشر</th>
                    {report.moderators.map((row) => <th key={row.slug} className="p-2 text-right">{row.name}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {metrics.map((metric) => {
                    const best = bestSlugs(report.moderators, metric);
                    return (
                      <tr key={metric.id} className="border-t">
                        <th className="p-2 text-right font-medium">{metric.label}{metric.lowerIsBetter ? " ↓" : ""}</th>
                        {report.moderators.map((row) => {
                          const marked = best.includes(row.slug);
                          return (
                            <td key={row.slug} className="p-2" style={marked ? { background: "#fff1eb", color: BRAND_PURPLE, fontWeight: 700, boxShadow: `inset 0 0 0 2px ${BRAND_ORANGE}` } : undefined}>
                              {show(metric, metric.value(row))}{marked ? " الأفضل" : ""}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-muted-foreground">
                {report.conversationsVisible
                  ? "في الوقت والتغطية والمتأخر وبدون رد بنفس تعريف لوحة البنات. بانتظار العميل يعني آخر رسالة منّا. التحويل = الطلبات المسجّلة ÷ المحادثات التي بدأت في الفترة."
                  : "مؤشرات المحادثات والخط الساخن والإعلانات ظاهرة فقط للمدير العام ومديرة المبيعات والمدير التنفيذي عندما تسمح بوابة المحادثات."}
                {" "}الكيلو للفترة فقط: العظم منفصل عن اللحوم، الهدايا داخل الإجمالي، والرقاب خارج العدّاد.
              </p>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {metrics.map((metric) => {
              const data = report.moderators.map((row) => ({ name: row.name, value: metric.value(row) ?? 0 }));
              const best = new Set(bestSlugs(report.moderators, metric));
              return (
                <Card key={metric.id} className="glass-card">
                  <CardHeader className="pb-0"><CardTitle className="text-sm">{metric.label}{metric.lowerIsBetter ? " — الأقل أفضل" : ""}</CardTitle></CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart data={data}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" fontSize={12} />
                        <YAxis fontSize={11} />
                        <Tooltip />
                        <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                          {data.map((entry) => (
                            <Cell key={entry.name} fill={best.has(report.moderators.find((r) => r.name === entry.name)?.slug ?? "") ? BRAND_ORANGE : BRAND_PURPLE} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Card className="glass-card">
            <CardHeader><CardTitle className="text-base">الكيلو</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-muted"><th className="p-2 text-right">البنت</th><th className="p-2">لحوم</th><th className="p-2">لحم بالعظم</th><th className="p-2">مصنعات</th><th className="p-2">هدايا</th><th className="p-2">إجمالي مطلوب</th><th className="p-2">إجمالي مسلّم</th></tr></thead>
                <tbody>
                  {report.moderators.map((row) => (
                    <tr key={row.slug} className="border-t">
                      <td className="p-2 font-medium">{row.name}</td>
                      <td className="p-2">{row.kgRequested.meat}</td>
                      <td className="p-2">{row.kgRequested.bone}</td>
                      <td className="p-2">{row.kgRequested.processed}</td>
                      <td className="p-2">{row.kgRequested.gifts}</td>
                      <td className="p-2">{totalKg(row.kgRequested)}</td>
                      <td className="p-2">{totalKg(row.kgDelivered)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {report.conversationsVisible && (
            <Card className="glass-card">
              <CardHeader><CardTitle className="text-base">الخط الساخن والإعلانات</CardTitle></CardHeader>
              <CardContent className="space-y-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="bg-muted">{["البنت", "مُجابة", "فائتة", "أقل من دقيقة", "1–5", "+5", "طابقت طلباً", "نسبة الرد"].map((h) => <th key={h} className="p-2 text-right">{h}</th>)}</tr></thead>
                  <tbody>
                    {report.moderators.map((row) => (
                      <tr key={row.slug} className="border-t">
                        <td className="p-2">{row.name}</td>
                        <td className="p-2">{row.calls?.answered ?? 0}</td>
                        <td className="p-2">{row.calls?.missed ?? 0}</td>
                        <td className="p-2">{row.calls?.under1Min ?? 0}</td>
                        <td className="p-2">{row.calls?.from1To5Min ?? 0}</td>
                        <td className="p-2">{row.calls?.over5Min ?? 0}</td>
                        <td className="p-2">{row.calls?.matchedOrder ?? 0}</td>
                        <td className="p-2">{row.calls?.answerRate ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {report.ads.length > 0 && (
                  <table className="w-full text-sm">
                    <thead><tr className="bg-muted"><th className="p-2 text-right">الإعلان</th>{report.moderators.map((row) => <th key={row.slug} className="p-2">{row.name}</th>)}</tr></thead>
                    <tbody>
                      {[...new Set(report.ads.map((a) => a.adName))].map((name) => (
                        <tr key={name} className="border-t">
                          <td className="p-2">{name}</td>
                          {report.moderators.map((row) => <td key={row.slug} className="p-2">{report.ads.find((a) => a.adName === name && a.slug === row.slug)?.conversations ?? 0}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </section>
  );
}

export default function ModeratorPeriodReport({ onReport }: { onReport: (report: ModeratorPeriodReport | null) => void }) {
  const { roles } = useAuth();
  const onReportRef = useRef(onReport);
  onReportRef.current = onReport;
  const initial = resolveReportRange("this_month");
  const [preset, setPreset] = useState<ReportPreset>("this_month");
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [report, setReport] = useState<ModeratorPeriodReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    (supabase as any).rpc("cm_moderator_period_report", { p_from: from, p_to: to }).then((res: { data: unknown; error: { code?: string; message?: string } | null }) => {
      if (!alive) return;
      if (res.error) {
        const msg = `${res.error.code ?? ""} ${res.error.message ?? ""}`;
        setReport(null);
        onReportRef.current(null);
        setError(/42501|CM_NOT_ALLOWED|permission/i.test(msg)
          ? "ليست لديك صلاحية هذا التقرير."
          : /42883|PGRST202|could not find the function|schema cache/i.test(msg)
            ? "دالة التقرير غير مثبّتة على قاعدة البيانات بعد."
            : /22023|CM_BAD_RANGE/i.test(msg)
              ? "المدة غير صالحة. الحد الأقصى سنة واحدة."
              : "تعذّر تحميل التقرير. أعد المحاولة.");
        setLoading(false);
        return;
      }
      try {
        const mapped = mapModeratorPeriodReport(res.data, viewerMaySeeConversationMetrics(roles));
        setReport(mapped);
        onReportRef.current(mapped);
      } catch {
        setReport(null);
        onReportRef.current(null);
        setError("تعذّر قراءة التقرير.");
      }
      setLoading(false);
    });
    return () => { alive = false; };
  }, [from, to, roles]);

  const choose = (next: ReportPreset) => {
    setPreset(next);
    if (next === "custom") return;
    const range = resolveReportRange(next);
    setFrom(range.from);
    setTo(range.to);
  };

  return (
    <ModeratorPeriodReportView
      report={report}
      loading={loading}
      error={error}
      preset={preset}
      from={from}
      to={to}
      onPreset={choose}
      onFrom={(value) => { setPreset("custom"); setFrom(value); }}
      onTo={(value) => { setPreset("custom"); setTo(value); }}
    />
  );
}
