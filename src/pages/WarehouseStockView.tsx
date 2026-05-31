import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Search, RefreshCw, Warehouse, Printer, Pencil, Check, X, ArrowLeftRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { printWarehouseStock } from "@/lib/printUtils";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

interface Product { id: string; name: string; unit: string; category?: string | null; }

export type StockScope = "both" | "agouza" | "main";

interface Props { scope?: StockScope }

const titleMap: Record<StockScope, { title: string; subtitle: string }> = {
  both: { title: "المتاح في المخازن", subtitle: "رؤية لحظية للكميات المتاحة في مخزن العجوزة والمخزن الرئيسي" },
  agouza: { title: "مخزن العجوزة", subtitle: "الكميات المتاحة في مخزن العجوزة" },
  main: { title: "المخزن الرئيسي", subtitle: "الكميات المتاحة في المخزن الرئيسي" },
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
  // معرّفات صفوف inventory_items لكل (مخزن، منتج) لاستخدامها عند الحفظ
  const [agouzaItemIds, setAgouzaItemIds] = useState<Record<string, string>>({});
  const [mainItemIds, setMainItemIds] = useState<Record<string, string>>({});
  const [agouzaWhId, setAgouzaWhId] = useState<string | null>(null);
  const [mainWhId, setMainWhId] = useState<string | null>(null);
  // الكميات المحجوزة على طلبات لم تُسلَّم/تُلغَ بعد، حسب مصدر التنفيذ
  const [agouzaPending, setAgouzaPending] = useState<Record<string, number>>({});
  const [mainPending, setMainPending] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  // وضع العرض: قبل الطلبات (الكمية الفعلية في المخزن) أو بعد خصم الطلبات الجارية
  const [mode, setMode] = useState<"raw" | "after_orders">("raw");
  // حالة التحرير: مفتاح "wh:productId"
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [saving, setSaving] = useState(false);

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
          const avail = Number(r.stock || 0) - Number(r.reserved_qty || 0) - Number(r.blocked_qty || 0);
          if (r.warehouse_id === agouza?.id) { ag[r.product_id] = (ag[r.product_id] || 0) + avail; agIds[r.product_id] = r.id; }
          if (r.warehouse_id === main?.id) { mn[r.product_id] = (mn[r.product_id] || 0) + avail; mnIds[r.product_id] = r.id; }
        });
        setAgouzaStock(ag);
        setMainStock(mn);
        setAgouzaItemIds(agIds);
        setMainItemIds(mnIds);

        // الطلبات الجارية المحجوزة على كل مخزن — أي أوردر لم يُسلَّم/يُلغَ
        // يُخصم من المتاح، بصرف النظر عن تاريخه (يشمل الـ 16 أوردر القديمة المعلقة).
        const { data: pendOrders } = await supabase
          .from("orders")
          .select("id, source_warehouse_id, status")
          .in("source_warehouse_id", whIds)
          .not("status", "in", "(delivered,cancelled)");

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
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  // حفظ تعديل الرصيد لمنتج في مخزن. القيمة المُدخلة بالكيلو وتُفسَّر حسب وضع العرض.
  const saveStock = async (wh: "agouza" | "main", productId: string, newDisplayKg: number) => {
    if (isNaN(newDisplayKg) || newDisplayKg < 0) { toast.error("أدخل قيمة صحيحة"); return; }
    const pending = (wh === "agouza" ? agouzaPending : mainPending)[productId] ?? 0;
    // عند العرض "بعد الطلبات"، المُدخل هو المتاح بعد الخصم → الرصيد الفعلي = المُدخل + المعلق
    const newStock = mode === "after_orders" ? newDisplayKg + pending : newDisplayKg;
    const whId = wh === "agouza" ? agouzaWhId : mainWhId;
    if (!whId) return;
    const itemId = (wh === "agouza" ? agouzaItemIds : mainItemIds)[productId];
    setSaving(true);
    try {
      if (itemId) {
        const { error } = await supabase
          .from("inventory_items")
          .update({ stock: newStock })
          .eq("id", itemId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("inventory_items")
          .insert({ warehouse_id: whId, product_id: productId, stock: newStock, module: "warehouse" } as any)
          .select("id")
          .single();
        if (error) throw error;
        if (wh === "agouza") setAgouzaItemIds((m) => ({ ...m, [productId]: data!.id }));
        else setMainItemIds((m) => ({ ...m, [productId]: data!.id }));
      }
      if (wh === "agouza") setAgouzaStock((s) => ({ ...s, [productId]: newStock }));
      else setMainStock((s) => ({ ...s, [productId]: newStock }));
      toast.success("تم تحديث الرصيد");
      setEditingKey(null);
    } catch (e: any) {
      toast.error(e.message || "تعذّر الحفظ");
    } finally {
      setSaving(false);
    }
  };

  // خلية عرض الكيلو (للقراءة فقط)
  const KgCell = ({ value }: { value: number }) => (
    <Badge variant={value <= 0 ? "destructive" : "outline"}>{value}</Badge>
  );

  // خلية العبوات: تعرض عدد العبوات، وعند المدير العام/التنفيذي يمكن تحريرها بالعبوة
  // فيتم تحويلها للكيلو حسب وزن العبوة قبل الحفظ.
  const PackagesCell = ({ wh, pid, name, kgValue }: { wh: "agouza" | "main"; pid: string; name: string; kgValue: number }) => {
    const per = kgPerPackage(name) || 0.5;
    const key = `${wh}:${pid}`;
    const isEditing = editingKey === key;
    if (isEditing) {
      const parsed = parseFloat(editValue.replace(",", "."));
      const previewKg = isNaN(parsed) ? 0 : parsed * per;
      return (
        <div className="flex items-center gap-1 justify-end">
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
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">عبوة = {previewKg} كجم</span>
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
      <div className="flex items-center gap-1 justify-end">
        <span className="text-xs text-muted-foreground whitespace-nowrap">{pkgs} عبوة</span>
        {(wh === "agouza" ? canEditAgouza : canEditAll) && (
          <button
            className="text-muted-foreground hover:text-primary opacity-60 hover:opacity-100"
            title="تعديل عدد العبوات"
            onClick={() => { setEditingKey(key); setEditValue(String(pkgs)); }}
          >
            <Pencil className="w-3 h-3" />
          </button>
        )}
      </div>
    );
  };




  // الكميات الظاهرة (مع/بدون خصم الطلبات الجارية)
  const displayAgouza = useMemo(() => {
    if (mode === "raw") return agouzaStock;
    const out: Record<string, number> = {};
    Object.keys({ ...agouzaStock, ...agouzaPending }).forEach((id) => {
      out[id] = (agouzaStock[id] ?? 0) - (agouzaPending[id] ?? 0);
    });
    return out;
  }, [mode, agouzaStock, agouzaPending]);
  const displayMain = useMemo(() => {
    if (mode === "raw") return mainStock;
    const out: Record<string, number> = {};
    Object.keys({ ...mainStock, ...mainPending }).forEach((id) => {
      out[id] = (mainStock[id] ?? 0) - (mainPending[id] ?? 0);
    });
    return out;
  }, [mode, mainStock, mainPending]);

  const filtered = useMemo(() => {
    const q = search.trim();
    const list = q ? products.filter(p => p.name?.includes(q) || p.category?.includes(q)) : products;
    // نعرض كل المنتجات حتى لو رصيدها صفر — عشان يقدر يدخل ويعدّل عليها (دهن، نخاع، ممبار، صندوق، شغت، فرم…)
    return list;
  }, [products, search, scope, displayAgouza, displayMain]);

  const { title, subtitle } = titleMap[scope];

  return (
    <DashboardLayout>
      <Header title={title} subtitle={subtitle} />

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              <Warehouse className="w-5 h-5 text-primary" />
              المنتجات والكميات المتاحة
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
              {/* مفتاح التبديل: قبل/بعد الطلبات الجارية */}
              <div className="inline-flex rounded-md border bg-background overflow-hidden">
                <button
                  type="button"
                  onClick={() => setMode("raw")}
                  className={`px-3 h-8 text-xs transition ${mode === "raw" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                  title="المتاح الحالي في المخزن قبل خصم الطلبات الجارية"
                >
                  بدون الطلبات
                </button>
                <button
                  type="button"
                  onClick={() => setMode("after_orders")}
                  className={`px-3 h-8 text-xs border-r transition ${mode === "after_orders" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                  title="المتاح بعد خصم الطلبات الجارية (غير المُسلَّمة/المُلغاة)"
                >
                  بعد الطلبات
                </button>
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
                  agouza: displayAgouza[p.id] ?? 0,
                  main: displayMain[p.id] ?? 0,
                }));
                const filter = search.trim() || undefined;
                const btn = "inline-flex items-center gap-1 h-8 px-3 text-xs rounded-md border bg-background hover:bg-muted transition";
                if (scope === "agouza") {
                  return (
                    <button className={btn} onClick={() => printWarehouseStock(rows, { filter, mode: "agouza" })}>
                      <Printer className="w-4 h-4" /> طباعة المتاح
                    </button>
                  );
                }
                if (scope === "main") {
                  return (
                    <button className={btn} onClick={() => printWarehouseStock(rows, { filter, mode: "main" })}>
                      <Printer className="w-4 h-4" /> طباعة المتاح
                    </button>
                  );
                }
                return (
                  <>
                    <button className={btn} onClick={() => printWarehouseStock(rows, { filter, mode: "agouza" })}>
                      <Printer className="w-4 h-4" /> العجوزة
                    </button>
                    <button className={btn} onClick={() => printWarehouseStock(rows, { filter, mode: "main" })}>
                      <Printer className="w-4 h-4" /> الرئيسي
                    </button>
                    <button className={btn} onClick={() => printWarehouseStock(rows, { filter, mode: "both" })}>
                      <Printer className="w-4 h-4" /> الإجمالي
                    </button>
                  </>
                );
              })()}
            </div>
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
                  {scope !== "main" && <th className="p-2 font-semibold whitespace-nowrap">مخزن العجوزة</th>}
                  {scope !== "main" && <th className="p-2 font-semibold whitespace-nowrap">عبوات العجوزة</th>}
                  {scope !== "agouza" && <th className="p-2 font-semibold whitespace-nowrap">المخزن الرئيسي</th>}
                  {scope !== "agouza" && <th className="p-2 font-semibold whitespace-nowrap">عبوات الرئيسي</th>}
                  {scope === "both" && <th className="p-2 font-semibold whitespace-nowrap">الإجمالي المتاح</th>}
                  {scope === "both" && <th className="p-2 font-semibold whitespace-nowrap">إجمالي العبوات</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const a = displayAgouza[p.id] ?? 0;
                  const m = displayMain[p.id] ?? 0;
                  return (
                    <tr key={p.id} className="border-t hover:bg-muted/30">
                      <td className="p-2 font-bold text-green-600 dark:text-green-400">{p.name}</td>
                      <td className="p-2 text-muted-foreground">{p.unit}</td>
                      {scope !== "main" && (
                        <td className="p-2"><KgCell value={a} /></td>
                      )}
                      {scope !== "main" && (
                        <td className="p-2"><PackagesCell wh="agouza" pid={p.id} name={p.name} kgValue={a} /></td>
                      )}
                      {scope !== "agouza" && (
                        <td className="p-2"><KgCell value={m} /></td>
                      )}
                      {scope !== "agouza" && (
                        <td className="p-2"><PackagesCell wh="main" pid={p.id} name={p.name} kgValue={m} /></td>
                      )}
                      {scope === "both" && (
                        <td className="p-2 font-bold text-primary">{a + m}</td>
                      )}
                      {scope === "both" && (
                        <td className="p-2 text-xs text-primary whitespace-nowrap">{formatPackages(a + m, p.name)}</td>
                      )}
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">لا توجد منتجات</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {filtered.map((p) => {
              const a = displayAgouza[p.id] ?? 0;
              const m = displayMain[p.id] ?? 0;
              return (
                <div key={p.id} className="border rounded-lg p-3 bg-card">
                  <div className="font-bold text-green-600 dark:text-green-400 mb-1">{p.name}</div>
                  <div className="text-xs text-muted-foreground mb-2">{p.unit}</div>
                  <div className={`grid ${scope === "both" ? "grid-cols-3" : "grid-cols-1"} gap-2 text-center text-xs`}>
                    {scope !== "main" && (
                      <div>
                        <div className="text-muted-foreground mb-1">العجوزة</div>
                        <div className="flex justify-center"><KgCell value={a} /></div>
                        <div className="mt-1 flex justify-center"><PackagesCell wh="agouza" pid={p.id} name={p.name} kgValue={a} /></div>
                      </div>
                    )}
                    {scope !== "agouza" && (
                      <div>
                        <div className="text-muted-foreground mb-1">الرئيسي</div>
                        <div className="flex justify-center"><KgCell value={m} /></div>
                        <div className="mt-1 flex justify-center"><PackagesCell wh="main" pid={p.id} name={p.name} kgValue={m} /></div>
                      </div>
                    )}
                    {scope === "both" && (
                      <div>
                        <div className="text-muted-foreground mb-1">الإجمالي</div>
                        <Badge className="bg-primary">{a + m}</Badge>
                        <div className="text-[10px] text-primary mt-1">{formatPackages(a + m, p.name)}</div>
                      </div>
                    )}
                  </div>
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
