import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, FileSpreadsheet, Inbox, CheckCircle2, AlertTriangle, Ban } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, Legend, CartesianGrid } from "recharts";
import * as XLSX from "xlsx";
import { formatDate } from "@/lib/dateFormat";
import { useAuth } from "@/hooks/useAuth";

interface Shipment {
  id: string;
  family_number: string | null;
  family_id: string | null;
  production_date: string;
  egg_count: number;
  status: "pending" | "received" | "partial" | "rejected";
  received_egg_count: number | null;
  damaged_count: number | null;
  received_at: string | null;
  received_by: string | null;
  receipt_notes: string | null;
  rejection_reason: string | null;
  hatch_batch_id: string | null;
  created_at: string;
}

const todayISO = () => new Date().toISOString().slice(0, 10);
const monthStartISO = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
};

const statusBadge = (s: Shipment["status"]) => {
  const map: Record<string, { label: string; variant: any }> = {
    pending: { label: "معلق", variant: "warning" },
    received: { label: "مستلم", variant: "default" },
    partial: { label: "جزئي", variant: "secondary" },
    rejected: { label: "مرفوض", variant: "destructive" },
  };
  return <Badge variant={map[s].variant}>{map[s].label}</Badge>;
};

const StatCard = ({ icon: Icon, label, value, color = "text-primary" }: any) => (
  <Card>
    <CardContent className="p-4 flex items-center gap-3">
      <div className={`p-2 rounded-lg bg-muted ${color}`}><Icon className="w-5 h-5" /></div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-bold">{value}</p>
      </div>
    </CardContent>
  </Card>
);

