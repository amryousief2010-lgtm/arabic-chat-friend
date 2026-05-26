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
import { Badge } from "@/components/ui/badge";
import { Egg, Plus, Truck, Wheat, Syringe, Users, Calendar, TrendingUp, Trash2, Search, BarChart3, Download } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { format } from "date-fns";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from "recharts";

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

        <Tabs defaultValue="families" dir="rtl">
          <TabsList className="grid grid-cols-2 md:grid-cols-6 w-full">
            <TabsTrigger value="families"><Users className="w-4 h-4 ml-1" />الأسر</TabsTrigger>
            <TabsTrigger value="eggs"><Egg className="w-4 h-4 ml-1" />الإنتاج اليومي</TabsTrigger>
            <TabsTrigger value="transfers"><Truck className="w-4 h-4 ml-1" />نقل للمعمل</TabsTrigger>
            <TabsTrigger value="feed"><Wheat className="w-4 h-4 ml-1" />العلف</TabsTrigger>
            <TabsTrigger value="meds"><Syringe className="w-4 h-4 ml-1" />الأدوية</TabsTrigger>
            <TabsTrigger value="charts"><BarChart3 className="w-4 h-4 ml-1" />تحليلات</TabsTrigger>
          </TabsList>

          <TabsContent value="families"><FamiliesTab families={families} qc={qc} /></TabsContent>
          <TabsContent value="eggs"><EggsTab eggs={eggs} families={families} qc={qc} /></TabsContent>
          <TabsContent value="transfers"><TransfersTab transfers={transfers} families={families} qc={qc} /></TabsContent>
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
  const filtered = useMemo(() => eggs.filter((e: any) => {
    if (fFamily !== "all" && e.family_id !== fFamily) return false;
    if (fFrom && e.production_date < fFrom) return false;
    if (fTo && e.production_date > fTo) return false;
    return true;
  }), [eggs, fFamily, fFrom, fTo]);
  const total = filtered.reduce((s: number, e: any) => s + (e.egg_count || 0), 0);

  const exportReport = () => {
    if (filtered.length === 0) { toast.error("لا توجد بيانات للتصدير"); return; }
    // Group by family
    const byFamily: Record<string, { name: string; total: number; days: number }> = {};
    filtered.forEach((e: any) => {
      const fname = familyName(e.family_id);
      if (!byFamily[e.family_id]) byFamily[e.family_id] = { name: fname, total: 0, days: 0 };
      byFamily[e.family_id].total += e.egg_count || 0;
      byFamily[e.family_id].days += 1;
    });
    const summaryRows = Object.values(byFamily).map((f) => ({
      "الأسرة": f.name, "إجمالي البيض": f.total, "عدد الأيام": f.days, "متوسط يومي": +(f.total / (f.days || 1)).toFixed(1),
    }));
    summaryRows.push({ "الأسرة": "الإجمالي", "إجمالي البيض": total, "عدد الأيام": filtered.length, "متوسط يومي": +(total / (filtered.length || 1)).toFixed(1) });

    const detailRows = filtered.map((e: any) => ({
      "التاريخ": e.production_date, "الأسرة": familyName(e.family_id), "عدد البيض": e.egg_count, "ملاحظات": e.notes || "",
    }));

    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.json_to_sheet(summaryRows);
    XLSX.utils.book_append_sheet(wb, ws1, "ملخص الأسر");
    const ws2 = XLSX.utils.json_to_sheet(detailRows);
    XLSX.utils.book_append_sheet(wb, ws2, "تفاصيل الإنتاج");
    const period = `${fFrom || "بداية"}_${fTo || "نهاية"}`;
    XLSX.writeFile(wb, `تقرير_إنتاج_البيض_${period}.xlsx`);
    toast.success("تم تصدير التقرير بنجاح");
  };

  return (
    <Card className="p-4">
      <div className="flex justify-between mb-3">
        <h3 className="font-bold">إنتاج البيض اليومي ({total.toLocaleString()} بيضة)</h3>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={exportReport} className="gap-1">
            <Download className="w-4 h-4" />تصدير تقرير
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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3">
        <Select value={fFamily} onValueChange={setFFamily}>
          <SelectTrigger><SelectValue placeholder="كل الأسر" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الأسر</SelectItem>
            {families.map((f: any) => <SelectItem key={f.id} value={f.id}>{f.family_number}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} placeholder="من" />
        <Input type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} placeholder="إلى" />
      </div>
      <div className="overflow-auto max-h-[600px]">
        <Table>
          <TableHeader><TableRow><TableHead>التاريخ</TableHead><TableHead>الأسرة</TableHead><TableHead>البيض</TableHead><TableHead>ملاحظات</TableHead><TableHead></TableHead></TableRow></TableHeader>
          <TableBody>
            {filtered.slice(0, 500).map((e: any) => (
              <TableRow key={e.id}>
                <TableCell>{e.production_date}</TableCell>
                <TableCell>{familyName(e.family_id)}</TableCell>
                <TableCell className="font-bold text-orange-600">{e.egg_count}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{e.notes || "-"}</TableCell>
                <TableCell><Button size="icon" variant="ghost" onClick={() => del.mutate(e.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button></TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">لا يوجد إنتاج مطابق</TableCell></TableRow>}
          </TableBody>
        </Table>
        {filtered.length > 500 && <p className="text-xs text-center text-muted-foreground py-2">عرض أول 500 من {filtered.length}</p>}
      </div>
    </Card>
  );
};

// ============ TRANSFERS ============
const TransfersTab = ({ transfers, families, qc }: any) => {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ transfer_date: today(), family_id: "", quantity: 0, damaged: 0, notes: "" });

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("farm_transfers").insert({ ...form, family_id: form.family_id || null });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("تم تسجيل النقل"); setOpen(false); setForm({ transfer_date: today(), family_id: "", quantity: 0, damaged: 0, notes: "" }); qc.invalidateQueries({ queryKey: ["farm_transfers"] }); },
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

  return (
    <Card className="p-4">
      <div className="flex justify-between mb-3">
        <h3 className="font-bold">نقل البيض للمعمل (المنقول: {totals.q.toLocaleString()} - هالك: {totals.d.toLocaleString()})</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="w-4 h-4 ml-1" />تسجيل نقل</Button></DialogTrigger>
          <DialogContent dir="rtl">
            <DialogHeader><DialogTitle>نقل بيض جديد</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>التاريخ</Label><Input type="date" value={form.transfer_date} onChange={(e) => setForm({ ...form, transfer_date: e.target.value })} /></div>
              <div><Label>الأسرة (اختياري)</Label>
                <Select value={form.family_id} onValueChange={(v) => setForm({ ...form, family_id: v })}>
                  <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                  <SelectContent>{families.map((f: any) => <SelectItem key={f.id} value={f.id}>{f.family_number}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>الكمية</Label><Input type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: +e.target.value })} /></div>
                <div><Label>الهالك</Label><Input type="number" value={form.damaged} onChange={(e) => setForm({ ...form, damaged: +e.target.value })} /></div>
              </div>
              <div><Label>ملاحظات</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            </div>
            <DialogFooter><Button onClick={() => save.mutate()} disabled={save.isPending}>حفظ</Button></DialogFooter>
          </DialogContent>
        </Dialog>
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
const FeedTab = ({ logs, qc }: any) => {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ log_date: today(), feed_type: "", quantity: 0, unit: "كجم", notes: "" });

  const save = useMutation({
    mutationFn: async () => { const { error } = await supabase.from("farm_feed_log").insert(form); if (error) throw error; },
    onSuccess: () => { toast.success("تم"); setOpen(false); setForm({ log_date: today(), feed_type: "", quantity: 0, unit: "كجم", notes: "" }); qc.invalidateQueries({ queryKey: ["farm_feed_log"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("farm_feed_log").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["farm_feed_log"] }),
  });

  return (
    <Card className="p-4">
      <div className="flex justify-between mb-3">
        <h3 className="font-bold">سجل العلف</h3>
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
      <div className="overflow-auto">
        <Table>
          <TableHeader><TableRow><TableHead>التاريخ</TableHead><TableHead>النوع</TableHead><TableHead>الكمية</TableHead><TableHead>الوحدة</TableHead><TableHead>ملاحظات</TableHead><TableHead></TableHead></TableRow></TableHeader>
          <TableBody>
            {logs.map((l: any) => (
              <TableRow key={l.id}>
                <TableCell>{l.log_date}</TableCell>
                <TableCell>{l.feed_type}</TableCell>
                <TableCell className="font-bold">{l.quantity}</TableCell>
                <TableCell>{l.unit}</TableCell>
                <TableCell className="text-xs">{l.notes || "-"}</TableCell>
                <TableCell><Button size="icon" variant="ghost" onClick={() => del.mutate(l.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button></TableCell>
              </TableRow>
            ))}
            {logs.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">لا يوجد سجل علف</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
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
