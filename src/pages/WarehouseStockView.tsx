import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Search, RefreshCw, Warehouse, Printer, Pencil, Check, X, ArrowLeftRight, AlertTriangle, PackageCheck, Lock, PackagePlus, PackageMinus, Package, History, Wallet, Clock, Boxes } from "lucide-react";
import ItemMovementsDialog from "@/components/warehouse/ItemMovementsDialog";
import { supabase } from "@/integrations/supabase/client";
import { printWarehouseStock } from "@/lib/printUtils";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import ReservedDetailsDialog from "@/components/warehouse/ReservedDetailsDialog";
import ManualStockAdditionDialog from "@/components/warehouse/ManualStockAdditionDialog";
import ManualStockOutDialog from "@/components/warehouse/ManualStockOutDialog";
import MainCardDialog from "@/components/warehouse/MainCardDialog";
import SubLocationDistributionDialog from "@/components/warehouse/SubLocationDistributionDialog";
import { MAIN_WAREHOUSE_OPERATIONAL_START, MAIN_WAREHOUSE_OPERATIONAL_START_ISO } from "@/constants/warehouseOperations";
import companyLogo from "@/assets/company-logo.jpg";

interface Product { id: string; name: string; unit: string; category?: string | null; barcode?: string | null; }

interface WarehouseDialogItem {
  id: string;
  warehouse_id: string | null;
  product_id: string | null;
  product_is_active?: boolean | null;
  product_category?: string | null;
  product_name?: string | null;
  name: string;
  category?: string | null;
  unit?: string | null;
  stock?: number | null;
  sku?: string | null;
  item_code?: string | null;
  barcode?: string | null;
  is_active?: boolean | null;
  module?: string | null;
}

export type StockScope = "both" | "agouza" | "main" | "carrefour" | "healthy";
type SingleWh = "agouza" | "main" | "carrefour" | "healthy";

interface Props { scope?: StockScope; embedded?: boolean }


const titleMap: Record<StockScope, { title: string; subtitle: string }> = {
  both: { title: "المتاح في المخازن", subtitle: "الفعلي • المحجوز • المتاح للبيع لكل مخزن" },
  agouza: { title: "مخزن العجوزة", subtitle: "الفعلي • المحجوز • المتاح للبيع" },
  main: { title: "المخزن الرئيسي", subtitle: "الفعلي (الجرد) • المحجوز للطلبات • المتاح للبيع" },
  carrefour: { title: "هايبر كارفور", subtitle: "الفعلي • المحجوز • المتاح للبيع" },
  healthy: { title: "هايبر هيلثي تيست", subtitle: "الفعلي • المحجوز • المتاح للبيع" },
};

// Single-warehouse scopes have per-warehouse add/issue buttons and clickable KPI cards
const SINGLE_SCOPES: StockScope[] = ["main", "agouza", "carrefour", "healthy"];
const isSingleScope = (s: StockScope) => SINGLE_SCOPES.includes(s);


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