const FarmShipmentsLog = () => {
  const { isGeneralManager, isExecutiveManager, isFarmManager, isHatcheryManager, isProductionManager, isQualityManager } = useAuth();
  const [from, setFrom] = useState(monthStartISO());
  const [to, setTo] = useState(todayISO());
  const [status, setStatus] = useState<string>("all");
  const [family, setFamily] = useState("");
  const canSubscribeToShipments = isGeneralManager || isExecutiveManager || isFarmManager || isHatcheryManager || isProductionManager || isQualityManager;

  const { data: rows = [], isLoading, refetch } = useQuery({
    queryKey: ["farm-shipments-log", from, to, status, family],
    queryFn: async () => {
      let q = (supabase as any)
        .from("farm_to_hatchery_shipments")
        .select("*")
        .gte("production_date", from)
        .lte("production_date", to)
        .order("production_date", { ascending: false })
        .limit(2000);
      if (status !== "all") q = q.eq("status", status);
      if (family.trim()) q = q.ilike("family_number", `%${family.trim()}%`);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as Shipment[];
    },
  });

  // Fetch profile names for received_by
  const receiverIds = useMemo(() => Array.from(new Set(rows.map(r => r.received_by).filter(Boolean))) as string[], [rows]);
  const { data: receivers = {} } = useQuery({
    queryKey: ["receivers", receiverIds.join(",")],
    queryFn: async () => {
      if (receiverIds.length === 0) return {};
      const { data } = await supabase.from("profile_directory").select("id, full_name").in("id", receiverIds);
      const map: Record<string, string> = {};
      (data || []).forEach((p: any) => { map[p.id] = p.full_name || p.id; });
      return map;
    },
    enabled: receiverIds.length > 0,
  });

  const batchIds = useMemo(() => Array.from(new Set(rows.map(r => r.hatch_batch_id).filter(Boolean))) as string[], [rows]);
  const { data: batches = {} } = useQuery({
    queryKey: ["log-batches", batchIds.join(",")],
    queryFn: async () => {
      if (batchIds.length === 0) return {};
      const { data } = await supabase.from("hatch_batches").select("id, batch_number, receive_date, received_eggs").in("id", batchIds);
      const map: Record<string, any> = {};
      (data || []).forEach((b: any) => { map[b.id] = b; });
      return map;
    },
    enabled: batchIds.length > 0,
  });

  useEffect(() => {
    if (!canSubscribeToShipments) return;
    const ch = supabase.channel("farm-shipments-log-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "farm_to_hatchery_shipments" }, () => refetch())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [canSubscribeToShipments, refetch]);

  // KPI
  const kpi = useMemo(() => {
    const recv = rows.filter(r => r.status === "received").length;
    const partial = rows.filter(r => r.status === "partial").length;
    const rejected = rows.filter(r => r.status === "rejected").length;
    const pending = rows.filter(r => r.status === "pending").length;
    const totalReceived = rows.reduce((s, r) => s + (r.received_egg_count || 0), 0);
    const totalDamaged = rows.reduce((s, r) => s + (r.damaged_count || 0), 0);
    const totalSent = rows.reduce((s, r) => s + (r.egg_count || 0), 0);
    return { recv, partial, rejected, pending, totalReceived, totalDamaged, totalSent };
  }, [rows]);

  // Daily chart
  const dailyData = useMemo(() => {
    const byDay = new Map<string, { date: string; sent: number; received: number; damaged: number; rejected: number }>();
    rows.forEach(r => {
      const d = r.production_date;
      const cur = byDay.get(d) || { date: d, sent: 0, received: 0, damaged: 0, rejected: 0 };
      cur.sent += r.egg_count || 0;
      cur.received += r.received_egg_count || 0;
      cur.damaged += r.damaged_count || 0;
      if (r.status === "rejected") cur.rejected += r.egg_count || 0;
      byDay.set(d, cur);
    });
    return Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [rows]);

  // Per-family aggregation
  const byFamily = useMemo(() => {
    const m = new Map<string, { family: string; sent: number; received: number; damaged: number; count: number }>();
    rows.forEach(r => {
      const k = r.family_number || "-";
      const cur = m.get(k) || { family: k, sent: 0, received: 0, damaged: 0, count: 0 };
      cur.sent += r.egg_count || 0;
      cur.received += r.received_egg_count || 0;
      cur.damaged += r.damaged_count || 0;
      cur.count += 1;
      m.set(k, cur);
    });
    return Array.from(m.values()).sort((a, b) => b.sent - a.sent);
  }, [rows]);

  // Batch reconciliation
  const batchRecon = useMemo(() => {
    const m = new Map<string, { batch: any; shipmentEggs: number; shipmentDamaged: number; count: number }>();
    rows.filter(r => r.hatch_batch_id && r.status !== "pending" && r.status !== "rejected").forEach(r => {
      const b = batches[r.hatch_batch_id!];
      if (!b) return;
      const cur = m.get(r.hatch_batch_id!) || { batch: b, shipmentEggs: 0, shipmentDamaged: 0, count: 0 };
      cur.shipmentEggs += r.received_egg_count || 0;
      cur.shipmentDamaged += r.damaged_count || 0;
      cur.count += 1;
      m.set(r.hatch_batch_id!, cur);
    });
    return Array.from(m.values());
  }, [rows, batches]);

  const exportExcel = () => {
    const data = rows.map(r => ({
      "تاريخ الإنتاج": r.production_date,
      "الأسرة": r.family_number || "-",
      "الحالة": r.status,
      "المرسل": r.egg_count,
      "المستلم": r.received_egg_count ?? "",
      "التالف": r.damaged_count ?? "",
      "الفاقد %": r.egg_count > 0 ? (((r.egg_count - (r.received_egg_count || 0)) / r.egg_count) * 100).toFixed(1) : "",
      "المستلم بواسطة": receivers[r.received_by || ""] || "-",
      "وقت الاستلام": r.received_at ? formatDate(r.received_at) : "",
      "الدفعة": r.hatch_batch_id ? (batches[r.hatch_batch_id]?.batch_number || "") : "",
      "سبب الرفض": r.rejection_reason || "",
      "ملاحظات": r.receipt_notes || "",
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, "وارد المزرعة");
    XLSX.writeFile(wb, `farm-shipments-${from}_${to}.xlsx`);
  };

  return (
    <DashboardLayout>
      <div className="space-y-4" dir="rtl">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-2xl font-bold">سجل وارد المزرعة للمعمل</h1>
          <Button onClick={exportExcel} variant="outline">
            <FileSpreadsheet className="w-4 h-4 ml-1" /> تصدير Excel
          </Button>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4 grid grid-cols-2 md:grid-cols-5 gap-3">
            <div>
              <Label className="text-xs">من تاريخ</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">إلى تاريخ</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">الحالة</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="pending">معلق</SelectItem>
                  <SelectItem value="received">مستلم</SelectItem>
                  <SelectItem value="partial">جزئي</SelectItem>
                  <SelectItem value="rejected">مرفوض</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">رقم الأسرة</Label>
              <Input value={family} onChange={(e) => setFamily(e.target.value)} placeholder="بحث..." />
            </div>
            <div className="flex items-end">
              <Button variant="outline" className="w-full" onClick={() => refetch()}>تحديث</Button>
            </div>
          </CardContent>
        </Card>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={CheckCircle2} label="مستلمة بالكامل" value={kpi.recv} color="text-green-600" />
          <StatCard icon={Inbox} label="مستلمة جزئياً" value={kpi.partial} color="text-blue-600" />
          <StatCard icon={Ban} label="مرفوضة" value={kpi.rejected} color="text-destructive" />
          <StatCard icon={AlertTriangle} label="إجمالي تالف (بيضة)" value={kpi.totalDamaged} color="text-orange-600" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <StatCard icon={Inbox} label="إجمالي المرسل" value={kpi.totalSent} />
          <StatCard icon={CheckCircle2} label="إجمالي المستلم" value={kpi.totalReceived} color="text-green-600" />
          <StatCard icon={AlertTriangle} label="نسبة الفاقد"
            value={kpi.totalSent > 0 ? `${(((kpi.totalSent - kpi.totalReceived) / kpi.totalSent) * 100).toFixed(1)}%` : "—"}
            color="text-orange-600" />
        </div>

        <Tabs defaultValue="log">
          <TabsList>
            <TabsTrigger value="log">سجل الاستلامات</TabsTrigger>
            <TabsTrigger value="daily">تقرير يومي</TabsTrigger>
            <TabsTrigger value="monthly">تقرير شهري</TabsTrigger>
            <TabsTrigger value="recon">مطابقة الدفعات</TabsTrigger>
          </TabsList>

          <TabsContent value="log">
            <Card>
              <CardHeader><CardTitle>السجل التفصيلي ({rows.length})</CardTitle></CardHeader>
              <CardContent>
                {isLoading ? (
                  <p className="text-center py-6 text-muted-foreground">جاري التحميل...</p>
                ) : (
                  <div className="overflow-auto max-h-[600px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>تاريخ</TableHead>
                          <TableHead>أسرة</TableHead>
                          <TableHead>الحالة</TableHead>
                          <TableHead>مرسل</TableHead>
                          <TableHead>مستلم</TableHead>
                          <TableHead>تالف</TableHead>
                          <TableHead>فاقد %</TableHead>
                          <TableHead>بواسطة</TableHead>
                          <TableHead>وقت الاستلام</TableHead>
                          <TableHead>دفعة</TableHead>
                          <TableHead>ملاحظات</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map(r => {
                          const loss = r.egg_count > 0 ? ((r.egg_count - (r.received_egg_count || 0)) / r.egg_count) * 100 : 0;
                          return (
                          <TableRow key={r.id}>
                            <TableCell>{r.production_date}</TableCell>
                            <TableCell className="font-semibold">{r.family_number || "-"}</TableCell>
                            <TableCell>{statusBadge(r.status)}</TableCell>
                            <TableCell>{r.egg_count}</TableCell>
                            <TableCell>{r.received_egg_count ?? "-"}</TableCell>
                            <TableCell className={r.damaged_count ? "text-orange-600 font-semibold" : ""}>{r.damaged_count ?? "-"}</TableCell>
                            <TableCell>{r.status === "pending" ? "-" : `${loss.toFixed(1)}%`}</TableCell>
                            <TableCell className="text-xs">{receivers[r.received_by || ""] || "-"}</TableCell>
                            <TableCell className="text-xs">{r.received_at ? formatDate(r.received_at) : "-"}</TableCell>
                            <TableCell className="text-xs">{r.hatch_batch_id ? (batches[r.hatch_batch_id]?.batch_number || "—") : "-"}</TableCell>
                            <TableCell className="text-xs max-w-[200px] truncate" title={r.rejection_reason || r.receipt_notes || ""}>
                              {r.rejection_reason ? `❌ ${r.rejection_reason}` : (r.receipt_notes || "-")}
                            </TableCell>
                          </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="daily">
            <Card>
              <CardHeader><CardTitle>التقرير اليومي</CardTitle></CardHeader>
              <CardContent>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dailyData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" />
                      <YAxis />
                      <RTooltip />
                      <Legend />
                      <Bar dataKey="sent" name="مرسل" fill="hsl(var(--primary))" />
                      <Bar dataKey="received" name="مستلم" fill="hsl(142 70% 45%)" />
                      <Bar dataKey="damaged" name="تالف" fill="hsl(25 95% 53%)" />
                      <Bar dataKey="rejected" name="مرفوض" fill="hsl(var(--destructive))" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <Table className="mt-4">
                  <TableHeader>
                    <TableRow>
                      <TableHead>التاريخ</TableHead>
                      <TableHead>مرسل</TableHead>
                      <TableHead>مستلم</TableHead>
                      <TableHead>تالف</TableHead>
                      <TableHead>مرفوض</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dailyData.map(d => (
                      <TableRow key={d.date}>
                        <TableCell>{d.date}</TableCell>
                        <TableCell>{d.sent}</TableCell>
                        <TableCell>{d.received}</TableCell>
                        <TableCell>{d.damaged}</TableCell>
                        <TableCell>{d.rejected}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="monthly">
            <Card>
              <CardHeader><CardTitle>مقارنة الأسر</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الأسرة</TableHead>
                      <TableHead>عدد الشحنات</TableHead>
                      <TableHead>مرسل</TableHead>
                      <TableHead>مستلم</TableHead>
                      <TableHead>تالف</TableHead>
                      <TableHead>الفاقد %</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {byFamily.map(f => (
                      <TableRow key={f.family}>
                        <TableCell className="font-semibold">{f.family}</TableCell>
                        <TableCell>{f.count}</TableCell>
                        <TableCell>{f.sent}</TableCell>
                        <TableCell>{f.received}</TableCell>
                        <TableCell className={f.damaged ? "text-orange-600" : ""}>{f.damaged}</TableCell>
                        <TableCell>{f.sent > 0 ? `${(((f.sent - f.received) / f.sent) * 100).toFixed(1)}%` : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="recon">
            <Card>
              <CardHeader><CardTitle>مطابقة الدفعات بالمعمل</CardTitle></CardHeader>
              <CardContent>
                {batchRecon.length === 0 ? (
                  <p className="text-center py-6 text-muted-foreground">لا توجد شحنات مرتبطة بدفع في هذه الفترة.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>الدفعة</TableHead>
                        <TableHead>تاريخ الاستلام</TableHead>
                        <TableHead>عدد الشحنات</TableHead>
                        <TableHead>إجمالي مستلم (شحنات)</TableHead>
                        <TableHead>إجمالي تالف</TableHead>
                        <TableHead>مسجل بالدفعة</TableHead>
                        <TableHead>فرق المطابقة</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {batchRecon.map(r => {
                        const diff = (r.batch.received_eggs || 0) - r.shipmentEggs;
                        return (
                        <TableRow key={r.batch.id}>
                          <TableCell className="font-semibold">{r.batch.batch_number}</TableCell>
                          <TableCell>{r.batch.receive_date}</TableCell>
                          <TableCell>{r.count}</TableCell>
                          <TableCell>{r.shipmentEggs}</TableCell>
                          <TableCell className={r.shipmentDamaged ? "text-orange-600" : ""}>{r.shipmentDamaged}</TableCell>
                          <TableCell>{r.batch.received_eggs || 0}</TableCell>
                          <TableCell className={diff !== 0 ? "text-destructive font-bold" : "text-green-600"}>
                            {diff === 0 ? "✓ مطابق" : diff > 0 ? `+${diff}` : diff}
                          </TableCell>
                        </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
};

export default FarmShipmentsLog;
