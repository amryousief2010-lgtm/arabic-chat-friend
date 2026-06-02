import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Search, RefreshCw, Warehouse, Printer, Pencil, Check, X, ArrowLeftRight, AlertTriangle, PackageCheck, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { printWarehouseStock } from "@/lib/printUtils";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import ReservedDetailsDialog from "@/components/warehouse/ReservedDetailsDialog";

interface Product { id: string; name: string; unit: string; category?: string | null; }

export type StockScope = "both" | "agouza" | "main";

interface Props { scope?: StockScope }

const titleMap: Record<StockScope, { title: string; subtitle: string }> = {
  both: { title: "المتاح في المخازن", subtitle: "الفعلي • المحجوز • المتاح للبيع لكل مخزن" },
  agouza: { title: "مخزن العجوزة", subtitle: "الفعلي • المحجوز • المتاح للبيع" },
  main: { title: "المخزن الرئيسي", subtitle: "الفعلي (الجرد) • المحجوز للطلبات • المتاح للبيع" },
};

// كيلوجرامات لكل عبوة بحسب اسم المنتج. الافتراضي 0.5 كجم لكل عبوة (عبوتين/كيلو).
const kgPerPackage = (name: string): number => {
  const n = (name || "").trim();
  if (n.includes("6ك") || n.includes("دبوس بالعظم")) return 6;
  if (n.includes("نعامة صندوق")) return 6;
  return 0.5;
};

const formatPackages = (kg: number, name: string): string => {
  const per = kgPerPackage(name);
  if (!per || per <= 0) return "-";
  const pkgs = kg / per;
  const rounded = Math.round(pkgs * 100) / 100;
  return `${rounded} عبوة`;
};

