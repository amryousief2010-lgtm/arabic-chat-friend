import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Egg, Plus, Truck, Wheat, Syringe, Users, Calendar, TrendingUp, Trash2, Search, BarChart3, Download, LayoutDashboard, Eye, Printer } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { format } from "date-fns";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from "recharts";
import MotherFarmDashboard from "@/components/farm/MotherFarmDashboard";
import MotherFarmFeedInventory from "@/components/farm/MotherFarmFeedInventory";

const today = () => format(new Date(), "yyyy-MM-dd");
const monthStart = () => { const d = new Date(); d.setDate(1); return format(d, "yyyy-MM-dd"); };
const yearStart = () => format(new Date(new Date().getFullYear(), 0, 1), "yyyy-MM-dd");

const Farm = () => {
  const qc = useQueryClient();

  const { data: families = [] } = useQuery({
    queryKey: ["farm_families"],
    queryFn: async () => {
      const { data, error } = await supabase.from("farm_families").select("*");
      if (error) throw error;
      return (data || []).sort((a: any, b: any) => {
        const na = parseInt(String(a.family_number), 10);
        const nb = parseInt(String(b.family_number), 10);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return String(a.family_number).localeCompare(String(b.family_number));
      });
    },
  });

  const { data: eggs = [] } = useQuery({
    queryKey: ["farm_egg_production"],
    queryFn: async () => {
      const all: any[] = [];
      let from = 0;
      const size = 1000;
      while (true) {
        const { data, error } = await supabase.from("farm_egg_production")
          .select("*").order("production_date", { ascending: false }).range(from, from + size - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < size) break;
        from += size;
      }
      return all;
    },
  });

  const { data: transfers = [] } = useQuery({
    queryKey: ["farm_transfers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("farm_transfers")
        .select("*").order("transfer_date", { ascending: false }).limit(1000);
      if (error) throw error; return data || [];
    },
  });

  const { data: feedLogs = [] } = useQuery({
    queryKey: ["farm_feed_log"],
    queryFn: async () => {
      const { data, error } = await supabase.from("farm_feed_log")
        .select("*").order("log_date", { ascending: false }).limit(500);
      if (error) throw error; return data || [];
    },
  });

  const { data: meds = [] } = useQuery({
    queryKey: ["farm_medications"],
    queryFn: async () => {
      const { data, error } = await supabase.from("farm_medications")
        .select("*").order("med_date", { ascending: false }).limit(500);
      if (error) throw error; return data || [];
    },
  });

  const stats = useMemo(() => {
    const totalFemale = families.reduce((s, f: any) => s + (f.female_count || 0), 0);
    const totalMale = families.reduce((s, f: any) => s + (f.male_count || 0), 0);
    const ms = monthStart(), ys = yearStart();
    const monthEggs = eggs.filter((e: any) => e.production_date >= ms).reduce((s, e: any) => s + e.egg_count, 0);
    const ytdEggs = eggs.filter((e: any) => e.production_date >= ys).reduce((s, e: any) => s + e.egg_count, 0);
    const monthTransfers = transfers.filter((t: any) => t.transfer_date >= ms).reduce((s, t: any) => s + t.quantity, 0);
    const ytdTransfers = transfers.filter((t: any) => t.transfer_date >= ys).reduce((s, t: any) => s + t.quantity, 0);
    const eggsPerFemale = totalFemale > 0 ? (monthEggs / totalFemale).toFixed(2) : "0";
    return {
      totalFamilies: families.length, totalFemale, totalMale,
      monthEggs, ytdEggs, monthTransfers, ytdTransfers, eggsPerFemale,
    };
  }, [families, eggs, transfers]);

  return (
    <DashboardLayout>
      <Header title="مزرعة الأمهات" subtitle="إدارة الأسر وإنتاج البيض ونقله للمعمل" />

      <div className="p-4 space-y-4 max-w-7xl mx-auto">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPI icon={Users} label="إجمالي الأسر" value={stats.totalFamilies} color="from-purple-500 to-purple-700" />
          <KPI icon={Users} label="الإناث" value={stats.totalFemale} sub={`الذكور: ${stats.totalMale}`} color="from-pink-500 to-pink-700" />
          <KPI icon={Egg} label="بيض الشهر" value={stats.monthEggs} sub={`YTD: ${stats.ytdEggs}`} color="from-orange-500 to-orange-700" />
          <KPI icon={TrendingUp} label="بيضة/أنثى (شهر)" value={stats.eggsPerFemale} sub={`منقول الشهر: ${stats.monthTransfers}`} color="from-emerald-500 to-emerald-700" />
        </div>

        <Tabs defaultValue="dashboard" dir="rtl">
          <TabsList className="grid grid-cols-2 md:grid-cols-8 w-full">
            <TabsTrigger value="dashboard"><LayoutDashboard className="w-4 h-4 ml-1" />لوحة التحكم</TabsTrigger>
            <TabsTrigger value="families"><Users className="w-4 h-4 ml-1" />الأسر</TabsTrigger>
            <TabsTrigger value="eggs"><Egg className="w-4 h-4 ml-1" />الإنتاج اليومي</TabsTrigger>
            <TabsTrigger value="transfers"><Truck className="w-4 h-4 ml-1" />نقل للمعمل</TabsTrigger>
            <TabsTrigger value="feed_inventory"><Wheat className="w-4 h-4 ml-1" />مخزون العلف</TabsTrigger>
            <TabsTrigger value="feed"><Wheat className="w-4 h-4 ml-1" />سجل العلف اليومي</TabsTrigger>
            <TabsTrigger value="meds"><Syringe className="w-4 h-4 ml-1" />الأدوية</TabsTrigger>
            <TabsTrigger value="charts"><BarChart3 className="w-4 h-4 ml-1" />تحليلات</TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard"><MotherFarmDashboard families={families} eggs={eggs} transfers={transfers} /></TabsContent>
          <TabsContent value="families"><FamiliesTab families={families} qc={qc} /></TabsContent>
          <TabsContent value="eggs"><EggsTab eggs={eggs} families={families} qc={qc} /></TabsContent>
          <TabsContent value="transfers"><TransfersTab transfers={transfers} families={families} eggs={eggs} qc={qc} /></TabsContent>
          <TabsContent value="feed_inventory"><MotherFarmFeedInventory /></TabsContent>
          <TabsContent value="feed"><FeedTab logs={feedLogs} qc={qc} /></TabsContent>
          <TabsContent value="meds"><MedsTab meds={meds} families={families} qc={qc} /></TabsContent>
          <TabsContent value="charts"><ChartsTab eggs={eggs} transfers={transfers} families={families} /></TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
};

const KPI = ({ icon: Icon, label, value, sub, color }: any) => (
  <Card className="relative overflow-hidden border-0 shadow-md">
    <div className={`absolute inset-0 bg-gradient-to-br ${color} opacity-95`} />
    <div className="relative p-4 text-white">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4" />
        <span className="text-xs opacity-90">{label}</span>
      </div>
      <p className="text-2xl font-bold">{value}</p>
      {sub && <p className="text-xs opacity-80 mt-1">{sub}</p>}
    </div>
  </Card>
);

// ============ FAMILIES ============
const FamiliesTab = ({ families, qc }: any) => {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ family_number: "", pen: "", status: "active", female_count: 0, male_count: 0, start_date: today(), notes: "" });

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("farm_families").insert(form);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("تم إضافة الأسرة"); setOpen(false); setForm({ family_number: "", pen: "", status: "active", female_count: 0, male_count: 0, start_date: today(), notes: "" }); qc.invalidateQueries({ queryKey: ["farm_families"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("farm_families").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { toast.success("حذف"); qc.invalidateQueries({ queryKey: ["farm_families"] }); },
  });

  return (
    <Card className="p-4">
      <div className="flex justify-between mb-3">
        <h3 className="font-bold">قائمة الأسر</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="w-4 h-4 ml-1" />إضافة أسرة</Button></DialogTrigger>
          <DialogContent dir="rtl">
            <DialogHeader><DialogTitle>إضافة أسرة جديدة</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>رقم الأسرة</Label><Input value={form.family_number} onChange={(e) => setForm({ ...form, family_number: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>الملعب</Label><Input value={form.pen} onChange={(e) => setForm({ ...form, pen: e.target.value })} /></div>
                <div><Label>الحالة</Label>
                  <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">نشطة</SelectItem>
                      <SelectItem value="resting">راحة</SelectItem>
                      <SelectItem value="inactive">معطلة</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>عدد الإناث</Label><Input type="number" value={form.female_count} onChange={(e) => setForm({ ...form, female_count: +e.target.value })} /></div>
                <div><Label>عدد الذكور</Label><Input type="number" value={form.male_count} onChange={(e) => setForm({ ...form, male_count: +e.target.value })} /></div>
              </div>
              <div><Label>تاريخ البدء</Label><Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></div>
              <div><Label>ملاحظات</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            </div>
            <DialogFooter><Button onClick={() => save.mutate()} disabled={save.isPending}>حفظ</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <div className="overflow-auto">
        <Table>
          <TableHeader>
            <TableRow><TableHead>رقم</TableHead><TableHead>الملعب</TableHead><TableHead>الحالة</TableHead><TableHead>إناث</TableHead><TableHead>ذكور</TableHead><TableHead>بدء</TableHead><TableHead></TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {families.map((f: any) => (
              <TableRow key={f.id}>
                <TableCell className="font-bold">{f.family_number}</TableCell>
                <TableCell>{f.pen || "-"}</TableCell>
                <TableCell><Badge variant={f.status === "active" ? "default" : "secondary"}>{f.status === "active" ? "نشطة" : f.status === "resting" ? "راحة" : "معطلة"}</Badge></TableCell>
                <TableCell>{f.female_count}</TableCell>
                <TableCell>{f.male_count}</TableCell>
                <TableCell>{f.start_date || "-"}</TableCell>
                <TableCell><Button size="icon" variant="ghost" onClick={() => del.mutate(f.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button></TableCell>
              </TableRow>
            ))}
            {families.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">لا توجد أسر بعد</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
};

// ============ EGGS ============
const EggsTab = ({ eggs, families, qc }: any) => {
  const [open, setOpen] = useState(false);
  const [bulkDate, setBulkDate] = useState<string>(today());
  const [bulkNotes, setBulkNotes] = useState<string>("");
  const [bulkCounts, setBulkCounts] = useState<Record<string, string>>({});
  const [bulkSearch, setBulkSearch] = useState("");

  // Reset counts when dialog opens
  const openDialog = () => {
    setBulkDate(today());
    setBulkNotes("");
    setBulkCounts({});
    setBulkSearch("");
    setOpen(true);
  };

  // Track which families already have a record for the selected date
  const recordedForDate = useMemo(() => {
    const map: Record<string, number> = {};
    eggs.forEach((e: any) => {
      if (e.production_date === bulkDate && e.family_id) {
        map[e.family_id] = (map[e.family_id] || 0) + (e.egg_count || 0);
      }
    });
    return map;
  }, [eggs, bulkDate]);

  const visibleFamilies = useMemo(() => {
    const q = bulkSearch.trim();
    if (!q) return families;
    return families.filter((f: any) =>
      String(f.family_number).includes(q) || String(f.pen || "").includes(q)
    );
  }, [families, bulkSearch]);

  const save = useMutation({
    mutationFn: async () => {
      const rows = Object.entries(bulkCounts)
        .map(([family_id, v]) => ({ family_id, egg_count: parseInt(v, 10) }))
        .filter(r => Number.isFinite(r.egg_count) && r.egg_count > 0)
        .map(r => ({
          production_date: bulkDate,
          family_id: r.family_id,
          egg_count: r.egg_count,
          notes: bulkNotes || null,
        }));
      if (rows.length === 0) throw new Error("أدخل عدد البيض لأسرة واحدة على الأقل");
      const { error } = await supabase.from("farm_egg_production").insert(rows);
      if (error) throw error;
      return rows.length;
    },
    onSuccess: (n: number) => {
      toast.success(`تم تسجيل إنتاج ${n} أسرة`);
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["farm_egg_production"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("farm_egg_production").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["farm_egg_production"] }),
  });

  const totalBulk = useMemo(
    () => Object.values(bulkCounts).reduce((s, v) => s + (parseInt(v, 10) || 0), 0),
    [bulkCounts]
  );
  const filledCount = useMemo(
    () => Object.values(bulkCounts).filter(v => (parseInt(v, 10) || 0) > 0).length,
    [bulkCounts]
  );

  const familyName = (id: string) => families.find((f: any) => f.id === id)?.family_number || "-";

  const [fFamily, setFFamily] = useState("all");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [fMonth, setFMonth] = useState("all");
  const [fYear, setFYear] = useState("all");
  const [detailDate, setDetailDate] = useState<string | null>(null);

  const filtered = useMemo(() => eggs.filter((e: any) => {
    if (fFamily !== "all" && e.family_id !== fFamily) return false;
    if (fFrom && e.production_date < fFrom) return false;
    if (fTo && e.production_date > fTo) return false;
    const d = e.production_date || "";
    if (fYear !== "all" && d.slice(0, 4) !== fYear) return false;
    if (fMonth !== "all" && d.slice(5, 7) !== fMonth) return false;
    return true;
  }), [eggs, fFamily, fFrom, fTo, fMonth, fYear]);
  const total = filtered.reduce((s: number, e: any) => s + (e.egg_count || 0), 0);

  // Group filtered eggs by production_date
  const dailySummary = useMemo(() => {
    const map: Record<string, { date: string; total: number; familyIds: Set<string>; rows: any[]; notes: string[] }> = {};
    filtered.forEach((e: any) => {
      const d = e.production_date;
      if (!map[d]) map[d] = { date: d, total: 0, familyIds: new Set(), rows: [], notes: [] };
      map[d].total += e.egg_count || 0;
      if (e.family_id) map[d].familyIds.add(e.family_id);
      map[d].rows.push(e);
      if (e.notes) map[d].notes.push(e.notes);
    });
    return Object.values(map)
      .map((g) => ({
        date: g.date,
        total: g.total,
        familiesCount: g.familyIds.size,
        familyNumbers: Array.from(g.familyIds).map(familyName).join("، "),
        avg: g.familyIds.size ? +(g.total / g.familyIds.size).toFixed(2) : 0,
        notes: Array.from(new Set(g.notes)).join(" | "),
        rows: g.rows,
      }))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [filtered, families]);

  const detailDay = useMemo(() => dailySummary.find((d) => d.date === detailDate) || null, [dailySummary, detailDate]);

  // KPI cards
  const kpis = useMemo(() => {
    const tdy = today();
    const mStart = monthStart();
    const todayRows = eggs.filter((e: any) => e.production_date === tdy);
    const todayTotal = todayRows.reduce((s: number, e: any) => s + (e.egg_count || 0), 0);
    const todayFamilies = new Set(todayRows.map((e: any) => e.family_id).filter(Boolean)).size;
    const monthRows = eggs.filter((e: any) => e.production_date >= mStart && e.production_date <= tdy);
    const monthTotal = monthRows.reduce((s: number, e: any) => s + (e.egg_count || 0), 0);
    const byDay: Record<string, number> = {};
    monthRows.forEach((e: any) => { byDay[e.production_date] = (byDay[e.production_date] || 0) + (e.egg_count || 0); });
    const dayKeys = Object.keys(byDay);
    const avgDaily = dayKeys.length ? Math.round(monthTotal / dayKeys.length) : 0;
    let topDay = { date: "-", total: 0 };
    dayKeys.forEach((k) => { if (byDay[k] > topDay.total) topDay = { date: k, total: byDay[k] }; });
    return { todayTotal, todayFamilies, monthTotal, avgDaily, topDay };
  }, [eggs]);

  const exportReport = () => {
    if (filtered.length === 0) { toast.error("لا توجد بيانات للتصدير"); return; }
    const summaryRows = dailySummary.map((d) => ({
      "التاريخ": d.date,
      "عدد الأسر المنتجة": d.familiesCount,
      "إجمالي البيض": d.total,
      "الأسر المنتجة": d.familyNumbers,
      "متوسط إنتاج الأسرة": d.avg,
      "ملاحظات": d.notes || "",
    }));
    summaryRows.push({
      "التاريخ": "الإجمالي", "عدد الأسر المنتجة": "" as any, "إجمالي البيض": total,
      "الأسر المنتجة": "", "متوسط إنتاج الأسرة": "" as any, "ملاحظات": "",
    });
    const detailRows = filtered.map((e: any) => ({
      "التاريخ": e.production_date, "الأسرة": familyName(e.family_id), "عدد البيض": e.egg_count, "ملاحظات": e.notes || "",
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), "ملخص الإنتاج اليومي");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detailRows), "تفاصيل الإنتاج");
    const period = `${fFrom || "بداية"}_${fTo || "نهاية"}`;
    XLSX.writeFile(wb, `تقرير_إنتاج_البيض_${period}.xlsx`);
    toast.success("تم تصدير التقرير بنجاح");
  };

  const printDay = (day: typeof dailySummary[number]) => {
    const rowsHtml = day.rows.map((r: any, i: number) => `
      <tr><td>${i + 1}</td><td>${familyName(r.family_id)}</td><td>${r.egg_count}</td><td>${r.notes || "-"}</td></tr>
    `).join("");
    const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
      <title>تقرير إنتاج البيض ${day.date}</title>
      <style>
        @page { size:A4; margin:14mm; }
        body{ font-family:'Cairo','Tajawal',sans-serif; direction:rtl; color:#111; }
        h1{ color:#7c3aed; margin:0 0 4px; } h2{ margin:6px 0; color:#444; font-size:14px; }
        .meta{ display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px; margin:10px 0; font-size:13px; }
        .meta b{ color:#333; }
        table{ width:100%; border-collapse:collapse; font-size:13px; margin-top:8px; }
        th,td{ border:1px solid #ccc; padding:6px 8px; text-align:right; }
        th{ background:#f3f0ff; color:#4c1d95; }
        tfoot td{ font-weight:bold; background:#fafafa; }
        .sign{ margin-top:50px; display:grid; grid-template-columns:1fr 1fr; gap:60px; font-size:13px; }
        .sign div{ border-top:1px solid #333; padding-top:6px; text-align:center; }
      </style></head><body>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #7c3aed;padding-bottom:8px;">
        <div><h1>نعام العاصمة</h1><div>Capital Ostrich</div></div>
        <div style="background:#f97316;color:#fff;padding:6px 14px;border-radius:6px;font-weight:bold;">
          تقرير إنتاج البيض اليومي لمزرعة الأمهات
        </div>
      </div>
      <div class="meta">
        <div><b>التاريخ:</b> ${day.date}</div>
        <div><b>إجمالي البيض:</b> ${day.total}</div>
        <div><b>عدد الأسر المنتجة:</b> ${day.familiesCount}</div>
      </div>
      <h2>تفاصيل الأسر المنتجة</h2>
      <table>
        <thead><tr><th style="width:40px">#</th><th>الأسرة</th><th>عدد البيض</th><th>ملاحظات</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
        <tfoot><tr><td colspan="2">الإجمالي</td><td>${day.total}</td><td>-</td></tr></tfoot>
      </table>
      <div class="sign">
        <div>توقيع مسؤول المزرعة</div>
        <div>توقيع الإدارة</div>
      </div>
      <script>window.addEventListener('load',()=>setTimeout(()=>window.print(),250));</script>
      </body></html>`;
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) { toast.error("الرجاء السماح بالنوافذ المنبثقة"); return; }
    w.document.write(html); w.document.close();
  };

  // Year/month options
  const years = useMemo(() => {
    const s = new Set<string>(); eggs.forEach((e: any) => e.production_date && s.add(e.production_date.slice(0, 4)));
    return Array.from(s).sort((a, b) => b.localeCompare(a));
  }, [eggs]);

  return (
    <div className="space-y-4">
      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Card className="p-3"><div className="text-xs text-muted-foreground">إنتاج اليوم</div><div className="text-2xl font-bold text-orange-600">{kpis.todayTotal.toLocaleString()}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">إنتاج هذا الشهر</div><div className="text-2xl font-bold text-primary">{kpis.monthTotal.toLocaleString()}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">عدد الأسر المنتجة اليوم</div><div className="text-2xl font-bold">{kpis.todayFamilies}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">متوسط الإنتاج اليومي (الشهر)</div><div className="text-2xl font-bold">{kpis.avgDaily.toLocaleString()}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">أعلى يوم إنتاجاً (الشهر)</div><div className="text-lg font-bold">{kpis.topDay.total.toLocaleString()}</div><div className="text-xs text-muted-foreground">{kpis.topDay.date}</div></Card>
      </div>

      <Card className="p-4">
        <div className="flex justify-between mb-3 flex-wrap gap-2">
          <h3 className="font-bold">ملخص الإنتاج اليومي ({total.toLocaleString()} بيضة)</h3>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={exportReport} className="gap-1">
              <Download className="w-4 h-4" />تصدير Excel
            </Button>
            <Dialog open={open} onOpenChange={(v) => (v ? openDialog() : setOpen(false))}>
              <DialogTrigger asChild><Button size="sm" onClick={openDialog}><Plus className="w-4 h-4 ml-1" />تسجيل إنتاج</Button></DialogTrigger>
              <DialogContent dir="rtl" className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>تسجيل إنتاج البيض اليومي</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <Label>التاريخ</Label>
                      <Input type="date" value={bulkDate} onChange={(e) => setBulkDate(e.target.value)} />
                    </div>
                    <div>
                      <Label>بحث برقم الأسرة / الملعب</Label>
                      <Input value={bulkSearch} onChange={(e) => setBulkSearch(e.target.value)} placeholder="مثال: 9" />
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground bg-muted/40 rounded-md px-3 py-2">
                    <span>الأسر المعبأة: <b className="text-foreground">{filledCount}</b> / {families.length}</span>
                    <span>إجمالي البيض: <b className="text-orange-600">{totalBulk.toLocaleString()}</b></span>
                  </div>
                  <div className="border rounded-md max-h-[340px] overflow-auto">
                    <Table>
                      <TableHeader className="sticky top-0 bg-background">
                        <TableRow>
                          <TableHead className="w-24">الأسرة</TableHead>
                          <TableHead className="w-20">الملعب</TableHead>
                          <TableHead>عدد البيض</TableHead>
                          <TableHead className="w-32 text-xs">مسجل سابقاً</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {visibleFamilies.map((f: any) => {
                          const already = recordedForDate[f.id] || 0;
                          return (
                            <TableRow key={f.id}>
                              <TableCell className="font-bold">{f.family_number}</TableCell>
                              <TableCell className="text-muted-foreground">{f.pen || "-"}</TableCell>
                              <TableCell>
                                <Input
                                  type="number"
                                  min="0"
                                  inputMode="numeric"
                                  value={bulkCounts[f.id] ?? ""}
                                  onChange={(e) => setBulkCounts(prev => ({ ...prev, [f.id]: e.target.value }))}
                                  placeholder="0"
                                  className="h-8"
                                />
                              </TableCell>
                              <TableCell className="text-xs">
                                {already > 0 ? <Badge variant="secondary">{already} بيضة</Badge> : <span className="text-muted-foreground">—</span>}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                        {visibleFamilies.length === 0 && (
                          <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-4">لا توجد أسر مطابقة</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                  <div>
                    <Label>ملاحظات (اختياري - تطبق على كل السجلات)</Label>
                    <Textarea value={bulkNotes} onChange={(e) => setBulkNotes(e.target.value)} rows={2} />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setBulkCounts({})}>مسح الكل</Button>
                  <Button onClick={() => save.mutate()} disabled={save.isPending || filledCount === 0}>
                    حفظ {filledCount > 0 ? `(${filledCount})` : ""}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
          <Select value={fFamily} onValueChange={setFFamily}>
            <SelectTrigger><SelectValue placeholder="كل الأسر" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الأسر</SelectItem>
              {families.map((f: any) => <SelectItem key={f.id} value={f.id}>{f.family_number}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} placeholder="من" />
          <Input type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} placeholder="إلى" />
          <Select value={fMonth} onValueChange={setFMonth}>
            <SelectTrigger><SelectValue placeholder="الشهر" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الشهور</SelectItem>
              {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0")).map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={fYear} onValueChange={setFYear}>
            <SelectTrigger><SelectValue placeholder="السنة" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل السنوات</SelectItem>
              {years.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* Daily summary table */}
        <div className="overflow-auto max-h-[600px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>التاريخ</TableHead>
                <TableHead>عدد الأسر المنتجة</TableHead>
                <TableHead>إجمالي البيض</TableHead>
                <TableHead>الأسر المنتجة</TableHead>
                <TableHead>متوسط إنتاج الأسرة</TableHead>
                <TableHead>ملاحظات</TableHead>
                <TableHead className="text-center">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dailySummary.map((d) => (
                <TableRow key={d.date}>
                  <TableCell className="font-medium">{d.date}</TableCell>
                  <TableCell>{d.familiesCount}</TableCell>
                  <TableCell className="font-bold text-orange-600">{d.total}</TableCell>
                  <TableCell className="text-xs">{d.familyNumbers}</TableCell>
                  <TableCell>{d.avg}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{d.notes || "-"}</TableCell>
                  <TableCell>
                    <div className="flex gap-1 justify-center">
                      <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => setDetailDate(d.date)}>
                        <Eye className="w-3 h-3" />رؤية
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => printDay(d)}>
                        <Printer className="w-3 h-3" />طباعة
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {dailySummary.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">لا يوجد إنتاج مطابق</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Details dialog */}
      <Dialog open={!!detailDate} onOpenChange={(v) => !v && setDetailDate(null)}>
        <DialogContent dir="rtl" className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>تفاصيل إنتاج يوم {detailDate}</DialogTitle>
          </DialogHeader>
          {detailDay && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-sm">
                <Card className="p-3"><div className="text-xs text-muted-foreground">التاريخ</div><div className="font-bold">{detailDay.date}</div></Card>
                <Card className="p-3"><div className="text-xs text-muted-foreground">إجمالي البيض</div><div className="font-bold text-orange-600">{detailDay.total}</div></Card>
                <Card className="p-3"><div className="text-xs text-muted-foreground">عدد الأسر المنتجة</div><div className="font-bold">{detailDay.familiesCount}</div></Card>
              </div>
              <div className="border rounded-md max-h-[400px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>رقم الأسرة</TableHead>
                      <TableHead>عدد البيض</TableHead>
                      <TableHead>ملاحظات</TableHead>
                      <TableHead>وقت التسجيل</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detailDay.rows.map((r: any) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-bold">{familyName(r.family_id)}</TableCell>
                        <TableCell className="text-orange-600 font-bold">{r.egg_count}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.notes || "-"}</TableCell>
                        <TableCell className="text-xs">{r.created_at ? new Date(r.created_at).toLocaleString("ar-EG") : "-"}</TableCell>
                        <TableCell>
                          <Button size="icon" variant="ghost" onClick={() => del.mutate(r.id)}>
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex justify-between items-center bg-muted/40 rounded-md px-3 py-2 text-sm">
                <span>إجمالي اليوم</span>
                <b className="text-orange-600">{detailDay.total} بيضة</b>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => printDay(detailDay)} className="gap-1">
                  <Printer className="w-4 h-4" />طباعة التقرير
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

// ============ TRANSFERS ============
const emptyRow = () => ({ transfer_date: today(), family_id: "", quantity: "", damaged: "", notes: "" });

// =================== Pending eggs grouped as ONE batch in current window ===================
const PendingByDayPanel = ({ eggs, transfers, families, qc, familyName }: any) => {
  const [viewOpen, setViewOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const defaultFrom = "2026-06-13";
  const [winFrom, setWinFrom] = useState<string>(defaultFrom);
  const [winTo, setWinTo] = useState<string>("2026-06-19");

  const localDateKey = (value: any) => String(value || "").slice(0, 10);

  const transferredByFamilyDate = useMemo(() => {
    const m = new Map<string, number>();
    (transfers || []).forEach((t: any) => {
      const date = localDateKey(t.transfer_date);
      if (!t.family_id || !date) return;
      const k = `${t.family_id}|${date}`;
      m.set(k, (m.get(k) || 0) + (Number(t.quantity) || 0));
    });
    return m;
  }, [transfers]);

  const pendingByDay = useMemo(() => {
    const td = today();
    const prod = new Map<string, { date: string; family_id: string; produced: number; records: any[] }>();

    (eggs || []).forEach((e: any) => {
      const date = localDateKey(e.production_date);
      if (!e.family_id || !date) return;
      if (date > td) return;
      if (winFrom && date < winFrom) return;
      if (winTo && date > winTo) return;
      const k = `${e.family_id}|${date}`;
      const cur = prod.get(k) || { date, family_id: e.family_id, produced: 0, records: [] };
      cur.produced += Number(e.egg_count) || 0;
      cur.records.push(e);
      prod.set(k, cur);
    });

    const map = new Map<string, { date: string; entries: any[]; totalQty: number; transferredTotal: number; producedTotal: number; familyCount: number }>();

    prod.forEach((p, k) => {
      const transferred = transferredByFamilyDate.get(k) || 0;
      const remaining = Math.max(0, p.produced - transferred);
      if (remaining <= 0) return;
      const cur = map.get(p.date) || { date: p.date, entries: [], totalQty: 0, transferredTotal: 0, producedTotal: 0, familyCount: 0 };
      cur.entries.push({ family_id: p.family_id, qty: remaining, produced: p.produced, transferred, records: p.records });
      cur.totalQty += remaining;
      cur.transferredTotal += transferred;
      cur.producedTotal += p.produced;
      map.set(p.date, cur);
    });

    map.forEach((v) => { v.familyCount = v.entries.length; });
    return Array.from(map.values())
      .filter((d) => d.totalQty > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [eggs, transferredByFamilyDate, winFrom, winTo]);

  const batchSummary = useMemo(() => {
    const totalQty = pendingByDay.reduce((s, d) => s + d.totalQty, 0);
    const dates = pendingByDay.map((d) => d.date);
    const minD = dates[0] || winFrom;
    const maxD = dates[dates.length - 1] || winTo;
    const shortLabel = dates.map((d) => {
      const [, mm, dd] = d.split("-");
      return `${Number(dd)}/${Number(mm)}`;
    }).join(" + ");
    return { totalQty, dayCount: dates.length, minD, maxD, shortLabel };
  }, [pendingByDay, winFrom, winTo]);

  const transferBatch = useMutation({
    mutationFn: async () => {
      const rows = pendingByDay.flatMap((d) =>
        d.entries.filter((e: any) => e.qty > 0).map((e: any) => ({
          transfer_date: d.date,
          family_id: e.family_id,
          quantity: e.qty,
          damaged: 0,
          notes: `دفعة نقل من ${batchSummary.minD} إلى ${batchSummary.maxD}`,
        }))
      );
      if (!rows.length) throw new Error("لا يوجد بيض للنقل");
      const { error } = await supabase.from("farm_transfers").insert(rows);
      if (error) throw error;
      return { count: rows.length, qty: rows.reduce((s, r) => s + r.quantity, 0) };
    },
    onSuccess: (r) => {
      toast.success(`تم نقل ${r.qty} بيضة (${r.count} حركة) كدفعة واحدة إلى المعمل`);
      qc.invalidateQueries({ queryKey: ["farm_transfers"] });
      qc.invalidateQueries({ queryKey: ["farm_egg_production"] });
      setBusy(false); setViewOpen(false);
    },
    onError: (e: any) => { toast.error(e.message); setBusy(false); },
  });

  const handleTransferBatch = () => {
    if (busy) return;
    if (!pendingByDay.length) { toast.error("لا يوجد بيض غير منقول في الفترة المحددة"); return; }
    if (!confirm(`نقل دفعة كاملة: ${batchSummary.totalQty} بيضة عبر ${batchSummary.dayCount} يوم من ${batchSummary.minD} إلى ${batchSummary.maxD}؟`)) return;
    setBusy(true);
    transferBatch.mutate();
  };

  return (
    <Card className="p-4 mb-4 border-purple-200">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className="font-bold text-purple-700">البيض غير المنقول — دفعة النقل الحالية</h3>
        <Badge variant="secondary">{batchSummary.dayCount} يوم • إجمالي {batchSummary.totalQty.toLocaleString()} بيضة</Badge>
      </div>

      <div className="flex flex-wrap items-end gap-2 mb-3 p-2 rounded bg-purple-50/40 dark:bg-purple-950/20 border border-purple-200">
        <div className="text-xs font-medium text-purple-700 dark:text-purple-300 ml-2">فترة النقل الحالية:</div>
        <div>
          <Label className="text-xs">من تاريخ</Label>
          <Input type="date" value={winFrom} onChange={(e) => setWinFrom(e.target.value)} className="h-8 w-[160px]" />
        </div>
        <div>
          <Label className="text-xs">إلى تاريخ</Label>
          <Input type="date" value={winTo} onChange={(e) => setWinTo(e.target.value)} className="h-8 w-[160px]" />
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={() => { setWinFrom(defaultFrom); setWinTo("2026-06-19"); }}>
          الفترة الافتراضية
        </Button>
        <div className="text-xs text-muted-foreground mr-auto">الأيام القديمة خارج هذه الفترة مخفية</div>
      </div>

      {pendingByDay.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-6">لا يوجد بيض غير منقول داخل الفترة المحددة.</div>
      ) : (
        <div className="overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>اسم الدفعة</TableHead>
                <TableHead>من — إلى</TableHead>
                <TableHead>عدد الأيام</TableHead>
                <TableHead>إجمالي البيض</TableHead>
                <TableHead>تفاصيل مختصرة</TableHead>
                <TableHead className="text-center">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-semibold text-purple-700">
                  دفعة نقل البيض من {batchSummary.minD} إلى {batchSummary.maxD}
                </TableCell>
                <TableCell className="text-xs">
                  <div>من: <b>{batchSummary.minD}</b></div>
                  <div>إلى: <b>{batchSummary.maxD}</b></div>
                </TableCell>
                <TableCell><Badge variant="outline">{batchSummary.dayCount}</Badge></TableCell>
                <TableCell className="font-bold text-purple-600">{batchSummary.totalQty.toLocaleString()}</TableCell>
                <TableCell className="text-xs text-muted-foreground max-w-[320px] truncate" title={batchSummary.shortLabel}>
                  {batchSummary.shortLabel}
                </TableCell>
                <TableCell>
                  <div className="flex gap-2 justify-center">
                    <Button size="sm" variant="outline" onClick={() => setViewOpen(true)}>
                      <Eye className="w-4 h-4 ml-1" />رؤية التفاصيل
                    </Button>
                    <Button size="sm" disabled={busy} onClick={handleTransferBatch}>
                      <Truck className="w-4 h-4 ml-1" />{busy ? "جارٍ النقل..." : "نقل للمعمل"}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent dir="rtl" className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>تفاصيل دفعة النقل من {batchSummary.minD} إلى {batchSummary.maxD}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              إجمالي: <b className="text-purple-600">{batchSummary.totalQty.toLocaleString()}</b> بيضة عبر <b>{batchSummary.dayCount}</b> يوم
            </div>
            <div className="overflow-auto max-h-[60vh]">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>عدد الأسر</TableHead>
                  <TableHead>إجمالي البيض</TableHead>
                  <TableHead>المنقول سابقًا</TableHead>
                  <TableHead>المتبقي للنقل</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {pendingByDay.map((d) => (
                    <TableRow key={d.date}>
                      <TableCell className="font-medium">{d.date}</TableCell>
                      <TableCell><Badge variant="outline">{d.familyCount}</Badge></TableCell>
                      <TableCell>{d.producedTotal.toLocaleString()}</TableCell>
                      <TableCell className="text-muted-foreground">{d.transferredTotal.toLocaleString()}</TableCell>
                      <TableCell className="font-bold text-purple-600">{d.totalQty.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <DialogFooter>
              <Button onClick={handleTransferBatch} disabled={busy}>
                <Truck className="w-4 h-4 ml-1" />{busy ? "جارٍ النقل..." : "نقل الدفعة كاملة للمعمل"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
};




const TransfersTab = ({ transfers, families, eggs = [], qc }: any) => {
  const [open, setOpen] = useState(false);
  const [batchFrom, setBatchFrom] = useState(today());
  const [batchTo, setBatchTo] = useState(today());
  const [batchLabel, setBatchLabel] = useState("");
  const [batchNotes, setBatchNotes] = useState("");
  const [rows, setRows] = useState<any[]>([emptyRow()]);
  const [autoLoaded, setAutoLoaded] = useState<{ count: number; from: string; to: string; totalQty: number } | null>(null);
  const [autoLoading, setAutoLoading] = useState(false);
  const [selectedDays, setSelectedDays] = useState<Set<string>>(new Set());

  // Window for "available days" — defaults to last 7 days (today-6 .. today).
  // Old historical days are hidden unless the user widens the window.
  const defaultWinFrom = "2026-06-13";
  const [winFrom, setWinFrom] = useState<string>(defaultWinFrom);
  const [winTo, setWinTo] = useState<string>("2026-06-19");

  // Per-day availability based on per-(family,date) production minus transferred quantity.
  // Filtered to the current transfer-window [winFrom..winTo] so old historical days
  // (e.g. January) do not appear in the picker.
  const availableDays = useMemo(() => {
    const td = today();
    const prod = new Map<string, { date: string; family_id: string; produced: number }>();
    (eggs || []).forEach((e: any) => {
      if (!e.family_id || !e.production_date) return;
      if (e.production_date > td) return;
      if (winFrom && e.production_date < winFrom) return;
      if (winTo && e.production_date > winTo) return;
      const k = `${e.family_id}|${e.production_date}`;
      const cur = prod.get(k) || { date: e.production_date, family_id: e.family_id, produced: 0 };
      cur.produced += Number(e.egg_count) || 0;
      prod.set(k, cur);
    });
    const trans = new Map<string, number>();
    (transfers || []).forEach((t: any) => {
      if (!t.family_id || !t.transfer_date) return;
      const k = `${t.family_id}|${t.transfer_date}`;
      trans.set(k, (trans.get(k) || 0) + (Number(t.quantity) || 0));
    });
    const byDay = new Map<string, {
      date: string; produced: number; transferred: number; remaining: number;
      entries: { family_id: string; produced: number; transferred: number; remaining: number }[];
    }>();
    prod.forEach((p, k) => {
      const transferred = trans.get(k) || 0;
      const remaining = Math.max(0, p.produced - transferred);
      const cur = byDay.get(p.date) || { date: p.date, produced: 0, transferred: 0, remaining: 0, entries: [] };
      cur.produced += p.produced;
      cur.transferred += transferred;
      cur.remaining += remaining;
      cur.entries.push({ family_id: p.family_id, produced: p.produced, transferred, remaining });
      byDay.set(p.date, cur);
    });
    return Array.from(byDay.values())
      .filter((d) => d.produced > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [eggs, transfers, winFrom, winTo]);


  const toggleDay = (d: string) => setSelectedDays((prev) => {
    const n = new Set(prev); n.has(d) ? n.delete(d) : n.add(d); return n;
  });
  const toggleAllAvailable = () => setSelectedDays((prev) => {
    const avail = availableDays.filter((d) => d.remaining > 0).map((d) => d.date);
    if (avail.every((d) => prev.has(d))) return new Set();
    return new Set(avail);
  });

  const selectedTotal = useMemo(() => availableDays
    .filter((d) => selectedDays.has(d.date))
    .reduce((s, d) => s + d.remaining, 0), [availableDays, selectedDays]);

  const loadSelectedDays = () => {
    const days = availableDays.filter((d) => selectedDays.has(d.date) && d.remaining > 0);
    if (!days.length) { toast.error("اختر يومًا واحدًا على الأقل به رصيد متبقي للنقل"); return; }
    const newRows = days.flatMap((d) =>
      d.entries.filter((e) => e.remaining > 0).map((e) => ({
        transfer_date: d.date,
        family_id: e.family_id,
        quantity: String(e.remaining),
        damaged: "",
        notes: "تحميل من اختيار أيام النقل",
      }))
    );
    const totalQty = newRows.reduce((s, r) => s + (Number(r.quantity) || 0), 0);
    const dates = newRows.map((r) => r.transfer_date).sort();
    const minD = dates[0], maxD = dates[dates.length - 1];
    setRows(newRows);
    setBatchFrom(minD); setBatchTo(maxD);
    setAutoLoaded({ count: newRows.length, from: minD, to: maxD, totalQty });
    toast.success(`تم تحميل ${days.length} يوم (${newRows.length} سجل) — إجمالي ${totalQty.toLocaleString()} بيضة`);
  };

  const resetForm = () => {
    setRows([emptyRow()]);
    setBatchFrom(today()); setBatchTo(today());
    setBatchLabel(""); setBatchNotes("");
    setAutoLoaded(null);
    setSelectedDays(new Set());
  };

  // Compute pending production using per-(family,date) accounting:
  // remaining = produced(family,date) - SUM(transfers(family,date)). This guarantees a day
  // is included whenever it still has un-transferred eggs, regardless of any later transfer
  // dates that exist for the same family. Uses local YYYY-MM-DD (no UTC shift).
  const autoLoadPending = async () => {
    setAutoLoading(true);
    try {
      const all: any[] = [];
      let from = 0; const size = 1000;
      while (true) {
        const { data, error } = await supabase.from("farm_egg_production")
          .select("production_date,family_id,egg_count")
          .order("production_date", { ascending: true })
          .range(from, from + size - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < size) break;
        from += size;
      }

      const transAll: any[] = [];
      {
        let fromT = 0;
        while (true) {
          const { data, error } = await supabase.from("farm_transfers")
            .select("transfer_date,family_id,quantity")
            .range(fromT, fromT + size - 1);
          if (error) throw error;
          if (!data || data.length === 0) break;
          transAll.push(...data);
          if (data.length < size) break;
          fromT += size;
        }
      }

      const td = today();
      const transMap = new Map<string, number>();
      transAll.forEach((t: any) => {
        if (!t.family_id || !t.transfer_date) return;
        const k = `${t.family_id}|${t.transfer_date}`;
        transMap.set(k, (transMap.get(k) || 0) + (Number(t.quantity) || 0));
      });

      const prodMap = new Map<string, { date: string; family_id: string; produced: number }>();
      all.forEach((e: any) => {
        if (!e.family_id || !e.production_date) return;
        if (e.production_date > td) return;
        const k = `${e.family_id}|${e.production_date}`;
        const cur = prodMap.get(k) || { date: e.production_date, family_id: e.family_id, produced: 0 };
        cur.produced += Number(e.egg_count) || 0;
        prodMap.set(k, cur);
      });

      const pending = Array.from(prodMap.entries())
        .map(([k, p]) => ({ ...p, qty: Math.max(0, p.produced - (transMap.get(k) || 0)) }))
        .filter((p) => p.qty > 0);

      if (!pending.length) {
        toast.info("لا يوجد بيض غير منقول حاليًا");
        setRows([emptyRow()]);
        setAutoLoaded({ count: 0, from: "", to: "", totalQty: 0 });
        return;
      }

      const newRows = pending
        .sort((a, b) => a.date.localeCompare(b.date) || String(a.family_id).localeCompare(String(b.family_id)))
        .map((g) => ({
          transfer_date: g.date,
          family_id: g.family_id,
          quantity: String(g.qty),
          damaged: "",
          notes: "تحميل تلقائي من الإنتاج اليومي",
        }));
      const dates = newRows.map((r) => r.transfer_date);
      const minD = dates[0], maxD = dates[dates.length - 1];
      const totalQty = newRows.reduce((s, r) => s + (Number(r.quantity) || 0), 0);
      setBatchFrom(minD); setBatchTo(maxD);
      setRows(newRows);
      setAutoLoaded({ count: newRows.length, from: minD, to: maxD, totalQty });
      toast.success(`تم تحميل ${newRows.length} سجل من الإنتاج غير المنقول — إجمالي البيض: ${totalQty.toLocaleString()}`);
    } catch (e: any) {
      toast.error(e.message || "فشل تحميل الإنتاج");
    } finally {
      setAutoLoading(false);
    }
  };

  // Open dialog — show day-selection checkboxes; user picks days then loads rows.
  const openDialog = async () => {
    resetForm();
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      const valid = rows
        .filter((r) => Number(r.quantity) > 0 || Number(r.damaged) > 0)
        .map((r) => ({
          transfer_date: r.transfer_date,
          family_id: r.family_id || null,
          quantity: Number(r.quantity) || 0,
          damaged: Number(r.damaged) || 0,
          notes: [batchLabel && `دفعة: ${batchLabel}`, batchNotes, r.notes]
            .filter(Boolean).join(" | ") || null,
        }));
      if (!valid.length) throw new Error("أضف صفًا واحدًا على الأقل بكمية");
      const { error } = await supabase.from("farm_transfers").insert(valid);
      if (error) throw error;
      return valid.length;
    },
    onSuccess: (n) => {
      toast.success(`تم تسجيل ${n} عملية نقل`);
      setOpen(false); resetForm();
      qc.invalidateQueries({ queryKey: ["farm_transfers"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("farm_transfers").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["farm_transfers"] }),
  });

  const familyName = (id: string) => families.find((f: any) => f.id === id)?.family_number || "-";

  const [fFamily, setFFamily] = useState("all");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const filtered = useMemo(() => transfers.filter((t: any) => {
    if (fFamily !== "all" && t.family_id !== fFamily) return false;
    if (fFrom && t.transfer_date < fFrom) return false;
    if (fTo && t.transfer_date > fTo) return false;
    return true;
  }), [transfers, fFamily, fFrom, fTo]);
  const totals = useMemo(() => filtered.reduce((a: any, t: any) => ({ q: a.q + (t.quantity || 0), d: a.d + (t.damaged || 0) }), { q: 0, d: 0 }), [filtered]);

  const rowTotals = useMemo(() => rows.reduce(
    (a, r) => ({ q: a.q + (Number(r.quantity) || 0), d: a.d + (Number(r.damaged) || 0) }),
    { q: 0, d: 0 }
  ), [rows]);

  const updateRow = (i: number, patch: any) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, { ...emptyRow(), transfer_date: batchTo || today() }]);
  const addRowAll = () =>
    setRows((rs) => [
      ...rs,
      ...families.map((f: any) => ({ ...emptyRow(), transfer_date: batchTo || today(), family_id: f.id })),
    ]);
  const removeRow = (i: number) =>
    setRows((rs) => (rs.length === 1 ? [emptyRow()] : rs.filter((_, idx) => idx !== i)));

  const exportReport = () => {
    if (!filtered.length) { toast.error("لا توجد بيانات للتصدير"); return; }
    const data = filtered.map((t: any) => ({
      التاريخ: t.transfer_date,
      الأسرة: familyName(t.family_id),
      الكمية: t.quantity || 0,
      الهالك: t.damaged || 0,
      الصافي: (t.quantity || 0) - (t.damaged || 0),
      ملاحظات: t.notes || "",
    }));
    data.push({ التاريخ: "الإجمالي", الأسرة: "", الكمية: totals.q, الهالك: totals.d, الصافي: totals.q - totals.d, ملاحظات: "" } as any);
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "نقل للمعمل");
    const period = `${fFrom || "الكل"}_${fTo || "الكل"}`;
    XLSX.writeFile(wb, `تقرير_نقل_للمعمل_${period}.xlsx`);
    toast.success("تم تصدير التقرير");
  };

  // Professional Arabic PDF for the pending production currently loaded in the dialog
  const exportPendingPdf = () => {
    const valid = rows.filter((r) => Number(r.quantity) > 0 || Number(r.damaged) > 0);
    if (!valid.length) { toast.error("لا توجد صفوف للتصدير"); return; }
    const esc = (s: any) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
    const totalQ = valid.reduce((s, r) => s + (Number(r.quantity) || 0), 0);
    const totalD = valid.reduce((s, r) => s + (Number(r.damaged) || 0), 0);
    const period = (autoLoaded && autoLoaded.count > 0)
      ? `${autoLoaded.from} → ${autoLoaded.to}`
      : `${batchFrom} → ${batchTo}`;
    const printedAt = new Date().toLocaleString("ar-EG");
    const rowsHtml = valid.map((r, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${esc(r.transfer_date)}</td>
        <td>${esc(familyName(r.family_id))}</td>
        <td class="num">${(Number(r.quantity) || 0).toLocaleString()}</td>
        <td class="num">${(Number(r.damaged) || 0).toLocaleString()}</td>
        <td class="num">${((Number(r.quantity) || 0) - (Number(r.damaged) || 0)).toLocaleString()}</td>
        <td>${esc(r.notes || "—")}</td>
      </tr>`).join("");

    const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<title>تقرير الإنتاج غير المنقول للمعمل</title>
<style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { font-family: "Cairo","Tajawal","Noto Naskh Arabic","Segoe UI",Tahoma,sans-serif; font-size: 12px; color:#111; margin:0; }
  header { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid #6b46c1; padding-bottom:10px; margin-bottom:12px; }
  header h1 { margin:0; font-size:20px; color:#6b46c1; }
  header .sub { font-size:11px; color:#666; margin-top:2px; }
  header .meta { text-align:left; font-size:10px; color:#444; line-height:1.6; }
  .summary { display:grid; grid-template-columns: repeat(4, 1fr); gap:8px; margin-bottom:14px; }
  .card { border:1px solid #ddd; border-radius:6px; padding:8px 10px; background:#fafafa; }
  .card .k { font-size:10px; color:#666; }
  .card .v { font-size:16px; font-weight:bold; color:#6b46c1; margin-top:2px; }
  .card.warn .v { color:#e85d3a; }
  .card.ok .v { color:#2e7d32; }
  table { width:100%; border-collapse:collapse; font-size:11px; }
  thead th { background:#6b46c1; color:#fff; padding:6px 8px; text-align:right; font-weight:bold; }
  tbody td { border:1px solid #e0e0e0; padding:5px 8px; text-align:right; }
  tbody tr:nth-child(even) td { background:#faf8ff; }
  td.num { font-variant-numeric: tabular-nums; font-weight:600; }
  tfoot td { background:#f5edff; font-weight:bold; padding:7px 8px; border:1px solid #cdb4f5; }
  .notes { margin-top:10px; padding:8px; background:#fff8e6; border:1px solid #f3d77a; border-radius:6px; font-size:11px; }
  .signatures { display:grid; grid-template-columns: repeat(3, 1fr); gap:14px; margin-top:24px; }
  .sig { border-top:1px solid #999; padding-top:5px; font-size:10px; text-align:center; color:#666; }
  footer { position:fixed; bottom:6mm; left:0; right:0; text-align:center; font-size:9px; color:#888; }
  .no-print { padding:10px; background:#f5edff; text-align:center; }
  .no-print button { font-size:14px; padding:6px 18px; cursor:pointer; margin:0 4px; }
  @media print { .no-print { display:none; } }
</style></head><body>
<div class="no-print">
  <button onclick="window.print()">طباعة / حفظ كـ PDF</button>
  <button onclick="window.close()">إغلاق</button>
</div>
<header>
  <div>
    <h1>تقرير الإنتاج غير المنقول للمعمل</h1>
    <div class="sub">شركة عاصمة النعام — Capital Ostrich</div>
    <div class="sub">الفترة: <b>${esc(period)}</b></div>
    ${batchLabel ? `<div class="sub">الدفعة: <b>${esc(batchLabel)}</b></div>` : ""}
  </div>
  <div class="meta">
    <div>تاريخ الطباعة: ${esc(printedAt)}</div>
    <div>عدد السجلات: <b>${valid.length}</b></div>
  </div>
</header>
<div class="summary">
  <div class="card"><div class="k">عدد السجلات</div><div class="v">${valid.length.toLocaleString()}</div></div>
  <div class="card ok"><div class="k">إجمالي الكمية</div><div class="v">${totalQ.toLocaleString()}</div></div>
  <div class="card warn"><div class="k">إجمالي الهالك</div><div class="v">${totalD.toLocaleString()}</div></div>
  <div class="card"><div class="k">الصافي للنقل</div><div class="v">${(totalQ - totalD).toLocaleString()}</div></div>
</div>
<table>
  <thead><tr>
    <th style="width:32px">#</th><th>التاريخ</th><th>الأسرة</th>
    <th>الكمية</th><th>الهالك</th><th>الصافي</th><th>ملاحظات</th>
  </tr></thead>
  <tbody>${rowsHtml}</tbody>
  <tfoot><tr>
    <td colspan="3" style="text-align:center">الإجمالي</td>
    <td class="num">${totalQ.toLocaleString()}</td>
    <td class="num">${totalD.toLocaleString()}</td>
    <td class="num">${(totalQ - totalD).toLocaleString()}</td>
    <td></td>
  </tr></tfoot>
</table>
${batchNotes ? `<div class="notes"><b>ملاحظات الدفعة:</b> ${esc(batchNotes)}</div>` : ""}
<div class="signatures">
  <div class="sig">مسؤول المزرعة</div>
  <div class="sig">مسؤول المعمل</div>
  <div class="sig">المدير المسؤول</div>
</div>
<footer>تم إنشاء التقرير بواسطة نظام عاصمة النعام — ${esc(printedAt)}</footer>
<script>setTimeout(()=>window.focus(), 100);</script>
</body></html>`;

    const w = window.open("", "_blank", "width=1000,height=800");
    if (!w) { toast.error("تعذّر فتح نافذة الطباعة — اسمح بالنوافذ المنبثقة"); return; }
    w.document.open(); w.document.write(html); w.document.close();
    toast.success("تم تجهيز التقرير — استخدم زر الطباعة لحفظه PDF");
  };

  return (
    <Card className="p-4">
      <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2 text-xs leading-6">
        <b>اعتماد نقل تاريخي:</b> تم اعتماد نقل كل البيض السابق حتى <b>13-06-2026</b> إلى معمل التفريخ. بيضة <b>الأسرة 13</b> المتبقية تم نقل تاريخها إلى <b>14-06-2026</b> لتكون بداية تجميع الدفعة الجديدة.
      </div>

      <PendingByDayPanel eggs={eggs} transfers={transfers} families={families} qc={qc} familyName={familyName} />
      <div className="flex flex-wrap justify-between items-center gap-2 mb-3">
        <h3 className="font-bold">نقل البيض للمعمل (المنقول: {totals.q.toLocaleString()} - هالك: {totals.d.toLocaleString()})</h3>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={exportReport}><Download className="w-4 h-4 ml-1" />تصدير تقرير المدة</Button>
          <Dialog open={open} onOpenChange={(v) => { if (v) openDialog(); else { setOpen(false); resetForm(); } }}>
            <DialogTrigger asChild><Button size="sm"><Plus className="w-4 h-4 ml-1" />تسجيل دفعة نقل</Button></DialogTrigger>
            <DialogContent dir="rtl" className="max-w-4xl max-h-[90vh] overflow-auto">
              <DialogHeader>
                <DialogTitle>تسجيل دفعة نقل للمعمل</DialogTitle>
                <p className="text-xs text-muted-foreground">يتم تحميل الإنتاج غير المنقول تلقائيًا — راجع الصفوف ثم اضغط حفظ</p>
              </DialogHeader>
              <div className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div><Label>من تاريخ</Label><Input type="date" value={batchFrom} onChange={(e) => setBatchFrom(e.target.value)} /></div>
                  <div><Label>إلى تاريخ</Label><Input type="date" value={batchTo} onChange={(e) => setBatchTo(e.target.value)} /></div>
                  <div className="md:col-span-2"><Label>اسم/رقم الدفعة (اختياري)</Label><Input value={batchLabel} onChange={(e) => setBatchLabel(e.target.value)} placeholder="مثال: دفعة 1 - مايو" /></div>
                </div>
                <div><Label>ملاحظات الدفعة</Label><Textarea rows={2} value={batchNotes} onChange={(e) => setBatchNotes(e.target.value)} /></div>

                {/* Day-selection checkbox panel */}
                <div className="border rounded-md p-3 bg-purple-50/50 dark:bg-purple-950/20">
                  <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                    <div className="font-semibold text-purple-700 dark:text-purple-300 text-sm">
                      اختر أيام النقل إلى معمل التفريخ ({availableDays.filter((d) => d.remaining > 0).length} يوم متاح)
                    </div>
                    <div className="flex gap-2 items-center text-xs">
                      <Button type="button" size="sm" variant="ghost" onClick={toggleAllAvailable}>
                        تحديد / إلغاء الكل
                      </Button>
                      <span>
                        المحدد: <b className="text-primary">{selectedDays.size}</b> يوم —
                        إجمالي: <b className="text-primary">{selectedTotal.toLocaleString()}</b> بيضة
                      </span>
                      <Button type="button" size="sm" onClick={loadSelectedDays} disabled={selectedDays.size === 0}>
                        تحميل الأيام المحددة في الجدول
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-end gap-2 mb-2 p-2 rounded bg-background/60 border">
                    <div className="text-xs font-medium text-purple-700 dark:text-purple-300 ml-2">
                      فترة النقل الحالية:
                    </div>
                    <div>
                      <Label className="text-xs">من تاريخ</Label>
                      <Input type="date" value={winFrom} onChange={(e) => setWinFrom(e.target.value)} className="h-8 w-[160px]" />
                    </div>
                    <div>
                      <Label className="text-xs">إلى تاريخ</Label>
                      <Input type="date" value={winTo} onChange={(e) => setWinTo(e.target.value)} className="h-8 w-[160px]" />
                    </div>
                    <Button type="button" size="sm" variant="ghost" onClick={() => { setWinFrom(defaultWinFrom); setWinTo("2026-06-19"); }}>
                      الفترة الافتراضية
                    </Button>
                    <div className="text-xs text-muted-foreground mr-auto">
                      يتم عرض الأيام داخل هذه الفترة فقط — الأيام القديمة مخفية
                    </div>
                  </div>

                  <div className="overflow-auto max-h-[32vh] border rounded bg-background">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10"></TableHead>
                          <TableHead>التاريخ</TableHead>
                          <TableHead>المنتج</TableHead>
                          <TableHead>المنقول سابقًا</TableHead>
                          <TableHead>المتبقي للنقل</TableHead>
                          <TableHead>الحالة</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {availableDays.length === 0 && (
                          <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-4">لا يوجد إنتاج مسجل</TableCell></TableRow>
                        )}
                        {availableDays.map((d) => {
                          const fully = d.remaining <= 0;
                          return (
                            <TableRow key={d.date} className={fully ? "opacity-60" : ""}>
                              <TableCell>
                                <Checkbox
                                  checked={selectedDays.has(d.date)}
                                  disabled={fully}
                                  onCheckedChange={() => toggleDay(d.date)}
                                />
                              </TableCell>
                              <TableCell className="font-medium">{d.date}</TableCell>
                              <TableCell>{d.produced.toLocaleString()}</TableCell>
                              <TableCell className="text-muted-foreground">{d.transferred.toLocaleString()}</TableCell>
                              <TableCell className="font-bold text-purple-600">{d.remaining.toLocaleString()}</TableCell>
                              <TableCell>
                                {fully
                                  ? <Badge variant="outline" className="text-emerald-700 border-emerald-300">تم نقله بالكامل</Badge>
                                  : <Badge variant="outline" className="text-amber-700 border-amber-300">متاح للنقل</Badge>}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </div>


                <div className="flex gap-2 flex-wrap items-center">
                  <Button type="button" size="sm" variant="secondary" onClick={autoLoadPending} disabled={autoLoading}>
                    {autoLoading ? "جارٍ التحميل..." : "تحميل الإنتاج غير المنقول"}
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={exportPendingPdf}>
                    <Download className="w-4 h-4 ml-1" />تصدير PDF
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={addRow}><Plus className="w-4 h-4 ml-1" />إضافة صف</Button>
                  <Button type="button" size="sm" variant="outline" onClick={addRowAll}>إضافة كل الأسر</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setRows([emptyRow()])}>مسح الكل</Button>
                  <div className="text-xs text-muted-foreground mr-auto">
                    إجمالي الكمية: <span className="font-bold text-primary">{rowTotals.q.toLocaleString()}</span> -
                    الهالك: <span className="font-bold text-destructive">{rowTotals.d.toLocaleString()}</span>
                  </div>
                </div>
                {autoLoaded && autoLoaded.count > 0 && (
                  <div className="text-xs bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-200 rounded p-2">
                    تم تحميل <b>{autoLoaded.count}</b> سجل تلقائيًا من الإنتاج اليومي ({autoLoaded.from} → {autoLoaded.to}). إجمالي البيض: <b>{autoLoaded.totalQty.toLocaleString()}</b> — يمكنك التعديل قبل الحفظ.
                  </div>
                )}
                {autoLoaded && autoLoaded.count === 0 && (
                  <div className="text-xs bg-muted border rounded p-2 text-muted-foreground">
                    لا يوجد إنتاج جديد بعد آخر نقل لكل أسرة. يمكنك إضافة صفوف يدويًا.
                  </div>
                )}

                <div className="border rounded overflow-auto max-h-[50vh]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>التاريخ</TableHead>
                        <TableHead>الأسرة</TableHead>
                        <TableHead>الكمية</TableHead>
                        <TableHead>الهالك</TableHead>
                        <TableHead>ملاحظة</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r, i) => (
                        <TableRow key={i}>
                          <TableCell><Input type="date" value={r.transfer_date} onChange={(e) => updateRow(i, { transfer_date: e.target.value })} /></TableCell>
                          <TableCell>
                            <Select value={r.family_id} onValueChange={(v) => updateRow(i, { family_id: v })}>
                              <SelectTrigger className="min-w-[120px]"><SelectValue placeholder="اختر" /></SelectTrigger>
                              <SelectContent>{families.map((f: any) => <SelectItem key={f.id} value={f.id}>{f.family_number}</SelectItem>)}</SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell><Input type="number" min="0" value={r.quantity} onChange={(e) => updateRow(i, { quantity: e.target.value })} className="w-24" /></TableCell>
                          <TableCell><Input type="number" min="0" value={r.damaged} onChange={(e) => updateRow(i, { damaged: e.target.value })} className="w-20" /></TableCell>
                          <TableCell><Input value={r.notes} onChange={(e) => updateRow(i, { notes: e.target.value })} placeholder="-" /></TableCell>
                          <TableCell><Button size="icon" variant="ghost" onClick={() => removeRow(i)}><Trash2 className="w-4 h-4 text-destructive" /></Button></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={() => save.mutate()} disabled={save.isPending}>
                  حفظ الدفعة ({rows.filter((r) => Number(r.quantity) > 0 || Number(r.damaged) > 0).length} سجل)
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3">
        <Select value={fFamily} onValueChange={setFFamily}>
          <SelectTrigger><SelectValue placeholder="كل الأسر" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الأسر</SelectItem>
            {families.map((f: any) => <SelectItem key={f.id} value={f.id}>{f.family_number}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} />
        <Input type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} />
      </div>
      <div className="overflow-auto max-h-[600px]">
        <Table>
          <TableHeader><TableRow><TableHead>التاريخ</TableHead><TableHead>الأسرة</TableHead><TableHead>الكمية</TableHead><TableHead>الهالك</TableHead><TableHead>ملاحظات</TableHead><TableHead></TableHead></TableRow></TableHeader>
          <TableBody>
            {filtered.slice(0, 500).map((t: any) => (
              <TableRow key={t.id}>
                <TableCell>{t.transfer_date}</TableCell>
                <TableCell>{familyName(t.family_id)}</TableCell>
                <TableCell className="font-bold text-purple-600">{t.quantity}</TableCell>
                <TableCell className="text-destructive">{t.damaged}</TableCell>
                <TableCell className="text-xs">{t.notes || "-"}</TableCell>
                <TableCell><Button size="icon" variant="ghost" onClick={() => del.mutate(t.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button></TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">لا توجد عمليات نقل</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
};

// ============ CHARTS ============
const ChartsTab = ({ eggs, transfers, families }: any) => {
  const [year, setYear] = useState(2026);
  const [selFamily, setSelFamily] = useState<string>("all");

  const monthly = useMemo(() => {
    const arr = Array.from({ length: 12 }, (_, i) => ({ name: `${i + 1}`, "إنتاج": 0, "نقل": 0 }));
    eggs.forEach((e: any) => { const d = new Date(e.production_date); if (d.getFullYear() === year) arr[d.getMonth()]["إنتاج"] += e.egg_count || 0; });
    transfers.forEach((t: any) => { const d = new Date(t.transfer_date); if (d.getFullYear() === year) arr[d.getMonth()]["نقل"] += t.quantity || 0; });
    return arr;
  }, [eggs, transfers, year]);

  const byFamily = useMemo(() => {
    const map: Record<string, number> = {};
    eggs.forEach((e: any) => { const d = new Date(e.production_date); if (d.getFullYear() === year && e.family_id) map[e.family_id] = (map[e.family_id] || 0) + (e.egg_count || 0); });
    return families
      .map((f: any) => ({ name: `أسرة ${f.family_number}`, "إنتاج": map[f.id] || 0 }))
      .sort((a: any, b: any) => {
        const na = parseInt(a.name.replace(/\D/g, ""));
        const nb = parseInt(b.name.replace(/\D/g, ""));
        return na - nb;
      });
  }, [eggs, families, year]);

  const familyMonthly = useMemo(() => {
    const arr = Array.from({ length: 12 }, (_, i) => ({ name: `${i + 1}`, "إنتاج": 0 }));
    eggs.forEach((e: any) => {
      const d = new Date(e.production_date);
      if (d.getFullYear() !== year) return;
      if (selFamily !== "all" && e.family_id !== selFamily) return;
      arr[d.getMonth()]["إنتاج"] += e.egg_count || 0;
    });
    return arr;
  }, [eggs, year, selFamily]);

  const last30 = useMemo(() => {
    const map: Record<string, number> = {};
    eggs.forEach((e: any) => { map[e.production_date] = (map[e.production_date] || 0) + (e.egg_count || 0); });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).slice(-30).map(([d, v]) => ({ name: d.slice(5), "إنتاج": v }));
  }, [eggs]);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex justify-between items-center mb-3 gap-2 flex-wrap">
          <h3 className="font-bold">إنتاج وَنَقل شهري ({year})</h3>
          <Select value={String(year)} onValueChange={(v) => setYear(+v)}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>{[2024, 2025, 2026, 2027].map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="h-72">
          <ResponsiveContainer>
            <BarChart data={monthly}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip /><Legend />
              <Bar dataKey="إنتاج" fill="hsl(var(--accent))" />
              <Bar dataKey="نقل" fill="hsl(var(--primary))" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex justify-between items-center mb-3 gap-2 flex-wrap">
          <h3 className="font-bold">إنتاج شهري حسب الأسرة ({year})</h3>
          <Select value={selFamily} onValueChange={setSelFamily}>
            <SelectTrigger className="w-48"><SelectValue placeholder="اختر أسرة" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الأسر</SelectItem>
              {families.map((f: any) => <SelectItem key={f.id} value={f.id}>أسرة {f.family_number}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="h-64">
          <ResponsiveContainer>
            <LineChart data={familyMonthly}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip /><Legend />
              <Line type="monotone" dataKey="إنتاج" stroke="hsl(var(--primary))" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="font-bold mb-3">إجمالي البيض لكل أسرة ({year})</h3>
        <div style={{ height: Math.max(320, byFamily.length * 28) }}>
          <ResponsiveContainer>
            <BarChart data={byFamily} layout="vertical" margin={{ left: 60 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis type="category" dataKey="name" width={80} />
              <Tooltip />
              <Bar dataKey="إنتاج" fill="hsl(var(--primary))" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="font-bold mb-3">آخر 30 يوم - إنتاج البيض اليومي</h3>
        <div className="h-64">
          <ResponsiveContainer>
            <LineChart data={last30}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="إنتاج" stroke="hsl(var(--accent))" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
};
// ============ FEED ============
const MOTHER_FEED_START_DATE = "2026-06-14";

const FeedTab = ({ logs, qc }: any) => {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ log_date: today(), feed_type: "", quantity: 0, unit: "كجم", notes: "" });
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [viewDay, setViewDay] = useState<string | null>(null);
  const [busyDay, setBusyDay] = useState<string | null>(null);

  // Existing daily withdrawals from mother farm feed inventory
  const { data: withdrawnDays = [] } = useQuery({
    queryKey: ["mff_consumption_days"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mother_farm_feed_movements" as any)
        .select("consumption_day, weight_kg, id")
        .eq("movement_type", "daily_consumption")
        .order("consumption_day", { ascending: false })
        .limit(2000);
      if (error) throw error;
      return (data as any[]) || [];
    },
  });
  const withdrawnMap = useMemo(() => {
    const m = new Map<string, { id: string; weight_kg: number }>();
    withdrawnDays.forEach((d: any) => { if (d.consumption_day) m.set(d.consumption_day, { id: d.id, weight_kg: Number(d.weight_kg) }); });
    return m;
  }, [withdrawnDays]);

  const withdrawDay = useMutation({
    mutationFn: async (day: { date: string; total: number }) => {
      if (day.date < MOTHER_FEED_START_DATE) {
        throw new Error("هذا اليوم قبل بداية التشغيل الفعلي لسحب علف الأمهات ولا يتم خصمه من المخزون");
      }
      if (withdrawnMap.has(day.date)) {
        throw new Error("تم سحب علف هذا اليوم من قبل");
      }
      if (!(day.total > 0)) throw new Error("لا يوجد كمية للسحب");
      const { error } = await supabase.from("mother_farm_feed_movements" as any).insert({
        movement_date: day.date,
        movement_type: "daily_consumption",
        weight_kg: day.total,
        consumption_day: day.date,
        notes: `سحب يدوي من سجل الأمهات — reference_id=mother_feed_consumption_${day.date} — source=mother_farm_feed_daily_consumption`,
      });
      if (error) throw error;
      return day;
    },
    onSuccess: (r) => {
      toast.success(`تم سحب ${r.total.toLocaleString()} كجم من مخزون علف الأمهات ليوم ${r.date}`);
      qc.invalidateQueries({ queryKey: ["mff_consumption_days"] });
      qc.invalidateQueries({ queryKey: ["mff_balance"] });
      qc.invalidateQueries({ queryKey: ["mff_movements"] });
      setBusyDay(null);
    },
    onError: (e: any) => { toast.error(e.message); setBusyDay(null); },
  });

  const handleWithdraw = (d: { date: string; total: number }) => {
    if (busyDay) return;
    if (!confirm(`سحب ${d.total.toLocaleString()} كجم من مخزون علف الأمهات ليوم ${d.date}؟`)) return;
    setBusyDay(d.date);
    withdrawDay.mutate(d);
  };

  const save = useMutation({
    mutationFn: async () => { const { error } = await supabase.from("farm_feed_log").insert(form); if (error) throw error; },
    onSuccess: () => { toast.success("تم"); setOpen(false); setForm({ log_date: today(), feed_type: "", quantity: 0, unit: "كجم", notes: "" }); qc.invalidateQueries({ queryKey: ["farm_feed_log"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("farm_feed_log").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["farm_feed_log"] }),
  });

  const filtered = useMemo(() => {
    return logs.filter((l: any) => {
      if (fromDate && l.log_date < fromDate) return false;
      if (toDate && l.log_date > toDate) return false;
      return true;
    });
  }, [logs, fromDate, toDate]);

  const byDay = useMemo(() => {
    const m = new Map<string, { date: string; total: number; count: number; types: Set<string>; rows: any[] }>();
    filtered.forEach((l: any) => {
      const cur = m.get(l.log_date) || { date: l.log_date, total: 0, count: 0, types: new Set<string>(), rows: [] };
      cur.total += Number(l.quantity || 0);
      cur.count += 1;
      if (l.feed_type) cur.types.add(l.feed_type);
      cur.rows.push(l);
      m.set(l.log_date, cur);
    });
    return Array.from(m.values()).sort((a, b) => b.date.localeCompare(a.date));
  }, [filtered]);

  const cards = useMemo(() => {
    const td = today();
    const ms = monthStart();
    const todayTotal = filtered.filter((l: any) => l.log_date === td).reduce((s: number, l: any) => s + Number(l.quantity || 0), 0);
    const monthTotal = filtered.filter((l: any) => l.log_date >= ms).reduce((s: number, l: any) => s + Number(l.quantity || 0), 0);
    const days = byDay.length;
    const avg = days > 0 ? (byDay.reduce((s, d) => s + d.total, 0) / days) : 0;
    const top = byDay.reduce((acc: any, d) => (d.total > (acc?.total || 0) ? d : acc), null as any);
    return { todayTotal, monthTotal, avg, top };
  }, [filtered, byDay]);

  const viewDayData = viewDay ? byDay.find((d) => d.date === viewDay) : null;

  const printDay = (day: { date: string; total: number; count: number; rows: any[] }) => {
    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) return;
    const rowsHtml = day.rows.map((r: any) => `<tr><td>${r.feed_type || "-"}</td><td>${Number(r.quantity).toLocaleString()}</td><td>${r.unit || "-"}</td><td>${r.notes || "-"}</td></tr>`).join("");
    win.document.write(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>تقرير علف ${day.date}</title>
      <style>body{font-family:Tahoma,Arial;padding:24px}h1{text-align:center}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #999;padding:6px;text-align:center}.k{background:#eee}.sig{margin-top:60px;display:flex;justify-content:space-between}</style>
      </head><body>
      <h1>تقرير استهلاك العلف اليومي - مزرعة الأمهات</h1>
      <p><b>التاريخ:</b> ${day.date} &nbsp; <b>عدد التسجيلات:</b> ${day.count} &nbsp; <b>إجمالي العلف:</b> ${day.total.toLocaleString()} كجم</p>
      <table><thead class="k"><tr><th>نوع العلف</th><th>الكمية</th><th>الوحدة</th><th>ملاحظات</th></tr></thead><tbody>${rowsHtml}</tbody></table>
      <div class="sig"><div>توقيع مسؤول المزرعة: ____________</div><div>توقيع الإدارة: ____________</div></div>
      <script>window.print()</script></body></html>`);
    win.document.close();
  };

  return (
    <Card className="p-4 space-y-4">
      <div className="flex justify-between flex-wrap gap-2">
        <h3 className="font-bold">ملخص استهلاك العلف اليومي</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="w-4 h-4 ml-1" />تسجيل صرف</Button></DialogTrigger>
          <DialogContent dir="rtl">
            <DialogHeader><DialogTitle>صرف علف</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>التاريخ</Label><Input type="date" value={form.log_date} onChange={(e) => setForm({ ...form, log_date: e.target.value })} /></div>
              <div><Label>نوع العلف</Label><Input value={form.feed_type} onChange={(e) => setForm({ ...form, feed_type: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>الكمية</Label><Input type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: +e.target.value })} /></div>
                <div><Label>الوحدة</Label><Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></div>
              </div>
              <div><Label>ملاحظات</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            </div>
            <DialogFooter><Button onClick={() => save.mutate()} disabled={save.isPending}>حفظ</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Card className="p-3"><div className="text-xs text-muted-foreground">استهلاك اليوم</div><div className="text-xl font-bold">{cards.todayTotal.toLocaleString()} كجم</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">استهلاك الشهر</div><div className="text-xl font-bold">{cards.monthTotal.toLocaleString()} كجم</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">متوسط يومي</div><div className="text-xl font-bold">{cards.avg.toFixed(1)} كجم</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">أعلى يوم</div><div className="text-xl font-bold">{cards.top ? `${cards.top.total.toLocaleString()} كجم` : "-"}</div><div className="text-[10px] text-muted-foreground">{cards.top?.date || ""}</div></Card>
      </div>

      <div className="flex gap-2 items-end flex-wrap">
        <div><Label className="text-xs">من تاريخ</Label><Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-9 w-40" /></div>
        <div><Label className="text-xs">إلى تاريخ</Label><Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-9 w-40" /></div>
        {(fromDate || toDate) && <Button size="sm" variant="ghost" onClick={() => { setFromDate(""); setToDate(""); }}>مسح</Button>}
      </div>

      <div className="overflow-auto">
        <Table>
          <TableHeader><TableRow>
            <TableHead>التاريخ</TableHead>
            <TableHead>عدد التسجيلات</TableHead>
            <TableHead>إجمالي العلف (كجم)</TableHead>
            <TableHead>متوسط/تسجيل</TableHead>
            <TableHead>الأنواع</TableHead>
            <TableHead>حالة السحب</TableHead>
            <TableHead>إجراءات</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {byDay.map((d) => {
              const withdrawn = withdrawnMap.get(d.date);
              const beforeStart = d.date < MOTHER_FEED_START_DATE;
              const isBusy = busyDay === d.date;
              return (
                <TableRow key={d.date}>
                  <TableCell className="font-bold">{d.date}</TableCell>
                  <TableCell>{d.count}</TableCell>
                  <TableCell className="font-bold text-primary">{d.total.toLocaleString()}</TableCell>
                  <TableCell>{(d.total / d.count).toFixed(1)}</TableCell>
                  <TableCell className="text-xs">{Array.from(d.types).join("، ") || "-"}</TableCell>
                  <TableCell>
                    {beforeStart ? (
                      <Badge variant="outline" className="text-muted-foreground">قبل التشغيل</Badge>
                    ) : withdrawn ? (
                      <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-300">تم السحب ({Number(withdrawn.weight_kg).toLocaleString()} كجم)</Badge>
                    ) : (
                      <Badge variant="outline" className="text-amber-700 border-amber-300">لم يُسحب</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 items-center">
                      <Button size="icon" variant="ghost" onClick={() => setViewDay(d.date)}><Eye className="w-4 h-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => printDay(d)}><Printer className="w-4 h-4" /></Button>
                      {!beforeStart && !withdrawn && (
                        <Button size="sm" disabled={isBusy} onClick={() => handleWithdraw({ date: d.date, total: d.total })}>
                          <Wheat className="w-4 h-4 ml-1" />{isBusy ? "..." : "سحب العلف"}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {byDay.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">لا يوجد سجل علف</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!viewDay} onOpenChange={(v) => !v && setViewDay(null)}>
        <DialogContent dir="rtl" className="max-w-3xl">
          <DialogHeader><DialogTitle>تفاصيل استهلاك العلف - {viewDay}</DialogTitle></DialogHeader>
          {viewDayData && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-sm">
                <Card className="p-2"><div className="text-xs text-muted-foreground">الإجمالي</div><div className="font-bold">{viewDayData.total.toLocaleString()} كجم</div></Card>
                <Card className="p-2"><div className="text-xs text-muted-foreground">عدد التسجيلات</div><div className="font-bold">{viewDayData.count}</div></Card>
                <Card className="p-2"><div className="text-xs text-muted-foreground">عدد الأنواع</div><div className="font-bold">{viewDayData.types.size}</div></Card>
              </div>
              <Table>
                <TableHeader><TableRow><TableHead>نوع العلف</TableHead><TableHead>الكمية</TableHead><TableHead>الوحدة</TableHead><TableHead>ملاحظات</TableHead><TableHead></TableHead></TableRow></TableHeader>
                <TableBody>
                  {viewDayData.rows.map((r: any) => (
                    <TableRow key={r.id}>
                      <TableCell>{r.feed_type || "-"}</TableCell>
                      <TableCell className="font-bold">{Number(r.quantity).toLocaleString()}</TableCell>
                      <TableCell>{r.unit || "-"}</TableCell>
                      <TableCell className="text-xs">{r.notes || "-"}</TableCell>
                      <TableCell><Button size="icon" variant="ghost" onClick={() => del.mutate(r.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
};

// ============ MEDS ============
const MedsTab = ({ meds, families, qc }: any) => {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ med_date: today(), name: "", dose: "", family_id: "", notes: "" });

  const save = useMutation({
    mutationFn: async () => { const { error } = await supabase.from("farm_medications").insert({ ...form, family_id: form.family_id || null }); if (error) throw error; },
    onSuccess: () => { toast.success("تم"); setOpen(false); setForm({ med_date: today(), name: "", dose: "", family_id: "", notes: "" }); qc.invalidateQueries({ queryKey: ["farm_medications"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("farm_medications").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["farm_medications"] }),
  });
  const familyName = (id: string) => families.find((f: any) => f.id === id)?.family_number || "-";

  return (
    <Card className="p-4">
      <div className="flex justify-between mb-3">
        <h3 className="font-bold">الأدوية واللقاحات</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="w-4 h-4 ml-1" />تسجيل دواء</Button></DialogTrigger>
          <DialogContent dir="rtl">
            <DialogHeader><DialogTitle>دواء/لقاح</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>التاريخ</Label><Input type="date" value={form.med_date} onChange={(e) => setForm({ ...form, med_date: e.target.value })} /></div>
              <div><Label>الاسم</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div><Label>الجرعة</Label><Input value={form.dose} onChange={(e) => setForm({ ...form, dose: e.target.value })} /></div>
              <div><Label>الأسرة (اختياري)</Label>
                <Select value={form.family_id} onValueChange={(v) => setForm({ ...form, family_id: v })}>
                  <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                  <SelectContent>{families.map((f: any) => <SelectItem key={f.id} value={f.id}>{f.family_number}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>ملاحظات</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            </div>
            <DialogFooter><Button onClick={() => save.mutate()} disabled={save.isPending}>حفظ</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <div className="overflow-auto">
        <Table>
          <TableHeader><TableRow><TableHead>التاريخ</TableHead><TableHead>الاسم</TableHead><TableHead>الجرعة</TableHead><TableHead>الأسرة</TableHead><TableHead>ملاحظات</TableHead><TableHead></TableHead></TableRow></TableHeader>
          <TableBody>
            {meds.map((m: any) => (
              <TableRow key={m.id}>
                <TableCell>{m.med_date}</TableCell>
                <TableCell className="font-bold">{m.name}</TableCell>
                <TableCell>{m.dose || "-"}</TableCell>
                <TableCell>{familyName(m.family_id)}</TableCell>
                <TableCell className="text-xs">{m.notes || "-"}</TableCell>
                <TableCell><Button size="icon" variant="ghost" onClick={() => del.mutate(m.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button></TableCell>
              </TableRow>
            ))}
            {meds.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">لا يوجد سجل أدوية</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
};

export default Farm;
