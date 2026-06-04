import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowDownLeft, ArrowUpRight, RefreshCw, Search, Activity, PackageCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Row {
  id: string;
  performed_at: string;
  movement_type: string;
  quantity: number;
  notes: string | null;
  reason: string | null;
  party: string | null;
  reference_type: string | null;
  item_name?: string;
  unit?: string;
  source_name?: string;
  destination_name?: string;
  performed_by_name?: string;
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" });

// تصنيف مصدر الحركة لعرض مقروء + لون
const SOURCE_LABELS: Record<string, { label: string; cls: string }> = {
  opening_balance: { label: "رصيد افتتاحي", cls: "bg-primary/15 text-primary border-primary/30" },
  slaughter_batch: { label: "توريد دبح", cls: "bg-rose-500/15 text-rose-700 border-rose-500/30" },
  meat_batch: { label: "مصنع اللحوم", cls: "bg-amber-500/15 text-amber-700 border-amber-500/30" },
  feed_batch: { label: "مصنع الأعلاف", cls: "bg-yellow-500/15 text-yellow-700 border-yellow-500/30" },
  order: { label: "صرف طلب", cls: "bg-blue-500/15 text-blue-700 border-blue-500/30" },
  transfer: { label: "تحويل مخازن", cls: "bg-violet-500/15 text-violet-700 border-violet-500/30" },
  manual_adjust: { label: "تعديل جرد", cls: "bg-orange-500/15 text-orange-700 border-orange-500/30" },
  return: { label: "مرتجع", cls: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30" },
};

const typeLabel = (mt: string) => {
  switch (mt) {
    case "in":
    case "stock_in":
    case "purchase_receipt":
    case "finished_goods_receipt":
    case "sales_return": return { txt: "وارد", cls: "bg-green-100 text-green-700" };
    case "out":
    case "stock_out":
    case "sales_dispatch": return { txt: "صادر", cls: "bg-orange-100 text-orange-700" };
    case "transfer": return { txt: "تحويل", cls: "bg-violet-100 text-violet-700" };
    case "adjust":
    case "adjustment":
    case "reconciliation": return { txt: "تعديل", cls: "bg-amber-100 text-amber-700" };
    case "opening_balance": return { txt: "افتتاحي", cls: "bg-primary/10 text-primary" };
    case "waste_loss": return { txt: "هالك", cls: "bg-red-100 text-red-700" };
    default: return { txt: mt, cls: "bg-muted text-muted-foreground" };
  }
};

const isIn = (mt: string, qty: number) =>
  ["in","stock_in","purchase_receipt","finished_goods_receipt","sales_return","opening_balance"].includes(mt) || qty > 0;
const isOut = (mt: string, qty: number) =>
  ["out","stock_out","sales_dispatch","waste_loss"].includes(mt) || qty < 0;

export default function MainWarehouseActivity() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  const [direction, setDirection] = useState<"all" | "in" | "out">("all");
  const [sourceCat, setSourceCat] = useState<string>("all");
  const [days, setDays] = useState<"7" | "30" | "90" | "all">("30");
  const [openingAt, setOpeningAt] = useState<string | null>(null);
  // العرض الافتراضي = من Opening Balance فقط. الأرشيف القديم اختياري.
  const [showArchive, setShowArchive] = useState(false);

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

      // آخر Opening Balance للمخزن الرئيسي
      const { data: ob } = await supabase
        .from("warehouse_opening_balances")
        .select("opened_at")
        .eq("warehouse_id", wh.id)
        .order("opened_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const openAt = (ob as any)?.opened_at as string | undefined;
      setOpeningAt(openAt ?? null);

      let q = supabase
        .from("inventory_movements")
        .select("id, performed_at, movement_type, quantity, notes, reason, party, item_id, source_warehouse_id, destination_warehouse_id, performed_by, reference_type")
        .or(`warehouse_id.eq.${wh.id},source_warehouse_id.eq.${wh.id},destination_warehouse_id.eq.${wh.id}`)
        .order("performed_at", { ascending: false })
        .limit(1000);

      // فلتر افتراضي: من Opening Balance فقط
      if (openAt && !showArchive) {
        q = q.gte("performed_at", openAt);
      } else if (days !== "all") {
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
      const userIds = Array.from(new Set((mvs || []).map((m: any) => m.performed_by).filter(Boolean)));

      const items = itemIds.length
        ? (await supabase.from("inventory_items").select("id, name, unit").in("id", itemIds)).data || []
        : [];
      const whs = whIds.length
        ? (await supabase.from("warehouses").select("id, name").in("id", whIds)).data || []
        : [];
      const profs: any[] = userIds.length
        ? ((await (supabase.from("profile_directory") as any).select("id, full_name").in("id", userIds)).data || [])
        : [];




      const itemMap = new Map((items || []).map((i: any) => [i.id, i]));
      const whMap = new Map((whs || []).map((w: any) => [w.id, w.name]));
      const userMap = new Map((profs || []).map((p: any) => [p.id, p.full_name]));

      setRows((mvs || []).map((m: any) => ({
        id: m.id,
        performed_at: m.performed_at,
        movement_type: m.movement_type,
        quantity: Number(m.quantity || 0),
        notes: m.notes,
        reason: m.reason,
        party: m.party,
        reference_type: m.reference_type,
        item_name: itemMap.get(m.item_id)?.name,
        unit: itemMap.get(m.item_id)?.unit,
        source_name: m.source_warehouse_id ? whMap.get(m.source_warehouse_id) : undefined,
        destination_name: m.destination_warehouse_id ? whMap.get(m.destination_warehouse_id) : undefined,
        performed_by_name: m.performed_by ? userMap.get(m.performed_by) : undefined,
      })));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); /* eslint-disable-next-line */ }, [days, showArchive]);

  const filtered = useMemo(() => {
    const q = search.trim();
    return rows.filter((r) => {
      if (direction === "in" && !isIn(r.movement_type, r.quantity)) return false;
      if (direction === "out" && !isOut(r.movement_type, r.quantity)) return false;
      if (sourceCat !== "all" && r.reference_type !== sourceCat) return false;
      if (!q) return true;
      return (
        r.item_name?.includes(q) ||
        r.notes?.includes(q) ||
        r.reason?.includes(q) ||
        r.party?.includes(q) ||
        r.performed_by_name?.includes(q) ||
        r.source_name?.includes(q) ||
        r.destination_name?.includes(q)
      );
    });
  }, [rows, search, direction, sourceCat]);

  const stats = useMemo(() => {
    const ins = filtered.filter(r => isIn(r.movement_type, r.quantity)).length;
    const outs = filtered.filter(r => isOut(r.movement_type, r.quantity)).length;
    const opening = filtered.filter(r => r.movement_type === "opening_balance").length;
    return { ins, outs, opening, total: filtered.length };
  }, [filtered]);

  return (
    <DashboardLayout>
      <Header
        title="سجل حركات المخزن الرئيسي"
        subtitle="كل وارد وصادر بعد تثبيت الـ Opening Balance — مع المستخدم المنفذ ومصدر الحركة"
      />

      {openingAt && (
        <Card className={`mb-3 ${showArchive ? "border-amber-500/40 bg-amber-500/5" : "border-primary/30 bg-primary/5"}`}>
          <CardContent className="p-3 flex flex-col sm:flex-row sm:items-center gap-3 text-sm">
            <div className={`p-2 rounded-md ${showArchive ? "bg-amber-500/15 text-amber-700" : "bg-primary/15 text-primary"}`}>
              <PackageCheck className="w-4 h-4" />
            </div>
            <div className="flex-1">
              <div className="font-semibold">
                {showArchive
                  ? "وضع الأرشيف: يتم عرض الحركات القديمة قبل تثبيت الرصيد الافتتاحي (للمراجعة فقط — لا تؤثر على الرصيد الحالي)"
                  : "العرض الافتراضي: الحركات من تاريخ الـ Opening Balance فقط"}
              </div>
              <div className="text-[11px] text-muted-foreground">
                Opening Balance: {new Date(openingAt).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" })}
                {" — "}
                الحركات الأقدم محفوظة في القاعدة كأرشيف ولا تدخل في حساب الرصيد الفعلي/المحجوز/المتاح للبيع.
              </div>
            </div>
            <Button
              size="sm"
              variant={showArchive ? "default" : "outline"}
              onClick={() => setShowArchive((v) => !v)}
            >
              {showArchive ? "العودة للعرض الحالي" : "عرض الأرشيف القديم"}
            </Button>
          </CardContent>
        </Card>
      )}


      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
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
            <PackageCheck className="w-5 h-5 text-primary" />
          </div>
          <div><p className="text-xs text-muted-foreground">رصيد افتتاحي</p><p className="text-2xl font-bold text-primary">{stats.opening}</p></div>
        </CardContent></Card>
        <Card><CardContent className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
            <Activity className="w-5 h-5" />
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
                <Input placeholder="بحث (صنف/جهة/مستخدم/سبب)" value={search} onChange={(e) => setSearch(e.target.value)} className="pr-9 w-60" />
              </div>
              <Select value={direction} onValueChange={(v: any) => setDirection(v)}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="in">وارد فقط</SelectItem>
                  <SelectItem value="out">صادر فقط</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sourceCat} onValueChange={(v) => setSourceCat(v)}>
                <SelectTrigger className="w-36"><SelectValue placeholder="المصدر" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل المصادر</SelectItem>
                  <SelectItem value="opening_balance">رصيد افتتاحي</SelectItem>
                  <SelectItem value="slaughter_batch">توريد دبح</SelectItem>
                  <SelectItem value="meat_batch">مصنع اللحوم</SelectItem>
                  <SelectItem value="order">صرف طلب</SelectItem>
                  <SelectItem value="transfer">تحويل مخازن</SelectItem>
                  <SelectItem value="manual_adjust">تعديل جرد</SelectItem>
                  <SelectItem value="return">مرتجع</SelectItem>
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
                  <th className="p-2">المصدر</th>
                  <th className="p-2">الصنف</th>
                  <th className="p-2">الكمية</th>
                  <th className="p-2">من / إلى</th>
                  <th className="p-2">المستخدم</th>
                  <th className="p-2">السبب / ملاحظات</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const t = typeLabel(r.movement_type);
                  const srcKey = r.reference_type || "";
                  const src = SOURCE_LABELS[srcKey];
                  const isOpening = r.movement_type === "opening_balance";
                  return (
                    <tr key={r.id} className={`border-t hover:bg-muted/30 ${isOpening ? "bg-primary/5" : ""}`}>
                      <td className="p-2 whitespace-nowrap text-xs text-muted-foreground">{formatDate(r.performed_at)}</td>
                      <td className="p-2"><Badge className={`${t.cls} hover:${t.cls}`}>{t.txt}</Badge></td>
                      <td className="p-2 text-xs">
                        {src ? (
                          <Badge variant="outline" className={src.cls}>{src.label}</Badge>
                        ) : (
                          <span className="text-muted-foreground">{srcKey || "—"}</span>
                        )}
                      </td>
                      <td className="p-2 font-semibold">{r.item_name || "—"}</td>
                      <td className="p-2 whitespace-nowrap font-mono">{r.quantity} {r.unit || ""}</td>
                      <td className="p-2 text-xs">
                        {r.source_name && <span>من: {r.source_name}</span>}
                        {r.source_name && r.destination_name && <span> ← </span>}
                        {r.destination_name && <span>إلى: {r.destination_name}</span>}
                        {!r.source_name && !r.destination_name && <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="p-2 text-xs">{r.performed_by_name || <span className="text-muted-foreground">—</span>}</td>
                      <td className="p-2 text-xs text-muted-foreground">
                        {r.reason || r.notes || r.party || ""}
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">
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