const WarehouseStockView = ({ scope = "both" }: Props) => {
  const { isExecutiveManager, isGeneralManager, canManageAgouzaStock, isAgouzaWarehouseKeeper } = useAuth();
  const navigate = useNavigate();
  const canEditAll = isExecutiveManager || isGeneralManager;
  const canEditAgouza = canManageAgouzaStock;
  const [products, setProducts] = useState<Product[]>([]);
  const [agouzaStock, setAgouzaStock] = useState<Record<string, number>>({});
  const [mainStock, setMainStock] = useState<Record<string, number>>({});
  const [agouzaItemIds, setAgouzaItemIds] = useState<Record<string, string>>({});
  const [mainItemIds, setMainItemIds] = useState<Record<string, string>>({});
  const [agouzaWhId, setAgouzaWhId] = useState<string | null>(null);
  const [mainWhId, setMainWhId] = useState<string | null>(null);
  const [agouzaPending, setAgouzaPending] = useState<Record<string, number>>({});
  const [mainPending, setMainPending] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [mainOpeningAt, setMainOpeningAt] = useState<string | null>(null);
  const [reservedDlg, setReservedDlg] = useState<{ wh: "agouza" | "main"; productId: string; productName: string; total: number } | null>(null);


  const fetchAll = async () => {
    setLoading(true);
    try {
      const [pRes, wRes] = await Promise.all([
        supabase.from("products").select("id, name, unit, category").eq("is_active", true).order("name"),
        supabase.from("warehouses").select("id, name").eq("is_active", true),
      ]);
      setProducts((pRes.data || []) as Product[]);
      const whs = wRes.data || [];
      const agouza = whs.find((w: any) => w.name?.includes("العجوزة"));
      const main = whs.find((w: any) => w.name?.includes("الرئيسي") || w.name?.includes("المقر"));
      setAgouzaWhId(agouza?.id ?? null);
      setMainWhId(main?.id ?? null);
      const whIds = [agouza?.id, main?.id].filter(Boolean) as string[];
      if (whIds.length > 0) {
        const { data: invRows } = await supabase
          .from("inventory_items")
          .select("id, warehouse_id, product_id, stock, reserved_qty, blocked_qty")
          .in("warehouse_id", whIds)
          .not("product_id", "is", null);
        const ag: Record<string, number> = {};
        const mn: Record<string, number> = {};
        const agIds: Record<string, string> = {};
        const mnIds: Record<string, string> = {};
        (invRows || []).forEach((r: any) => {
          // الرصيد الفعلي = stock (بدون خصم محجوز - المحجوز يُحسب من الأوردرات الجارية)
          const actual = Number(r.stock || 0) - Number(r.blocked_qty || 0);
          if (r.warehouse_id === agouza?.id) { ag[r.product_id] = (ag[r.product_id] || 0) + actual; agIds[r.product_id] = r.id; }
          if (r.warehouse_id === main?.id) { mn[r.product_id] = (mn[r.product_id] || 0) + actual; mnIds[r.product_id] = r.id; }
        });
        setAgouzaStock(ag);
        setMainStock(mn);
        setAgouzaItemIds(agIds);
        setMainItemIds(mnIds);

        // المحجوز = أوردرات لم تُسلَّم/تُلغَ ولم تُخصم فعلًا (stock_status != dispatched)
        const { data: pendOrders } = await supabase
          .from("orders")
          .select("id, source_warehouse_id, status, stock_status")
          .in("source_warehouse_id", whIds)
          .not("status", "in", "(delivered,cancelled)")
          .or("stock_status.is.null,stock_status.neq.dispatched");

        const orderIds = (pendOrders || []).map((o: any) => o.id);
        const whByOrder: Record<string, string> = Object.fromEntries(
          (pendOrders || []).map((o: any) => [o.id, o.source_warehouse_id])
        );
        const agPend: Record<string, number> = {};
        const mnPend: Record<string, number> = {};
        if (orderIds.length > 0) {
          for (let i = 0; i < orderIds.length; i += 500) {
            const slice = orderIds.slice(i, i + 500);
            const { data: items } = await supabase
              .from("order_items")
              .select("order_id, product_id, quantity")
              .in("order_id", slice)
              .not("product_id", "is", null);
            (items || []).forEach((it: any) => {
              const wh = whByOrder[it.order_id];
              const qty = Number(it.quantity || 0);
              if (wh === agouza?.id) agPend[it.product_id] = (agPend[it.product_id] || 0) + qty;
              if (wh === main?.id) mnPend[it.product_id] = (mnPend[it.product_id] || 0) + qty;
            });
          }
        }
        setAgouzaPending(agPend);
        setMainPending(mnPend);

        // آخر تاريخ Opening Balance للمخزن الرئيسي
        if (main?.id) {
          const { data: ob } = await supabase
            .from("warehouse_opening_balances")
            .select("opened_at")
            .eq("warehouse_id", main.id)
            .order("opened_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          setMainOpeningAt((ob as any)?.opened_at ?? null);
        }
      }
    } finally {
      setLoading(false);
    }
  };


  useEffect(() => { fetchAll(); }, []);

  // حفظ تعديل الرصيد الفعلي (الجرد) — لا يأخذ المحجوز في الاعتبار
  const saveStock = async (wh: "agouza" | "main", productId: string, newActualKg: number) => {
    if (isNaN(newActualKg) || newActualKg < 0) { toast.error("أدخل قيمة صحيحة"); return; }
    const whId = wh === "agouza" ? agouzaWhId : mainWhId;
    if (!whId) return;
    const itemId = (wh === "agouza" ? agouzaItemIds : mainItemIds)[productId];

    // المخزن الرئيسي: لازم سبب + يمر عبر RPC مدقَّق يسجل حركة تعديل جرد
    if (wh === "main") {
      if (!itemId) { toast.error("الصنف غير موجود في الجرد، أضِفه أولاً"); return; }
      const reason = window.prompt("سبب تعديل الجرد (إلزامي):", "تعديل جرد يدوي");
      if (!reason || reason.trim().length < 3) { toast.error("لازم تكتب سبب"); return; }
      setSaving(true);
      try {
        const { error } = await supabase.rpc("adjust_main_warehouse_stock", {
          p_item_id: itemId,
          p_new_qty: newActualKg,
          p_reason: reason.trim(),
        });
        if (error) throw error;
        setMainStock((s) => ({ ...s, [productId]: newActualKg }));
        toast.success("تم تعديل الجرد وتسجيل الحركة");
        setEditingKey(null);
      } catch (e: any) {
        toast.error(e.message || "تعذّر الحفظ");
      } finally { setSaving(false); }
      return;
    }

    setSaving(true);
    try {
      if (itemId) {
        const { error } = await supabase
          .from("inventory_items")
          .update({ stock: newActualKg })
          .eq("id", itemId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("inventory_items")
          .insert({ warehouse_id: whId, product_id: productId, stock: newActualKg, module: "warehouse" } as any)
          .select("id")
          .single();
        if (error) throw error;
        setAgouzaItemIds((m) => ({ ...m, [productId]: data!.id }));
      }
      setAgouzaStock((s) => ({ ...s, [productId]: newActualKg }));
      toast.success("تم تحديث الرصيد الفعلي");
      setEditingKey(null);

    } catch (e: any) {
      toast.error(e.message || "تعذّر الحفظ");
    } finally {
      setSaving(false);
    }
  };

  const canEditFor = (wh: "agouza" | "main") => wh === "agouza" ? canEditAgouza : canEditAll;

  // خلية الرصيد الفعلي (قابلة للتعديل) — تعرض عدد العبوات والكيلو
  const ActualCell = ({ wh, pid, name, kgValue }: { wh: "agouza" | "main"; pid: string; name: string; kgValue: number }) => {
    const per = kgPerPackage(name) || 0.5;
    const key = `${wh}:${pid}`;
    const isEditing = editingKey === key;
    if (isEditing) {
      const parsed = parseFloat(editValue.replace(",", "."));
      const previewKg = isNaN(parsed) ? 0 : parsed * per;
      return (
        <div className="flex items-center gap-1 justify-end flex-wrap">
          <Input
            type="number"
            step="1"
            min="0"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            className="h-7 w-20 text-xs"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") saveStock(wh, pid, previewKg);
              if (e.key === "Escape") setEditingKey(null);
            }}
          />
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">= {previewKg} كجم</span>
          <button className="text-green-600 disabled:opacity-50" disabled={saving} onClick={() => saveStock(wh, pid, previewKg)}>
            <Check className="w-4 h-4" />
          </button>
          <button className="text-muted-foreground" onClick={() => setEditingKey(null)}>
            <X className="w-4 h-4" />
          </button>
        </div>
      );
    }
    const pkgs = per > 0 ? Math.round((kgValue / per) * 100) / 100 : 0;
    return (
      <div className="flex flex-col items-end gap-0.5">
        <div className="flex items-center gap-1">
          <Badge variant="outline" className="font-bold">{kgValue} كجم</Badge>
          {canEditFor(wh) && (
            <button
              className="text-muted-foreground hover:text-primary opacity-60 hover:opacity-100"
              title="تعديل الجرد الفعلي"
              onClick={() => { setEditingKey(key); setEditValue(String(pkgs)); }}
            >
              <Pencil className="w-3 h-3" />
            </button>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground">{pkgs} عبوة</span>
      </div>
    );
  };

  const ReservedCell = ({ pending, name, onOpen }: { pending: number; name: string; onOpen?: () => void }) => {
    const per = kgPerPackage(name) || 0.5;
    const pkgs = per > 0 ? Math.round((pending / per) * 100) / 100 : 0;
    if (pending <= 0) return <span className="text-xs text-muted-foreground">—</span>;
    const badge = (
      <Badge className="bg-orange-500/15 text-orange-700 dark:text-orange-300 border border-orange-500/30 hover:bg-orange-500/25 cursor-pointer">
        <Lock className="w-3 h-3 ml-1" />
        {pending} كجم
      </Badge>
    );
    return (
      <div className="flex flex-col items-end gap-0.5">
        {onOpen ? (
          <button type="button" onClick={onOpen} title="عرض تفاصيل المحجوز (لمن ولأي أوردرات)">
            {badge}
          </button>
        ) : badge}
        <span className="text-[10px] text-muted-foreground">{pkgs} عبوة</span>
      </div>
    );
  };

  const AvailableCell = ({ actual, pending, name }: { actual: number; pending: number; name: string }) => {
    const avail = actual - pending;
    const per = kgPerPackage(name) || 0.5;
    const pkgs = per > 0 ? Math.round((avail / per) * 100) / 100 : 0;
    return (
      <div className="flex flex-col items-end gap-0.5">
        <Badge
          variant={avail < 0 ? "destructive" : "outline"}
          className={avail > 0 ? "bg-green-500/15 text-green-700 dark:text-green-300 border-green-500/30 font-bold" : avail === 0 ? "" : ""}
        >
          {avail} كجم
        </Badge>
        <span className={`text-[10px] ${avail < 0 ? "text-destructive" : "text-muted-foreground"}`}>{pkgs} عبوة</span>
      </div>
    );
  };

  const filtered = useMemo(() => {
    const q = search.trim();
    const list = q ? products.filter(p => p.name?.includes(q) || p.category?.includes(q)) : products;
    return list;
  }, [products, search]);

  // ملخص أعلى الشاشة (يُحسب على الـ scope الحالي)
  const summary = useMemo(() => {
    let itemsWithStock = 0;
    let totalReservedKg = 0;
    let belowZero = 0;
    const stockSrc = scope === "agouza" ? agouzaStock : scope === "main" ? mainStock : null;
    const pendSrc = scope === "agouza" ? agouzaPending : scope === "main" ? mainPending : null;
    if (stockSrc && pendSrc) {
      filtered.forEach((p) => {
        const a = stockSrc[p.id] ?? 0;
        const r = pendSrc[p.id] ?? 0;
        if (a > 0) itemsWithStock++;
        totalReservedKg += r;
        if (a - r < 0) belowZero++;
      });
    } else {
      // both
      filtered.forEach((p) => {
        const a = (agouzaStock[p.id] ?? 0) + (mainStock[p.id] ?? 0);
        const r = (agouzaPending[p.id] ?? 0) + (mainPending[p.id] ?? 0);
        if (a > 0) itemsWithStock++;
        totalReservedKg += r;
        if (a - r < 0) belowZero++;
      });
    }
    return { itemsWithStock, totalReservedKg: Math.round(totalReservedKg * 100) / 100, belowZero };
  }, [filtered, scope, agouzaStock, mainStock, agouzaPending, mainPending]);

  const { title, subtitle } = titleMap[scope];

  // أعمدة الجدول حسب الـ scope
  const renderMainCols = scope !== "agouza";
  const renderAgouzaCols = scope !== "main";

  return (
    <DashboardLayout>
      <Header title={title} subtitle={subtitle} />

      {scope === "main" && mainOpeningAt && (
        <Card className="mb-3 border-primary/30 bg-primary/5">
          <CardContent className="p-3 flex items-center gap-3 text-sm">
            <div className="p-2 rounded-md bg-primary/15 text-primary">
              <PackageCheck className="w-4 h-4" />
            </div>
            <div className="flex-1">
              <div className="text-xs text-muted-foreground">رصيد افتتاحي معتمد (Zero-base)</div>
              <div className="font-semibold">
                تم تثبيت الجرد الحالي كنقطة صفر بتاريخ{" "}
                {new Date(mainOpeningAt).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" })}
              </div>
              <div className="text-[11px] text-muted-foreground">
                أي تغيير بعد ذلك يكون عبر: توريد دبح/مصنع، مرتجعات معتمدة، صرف طلبات، تحويلات، أو تعديل جرد بصلاحية المدير.
              </div>
            </div>
          </CardContent>
        </Card>
      )}



      {/* ملخص سريع */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-md bg-green-500/15 text-green-700 dark:text-green-300">
              <PackageCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">أصناف لها رصيد فعلي</div>
              <div className="text-xl font-bold">{summary.itemsWithStock}</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-md bg-orange-500/15 text-orange-700 dark:text-orange-300">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">إجمالي محجوز للطلبات</div>
              <div className="text-xl font-bold">{summary.totalReservedKg} كجم</div>
            </div>
          </CardContent>
        </Card>
        <Card className={summary.belowZero > 0 ? "border-destructive/40" : ""}>
          <CardContent className="p-4 flex items-center gap-3">
            <div className={`p-2 rounded-md ${summary.belowZero > 0 ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground"}`}>
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">أصناف محجوز أكثر من الفعلي</div>
              <div className={`text-xl font-bold ${summary.belowZero > 0 ? "text-destructive" : ""}`}>{summary.belowZero}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              <Warehouse className="w-5 h-5 text-primary" />
              المنتجات والكميات
            </CardTitle>
            <div className="flex gap-2 items-center flex-wrap">
              <div className="relative flex-1 sm:w-64">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="بحث باسم المنتج..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pr-9"
                />
              </div>
              <Button size="sm" variant="outline" onClick={fetchAll} disabled={loading}>
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
              {scope === "agouza" && (isAgouzaWarehouseKeeper || canEditAll) && agouzaWhId && (
                <Button
                  size="sm"
                  className="gap-1"
                  onClick={() => navigate(`/modules/warehouses/${agouzaWhId}`)}
                >
                  <ArrowLeftRight className="w-4 h-4" />
                  طلب تحويل من الرئيسي
                </Button>
              )}
              {(() => {
                const rows = filtered.map(p => ({
                  name: p.name,
                  unit: p.unit,
                  // legacy fields = available (للحفاظ على التوافق)
                  agouza: (agouzaStock[p.id] ?? 0) - (agouzaPending[p.id] ?? 0),
                  main: (mainStock[p.id] ?? 0) - (mainPending[p.id] ?? 0),
                  // الحقول الجديدة: الفعلي والمحجوز
                  agouza_actual: agouzaStock[p.id] ?? 0,
                  agouza_reserved: agouzaPending[p.id] ?? 0,
                  main_actual: mainStock[p.id] ?? 0,
                  main_reserved: mainPending[p.id] ?? 0,
                }));
                const filter = search.trim() || undefined;
                const btn = "inline-flex items-center gap-1 h-8 px-3 text-xs rounded-md border bg-background hover:bg-muted transition";
                const renderViewButtons = (mode: "agouza" | "main") => (
                  <>
                    <button className={btn} title="طباعة الجرد الفعلي قبل المحجوز" onClick={() => printWarehouseStock(rows, { filter, mode, view: "actual" })}>
                      <Printer className="w-4 h-4" /> الفعلي
                    </button>
                    <button className={btn} title="طباعة المتاح للبيع بعد المحجوز" onClick={() => printWarehouseStock(rows, { filter, mode, view: "available" })}>
                      <Printer className="w-4 h-4" /> المتاح للبيع
                    </button>
                    <button className={btn} title="طباعة الفعلي والمحجوز والمتاح في 3 أعمدة" onClick={() => printWarehouseStock(rows, { filter, mode, view: "full" })}>
                      <Printer className="w-4 h-4" /> 3 أعمدة
                    </button>
                  </>
                );
                if (scope === "agouza") return renderViewButtons("agouza");
                if (scope === "main") return renderViewButtons("main");
                return (
                  <>
                    <button className={btn} onClick={() => printWarehouseStock(rows, { filter, mode: "agouza", view: "full" })}>
                      <Printer className="w-4 h-4" /> العجوزة
                    </button>
                    <button className={btn} onClick={() => printWarehouseStock(rows, { filter, mode: "main", view: "full" })}>
                      <Printer className="w-4 h-4" /> الرئيسي
                    </button>
                    <button className={btn} onClick={() => printWarehouseStock(rows, { filter, mode: "both", view: "full" })}>
                      <Printer className="w-4 h-4" /> الإجمالي
                    </button>
                  </>
                );
              })()}

            </div>
          </div>
          <div className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
            <span className="inline-flex items-center gap-1 me-3"><Badge variant="outline" className="px-1.5">الفعلي</Badge> الجرد على أرض الواقع</span>
            <span className="inline-flex items-center gap-1 me-3"><Badge className="bg-orange-500/15 text-orange-700 border border-orange-500/30 hover:bg-orange-500/15 px-1.5">المحجوز</Badge> طلبات لم تُصرف/تُسلَّم بعد</span>
            <span className="inline-flex items-center gap-1"><Badge className="bg-green-500/15 text-green-700 border-green-500/30 px-1.5">المتاح</Badge> = الفعلي − المحجوز</span>
          </div>
        </CardHeader>
        <CardContent>
          {/* Desktop table */}
          <div className="hidden md:block border rounded-lg overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="bg-muted/60 text-xs">
                <tr>
                  <th className="p-2 font-semibold">المنتج</th>
                  <th className="p-2 font-semibold">الوحدة</th>
                  {renderAgouzaCols && <th className="p-2 font-semibold whitespace-nowrap">العجوزة — الفعلي</th>}
                  {renderAgouzaCols && <th className="p-2 font-semibold whitespace-nowrap">العجوزة — المحجوز</th>}
                  {renderAgouzaCols && <th className="p-2 font-semibold whitespace-nowrap">العجوزة — المتاح</th>}
                  {renderMainCols && <th className="p-2 font-semibold whitespace-nowrap">الرئيسي — الفعلي</th>}
                  {renderMainCols && <th className="p-2 font-semibold whitespace-nowrap">الرئيسي — المحجوز</th>}
                  {renderMainCols && <th className="p-2 font-semibold whitespace-nowrap">الرئيسي — المتاح</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const aActual = agouzaStock[p.id] ?? 0;
                  const aPend = agouzaPending[p.id] ?? 0;
                  const mActual = mainStock[p.id] ?? 0;
                  const mPend = mainPending[p.id] ?? 0;
                  return (
                    <tr key={p.id} className="border-t hover:bg-muted/30">
                      <td className="p-2 font-bold text-green-600 dark:text-green-400">{p.name}</td>
                      <td className="p-2 text-muted-foreground">{p.unit}</td>
                      {renderAgouzaCols && <td className="p-2"><ActualCell wh="agouza" pid={p.id} name={p.name} kgValue={aActual} /></td>}
                      {renderAgouzaCols && <td className="p-2"><ReservedCell pending={aPend} name={p.name} /></td>}
                      {renderAgouzaCols && <td className="p-2"><AvailableCell actual={aActual} pending={aPend} name={p.name} /></td>}
                      {renderMainCols && <td className="p-2"><ActualCell wh="main" pid={p.id} name={p.name} kgValue={mActual} /></td>}
                      {renderMainCols && <td className="p-2"><ReservedCell pending={mPend} name={p.name} /></td>}
                      {renderMainCols && <td className="p-2"><AvailableCell actual={mActual} pending={mPend} name={p.name} /></td>}
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">لا توجد منتجات</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {filtered.map((p) => {
              const aActual = agouzaStock[p.id] ?? 0;
              const aPend = agouzaPending[p.id] ?? 0;
              const mActual = mainStock[p.id] ?? 0;
              const mPend = mainPending[p.id] ?? 0;
              return (
                <div key={p.id} className="border rounded-lg p-3 bg-card space-y-2">
                  <div>
                    <div className="font-bold text-green-600 dark:text-green-400">{p.name}</div>
                    <div className="text-xs text-muted-foreground">{p.unit}</div>
                  </div>
                  {renderAgouzaCols && (
                    <div className="border-t pt-2">
                      <div className="text-xs font-semibold mb-1 text-muted-foreground">مخزن العجوزة</div>
                      <div className="grid grid-cols-3 gap-1 text-[11px]">
                        <div><div className="text-muted-foreground mb-0.5">الفعلي</div><ActualCell wh="agouza" pid={p.id} name={p.name} kgValue={aActual} /></div>
                        <div><div className="text-muted-foreground mb-0.5">المحجوز</div><ReservedCell pending={aPend} name={p.name} /></div>
                        <div><div className="text-muted-foreground mb-0.5">المتاح</div><AvailableCell actual={aActual} pending={aPend} name={p.name} /></div>
                      </div>
                    </div>
                  )}
                  {renderMainCols && (
                    <div className="border-t pt-2">
                      <div className="text-xs font-semibold mb-1 text-muted-foreground">المخزن الرئيسي</div>
                      <div className="grid grid-cols-3 gap-1 text-[11px]">
                        <div><div className="text-muted-foreground mb-0.5">الفعلي</div><ActualCell wh="main" pid={p.id} name={p.name} kgValue={mActual} /></div>
                        <div><div className="text-muted-foreground mb-0.5">المحجوز</div><ReservedCell pending={mPend} name={p.name} /></div>
                        <div><div className="text-muted-foreground mb-0.5">المتاح</div><AvailableCell actual={mActual} pending={mPend} name={p.name} /></div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </DashboardLayout>
  );
};

export default WarehouseStockView;