const normalizeSearch = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[أإآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ");

const WarehouseStockView = ({ scope = "both", embedded = false }: Props) => {
  const { isExecutiveManager, isGeneralManager, canManageAgouzaStock, isAgouzaWarehouseKeeper, isWarehouseSupervisor } = useAuth();
  const navigate = useNavigate();
  const canEditAll = isExecutiveManager || isGeneralManager;
  // Agouza keeper can view + upload delivery sheets, but CANNOT edit stock quantities directly
  const canEditAgouza = canEditAll || isWarehouseSupervisor;
  const [products, setProducts] = useState<Product[]>([]);
  const [agouzaStock, setAgouzaStock] = useState<Record<string, number>>({});
  const [mainStock, setMainStock] = useState<Record<string, number>>({});
  const [agouzaItemIds, setAgouzaItemIds] = useState<Record<string, string>>({});
  const [mainItemIds, setMainItemIds] = useState<Record<string, string>>({});
  const [agouzaWhId, setAgouzaWhId] = useState<string | null>(null);
  const [mainWhId, setMainWhId] = useState<string | null>(null);
  const [agouzaPending, setAgouzaPending] = useState<Record<string, number>>({});
  const [mainPending, setMainPending] = useState<Record<string, number>>({});

  // Generic per-scope maps for carrefour/healthy (and could grow)
  // Each map is: scopeKey -> productId -> value
  const [extraWhIds, setExtraWhIds] = useState<Record<string, string | null>>({ carrefour: null, healthy: null });
  const [extraStock, setExtraStock] = useState<Record<string, Record<string, number>>>({ carrefour: {}, healthy: {} });
  const [extraItemIds, setExtraItemIds] = useState<Record<string, Record<string, string>>>({ carrefour: {}, healthy: {} });
  const [extraPending, setExtraPending] = useState<Record<string, Record<string, number>>>({ carrefour: {}, healthy: {} });
  const [extraCost, setExtraCost] = useState<Record<string, Record<string, number>>>({ carrefour: {}, healthy: {} });
  const [extraSku, setExtraSku] = useState<Record<string, Record<string, string>>>({ carrefour: {}, healthy: {} });
  const [extraLastMove, setExtraLastMove] = useState<Record<string, Record<string, string>>>({ carrefour: {}, healthy: {} });
  const [extraLowThreshold, setExtraLowThreshold] = useState<Record<string, Record<string, number>>>({ carrefour: {}, healthy: {} });
  const [dialogItemsByWh, setDialogItemsByWh] = useState<Record<SingleWh, WarehouseDialogItem[]>>({
    main: [],
    agouza: [],
    carrefour: [],
    healthy: [],
  });

  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [mainOpeningAt, setMainOpeningAt] = useState<string | null>(null);
  const [reservedDlg, setReservedDlg] = useState<{ wh: "agouza" | "main" | "carrefour" | "healthy"; productId: string; productName: string; total: number } | null>(null);
  const [manualAddOpen, setManualAddOpen] = useState(false);
  const [manualOutOpen, setManualOutOpen] = useState(false);
  const [mainCost, setMainCost] = useState<Record<string, number>>({});
  const [mainSku, setMainSku] = useState<Record<string, string>>({});
  const [mainLastMove, setMainLastMove] = useState<Record<string, string>>({});
  const [mainLowThreshold, setMainLowThreshold] = useState<Record<string, number>>({});
  const [agouzaCost, setAgouzaCost] = useState<Record<string, number>>({});
  const [agouzaSku, setAgouzaSku] = useState<Record<string, string>>({});
  const [agouzaLastMove, setAgouzaLastMove] = useState<Record<string, string>>({});
  const [agouzaLowThreshold, setAgouzaLowThreshold] = useState<Record<string, number>>({});
  const [cardDialog, setCardDialog] = useState<null | "withStock" | "overReserved">(null);
  // Additional drill-down filters (open the items table filtered to subset)
  const [tableFilter, setTableFilter] = useState<null | "all" | "withStock" | "lowStock" | "overReserved">(null);
  const [cardSearch, setCardSearch] = useState("");
  const [distDlg, setDistDlg] = useState<null | { warehouseId: string; productId: string; productName: string; unit: string; actual: number; reserved: number }>(null);
  const [showItemsTable, setShowItemsTable] = useState(false);
  const [movDlg, setMovDlg] = useState<null | { itemId: string; name: string; unit: string; stock: number; whId: string; whLabel: string }>(null);



  const fetchAll = async () => {
    setLoading(true);
    try {
      const [pRes, wRes] = await Promise.all([
        supabase.from("products").select("id, name, unit, category, barcode").eq("is_active", true).order("name"),
        supabase.from("warehouses").select("id, name").eq("is_active", true),
      ]);
      setProducts((pRes.data || []) as Product[]);
      const whs = wRes.data || [];
      const agouza = whs.find((w: any) => w.name?.includes("العجوزة"));
      const main = whs.find((w: any) => w.name?.includes("الرئيسي") || w.name?.includes("المقر"));
      const carrefour = whs.find((w: any) => w.name?.includes("كارفور") || /carrefour/i.test(w.name || ""));
      const healthy = whs.find((w: any) => w.name?.includes("هيلثي") || /healthy/i.test(w.name || ""));
      setAgouzaWhId(agouza?.id ?? null);
      setMainWhId(main?.id ?? null);
      setExtraWhIds({ carrefour: carrefour?.id ?? null, healthy: healthy?.id ?? null });

      const whIds = [agouza?.id, main?.id, carrefour?.id, healthy?.id].filter(Boolean) as string[];
      if (whIds.length > 0) {
        const { data: invRows } = await supabase
          .from("inventory_items")
          .select("id, warehouse_id, product_id, name, category, unit, stock, reserved_qty, blocked_qty, unit_cost, sku, item_code, low_stock_threshold, is_active, module")
          .in("warehouse_id", whIds);

        const productById = new Map<string, Product>((pRes.data || []).map((p: any) => [p.id, p as Product]));

        const ag: Record<string, number> = {};
        const mn: Record<string, number> = {};
        const agIds: Record<string, string> = {};
        const mnIds: Record<string, string> = {};
        const mnCost: Record<string, number> = {};
        const mnSku: Record<string, string> = {};
        const mnLow: Record<string, number> = {};
        const agCost: Record<string, number> = {};
        const agSku: Record<string, string> = {};
        const agLow: Record<string, number> = {};
        const exStock: Record<string, Record<string, number>> = { carrefour: {}, healthy: {} };
        const exIds: Record<string, Record<string, string>> = { carrefour: {}, healthy: {} };
        const exCost: Record<string, Record<string, number>> = { carrefour: {}, healthy: {} };
        const exSku: Record<string, Record<string, string>> = { carrefour: {}, healthy: {} };
        const exLow: Record<string, Record<string, number>> = { carrefour: {}, healthy: {} };
        const dialogItems: Record<SingleWh, WarehouseDialogItem[]> = { main: [], agouza: [], carrefour: [], healthy: [] };

        const pushDialogItem = (whKey: SingleWh, r: any) => {
          const product = r.product_id ? productById.get(r.product_id) : null;
          dialogItems[whKey].push({
            id: r.id,
            warehouse_id: r.warehouse_id,
            product_id: r.product_id || null,
            name: r.name || product?.name || "صنف بدون اسم",
            category: r.category || product?.category || null,
            unit: r.unit || product?.unit || "كجم",
            stock: Number(r.stock || 0) - Number(r.blocked_qty || 0),
            sku: r.sku || null,
            item_code: r.item_code || null,
            barcode: product?.barcode || null,
            product_is_active: r.product_id ? !!product : null,
            product_category: product?.category || null,
            product_name: product?.name || null,
            is_active: r.is_active,
            module: r.module || "warehouse",
          });
        };

        (invRows || []).forEach((r: any) => {
          const actual = Number(r.stock || 0) - Number(r.blocked_qty || 0);
          if (r.warehouse_id === agouza?.id) {
            pushDialogItem("agouza", r);
            if (r.product_id) {
              ag[r.product_id] = (ag[r.product_id] || 0) + actual;
              agIds[r.product_id] = r.id;
              agCost[r.product_id] = Number(r.unit_cost || 0);
              if (r.sku) agSku[r.product_id] = r.sku;
              agLow[r.product_id] = Number(r.low_stock_threshold || 0);
            }
          }
          if (r.warehouse_id === main?.id) {
            pushDialogItem("main", r);
            if (r.product_id) {
              mn[r.product_id] = (mn[r.product_id] || 0) + actual;
              mnIds[r.product_id] = r.id;
              mnCost[r.product_id] = Number(r.unit_cost || 0);
              if (r.sku) mnSku[r.product_id] = r.sku;
              mnLow[r.product_id] = Number(r.low_stock_threshold || 0);
            }
          }
          if (carrefour?.id && r.warehouse_id === carrefour.id) {
            pushDialogItem("carrefour", r);
            if (r.product_id) {
              exStock.carrefour[r.product_id] = (exStock.carrefour[r.product_id] || 0) + actual;
              exIds.carrefour[r.product_id] = r.id;
              exCost.carrefour[r.product_id] = Number(r.unit_cost || 0);
              if (r.sku) exSku.carrefour[r.product_id] = r.sku;
              exLow.carrefour[r.product_id] = Number(r.low_stock_threshold || 0);
            }
          }
          if (healthy?.id && r.warehouse_id === healthy.id) {
            pushDialogItem("healthy", r);
            if (r.product_id) {
              exStock.healthy[r.product_id] = (exStock.healthy[r.product_id] || 0) + actual;
              exIds.healthy[r.product_id] = r.id;
              exCost.healthy[r.product_id] = Number(r.unit_cost || 0);
              if (r.sku) exSku.healthy[r.product_id] = r.sku;
              exLow.healthy[r.product_id] = Number(r.low_stock_threshold || 0);
            }
          }
        });
        setDialogItemsByWh(dialogItems);
        setAgouzaStock(ag);
        setMainStock(mn);
        setAgouzaItemIds(agIds);
        setMainItemIds(mnIds);
        setMainCost(mnCost);
        setMainSku(mnSku);
        setMainLowThreshold(mnLow);
        setAgouzaCost(agCost);
        setAgouzaSku(agSku);
        setAgouzaLowThreshold(agLow);
        setExtraStock(exStock);
        setExtraItemIds(exIds);
        setExtraCost(exCost);
        setExtraSku(exSku);
        setExtraLowThreshold(exLow);

        // آخر حركة لكل صنف لكل مخزن (نجمعها من كل الـ item ids المعروفة)
        const allItemIds: { pid: string; iid: string; whKey: "main" | "agouza" | "carrefour" | "healthy" }[] = [];
        Object.entries(mnIds).forEach(([pid, iid]) => allItemIds.push({ pid, iid, whKey: "main" }));
        Object.entries(agIds).forEach(([pid, iid]) => allItemIds.push({ pid, iid, whKey: "agouza" }));
        Object.entries(exIds.carrefour).forEach(([pid, iid]) => allItemIds.push({ pid, iid, whKey: "carrefour" }));
        Object.entries(exIds.healthy).forEach(([pid, iid]) => allItemIds.push({ pid, iid, whKey: "healthy" }));
        if (allItemIds.length > 0) {
          const itemIdList = allItemIds.map(x => x.iid);
          const { data: lastMoves } = await supabase
            .from("inventory_movements")
            .select("item_id, performed_at")
            .in("item_id", itemIdList)
            .order("performed_at", { ascending: false })
            .limit(5000);
          const lastByItem: Record<string, string> = {};
          (lastMoves || []).forEach((m: any) => {
            if (!lastByItem[m.item_id]) lastByItem[m.item_id] = m.performed_at;
          });
          const mainLM: Record<string, string> = {};
          const agLM: Record<string, string> = {};
          const exLM: Record<string, Record<string, string>> = { carrefour: {}, healthy: {} };
          allItemIds.forEach(({ pid, iid, whKey }) => {
            const ts = lastByItem[iid];
            if (!ts) return;
            if (whKey === "main") mainLM[pid] = ts;
            else if (whKey === "agouza") agLM[pid] = ts;
            else exLM[whKey][pid] = ts;
          });
          setMainLastMove(mainLM);
          setAgouzaLastMove(agLM);
          setExtraLastMove(exLM);
        }


        // المحجوز = أوردرات لم تُسلَّم/تُلغَ ولم تُخصم فعلًا (stock_status != dispatched)
        // المخزن الرئيسي: نتجاهل أي أوردر مسجل قبل تاريخ بداية التشغيل (Cut-off) — الجرد اليدوي الحالي هو نقطة البداية الرسمية.
        const { data: pendOrders } = await supabase
          .from("orders")
          .select("id, source_warehouse_id, status, stock_status, created_at")
          .in("source_warehouse_id", whIds)
          .not("status", "in", "(delivered,cancelled)")
          .or("stock_status.is.null,stock_status.neq.dispatched");

        const cutoffMs = new Date(MAIN_WAREHOUSE_OPERATIONAL_START_ISO).getTime();
        const eligibleOrders = (pendOrders || []).filter((o: any) => {
          if (o.source_warehouse_id !== main?.id) return true; // العجوزة وغيره: لا cut-off
          return new Date(o.created_at).getTime() >= cutoffMs;
        });

        const orderIds = eligibleOrders.map((o: any) => o.id);
        const whByOrder: Record<string, string> = Object.fromEntries(
          eligibleOrders.map((o: any) => [o.id, o.source_warehouse_id])
        );
        const agPend: Record<string, number> = {};
        const mnPend: Record<string, number> = {};
        const exPend: Record<string, Record<string, number>> = { carrefour: {}, healthy: {} };
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
              if (carrefour?.id && wh === carrefour.id) exPend.carrefour[it.product_id] = (exPend.carrefour[it.product_id] || 0) + qty;
              if (healthy?.id && wh === healthy.id) exPend.healthy[it.product_id] = (exPend.healthy[it.product_id] || 0) + qty;
            });
          }
        }
        setAgouzaPending(agPend);
        setMainPending(mnPend);
        setExtraPending(exPend);

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

  const getStockMap = (wh: SingleWh): Record<string, number> =>
    wh === "agouza" ? agouzaStock : wh === "main" ? mainStock : extraStock[wh] || {};
  const getPendingMap = (wh: SingleWh): Record<string, number> =>
    wh === "agouza" ? agouzaPending : wh === "main" ? mainPending : extraPending[wh] || {};
  const getItemIdsMap = (wh: SingleWh): Record<string, string> =>
    wh === "agouza" ? agouzaItemIds : wh === "main" ? mainItemIds : extraItemIds[wh] || {};
  const getCostMap = (wh: SingleWh): Record<string, number> =>
    wh === "agouza" ? agouzaCost : wh === "main" ? mainCost : extraCost[wh] || {};
  const getSkuMap = (wh: SingleWh): Record<string, string> =>
    wh === "agouza" ? agouzaSku : wh === "main" ? mainSku : extraSku[wh] || {};
  const getLastMoveMap = (wh: SingleWh): Record<string, string> =>
    wh === "agouza" ? agouzaLastMove : wh === "main" ? mainLastMove : extraLastMove[wh] || {};
  const getLowMap = (wh: SingleWh): Record<string, number> =>
    wh === "agouza" ? agouzaLowThreshold : wh === "main" ? mainLowThreshold : extraLowThreshold[wh] || {};
  const getWhId = (wh: SingleWh): string | null =>
    wh === "agouza" ? agouzaWhId : wh === "main" ? mainWhId : extraWhIds[wh] ?? null;
  const getWhLabel = (wh: SingleWh): string =>
    wh === "agouza" ? "مخزن العجوزة" :
    wh === "main" ? "المخزن الرئيسي" :
    wh === "carrefour" ? "هايبر كارفور" : "هايبر هيلثي تيست";

  // حفظ تعديل الرصيد الفعلي (الجرد) — لا يأخذ المحجوز في الاعتبار
  const saveStock = async (wh: SingleWh, productId: string, newActualKg: number) => {
    if (isNaN(newActualKg) || newActualKg < 0) { toast.error("أدخل قيمة صحيحة"); return; }
    const whId = getWhId(wh);
    if (!whId) return;
    const itemId = getItemIdsMap(wh)[productId];

    // المخزن الرئيسي: تعديل الرصيد الفعلي / التسوية اليدوية = حصري للمدير العام أو المدير التنفيذي
    // + سبب وملاحظة إجباريين، وتمر عبر RPC مدقَّق يسجل حركة تعديل جرد
    if (wh === "main") {
      if (!(isGeneralManager || isExecutiveManager)) {
        toast.error("غير مسموح بتعديل الرصيد الفعلي يدويًا. التعديل متاح فقط للمدير العام أو المدير التنفيذي.");
        return;
      }
      if (!itemId) { toast.error("الصنف غير موجود في الجرد، أضِفه أولاً"); return; }
      const reason = window.prompt("سبب تعديل الجرد (إجباري — 3 أحرف على الأقل):", "تعديل جرد يدوي");
      if (!reason || reason.trim().length < 3) { toast.error("لازم تكتب سبب واضح"); return; }
      const notes = window.prompt("ملاحظة توضيحية (إجبارية — 5 أحرف على الأقل):", "");
      if (!notes || notes.trim().length < 5) { toast.error("لازم تكتب ملاحظة توضيحية"); return; }
      setSaving(true);
      try {
        const { error } = await supabase.rpc("adjust_main_warehouse_stock", {
          p_item_id: itemId,
          p_new_qty: newActualKg,
          p_reason: `${reason.trim()} — ${notes.trim()}`,
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
        if (wh === "agouza") setAgouzaItemIds((m) => ({ ...m, [productId]: data!.id }));
        else setExtraItemIds((m) => ({ ...m, [wh]: { ...(m[wh] || {}), [productId]: data!.id } }));
      }
      if (wh === "agouza") setAgouzaStock((s) => ({ ...s, [productId]: newActualKg }));
      else setExtraStock((s) => ({ ...s, [wh]: { ...(s[wh] || {}), [productId]: newActualKg } }));
      toast.success("تم تحديث الرصيد الفعلي");
      setEditingKey(null);

    } catch (e: any) {
      toast.error(e.message || "تعذّر الحفظ");
    } finally {
      setSaving(false);
    }
  };

  const canEditFor = (wh: SingleWh) => wh === "agouza" ? canEditAgouza : canEditAll;

  // Format kg values: strip float artefacts (e.g. 14.100000000000001 → 14.1), 2 decimals max.
  const fmtKg = (v: number) => {
    if (v == null || isNaN(v)) return "0";
    const rounded = Math.round(v * 100) / 100;
    return String(rounded);
  };


  // خلية الرصيد الفعلي (قابلة للتعديل) — تعرض عدد العبوات والكيلو
  const ActualCell = ({ wh, pid, name, kgValue }: { wh: SingleWh; pid: string; name: string; kgValue: number }) => {
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
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">= {fmtKg(previewKg)} كجم</span>
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
          <Badge variant="outline" className="font-bold">{fmtKg(kgValue)} كجم</Badge>
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
    const q = normalizeSearch(search);
    const list = q ? products.filter((p) => {
      const codes = [
        p.name,
        p.category,
        p.unit,
        p.barcode,
        mainSku[p.id],
        agouzaSku[p.id],
        extraSku.carrefour?.[p.id],
        extraSku.healthy?.[p.id],
      ];
      return codes.some((v) => normalizeSearch(v).includes(q));
    }) : products;
    return list;
  }, [products, search, mainSku, agouzaSku, extraSku]);

  // ملخص أعلى الشاشة (يُحسب على الـ scope الحالي)
  const summary = useMemo(() => {
    let itemsWithStock = 0;
    let totalReservedKg = 0;
    let belowZero = 0;
    let totalValue = 0;
    let lowStockCount = 0;
    let lastMoveTs: string | null = null;
    let lastMovePid: string | null = null;

    const stockSrc = isSingleScope(scope) ? getStockMap(scope as SingleWh) : null;
    const pendSrc = isSingleScope(scope) ? getPendingMap(scope as SingleWh) : null;
    const costSrc = isSingleScope(scope) ? getCostMap(scope as SingleWh) : null;
    const lowSrc = isSingleScope(scope) ? getLowMap(scope as SingleWh) : null;
    const lastMoveSrc = isSingleScope(scope) ? getLastMoveMap(scope as SingleWh) : null;

    if (stockSrc && pendSrc) {
      filtered.forEach((p) => {
        const a = stockSrc[p.id] ?? 0;
        const r = pendSrc[p.id] ?? 0;
        if (a > 0) itemsWithStock++;
        totalReservedKg += r;
        if (a - r < 0) belowZero++;
        if (costSrc) totalValue += a * (costSrc[p.id] ?? 0);
        const lo = lowSrc?.[p.id] ?? 0;
        if (lo > 0 && a <= lo) lowStockCount++;
        const ts = lastMoveSrc?.[p.id];
        if (ts && (!lastMoveTs || ts > lastMoveTs)) { lastMoveTs = ts; lastMovePid = p.id; }
      });
    } else {
      filtered.forEach((p) => {
        const a = (agouzaStock[p.id] ?? 0) + (mainStock[p.id] ?? 0);
        const r = (agouzaPending[p.id] ?? 0) + (mainPending[p.id] ?? 0);
        if (a > 0) itemsWithStock++;
        totalReservedKg += r;
        if (a - r < 0) belowZero++;
      });
    }
    return {
      itemsWithStock,
      totalReservedKg: Math.round(totalReservedKg * 100) / 100,
      belowZero,
      totalValue: Math.round(totalValue * 100) / 100,
      lowStockCount,
      lastMoveTs,
      lastMovePid,
      itemsCount: filtered.length,
    };
  }, [filtered, scope, agouzaStock, mainStock, agouzaPending, mainPending, extraStock, extraPending, extraCost, extraLowThreshold, extraLastMove, mainCost, agouzaCost, mainLowThreshold, agouzaLowThreshold, mainLastMove, agouzaLastMove]);

  const { title, subtitle } = titleMap[scope];

  // أعمدة الجدول حسب الـ scope
  const renderMainCols = scope === "main" || scope === "both";
  const renderAgouzaCols = scope === "agouza" || scope === "both";
  const renderCarrefourCols = scope === "carrefour";
  const renderHealthyCols = scope === "healthy";
  const currentSingleScope: SingleWh | null = isSingleScope(scope) ? (scope as SingleWh) : null;
  const currentWhId = currentSingleScope ? getWhId(currentSingleScope) : null;
  const currentWhLabel = currentSingleScope ? getWhLabel(currentSingleScope) : "";
  const currentStock = currentSingleScope ? getStockMap(currentSingleScope) : {};
  const currentPending = currentSingleScope ? getPendingMap(currentSingleScope) : {};
  const currentCost = currentSingleScope ? getCostMap(currentSingleScope) : {};
  const currentSku = currentSingleScope ? getSkuMap(currentSingleScope) : {};
  const currentLastMove = currentSingleScope ? getLastMoveMap(currentSingleScope) : {};
  const currentDialogItems = useMemo(
    () => (currentSingleScope ? dialogItemsByWh[currentSingleScope] || [] : []),
    [currentSingleScope, dialogItemsByWh]
  );



  const content = (
    <TooltipProvider delayDuration={200}>
      {!embedded && <Header title={title} subtitle={subtitle} />}

      {/* Premium hero header */}
      {isSingleScope(scope) && (
        <Card className="mb-4 overflow-hidden border-primary/10 shadow-sm">
          <div className="relative bg-gradient-to-l from-primary/8 via-background to-orange-500/8 p-5">
            <div className="flex flex-col md:flex-row md:items-center gap-4">
              <div className="flex items-center gap-3">
                <div className="h-14 w-14 rounded-2xl bg-white shadow-sm ring-1 ring-primary/15 flex items-center justify-center overflow-hidden shrink-0">
                  <img src={companyLogo} alt="نعام العاصمة" className="h-12 w-12 object-contain" />
                </div>
                <div>
                  <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
                    <Warehouse className="w-5 h-5 text-primary" />
                    {title}
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    الفعلي • المحجوز للطلبات • المتاح للبيع
                  </p>
                </div>
              </div>
              {currentWhId && (
                <div className="md:ms-auto flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setManualAddOpen(true)} className="bg-emerald-600 hover:bg-emerald-700 shadow-sm h-9">
                    <PackagePlus className="w-4 h-4 ml-1.5" /> إضافة رصيد / توريد
                  </Button>
                  <Button size="sm" onClick={() => setManualOutOpen(true)} className="bg-rose-600 hover:bg-rose-700 shadow-sm h-9">
                    <PackageMinus className="w-4 h-4 ml-1.5" /> صرف / توريد للجهات
                  </Button>
                  <Button size="sm" variant="outline" onClick={fetchAll} disabled={loading} className="h-9">
                    <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                  </Button>
                </div>
              )}
            </div>
          </div>
        </Card>
      )}


      {isSingleScope(scope) && currentWhId && (
        <>
          <ManualStockAdditionDialog
            open={manualAddOpen}
            onOpenChange={setManualAddOpen}
            warehouseId={currentWhId}
            warehouseName={currentWhLabel}
            items={currentDialogItems}
            onSaved={fetchAll}
          />
          <ManualStockOutDialog
            open={manualOutOpen}
            onOpenChange={setManualOutOpen}
            warehouseId={currentWhId}
            warehouseName={currentWhLabel}
            items={currentDialogItems}
            onSaved={fetchAll}
          />
        </>
      )}




      {/* KPI cards — premium */}
      {(() => {
        const Kpi = ({ icon: Icon, label, value, sub, tone = "neutral", onClick, valueClass = "" }: any) => {
          const tones: Record<string, string> = {
            green: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/20",
            orange: "bg-orange-500/10 text-orange-700 dark:text-orange-300 ring-orange-500/20",
            red: "bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-rose-500/20",
            purple: "bg-violet-500/10 text-violet-700 dark:text-violet-300 ring-violet-500/20",
            blue: "bg-sky-500/10 text-sky-700 dark:text-sky-300 ring-sky-500/20",
            neutral: "bg-muted text-muted-foreground ring-border",
          };
          return (
            <Card
              onClick={onClick}
              className={`group relative overflow-hidden rounded-xl border-border/60 shadow-sm transition-all ${onClick ? "cursor-pointer hover:-translate-y-0.5 hover:shadow-md hover:border-primary/30" : ""}`}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium text-muted-foreground tracking-tight">{label}</div>
                    <div className={`mt-1.5 text-2xl font-bold tabular-nums leading-none ${valueClass}`}>{value}</div>
                    {sub && <div className="mt-1.5 text-[10px] text-muted-foreground">{sub}</div>}
                  </div>
                  <div className={`h-10 w-10 rounded-xl ring-1 flex items-center justify-center ${tones[tone]}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        };
        return (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            {isSingleScope(scope) && (
              <Kpi
                icon={Wallet}
                tone="green"
                label="قيمة المخزون"
                value={`${summary.totalValue.toLocaleString()} ج.م`}
              />
            )}
            <Kpi
              icon={Boxes}
              tone="blue"
              label="عدد الأصناف"
              value={summary.itemsCount}
              sub={showItemsTable ? "اضغط للإخفاء" : "اضغط لعرض الجدول"}
              onClick={() => { setTableFilter("all"); setShowItemsTable((v) => !v); }}
            />
            <Kpi
              icon={PackageCheck}
              tone="green"
              label="أصناف لها رصيد فعلي"
              value={summary.itemsWithStock}
              sub="اضغط للتفاصيل"
              onClick={isSingleScope(scope) ? () => { setCardSearch(""); setCardDialog("withStock"); } : () => setShowItemsTable(true)}
            />
            <Kpi
              icon={Lock}
              tone="orange"
              label="إجمالي محجوز للطلبات"
              value={`${summary.totalReservedKg} كجم`}
              sub={isSingleScope(scope) ? "اضغط للتفاصيل" : undefined}
              onClick={isSingleScope(scope) ? () => { setTableFilter("all"); setShowItemsTable(true); } : undefined}
            />
            {isSingleScope(scope) && (
              <Kpi
                icon={AlertTriangle}
                tone={summary.lowStockCount > 0 ? "red" : "neutral"}
                label="منتجات منخفضة"
                value={summary.lowStockCount}
                valueClass={summary.lowStockCount > 0 ? "text-rose-600" : ""}
                sub="اضغط للتفاصيل"
                onClick={() => { setTableFilter("lowStock"); setShowItemsTable(true); }}
              />
            )}
            <Kpi
              icon={AlertTriangle}
              tone={summary.belowZero > 0 ? "red" : "neutral"}
              label="محجوز أكثر من الفعلي"
              value={summary.belowZero}
              valueClass={summary.belowZero > 0 ? "text-rose-600" : ""}
              sub="اضغط للتفاصيل"
              onClick={isSingleScope(scope) ? () => { setCardSearch(""); setCardDialog("overReserved"); } : () => setShowItemsTable(true)}
            />
            {isSingleScope(scope) && (
              <Kpi
                icon={Clock}
                tone="purple"
                label="آخر حركة"
                value={summary.lastMoveTs ? new Date(summary.lastMoveTs).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" }) : "—"}
                valueClass="text-sm"
                sub={summary.lastMovePid ? (products.find(p => p.id === summary.lastMovePid)?.name || "") : undefined}
              />
            )}
          </div>
        );
      })()}




      {showItemsTable && (
      <Card className="rounded-xl border-border/60 shadow-sm overflow-hidden">
        <CardHeader className="pb-3 border-b bg-muted/30">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                <Warehouse className="w-4 h-4" />
              </div>
              المنتجات والكميات
            </CardTitle>
            <div className="flex gap-2 items-center flex-wrap">
              <div className="relative flex-1 sm:w-72">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="بحث باسم المنتج..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pr-9 h-9 bg-background"
                />
              </div>
              <Button size="sm" variant="ghost" onClick={() => setShowItemsTable(false)} className="h-9">
                <X className="w-4 h-4 ml-1" /> رجوع
              </Button>
              {scope === "agouza" && (isAgouzaWarehouseKeeper || canEditAll) && agouzaWhId && (
                <Button
                  size="sm"
                  className="gap-1 h-9"
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
                  agouza: (agouzaStock[p.id] ?? 0) - (agouzaPending[p.id] ?? 0),
                  main: (mainStock[p.id] ?? 0) - (mainPending[p.id] ?? 0),
                  agouza_actual: agouzaStock[p.id] ?? 0,
                  agouza_reserved: agouzaPending[p.id] ?? 0,
                  main_actual: mainStock[p.id] ?? 0,
                  main_reserved: mainPending[p.id] ?? 0,
                }));
                const filter = search.trim() || undefined;
                const btn = "inline-flex items-center gap-1.5 h-9 px-3 text-xs rounded-md border bg-background hover:bg-muted hover:border-primary/30 transition-colors";
                const renderViewButtons = (mode: "agouza" | "main") => (
                  <>
                    <button className={btn} title="طباعة الجرد الفعلي قبل المحجوز" onClick={() => printWarehouseStock(rows, { filter, mode, view: "actual" })}>
                      <Printer className="w-3.5 h-3.5" /> الفعلي
                    </button>
                    <button className={btn} title="طباعة المتاح للبيع بعد المحجوز" onClick={() => printWarehouseStock(rows, { filter, mode, view: "available" })}>
                      <Printer className="w-3.5 h-3.5" /> المتاح
                    </button>
                    <button className={btn} title="طباعة الفعلي والمحجوز والمتاح في 3 أعمدة" onClick={() => printWarehouseStock(rows, { filter, mode, view: "full" })}>
                      <Printer className="w-3.5 h-3.5" /> 3 أعمدة
                    </button>
                  </>
                );
                if (scope === "agouza") return renderViewButtons("agouza");
                if (scope === "main") return renderViewButtons("main");
                return (
                  <>
                    <button className={btn} onClick={() => printWarehouseStock(rows, { filter, mode: "agouza", view: "full" })}>
                      <Printer className="w-3.5 h-3.5" /> العجوزة
                    </button>
                    <button className={btn} onClick={() => printWarehouseStock(rows, { filter, mode: "main", view: "full" })}>
                      <Printer className="w-3.5 h-3.5" /> الرئيسي
                    </button>
                    <button className={btn} onClick={() => printWarehouseStock(rows, { filter, mode: "both", view: "full" })}>
                      <Printer className="w-3.5 h-3.5" /> الإجمالي
                    </button>
                  </>
                );
              })()}
            </div>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1 leading-relaxed flex flex-wrap gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1"><Badge variant="outline" className="px-1.5 py-0">الفعلي</Badge> الجرد على أرض الواقع</span>
            <span className="inline-flex items-center gap-1"><Badge className="bg-orange-500/15 text-orange-700 border border-orange-500/30 hover:bg-orange-500/15 px-1.5 py-0">المحجوز</Badge> طلبات لم تُصرف بعد</span>
            <span className="inline-flex items-center gap-1"><Badge className="bg-emerald-500/15 text-emerald-700 border border-emerald-500/30 hover:bg-emerald-500/15 px-1.5 py-0">المتاح</Badge> = الفعلي − المحجوز</span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto max-h-[70vh]">
            <table className="w-full text-right text-sm border-collapse">
              <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur supports-[backdrop-filter]:bg-muted/60 text-xs">
                <tr className="border-b">
                  <th className="p-3 font-semibold text-muted-foreground">المنتج</th>
                  <th className="p-3 font-semibold text-muted-foreground">الوحدة</th>
                  {renderAgouzaCols && <th className="p-3 font-semibold text-muted-foreground whitespace-nowrap">العجوزة — الفعلي</th>}
                  {renderAgouzaCols && <th className="p-3 font-semibold text-muted-foreground whitespace-nowrap">العجوزة — المحجوز</th>}
                  {renderAgouzaCols && <th className="p-3 font-semibold text-muted-foreground whitespace-nowrap">العجوزة — المتاح</th>}
                  {renderMainCols && <th className="p-3 font-semibold text-muted-foreground whitespace-nowrap">الرئيسي — الفعلي</th>}
                  {renderMainCols && <th className="p-3 font-semibold text-muted-foreground whitespace-nowrap">الرئيسي — المحجوز</th>}
                  {renderMainCols && <th className="p-3 font-semibold text-muted-foreground whitespace-nowrap">الرئيسي — المتاح</th>}
                  {(renderCarrefourCols || renderHealthyCols) && <th className="p-3 font-semibold text-muted-foreground whitespace-nowrap">الفعلي</th>}
                  {(renderCarrefourCols || renderHealthyCols) && <th className="p-3 font-semibold text-muted-foreground whitespace-nowrap">المحجوز</th>}
                  {(renderCarrefourCols || renderHealthyCols) && <th className="p-3 font-semibold text-muted-foreground whitespace-nowrap">المتاح</th>}
                  <th className="p-3 font-semibold text-muted-foreground whitespace-nowrap text-center sticky left-0 bg-muted/80 backdrop-blur">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {loading && filtered.length === 0 && Array.from({ length: 6 }).map((_, i) => (
                  <tr key={`sk-${i}`} className="border-b">
                    <td colSpan={11} className="p-3"><Skeleton className="h-8 w-full" /></td>
                  </tr>
                ))}
                {filtered
                  .filter((p) => {
                    if (!currentSingleScope) return true;
                    const a = currentStock[p.id] ?? 0;
                    const r = currentPending[p.id] ?? 0;
                    const lo = (currentSingleScope ? getLowMap(currentSingleScope) : {})[p.id] ?? 0;
                    if (tableFilter === "withStock") return a > 0;
                    if (tableFilter === "lowStock") return lo > 0 && a <= lo;
                    if (tableFilter === "overReserved") return r > a;
                    return true;
                  })
                  .map((p) => {
                  const aActual = agouzaStock[p.id] ?? 0;
                  const aPend = agouzaPending[p.id] ?? 0;
                  const mActual = mainStock[p.id] ?? 0;
                  const mPend = mainPending[p.id] ?? 0;
                  const cActual = currentSingleScope ? (currentStock[p.id] ?? 0) : 0;
                  const cPend = currentSingleScope ? (currentPending[p.id] ?? 0) : 0;
                  return (
                    <tr key={p.id} className="border-b border-border/50 hover:bg-primary/[0.03] transition-colors group">
                      <td className="p-3 font-semibold text-foreground">{p.name}</td>
                      <td className="p-3 text-muted-foreground text-xs">{p.unit}</td>
                      {renderAgouzaCols && <td className="p-3"><ActualCell wh="agouza" pid={p.id} name={p.name} kgValue={aActual} /></td>}
                      {renderAgouzaCols && <td className="p-3"><ReservedCell pending={aPend} name={p.name} onOpen={() => setReservedDlg({ wh: "agouza", productId: p.id, productName: p.name, total: aPend })} /></td>}
                      {renderAgouzaCols && <td className="p-3"><AvailableCell actual={aActual} pending={aPend} name={p.name} /></td>}
                      {renderMainCols && <td className="p-3"><ActualCell wh="main" pid={p.id} name={p.name} kgValue={mActual} /></td>}
                      {renderMainCols && <td className="p-3"><ReservedCell pending={mPend} name={p.name} onOpen={() => setReservedDlg({ wh: "main", productId: p.id, productName: p.name, total: mPend })} /></td>}
                      {renderMainCols && <td className="p-3"><AvailableCell actual={mActual} pending={mPend} name={p.name} /></td>}
                      {(renderCarrefourCols || renderHealthyCols) && currentSingleScope && (
                        <>
                          <td className="p-3"><ActualCell wh={currentSingleScope} pid={p.id} name={p.name} kgValue={cActual} /></td>
                          <td className="p-3"><ReservedCell pending={cPend} name={p.name} onOpen={() => setReservedDlg({ wh: currentSingleScope, productId: p.id, productName: p.name, total: cPend })} /></td>
                          <td className="p-3"><AvailableCell actual={cActual} pending={cPend} name={p.name} /></td>
                        </>
                      )}
                      <td className="p-2 text-center sticky left-0 bg-card group-hover:bg-primary/[0.03] transition-colors">
                        {(() => {
                          const whKey: SingleWh | null = currentSingleScope ?? (renderMainCols && mainItemIds[p.id] ? "main" : renderAgouzaCols && agouzaItemIds[p.id] ? "agouza" : null);
                          const iid = whKey ? getItemIdsMap(whKey)[p.id] : null;
                          const whId = whKey ? getWhId(whKey) : null;
                          const stockVal = whKey === "main" ? mActual : whKey === "agouza" ? aActual : cActual;
                          const hasReserved = (whKey === "main" ? mPend : whKey === "agouza" ? aPend : cPend) > 0;
                          if (!iid || !whId) return <span className="text-muted-foreground text-xs">—</span>;
                          return (
                            <div className="flex items-center justify-center gap-1">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    className="h-8 w-8 inline-flex items-center justify-center rounded-lg bg-violet-500/10 text-violet-700 dark:text-violet-300 hover:bg-violet-500/20 transition-colors"
                                    onClick={() => setMovDlg({ itemId: iid, name: p.name, unit: p.unit, stock: stockVal, whId, whLabel: getWhLabel(whKey!) })}
                                  >
                                    <History className="w-4 h-4" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="top">سجل حركة الصنف</TooltipContent>
                              </Tooltip>
                              {hasReserved && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      className="h-8 w-8 inline-flex items-center justify-center rounded-lg bg-orange-500/10 text-orange-700 dark:text-orange-300 hover:bg-orange-500/20 transition-colors"
                                      onClick={() => setReservedDlg({ wh: whKey!, productId: p.id, productName: p.name, total: whKey === "main" ? mPend : whKey === "agouza" ? aPend : cPend })}
                                    >
                                      <Lock className="w-4 h-4" />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent side="top">الحجوزات</TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                    </tr>
                  );
                })}
                {!loading && filtered.length === 0 && (
                  <tr><td colSpan={11} className="p-12 text-center text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                        <Package className="w-6 h-6 opacity-50" />
                      </div>
                      <div className="text-sm">لا توجد منتجات مطابقة</div>
                    </div>
                  </td></tr>
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
              const cActual = currentSingleScope ? (currentStock[p.id] ?? 0) : 0;
              const cPend = currentSingleScope ? (currentPending[p.id] ?? 0) : 0;
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
                        <div><div className="text-muted-foreground mb-0.5">المحجوز</div><ReservedCell pending={aPend} name={p.name} onOpen={() => setReservedDlg({ wh: "agouza", productId: p.id, productName: p.name, total: aPend })} /></div>
                        <div><div className="text-muted-foreground mb-0.5">المتاح</div><AvailableCell actual={aActual} pending={aPend} name={p.name} /></div>
                      </div>
                    </div>
                  )}
                  {renderMainCols && (
                    <div className="border-t pt-2">
                      <div className="text-xs font-semibold mb-1 text-muted-foreground">المخزن الرئيسي</div>
                      <div className="grid grid-cols-3 gap-1 text-[11px]">
                        <div><div className="text-muted-foreground mb-0.5">الفعلي</div><ActualCell wh="main" pid={p.id} name={p.name} kgValue={mActual} /></div>
                        <div><div className="text-muted-foreground mb-0.5">المحجوز</div><ReservedCell pending={mPend} name={p.name} onOpen={() => setReservedDlg({ wh: "main", productId: p.id, productName: p.name, total: mPend })} /></div>
                        <div><div className="text-muted-foreground mb-0.5">المتاح</div><AvailableCell actual={mActual} pending={mPend} name={p.name} /></div>
                      </div>
                    </div>
                  )}
                  {(renderCarrefourCols || renderHealthyCols) && currentSingleScope && (
                    <div className="border-t pt-2">
                      <div className="text-xs font-semibold mb-1 text-muted-foreground">{currentWhLabel}</div>
                      <div className="grid grid-cols-3 gap-1 text-[11px]">
                        <div><div className="text-muted-foreground mb-0.5">الفعلي</div><ActualCell wh={currentSingleScope} pid={p.id} name={p.name} kgValue={cActual} /></div>
                        <div><div className="text-muted-foreground mb-0.5">المحجوز</div><ReservedCell pending={cPend} name={p.name} onOpen={() => setReservedDlg({ wh: currentSingleScope, productId: p.id, productName: p.name, total: cPend })} /></div>
                        <div><div className="text-muted-foreground mb-0.5">المتاح</div><AvailableCell actual={cActual} pending={cPend} name={p.name} /></div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
      )}

      {reservedDlg && (
        <ReservedDetailsDialog
          open={!!reservedDlg}
          onOpenChange={(o) => { if (!o) setReservedDlg(null); }}
          warehouseId={getWhId(reservedDlg.wh) || ""}
          warehouseName={getWhLabel(reservedDlg.wh)}
          productId={reservedDlg.productId}
          productName={reservedDlg.productName}
          totalReservedKg={reservedDlg.total}
        />
      )}

      {isSingleScope(scope) && currentSingleScope && (
        <MainCardDialog
          mode={cardDialog}
          onClose={() => setCardDialog(null)}
          products={products}
          mainStock={currentStock}
          mainPending={currentPending}
          mainCost={currentCost}
          mainSku={currentSku}
          mainLastMove={currentLastMove}
          search={cardSearch}
          onSearch={setCardSearch}
          onOpenReserved={(pid, name, total) => setReservedDlg({ wh: currentSingleScope, productId: pid, productName: name, total })}
          warehouseName={currentWhLabel}
          onOpenDistribute={
            currentSingleScope === "main" && currentWhId
              ? (product, actual, reserved) =>
                  setDistDlg({ warehouseId: currentWhId, productId: product.id, productName: product.name, unit: product.unit, actual, reserved })
              : undefined
          }
        />
      )}

      {distDlg && (
        <SubLocationDistributionDialog
          open={!!distDlg}
          onClose={() => setDistDlg(null)}
          warehouseId={distDlg.warehouseId}
          warehouseName={currentWhLabel}
          productId={distDlg.productId}
          productName={distDlg.productName}
          unit={distDlg.unit}
          mainActual={distDlg.actual}
          mainReserved={distDlg.reserved}
        />
      )}

      {movDlg && (
        <ItemMovementsDialog
          open={!!movDlg}
          onOpenChange={(o) => { if (!o) setMovDlg(null); }}
          item={{ id: movDlg.itemId, name: movDlg.name, unit: movDlg.unit, stock: movDlg.stock }}
          warehouseId={movDlg.whId}
          warehouseName={movDlg.whLabel}
        />
      )}
    </TooltipProvider>

  );

  return embedded ? content : <DashboardLayout>{content}</DashboardLayout>;
};


export default WarehouseStockView;

