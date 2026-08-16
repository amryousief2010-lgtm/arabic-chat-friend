import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CalendarDays, ChevronDown, ChevronLeft, FileSpreadsheet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cairoMonthStartUTC, currentCairoYearMonth, toCairoDateString } from "@/lib/cairoDate";
import * as XLSX from "xlsx";
import { displayModeratorName } from "@/constants/moderators";

const MONTH_AR = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

interface Row { created_at: string; total: number; moderator: string | null }

const DailyRegistrationsTable = () => {
  const [openDay, setOpenDay] = useState<string | null>(null);
  const { year, monthIndex0 } = currentCairoYearMonth();
  const from = useMemo(() => cairoMonthStartUTC(year, monthIndex0).toISOString(), [year, monthIndex0]);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["daily-registrations", from],
    queryFn: async () => {
      let all: Row[] = [];
      let page = 0;
      const size = 1000;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data, error } = await supabase
          .from("orders")
          .select("created_at, total, moderator")
          .gte("created_at", from)
          .order("created_at", { ascending: false })
          .range(page * size, (page + 1) * size - 1);
        if (error) throw error;
        all = all.concat((data || []) as Row[]);
        if ((data?.length || 0) < size) break;
        page++;
      }
      return all;
    },
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 60 * 1000,
  });

  const { days, moderators, totalOrders, totalSales } = useMemo(() => {
    const rows = data || [];
    const dayMap: Record<string, { orders: number; sales: number; mods: Record<string, { orders: number; sales: number }> }> = {};
    const modMap: Record<string, { orders: number; sales: number }> = {};
    let totalOrders = 0;
    let totalSales = 0;

    for (const r of rows) {
      const key = toCairoDateString(r.created_at);
      const mod = displayModeratorName((r.moderator || "غير محدد").trim() || "غير محدد");
      const t = Number(r.total || 0);
      if (!dayMap[key]) dayMap[key] = { orders: 0, sales: 0, mods: {} };
      dayMap[key].orders++; dayMap[key].sales += t;
      if (!dayMap[key].mods[mod]) dayMap[key].mods[mod] = { orders: 0, sales: 0 };
      dayMap[key].mods[mod].orders++; dayMap[key].mods[mod].sales += t;
      if (!modMap[mod]) modMap[mod] = { orders: 0, sales: 0 };
      modMap[mod].orders++; modMap[mod].sales += t;
      totalOrders++; totalSales += t;
    }

    const days = Object.entries(dayMap)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, v]) => ({
        date,
        orders: v.orders,
        sales: v.sales,
        mods: Object.entries(v.mods)
          .map(([name, m]) => ({ name, ...m }))
          .sort((a, b) => b.sales - a.sales),
      }));

    const moderators = Object.entries(modMap)
      .map(([name, m]) => ({ name, ...m }))
      .sort((a, b) => b.sales - a.sales);

    return { days, moderators, totalOrders, totalSales };
  }, [data]);

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(days.map(d => ({ "التاريخ": d.date, "عدد الأوردرات": d.orders, "إجمالي المبيعات": Math.round(d.sales) }))),
      "التسجيلات اليومية",
    );
    const detail: any[] = [];
    days.forEach(d => d.mods.forEach(m => detail.push({ "التاريخ": d.date, "الموظفة": m.name, "عدد الأوردرات": m.orders, "إجمالي المبيعات": Math.round(m.sales) })));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detail), "تفصيل الموظفات");
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(moderators.map(m => ({ "الموظفة": m.name, "عدد الأوردرات": m.orders, "إجمالي المبيعات": Math.round(m.sales) }))),
      "إجمالي الشهر",
    );
    XLSX.writeFile(wb, `التسجيلات-اليومية-${MONTH_AR[monthIndex0]}-${year}.xlsx`);
  };

  return (
    <Card className="glass-card mb-6">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarDays className="w-5 h-5 text-primary" />
          التسجيلات اليومية — {MONTH_AR[monthIndex0]} {year}
        </CardTitle>
        <Button size="sm" variant="outline" onClick={exportExcel} disabled={isLoading || days.length === 0}>
          <FileSpreadsheet className="w-4 h-4 ml-1" /> تصدير Excel
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : days.length === 0 ? (
          <p className="text-center text-muted-foreground py-6 text-sm">لا توجد تسجيلات هذا الشهر</p>
        ) : (
          <div className="space-y-6">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">اليوم</TableHead>
                    <TableHead className="text-right">عدد الأوردرات</TableHead>
                    <TableHead className="text-right">إجمالي المبيعات</TableHead>
                    <TableHead className="text-right">الموظفات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {days.map(d => {
                    const open = openDay === d.date;
                    return (
                      <Fragment key={d.date}>
                        <TableRow
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => setOpenDay(open ? null : d.date)}
                        >
                          <TableCell className="font-medium">
                            <span className="inline-flex items-center gap-1">
                              {open ? <ChevronDown className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                              {d.date.split("-").reverse().join("/")}
                            </span>
                          </TableCell>
                          <TableCell>{d.orders}</TableCell>
                          <TableCell className="text-primary font-semibold">{Math.round(d.sales).toLocaleString()} ج.م</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {d.mods.map(m => `${m.name} (${m.orders})`).join(" • ")}
                          </TableCell>
                        </TableRow>
                        {open && (
                          <TableRow className="bg-muted/30">
                            <TableCell colSpan={4}>
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                {d.mods.map(m => (
                                  <div key={m.name} className="rounded-lg border bg-card p-2 text-sm">
                                    <div className="font-semibold">{m.name}</div>
                                    <div className="text-xs text-muted-foreground">
                                      {m.orders} أوردر — <span className="text-primary font-semibold">{Math.round(m.sales).toLocaleString()} ج.م</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                  <TableRow className="bg-muted/50 font-bold">
                    <TableCell>الإجمالي</TableCell>
                    <TableCell>{totalOrders}</TableCell>
                    <TableCell className="text-primary">{Math.round(totalSales).toLocaleString()} ج.م</TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            </div>

            <div>
              <p className="text-sm font-semibold mb-2">إجمالي الشهر لكل موظفة</p>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">الموظفة</TableHead>
                      <TableHead className="text-right">عدد الأوردرات</TableHead>
                      <TableHead className="text-right">إجمالي المبيعات</TableHead>
                      <TableHead className="text-right">النسبة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {moderators.map(m => (
                      <TableRow key={m.name}>
                        <TableCell className="font-medium">{m.name}</TableCell>
                        <TableCell>{m.orders}</TableCell>
                        <TableCell className="text-primary font-semibold">{Math.round(m.sales).toLocaleString()} ج.م</TableCell>
                        <TableCell>{totalSales > 0 ? Math.round((m.sales / totalSales) * 100) : 0}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default DailyRegistrationsTable;
