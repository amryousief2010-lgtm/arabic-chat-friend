import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowDownLeft, ArrowUpRight, RefreshCw, Search, Activity } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Row {
  id: string;
  performed_at: string;
  movement_type: string; // in | out | adjust
  quantity: number;
  notes: string | null;
  party: string | null;
  item_name?: string;
  unit?: string;
  source_name?: string;
  destination_name?: string;
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" });

export default function MainWarehouseActivity() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  const [direction, setDirection] = useState<"all" | "in" | "out">("all");
  const [days, setDays] = useState<"7" | "30" | "90" | "all">("30");
  const [mainId, setMainId] = useState<string | null>(null);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const { data: wh } = await supabase
        .from("warehouses")
        .select("id, name")
        .or("name.ilike.%الرئيسي%,name.ilike.%المقر%")
        .limit(1)
        .maybeSingle();
      if (!wh) { setRows([]); return; }
      setMainId(wh.id);

      let q = supabase
        .from("inventory_movements")
        .select("id, performed_at, movement_type, quantity, notes, party, item_id, source_warehouse_id, destination_warehouse_id")
        .or(`warehouse_id.eq.${wh.id},source_warehouse_id.eq.${wh.id},destination_warehouse_id.eq.${wh.id}`)
        .order("performed_at", { ascending: false })
        .limit(1000);

      if (days !== "all") {
        const since = new Date();
        since.setDate(since.getDate() - Number(days));
        q = q.gte("performed_at", since.toISOString());
      }
      const { data: mvs, error } = await q;
      if (error) throw error;

      const itemIds = Array.from(new Set((mvs || []).map((m: any) => m.item_id).filter(Boolean)));
      const whIds = Array.from(new Set(
        (mvs || []).flatMap((m: any) => [m.source_warehouse_id, m.destination_warehouse_id]).filter(Boolean)
      ));

      const [{ data: items }, { data: whs }] = await Promise.all([
        itemIds.length
          ? supabase.from("inventory_items").select("id, name, unit").in("id", itemIds)
          : Promise.resolve({ data: [] as any[] }),
        whIds.length
          ? supabase.from("warehouses").select("id, name").in("id", whIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      const itemMap = new Map((items || []).map((i: any) => [i.id, i]));
      const whMap = new Map((whs || []).map((w: any) => [w.id, w.name]));

      setRows((mvs || []).map((m: any) => ({
        id: m.id,
        performed_at: m.performed_at,
        movement_type: m.movement_type,
        quantity: Number(m.quantity || 0),
        notes: m.notes,
        party: m.party,
        item_name: itemMap.get(m.item_id)?.name,
        unit: itemMap.get(m.item_id)?.unit,
        source_name: m.source_warehouse_id ? whMap.get(m.source_warehouse_id) : undefined,
        destination_name: m.destination_warehouse_id ? whMap.get(m.destination_warehouse_id) : undefined,
      })));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); /* eslint-disable-next-line */ }, [days]);

  const filtered = useMemo(() => {
    const q = search.trim();
    return rows.filter((r) => {
      if (direction !== "all" && r.movement_type !== direction) return false;
      if (!q) return true;
      return (
        r.item_name?.includes(q) ||
        r.notes?.includes(q) ||
        r.party?.includes(q) ||
        r.source_name?.includes(q) ||
        r.destination_name?.includes(q)
      );
    });
  }, [rows, search, direction]);

  const stats = useMemo(() => {
    const ins = filtered.filter(r => r.movement_type === "in").length;
    const outs = filtered.filter(r => r.movement_type === "out").length;
    return { ins, outs, total: filtered.length };
  }, [filtered]);

  return (
    <DashboardLayout>
      <Header
        title="سجل حركات المخزن الرئيسي"
        subtitle="مراقبة شاملة لكل وارد وصادر من المخزن الرئيسي — للمدير العام والتنفيذي ومسؤول المخزن"
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center">
            <ArrowDownLeft className="w-5 h-5 text-green-600" />
          </div>
          <div><p className="text-xs text-muted-foreground">وارد</p><p className="text-2xl font-bold text-green-600">{stats.ins}</p></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-orange-500/10 flex items-center justify-center">
            <ArrowUpRight className="w-5 h-5 text-orange-600" />
          </div>
          <div><p className="text-xs text-muted-foreground">صادر</p><p className="text-2xl font-bold text-orange-600">{stats.outs}</p></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <Activity className="w-5 h-5 text-primary" />
          </div>
          <div><p className="text-xs text-muted-foreground">إجمالي الحركات</p><p className="text-2xl font-bold">{stats.total}</p></div>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <CardTitle className="text-base">الحركات</CardTitle>
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input placeholder="بحث (صنف/جهة/ملاحظة)" value={search} onChange={(e) => setSearch(e.target.value)} className="pr-9 w-56" />
              </div>
              <Select value={direction} onValueChange={(v: any) => setDirection(v)}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="in">وارد فقط</SelectItem>
                  <SelectItem value="out">صادر فقط</SelectItem>
                </SelectContent>
              </Select>
              <Select value={days} onValueChange={(v: any) => setDays(v)}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">آخر 7 أيام</SelectItem>
                  <SelectItem value="30">آخر 30 يوم</SelectItem>
                  <SelectItem value="90">آخر 90 يوم</SelectItem>
                  <SelectItem value="all">الكل</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" onClick={fetchAll} disabled={loading}>
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-muted/60 text-xs">
                <tr>
                  <th className="p-2">التاريخ</th>
                  <th className="p-2">النوع</th>
                  <th className="p-2">الصنف</th>
                  <th className="p-2">الكمية</th>
                  <th className="p-2">من / إلى</th>
                  <th className="p-2">الجهة</th>
                  <th className="p-2">ملاحظات</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-t hover:bg-muted/30">
                    <td className="p-2 whitespace-nowrap text-xs text-muted-foreground">{formatDate(r.performed_at)}</td>
                    <td className="p-2">
                      {r.movement_type === "in" ? (
                        <Badge className="bg-green-100 text-green-700 hover:bg-green-100">وارد</Badge>
                      ) : r.movement_type === "out" ? (
                        <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-100">صادر</Badge>
                      ) : (
                        <Badge variant="outline">{r.movement_type}</Badge>
                      )}
                    </td>
                    <td className="p-2 font-semibold">{r.item_name || "—"}</td>
                    <td className="p-2 whitespace-nowrap">{r.quantity} {r.unit || ""}</td>
                    <td className="p-2 text-xs">
                      {r.source_name && <span>من: {r.source_name}</span>}
                      {r.source_name && r.destination_name && <span> ← </span>}
                      {r.destination_name && <span>إلى: {r.destination_name}</span>}
                    </td>
                    <td className="p-2 text-xs">{r.party || "—"}</td>
                    <td className="p-2 text-xs text-muted-foreground">{r.notes || ""}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">
                    {loading ? "جاري التحميل..." : "لا توجد حركات في النطاق المحدد"}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </DashboardLayout>
  );
}
