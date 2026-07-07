import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import OrdersAnalytics from "@/components/dashboard/OrdersAnalytics";
import ModeratorQuickAccessCards from "@/components/sales/ModeratorQuickAccessCards";
import ModeratorsAggregateSummary from "@/components/sales/ModeratorsAggregateSummary";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ShoppingCart, Eye, Truck, CheckCircle, XCircle, Plus, Trash2, Pencil, ChevronDown, ChevronUp, PackageOpen, PackagePlus, FileDown, FileText, KeyRound, MapPin, Printer, AlertCircle, AlertTriangle, Wallet, Zap, UserCog, Search } from "lucide-react";
import { printOrderInvoice } from "@/lib/printUtils";
import { cairoMonthStartUTC, cairoYearStartUTC, currentCairoYearMonth, cairoTodayStartUTC, toCairoDateString } from "@/lib/cairoDate";
import { exportOrdersToCSV, exportOrdersToPDF, exportOrdersToXLSX } from "@/utils/exportOrders";
import EditOrderItemsDialog from "@/components/orders/EditOrderItemsDialog";
import SwapOfferDialog from "@/components/orders/SwapOfferDialog";
import AddOfferDialog from "@/components/orders/AddOfferDialog";
import EditAddressWarehouseDialog from "@/components/orders/EditAddressWarehouseDialog";
import EditCustomerInfoDialog from "@/components/orders/EditCustomerInfoDialog";
import PhoneWithCopy from "@/components/orders/PhoneWithCopy";
import DiscrepancyBanner from "@/components/orders/DiscrepancyBanner";
import QuickDeliveryDialog from "@/components/orders/QuickDeliveryDialog";
import ReassignOwnerDialog from "@/components/orders/ReassignOwnerDialog";
import { findModeratorByName, isOrderForModerator } from "@/constants/moderators";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { formatDate } from "@/lib/dateFormat";
import {
  AGOUZA_WAREHOUSE_ID,
  commitAgouzaForOrder,
  releaseAgouzaForOrder,
} from "@/lib/agouzaReservations";
import { MAIN_WAREHOUSE_ID } from "@/lib/warehouseItemFilters";


type YearGroup = "all" | "2026" | "pre2026";

type OrderStatus = 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled';

interface OrderItem {
  id: string;
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  unit?: string;
  offer_name?: string | null;
}

interface Order {
  id: string;
  order_number: string;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string;
  customer_phone2?: string | null;
  status: OrderStatus;
  payment_method: string;
  payment_status: string;
  collection_status: string;
  subtotal: number;
  discount: number;
  delivery_fee: number;
  total: number;
  notes: string | null;
  delivery_address: string | null;
  created_at: string;
  delivered_at: string | null;
  created_by: string | null;
  moderator_name: string;
  governorate: string | null;
  shipping_company: string | null;
  source: string | null;
  fulfillment_type: string | null;
  source_warehouse_id: string | null;
  source_warehouse_name: string | null;
  route_id: string | null;
  route_name: string | null;
  items: OrderItem[];
  update_status_marker?: UpdateStatusMarker | null;
  update_status_updated_at?: string | null;
  collection_method?: CollectionMethod | null;
  courier_cash_due?: number | null;
  vodafone_cash_amount?: number | null;
  instapay_amount?: number | null;
  bank_transfer_amount?: number | null;
  other_amount?: number | null;
  free_amount?: number | null;
  transfer_reference?: string | null;
  collection_updated_at?: string | null;
  shipping_bill_no?: string | null;
}

// آخر زر تحديث تم استخدامه على الأوردر (عرض فقط، لا يمس منطق المخزون/المالية).
type UpdateStatusMarker =
  | 'cash'
  | 'delivered'
  | 'distribution'
  | 'correction'
  | 'cancelled'
  | 'gift'
  | 'returned';

const updateMarkerMeta: Record<UpdateStatusMarker, { label: string; className: string }> = {
  cash:         { label: 'كاش ✅',    className: 'bg-emerald-500 text-white border-emerald-600' },
  delivered:    { label: 'تسليم ✅',  className: 'bg-sky-500 text-white border-sky-600' },
  distribution: { label: 'توزيع 🚚',  className: 'bg-violet-500 text-white border-violet-600' },
  correction:   { label: 'تصحيح 🔧', className: 'bg-orange-500 text-white border-orange-600' },
  cancelled:    { label: 'إلغاء ❌',  className: 'bg-slate-500 text-white border-slate-600' },
  gift:         { label: 'مجاني 🎁', className: 'bg-pink-500 text-white border-pink-600' },
  returned:     { label: 'مرتجع ↩️', className: 'bg-red-600 text-white border-red-700' },
};

// طريقة/حالة تحصيل مبلغ الأوردر — للعرض فقط ولا تمس منطق التسليم/المخزون/المالية.
type CollectionMethod =
  | 'cash_courier'
  | 'vodafone_cash'
  | 'instapay'
  | 'bank_transfer'
  | 'other'
  | 'mixed_payment'
  | 'prepaid'
  | 'none';

const collectionMethodMeta: Record<CollectionMethod, { label: string; short: string; className: string }> = {
  cash_courier:  { label: 'تحصيل نقدي مع المندوب', short: 'كاش من المندوب',  className: 'bg-emerald-500 text-white border-emerald-600' },
  vodafone_cash: { label: 'تحويل فودافون كاش',      short: 'Vodafone Cash',   className: 'bg-rose-500 text-white border-rose-600' },
  instapay:      { label: 'تحويل إنستاباي',         short: 'InstaPay',        className: 'bg-violet-500 text-white border-violet-600' },
  bank_transfer: { label: 'تحويل بنكي',              short: 'تحويل بنكي 🏦',    className: 'bg-blue-600 text-white border-blue-700' },
  other:         { label: 'أخرى',                    short: 'أخرى',            className: 'bg-zinc-500 text-white border-zinc-600' },
  mixed_payment: { label: 'تحصيل مختلط',            short: 'مختلط 🧩',        className: 'bg-amber-500 text-white border-amber-600' },
  prepaid:       { label: 'مدفوع مسبقاً',           short: 'مدفوع مسبقاً',    className: 'bg-sky-500 text-white border-sky-600' },
  none:          { label: 'لا يوجد تحصيل',          short: 'لا يوجد تحصيل',   className: 'bg-slate-500 text-white border-slate-600' },
};


// Fulfillment filter keys
const fulfillmentOptions: { value: string; label: string }[] = [
  { value: 'pickup_main', label: 'استلام من المخزن الرئيسي' },
  { value: 'delivery_main', label: 'توصيل بالمندوب الخاص (كيمو)' },
  { value: 'pickup_agouza', label: 'استلام من العجوزة' },
  { value: 'delivery_agouza', label: 'توصيل من العجوزة' },
  { value: 'shipping_company', label: 'شركة شحن' },
];

// Sales manager who must approve private-delivery-rep edits (م. آلاء حامد)
const SALES_MANAGER_ID = '77b71c5f-cfa8-42bc-85de-ae536a3ec1c1';

// Arabic normalization for search: strip diacritics/tatweel, unify hamza/ta-marbuta/alef-maksura.
const normalizeArabic = (s: string): string =>
  (s || "")
    .toString()
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "") // tashkeel + tatweel
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();

const statusColors: Record<OrderStatus, string> = {
  pending: "bg-warning text-warning-foreground",
  processing: "bg-primary text-primary-foreground",
  shipped: "bg-chart-4 text-primary-foreground",
  delivered: "bg-success text-success-foreground",
  cancelled: "bg-destructive text-destructive-foreground",
};

const statusLabels: Record<OrderStatus, string> = {
  pending: "قيد الانتظار",
  processing: "جاري التجهيز",
  shipped: "تم الشحن",
  delivered: "تم التوصيل",
  cancelled: "مرتجع",
};

const paymentLabels: Record<string, string> = {
  cash: "نقدي",
  online: "إلكتروني",
};

const paymentStatusLabels: Record<string, string> = {
  pending: "قيد الانتظار",
  paid: "مدفوع",
  failed: "فشل",
};

const isMassUnit = (u?: string) => {
  const n = (u || '').trim().toLowerCase();
  return ['كجم', 'كيلو', 'كيلوجرام', 'kg', 'جم', 'جرام', 'g'].includes(n);
};

const formatItemQty = (qty: number, unit?: string): string => {
  const mass = isMassUnit(unit);
  let q = qty;
  let suffix = unit || '';
  if (mass) {
    suffix = 'ك';
    if (unit === 'جم' || unit === 'جرام' || unit === 'g') q = qty / 1000;
  }
  const fractions: Record<string, string> = {
    '0.25': 'ربع',
    '0.5': 'نص',
    '0.75': '٣/٤',
  };
  const whole = Math.floor(q);
  const frac = +(q - whole).toFixed(2);
  const fracLabel = fractions[String(frac)];

  let qtyStr: string;
  if (whole === 0 && fracLabel) qtyStr = fracLabel;
  else if (whole > 0 && fracLabel) qtyStr = `${whole} و${fracLabel}`;
  else if (whole === 1 && frac === 0) qtyStr = '';
  else qtyStr = q % 1 === 0 ? String(whole) : String(q);

  // للوحدات الوزنية: نلغى لاحقة "ك" فقط لما الكمية "نص" (مثلاً "نص كفتة")،
  // أما "1 ك لحمة" أو "2 ك سجق" نخليها زى ما هى.
  if (mass && whole === 0 && fracLabel === 'نص') suffix = '';


  if (!suffix) return qtyStr || String(q);
  return qtyStr ? `${qtyStr} ${suffix}` : suffix;
};

const Orders = () => {
 const { user, isShippingCompany, isAccountant, isSalesModerator, isPrivateDeliveryRep, isWarehouseSupervisor, isGeneralManager, isExecutiveManager, roles, canUpdateOrderStatusForOrder, canDeleteOrders, canEditOrderItems, canManageOrders } = useAuth();
  const isSocialMediaManager = roles?.includes('social_media_manager') ?? false;
   const canExportExcel = isGeneralManager || isExecutiveManager || roles.includes('marketing_sales_manager');
   // صلاحية إدارة/اختيار طريقة التحصيل — الأدوار المسؤولة عن التحصيل فعلياً فقط.
   // الأدوار التسويقية (مثل مديرة التسويق م/آلاء) تحدّث الحالة فقط بدون فتح شاشة التحصيل.
   const rolesList = (roles || []) as string[];
   const canSetCollectionMethod =
     isGeneralManager ||
     isExecutiveManager ||
     isWarehouseSupervisor ||
     isAccountant ||
     isShippingCompany ||
     isPrivateDeliveryRep ||
     rolesList.includes('financial_manager') ||
     rolesList.includes('main_treasury_accountant') ||
     rolesList.includes('main_treasury_approver') ||
     rolesList.includes('treasury_accountant') ||
     rolesList.includes('courier');
   // صلاحية تحديث حالة الأوردر إلى "تم التسليم للعميل".
   // مسموح: التسويق (م/آلاء) والموديريتور ومدير المبيعات والإدارة العليا وشركات الشحن/المندوبين.
   // ممنوع: مسؤول المخزن (عبدالمنعم) والمحاسبون/الخزنة — دورهم بعد التسليم فقط (ضبط التحصيل).
   const canMarkDelivered =
     isGeneralManager ||
     isExecutiveManager ||
     rolesList.includes('marketing_sales_manager') ||
     rolesList.includes('sales_manager') ||
     isSalesModerator ||
     isShippingCompany ||
     isPrivateDeliveryRep ||
     rolesList.includes('courier');
   // صلاحية نقل الأوردر من مسوقة إلى أخرى — مقصورة على مديرة التسويق والإدارة العليا فقط
   const canReassignOwner =
     isGeneralManager ||
     isExecutiveManager ||
     rolesList.includes('marketing_sales_manager');
   const [reassignOrder, setReassignOrder] = useState<Order | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  // M4-B: per-order Agouza reservation status. Drives the Agouza-only badge and
  // blocks delivery confirmation when no active/committed reservation exists.
  // 'active' = held, 'committed' = stock already deducted, 'released' = freed,
  // 'shortage' = order saved but reservation refused due to insufficient stock,
  // 'none' = no reservation row found.
  type AgouzaResvStatus = 'active' | 'committed' | 'released' | 'shortage' | 'none';
  const [agouzaResvMap, setAgouzaResvMap] = useState<Record<string, AgouzaResvStatus>>({});

  // Overrides for optimistic status changes — re-applied after every background
  // pagination batch so that a user's status change does not get visually
  // "reverted" by a later batch arriving from the still-running fetch loop.
  const statusOverridesRef = useRef<Map<string, { status: OrderStatus; delivered_at: string | null }>>(new Map());
  const applyStatusOverrides = useCallback((list: Order[]): Order[] => {
    if (statusOverridesRef.current.size === 0) return list;
    return list.map((o) => {
      const ov = statusOverridesRef.current.get(o.id);
      return ov ? { ...o, status: ov.status, delivered_at: ov.delivered_at } : o;
    });
  }, []);
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('order_review_status')
        .select('order_id, is_reviewed')
        .eq('user_id', user.id)
        .eq('is_reviewed', true);
      if (cancelled || error) return;
      setReviewedIds(new Set((data || []).map((r: any) => r.order_id)));
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const toggleReviewed = async (orderId: string, next: boolean) => {
    if (!user?.id) return;
    setReviewedIds(prev => {
      const n = new Set(prev);
      next ? n.add(orderId) : n.delete(orderId);
      return n;
    });
    const { error } = await supabase
      .from('order_review_status')
      .upsert(
        { order_id: orderId, user_id: user.id, is_reviewed: next, reviewed_at: next ? new Date().toISOString() : null },
        { onConflict: 'order_id,user_id' }
      );
    if (error) {
      toast.error('تعذر حفظ حالة المراجعة');
      setReviewedIds(prev => {
        const n = new Set(prev);
        next ? n.delete(orderId) : n.add(orderId);
        return n;
      });
    }
  };
  const [approvedEditOrderIds, setApprovedEditOrderIds] = useState<Set<string>>(new Set());
  const [pendingEditOrderIds, setPendingEditOrderIds] = useState<Set<string>>(new Set());
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) => {
    setExpandedItems(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };
  const [expandedDetails, setExpandedDetails] = useState<Set<string>>(new Set());
  const toggleDetails = (id: string) => {
    setExpandedDetails(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [swapOfferOrder, setSwapOfferOrder] = useState<Order | null>(null);
  const [addOfferOrder, setAddOfferOrder] = useState<Order | null>(null);
  const [editAddressOrder, setEditAddressOrder] = useState<Order | null>(null);
  const [editCustomerOrder, setEditCustomerOrder] = useState<Order | null>(null);

  const handlePrintOrder = (order: Order) => {
    printOrderInvoice({
      order_number: order.order_number,
      created_at: order.created_at,
      customer_name: order.customer_name,
      customer_phone: order.customer_phone,
      delivery_address: order.delivery_address,
      payment_method: order.payment_method,
      payment_status: order.payment_status,
      notes: order.notes,
      items: order.items.map((it) => ({
        product_name: it.product_name,
        quantity: it.quantity,
        unit_price: it.unit_price,
        total_price: it.total_price,
        product_unit: it.unit,
        offer_name: it.offer_name,
      })),
      subtotal: order.subtotal,
      discount: order.discount,
      delivery_fee: order.delivery_fee,
      total: order.total,
      source_warehouse_name: order.source_warehouse_name,
      created_by_name: order.moderator_name,
    });
  };
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterWarehouseChip, setFilterWarehouseChip] = useState<"all" | "main" | "agouza">(() => {
    try {
      const v = localStorage.getItem("orders.filterWarehouseChip");
      if (v === "all" || v === "main" || v === "agouza") return v;
    } catch {}
    return "all";
  });
  useEffect(() => {
    try { localStorage.setItem("orders.filterWarehouseChip", filterWarehouseChip); } catch {}
  }, [filterWarehouseChip]);
  const [filterModerator, setFilterModerator] = useState<string>("all");
  const [filterProduct, setFilterProduct] = useState<string>("all");
  const [filterGovernorate, setFilterGovernorate] = useState<string>("all");
  const [filterFulfillment, setFilterFulfillment] = useState<string>("all");
  const [filterRoute, setFilterRoute] = useState<string>("all");
  const [filterCollectionMethod, setFilterCollectionMethod] = useState<string>("all");
  const [availableRoutes, setAvailableRoutes] = useState<{ id: string; name: string; color: string }[]>([]);
  const [availableProducts, setAvailableProducts] = useState<string[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const yearParam = searchParams.get("year");
  const todayParam = searchParams.get("today") === "1";
  const rawChannelParam = searchParams.get("channel");
  const channelParam = rawChannelParam === 'shipping' ? null : rawChannelParam; // 'main' | 'agouza' | 'unclassified' | null
  const rangeParam = searchParams.get("range"); // '3d' | null
  const productIdParam = searchParams.get("product_id");
  const productNameParam = searchParams.get("product_name");
  const yearGroup: YearGroup =
    yearParam === "2026" || yearParam === "pre2026" || yearParam === "all"
      ? (yearParam as YearGroup)
      : "all";
  const setYearGroup = (v: YearGroup) => {
    const next = new URLSearchParams(searchParams);
    if (v === "all") next.delete("year");
    else next.set("year", v);
    setSearchParams(next, { replace: true });
  };
  const clearDashboardFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("today");
    next.delete("channel");
    next.delete("range");
    next.delete("product_id");
    next.delete("product_name");
    setSearchParams(next, { replace: true });
  };
  // تنظيف فلتر channel=shipping القديم من الرابط تلقائيًا
  useEffect(() => {
    if (rawChannelParam === 'shipping') {
      const next = new URLSearchParams(searchParams);
      next.delete('channel');
      setSearchParams(next, { replace: true });
    }
  }, [rawChannelParam]);
  // فتح نافذة ضبط التحصيل تلقائيًا عند وجود ?mixed=<orderId>
  const mixedParam = searchParams.get("mixed");
  const [draftSearch, setDraftSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [quickDeliveryOpen, setQuickDeliveryOpen] = useState(false);
  const triggerSearchNow = () => setAppliedSearch(draftSearch.trim());
  const now = new Date();
  const [filterMonth, setFilterMonth] = useState<string>("all");
  const [filterYear, setFilterYear] = useState<string>("all");
  const [collectionMismatch, setCollectionMismatch] = useState<{
    orderId: string;
    orderNumber: string;
    deliveredTotal: number;
    currentTotal: number;
  } | null>(null);

  // افتراضياً نحمّل طلبات الشهر الحالي فقط لتسريع الواجهة.
  // عند البحث أو اختيار شهر/سنة محددة يتم تجاوز هذا التقييد لجلب كل المطابقات.
  // شركات الشحن قد لا يكون لديها طلبات في الشهر الحالي (مثلاً زودكس آخر طلب لها في 2025)
  // لتفادي ظهور صفحة فارغة افتراضياً، نحمّل لهم كل الطلبات المسموح بها بدلاً من تقييد الشهر الحالي.
  const restrictToCurrentMonth =
    !appliedSearch &&
    filterMonth === "all" &&
    filterYear === "all" &&
    yearGroup === "all" &&
    !isShippingCompany;

  useEffect(() => {
    fetchOrders();



    (async () => {
      const { data } = await supabase.from('delivery_routes').select('id,name,color').order('name', { ascending: true });
      setAvailableRoutes((data as any[]) || []);
    })();
  }, [filterMonth, filterYear, yearGroup, appliedSearch]);

  // M4-B: Reload Agouza reservation status whenever the visible orders set changes.
  // Read-only; Agouza-only — other warehouses are skipped entirely.
  useEffect(() => {
    const agouzaIds = orders
      .filter((o) => o.source_warehouse_id === AGOUZA_WAREHOUSE_ID)
      .map((o) => o.id);
    if (agouzaIds.length === 0) { setAgouzaResvMap({}); return; }
    let cancelled = false;
    (async () => {
      const map: Record<string, AgouzaResvStatus> = {};
      for (let i = 0; i < agouzaIds.length; i += 500) {
        const chunk = agouzaIds.slice(i, i + 500);
        const { data: resvs } = await supabase
          .from('agouza_stock_reservations')
          .select('order_id,status')
          .in('order_id', chunk);
        (resvs || []).forEach((r: any) => {
          const prev = map[r.order_id];
          if (r.status === 'committed') map[r.order_id] = 'committed';
          else if (r.status === 'active' && prev !== 'committed') map[r.order_id] = 'active';
          else if (!prev) map[r.order_id] = 'released';
        });
        chunk.forEach((id) => { if (!map[id]) map[id] = 'none'; });
      }
      if (!cancelled) setAgouzaResvMap(map);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders.length]);


  const fetchOrders = async () => {
    setLoading(true);
    try {
      // طبّق فلتر التاريخ على الخادم فقط عندما يختاره المستخدم صراحةً.
      // إبقاء الصفحة على "الكل" افتراضياً يمنع ظهور قائمة فارغة عند بداية شهر جديد
      // أو عند عدم وجود طلبات في الشهر الحالي رغم وجود طلبات سابقة.
      // الحدود محسوبة بتوقيت القاهرة (UTC+2/+3 حسب التوقيت الصيفي) حتى أي طلب
      // يُسجّل بعد منتصف الليل بتوقيت القاهرة يظهر في الشهر الصحيح، حتى لو
      // كان created_at المخزّن بـ UTC لا يزال في الشهر السابق.
      let startDate: string | null = null;
      let endDate: string | null = null;
      if (filterYear !== 'all') {
        const y = Number(filterYear);
        if (filterMonth !== 'all') {
          const m = Number(filterMonth);
          startDate = cairoMonthStartUTC(y, m - 1).toISOString();
          endDate = cairoMonthStartUTC(y, m).toISOString();
        } else {
          startDate = cairoYearStartUTC(y).toISOString();
          endDate = cairoYearStartUTC(y + 1).toISOString();
        }
      } else if (yearGroup === '2026') {
        startDate = cairoYearStartUTC(2026).toISOString();
      } else if (yearGroup === 'pre2026') {
        endDate = cairoYearStartUTC(2026).toISOString();
      } else if (restrictToCurrentMonth) {
        const { year, monthIndex0 } = currentCairoYearMonth(now);
        startDate = cairoMonthStartUTC(year, monthIndex0).toISOString();
        endDate = cairoMonthStartUTC(year, monthIndex0 + 1).toISOString();
      }


      // أعمدة محددة بدلاً من * لتقليل الحمولة (نفس البيانات المستعملة في الواجهة فقط)
      const ORDER_COLS = [
        'id','order_number','customer_id','status','payment_method','payment_status',
        'collection_status','subtotal','discount','delivery_fee','total','notes',
        'delivery_address','created_at','delivered_at','created_by','moderator',
        'shipping_company','source','fulfillment_type','source_warehouse_id','route_id',
        'update_status_marker','update_status_updated_at',
        'collection_method','courier_cash_due','collection_updated_at',
        'vodafone_cash_amount','instapay_amount','free_amount','shipping_bill_no',
      ].join(',');
      const ITEM_COLS = 'id,order_id,product_id,product_name,quantity,unit_price,total_price,offer_name,is_half_kg';

      // الخرائط المساعدة تُبنى بشكل تراكمي حتى يظهر الجدول بسرعة
      const profilesMap: Record<string, string> = {};
      const productsMap: Record<string, string> = {};
      const warehousesMap: Record<string, string> = {};
      const routesMap: Record<string, string> = {};
      const productNamesSet = new Set<string>();

      const formatBatch = (ordersData: any[], itemsByOrder: Record<string, any[]>): Order[] =>
        ordersData.map((order: any) => ({
          id: order.id,
          order_number: order.order_number,
          customer_id: order.customer_id,
          customer_name: order.customers?.name || 'عميل غير معروف',
          customer_phone: order.customers?.phone || order.customers?.phone2 || '',
          customer_phone2: order.customers?.phone2 || null,
          status: order.status as OrderStatus,
          payment_method: order.payment_method,
          payment_status: order.payment_status,
          collection_status: (order as any).collection_status || 'not_collected',
          subtotal: Number(order.subtotal),
          discount: Number(order.discount),
          delivery_fee: Number(order.delivery_fee),
          total: Number(order.total),
          notes: order.notes,
          delivery_address: order.delivery_address,
          created_at: order.created_at,
          delivered_at: (order as any).delivered_at ?? null,
          created_by: order.created_by,
          moderator_name:
            (order.created_by && profilesMap[order.created_by]) ||
            order.moderator ||
            '-',
          governorate: (order.customers as any)?.governorate ?? null,
          shipping_company: order.shipping_company ?? null,
          source: (order as any).source ?? null,
          fulfillment_type: (order as any).fulfillment_type ?? null,
          source_warehouse_id: (order as any).source_warehouse_id ?? null,
          source_warehouse_name: (order as any).source_warehouse_id
            ? (warehousesMap[(order as any).source_warehouse_id] ?? null)
            : null,
          route_id: (order as any).route_id ?? null,
          route_name: (order as any).route_id
            ? (routesMap[(order as any).route_id] ?? null)
            : null,
          items: (itemsByOrder[order.id] || []).map((item: any) => ({
            id: item.id,
            product_id: item.product_id ?? null,
            product_name: item.product_name,
            quantity: Number(item.quantity),
            unit_price: Number(item.unit_price),
            total_price: Number(item.total_price),
            unit: (item.product_id && productsMap[item.product_id]) || 'كجم',
            offer_name: (item as any).offer_name ?? null,
          })),
          update_status_marker: ((order as any).update_status_marker ?? null) as UpdateStatusMarker | null,
          update_status_updated_at: (order as any).update_status_updated_at ?? null,
          collection_method: ((order as any).collection_method ?? null) as CollectionMethod | null,
          courier_cash_due: (order as any).courier_cash_due != null ? Number((order as any).courier_cash_due) : 0,
          vodafone_cash_amount: (order as any).vodafone_cash_amount != null ? Number((order as any).vodafone_cash_amount) : 0,
          instapay_amount: (order as any).instapay_amount != null ? Number((order as any).instapay_amount) : 0,
          bank_transfer_amount: (order as any).bank_transfer_amount != null ? Number((order as any).bank_transfer_amount) : 0,
          other_amount: (order as any).other_amount != null ? Number((order as any).other_amount) : 0,
          free_amount: (order as any).free_amount != null ? Number((order as any).free_amount) : 0,
          transfer_reference: (order as any).transfer_reference ?? null,
          collection_updated_at: (order as any).collection_updated_at ?? null,
          shipping_bill_no: (order as any).shipping_bill_no ?? null,
        }));

      const loadLookups = async (orders: any[], items: any[]) => {
        const newCreators = Array.from(new Set(
          orders.map((o: any) => o.created_by).filter((id: string) => id && !profilesMap[id])
        )) as string[];
        const newProducts = Array.from(new Set(
          items.map((it: any) => it.product_id).filter((id: string) => id && !productsMap[id])
        )) as string[];
        const newWarehouses = Array.from(new Set(
          orders.map((o: any) => o.source_warehouse_id).filter((id: string) => id && !warehousesMap[id])
        )) as string[];
        const newRoutes = Array.from(new Set(
          orders.map((o: any) => o.route_id).filter((id: string) => id && !routesMap[id])
        )) as string[];

        await Promise.all([
          newCreators.length > 0
            ? supabase.from('profile_directory').select('id, full_name').in('id', newCreators).then(({ data }) => {
                (data || []).forEach((p: any) => { profilesMap[p.id] = p.full_name; });
              })
            : Promise.resolve(),
          newProducts.length > 0
            ? supabase.from('products').select('id, unit').in('id', newProducts).then(({ data }) => {
                (data || []).forEach((p: any) => { productsMap[p.id] = p.unit; });
              })
            : Promise.resolve(),
          newWarehouses.length > 0
            ? supabase.from('warehouses').select('id, name').in('id', newWarehouses).then(({ data }) => {
                (data || []).forEach((w: any) => { warehousesMap[w.id] = w.name; });
              })
            : Promise.resolve(),
          newRoutes.length > 0
            ? supabase.from('delivery_routes').select('id, name').in('id', newRoutes).then(({ data }) => {
                (data || []).forEach((r: any) => { routesMap[r.id] = r.name; });
              })
            : Promise.resolve(),
        ]);
      };

      // ====== فرع البحث: نجلب فقط الطلبات المطابقة بدل تحميل كل الشهر ======
      if (appliedSearch) {
        const term = appliedSearch;
        const termNorm = normalizeArabic(term);
        const digits = term.replace(/[^\d]/g, "");
        // 1) ابحث عن العملاء المطابقين بالاسم أو الهاتف الأساسي أو الهاتف الإضافي أو المحافظة
        let custIds: string[] = [];
        const custFilters: string[] = [];
        if (term) custFilters.push(`name.ilike.%${term}%`);
        if (termNorm && termNorm !== term.toLowerCase()) custFilters.push(`name.ilike.%${termNorm}%`);
        if (digits) custFilters.push(`phone.ilike.%${digits}%`);
        if (digits) custFilters.push(`phone2.ilike.%${digits}%`);
        if (term) custFilters.push(`governorate.ilike.%${term}%`);
        if (termNorm && termNorm !== term.toLowerCase()) custFilters.push(`governorate.ilike.%${termNorm}%`);
        if (custFilters.length > 0) {
          const { data: cdata } = await supabase
            .from('customers')
            .select('id')
            .or(custFilters.join(','))
            .limit(500);
          custIds = (cdata || []).map((c: any) => c.id);
        }
        // 2) جلب الطلبات: رقم طلب أو ينتمي لعميل مطابق أو عنوان تسليم مطابق.
        const orFilters: string[] = [
          `order_number.ilike.%${term}%`,
          `delivery_address.ilike.%${term}%`,
        ];
        if (termNorm && termNorm !== term.toLowerCase()) {
          orFilters.push(`delivery_address.ilike.%${termNorm}%`);
        }
        if (custIds.length > 0) {
          orFilters.push(`customer_id.in.(${custIds.join(',')})`);
        }
        const { data, error } = await supabase
          .from('orders')
          .select(`${ORDER_COLS}, customers (name, phone, phone2, governorate)`)
          .or(orFilters.join(','))
          .order('created_at', { ascending: false })
          .limit(300);
        if (error) throw error;
        const ords = (data || []) as any[];
        let items: any[] = [];
        if (ords.length > 0) {
          const ids = ords.map((o) => o.id);
          const { data: itemsData, error: itemsErr } = await supabase
            .from('order_items')
            .select(ITEM_COLS)
            .in('order_id', ids);
          if (itemsErr) throw itemsErr;
          items = itemsData || [];
        }
        await loadLookups(ords, items);
        const byOrder: Record<string, any[]> = {};
        items.forEach((it: any) => { (byOrder[it.order_id] ||= []).push(it); });
        const formatted = formatBatch(ords, byOrder);
        items.forEach((it: any) => { if (it.product_name) productNamesSet.add(it.product_name); });
        setOrders(applyStatusOverrides(formatted));
        setAvailableProducts(Array.from(productNamesSet).sort((a, b) => a.localeCompare(b, 'ar')));
        setLoading(false);
        return;
      }

      // الصفحة الأولى: نعرضها فوراً ثم نكمل باقى الصفحات فى الخلفية
      const ORDERS_PAGE = 100;
      let oPage = 0;
      let accumulated: Order[] = [];

      const fetchPage = async (page: number) => {
        let q = supabase
          .from('orders')
          .select(`${ORDER_COLS}, customers (name, phone, phone2, governorate)`)
          .order('created_at', { ascending: false })
          .range(page * ORDERS_PAGE, (page + 1) * ORDERS_PAGE - 1);
        if (startDate) q = q.gte('created_at', startDate);
        if (endDate) q = q.lt('created_at', endDate);
        const { data, error } = await q;
        if (error) throw error;
        const ords = (data || []) as any[];
        if (ords.length === 0) return ords;
        const ids = ords.map((o) => o.id);
        const { data: itemsData, error: itemsErr } = await supabase
          .from('order_items')
          .select(ITEM_COLS)
          .in('order_id', ids);
        if (itemsErr) throw itemsErr;
        const byOrder: Record<string, any[]> = {};
        (itemsData || []).forEach((it: any) => {
          (byOrder[it.order_id] ||= []).push(it);
        });
        ords.forEach((o: any) => { o.order_items = byOrder[o.id] || []; });
        return ords;
      };


      const firstBatch = await fetchPage(oPage);
      const firstItems = firstBatch.flatMap((o: any) =>
        ((o.order_items as any[]) || []).map((it) => ({ ...it, order_id: o.id }))
      );
      await loadLookups(firstBatch, firstItems);
      const itemsByOrder1: Record<string, any[]> = {};
      firstBatch.forEach((o: any) => { itemsByOrder1[o.id] = (o.order_items as any[]) || []; });
      accumulated = formatBatch(firstBatch, itemsByOrder1);
      firstItems.forEach((it: any) => { if (it.product_name) productNamesSet.add(it.product_name); });
      setOrders(applyStatusOverrides(accumulated));
      setAvailableProducts(Array.from(productNamesSet).sort((a, b) => a.localeCompare(b, 'ar')));
      setLoading(false);

      // باقى الصفحات تُحمَّل فى الخلفية دون أن تحجب الواجهة
      if (firstBatch.length === ORDERS_PAGE) {
        oPage = 1;
        while (true) {
          const batch = await fetchPage(oPage);
          if (batch.length === 0) break;
          const batchItems = batch.flatMap((o: any) =>
            ((o.order_items as any[]) || []).map((it) => ({ ...it, order_id: o.id }))
          );
          await loadLookups(batch, batchItems);
          const itemsByOrder: Record<string, any[]> = {};
          batch.forEach((o: any) => { itemsByOrder[o.id] = (o.order_items as any[]) || []; });
          const formatted = formatBatch(batch, itemsByOrder);
          batchItems.forEach((it: any) => { if (it.product_name) productNamesSet.add(it.product_name); });
          accumulated = accumulated.concat(formatted);
          setOrders(applyStatusOverrides([...accumulated]));
          setAvailableProducts(Array.from(productNamesSet).sort((a, b) => a.localeCompare(b, 'ar')));
          if (batch.length < ORDERS_PAGE) break;
          oPage++;
        }
      }

    } catch (error) {
      console.error('Error fetching orders:', error);
      toast.error('حدث خطأ أثناء جلب الطلبات');
    } finally {
      setLoading(false);
    }
  };


  const filteredOrders = useMemo(() => orders.filter((order) => {
    const matchesStatus =
      filterStatus === "all" || order.status === filterStatus;
    const qRaw = appliedSearch.trim();
    const q = qRaw.toLowerCase();
    const qNorm = normalizeArabic(qRaw);
    const normalizedPhoneQuery = q.replace(/[^\d]/g, "");
    const normalizedOrderPhone = (order.customer_phone || "").replace(/[^\d]/g, "");
    const normalizedOrderPhone2 = (order.customer_phone2 || "").replace(/[^\d]/g, "");
    const nameNorm = normalizeArabic(order.customer_name || "");
    const govNorm = normalizeArabic(order.governorate || "");
    const addrNorm = normalizeArabic(order.delivery_address || "");
    const routeName = (order.route_name || "").toLowerCase();
    const routeNameNorm = normalizeArabic(order.route_name || "");
    const matchesSearch =
      !q ||
      order.order_number.toLowerCase().includes(q) ||
      (qNorm && nameNorm.includes(qNorm)) ||
      (qNorm && govNorm.includes(qNorm)) ||
      (qNorm && addrNorm.includes(qNorm)) ||
      routeName.includes(q) ||
      (qNorm && routeNameNorm.includes(qNorm)) ||
      (normalizedPhoneQuery.length > 0 && (
        normalizedOrderPhone.includes(normalizedPhoneQuery) ||
        normalizedOrderPhone2.includes(normalizedPhoneQuery)
      ));
    // Use Cairo calendar for year/month classification so orders after
    // midnight Cairo (still previous UTC day) are bucketed correctly.
    const cairoYMD = toCairoDateString(order.created_at); // YYYY-MM-DD
    const year = parseInt(cairoYMD.slice(0, 4), 10);
    const month = parseInt(cairoYMD.slice(5, 7), 10);
    // عند وجود بحث نتجاهل فلاتر السنة/الشهر لكى يظهر العميل حتى لو مسجل فى شهر آخر
    const searchActive = q.length > 0;
    const matchesYearGroup =
      searchActive ||
      yearGroup === "all" ||
      (yearGroup === "2026" && year >= 2026) ||
      (yearGroup === "pre2026" && year < 2026);
    const matchesMonth = searchActive || filterMonth === "all" || String(month) === filterMonth;
    const matchesYear = searchActive || filterYear === "all" || String(year) === filterYear;
    const matchesProduct =
      filterProduct === "all" ||
      order.items.some((it) => it.product_name === filterProduct);
    const matchesModerator =
      filterModerator === "all" ||
      (() => {
        const mod = findModeratorByName(filterModerator);
        if (!mod) return order.moderator_name === filterModerator;
        return isOrderForModerator(mod, order.moderator_name, order.moderator_name);
      })();
    const matchesGovernorate =
      filterGovernorate === "all" ||
      (order.governorate || "").trim() === filterGovernorate;
    // مصدر التنفيذ: تصنيف موحّد يجمع نوع التنفيذ والمخزن أو شركة الشحن
    const fulfillmentKey = (() => {
      const ft = order.fulfillment_type;
      const wn = order.source_warehouse_name || '';
      const isMain = wn.includes('الرئيسي');
      const isAgouza = wn.includes('العجوزة');
      if (ft === 'pickup' && isMain) return 'pickup_main';
      if (ft === 'delivery' && isMain) return 'delivery_main';
      if (ft === 'pickup' && isAgouza) return 'pickup_agouza';
      if (ft === 'delivery' && isAgouza) return 'delivery_agouza';
      if (order.shipping_company && order.shipping_company !== 'مندوب خاص') return 'shipping_company';
      return '';
    })();
    const matchesFulfillment =
      filterFulfillment === "all" || fulfillmentKey === filterFulfillment;
    const matchesRoute =
      filterRoute === "all" || order.route_id === filterRoute;
    const matchesCollectionMethod =
      filterCollectionMethod === "all" ||
      (filterCollectionMethod === "unset" ? !order.collection_method : order.collection_method === filterCollectionMethod);
    // مشرف المخزن الرئيسي (هادى) يشوف فقط طلبات المخزن الرئيسي (استلام أو توصيل)
    const matchesWarehouseScope =
      !isWarehouseSupervisor || fulfillmentKey === 'pickup_main' || fulfillmentKey === 'delivery_main';
    // إخفاء أوردرات ما قبل تاريخ بداية تشغيل المخزن الرئيسي (2026-06-18)
    // عن مسؤول/مشرف المخزن والمدير التنفيذي. المدير العام فقط يرى الأرشيف.
    const matchesOperationalStart =
      isGeneralManager ||
      (!isWarehouseSupervisor && !isExecutiveManager) ||
      new Date(order.created_at) >= new Date('2026-06-18T00:00:00+02:00');
    // Dashboard "today" card deep-link filter: /orders?today=1&channel=main|agouza|unclassified
    // Uses Cairo timezone (same classification as useTodayOrdersBreakdown) so totals match the card exactly.
    let matchesDashboardToday = true;
    let matchesDashboardChannel = true;
    if (todayParam) {
      const todayCairo = toCairoDateString(new Date().toISOString());
      matchesDashboardToday = toCairoDateString(order.created_at) === todayCairo;
    }
    if (channelParam && channelParam !== 'shipping') {
      const sc = (order.shipping_company || '').trim();
      let ch: 'main' | 'agouza' | 'unclassified';
      if (order.source_warehouse_id === MAIN_WAREHOUSE_ID) ch = 'main';
      else if (order.source_warehouse_id === AGOUZA_WAREHOUSE_ID) ch = 'agouza';
      else ch = 'unclassified';
      matchesDashboardChannel = ch === channelParam;
    }
    // Dashboard "Top products" deep-link: /orders?range=1d|3d|7d|30d&product_id=... or product_name=...
    let matchesRange3d = true;
    let matchesProductParam = true;
    const rangeDaysMap: Record<string, number> = { '1d': 1, '3d': 3, '7d': 7, '30d': 30 };
    if (rangeParam && rangeDaysMap[rangeParam]) {
      const nDays = rangeDaysMap[rangeParam];
      const todayStart = cairoTodayStartUTC(new Date());
      const rangeStart = new Date(todayStart.getTime() - (nDays - 1) * 24 * 60 * 60 * 1000);
      const rangeEnd = new Date(todayStart.getTime() + 26 * 60 * 60 * 1000);
      const created = new Date(order.created_at);
      matchesRange3d = created >= rangeStart && created < rangeEnd;
    }

    if (productIdParam || productNameParam) {
      const items = (order as any).order_items || [];
      matchesProductParam = items.some((it: any) =>
        productIdParam ? it.product_id === productIdParam : it.product_name === productNameParam,
      );
    }
    const matchesWarehouseChip =
      filterWarehouseChip === "all" ||
      (filterWarehouseChip === "main" && order.source_warehouse_id === MAIN_WAREHOUSE_ID) ||
      (filterWarehouseChip === "agouza" && order.source_warehouse_id === AGOUZA_WAREHOUSE_ID);
    const baseMatch = matchesStatus && matchesSearch && matchesYearGroup && matchesMonth && matchesYear && matchesProduct && matchesModerator && matchesGovernorate && matchesFulfillment && matchesRoute && matchesCollectionMethod && matchesWarehouseScope && matchesOperationalStart && matchesDashboardToday && matchesDashboardChannel && matchesRange3d && matchesProductParam;
    (order as any).__matchesBaseNoChip = baseMatch;
    return baseMatch && matchesWarehouseChip;
  }), [orders, filterStatus, filterWarehouseChip, appliedSearch, yearGroup, filterMonth, filterYear, filterProduct, filterModerator, filterGovernorate, filterFulfillment, filterRoute, filterCollectionMethod, isWarehouseSupervisor, isGeneralManager, isExecutiveManager, todayParam, channelParam, rangeParam, productIdParam, productNameParam]);

  // Counts per warehouse chip that honor ALL other filters (including current status).
  const warehouseChipCounts = useMemo(() => {
    let all = 0, main = 0, agouza = 0;
    for (const o of orders) {
      if (!(o as any).__matchesBaseNoChip) continue;
      all++;
      if (o.source_warehouse_id === MAIN_WAREHOUSE_ID) main++;
      else if (o.source_warehouse_id === AGOUZA_WAREHOUSE_ID) agouza++;
    }
    return { all, main, agouza };
  }, [orders, filteredOrders]);

  // إجمالي المطلوب من المندوب كاش على الأوردرات الظاهرة حالياً بعد الفلاتر.
  const totalCourierCashDue = useMemo(
    () =>
      filteredOrders.reduce(
        (sum, o) => sum + (o.collection_method === 'cash_courier' ? Number(o.courier_cash_due || o.total || 0) : 0),
        0
      ),
    [filteredOrders]
  );

  // Detect duplicate orders by customer phone — only flag orders placed on the
  // same phone within a short window (24 hours). Repeat customers ordering
  // again after that are legitimate re-orders, not duplicates.
  const duplicatePhoneOrderIds = useMemo(() => {
    const DUP_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h
    const groups = new Map<string, { id: string; created_at: string }[]>();
    for (const o of orders) {
      const norm = (o.customer_phone || "").replace(/[^\d]/g, "");
      if (norm.length < 6) continue;
      const arr = groups.get(norm) || [];
      arr.push({ id: o.id, created_at: o.created_at });
      groups.set(norm, arr);
    }
    const dups = new Set<string>();
    for (const arr of groups.values()) {
      if (arr.length < 2) continue;
      arr.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      for (let i = 1; i < arr.length; i++) {
        const prev = new Date(arr[i - 1].created_at).getTime();
        const curr = new Date(arr[i].created_at).getTime();
        if (curr - prev <= DUP_WINDOW_MS) dups.add(arr[i].id);
      }
    }
    return dups;
  }, [orders]);

  // One-time popup alert for م. آلاء حامد (مديرة المبيعات) when she opens the app
  // and there are duplicate-phone orders to review.
  const [showDupAlert, setShowDupAlert] = useState(false);
  const [dupAlertOrders, setDupAlertOrders] = useState<Order[]>([]);
  useEffect(() => {
    if (!user?.id || user.id !== SALES_MANAGER_ID) return;
    if (orders.length === 0) return;
    if (sessionStorage.getItem('dup-alert-shown') === '1') return;
    const dups = orders.filter((o) => duplicatePhoneOrderIds.has(o.id));
    if (dups.length === 0) return;
    setDupAlertOrders(dups.slice(0, 10));
    setShowDupAlert(true);
    sessionStorage.setItem('dup-alert-shown', '1');
  }, [user?.id, orders, duplicatePhoneOrderIds]);

  const availableGovernorates = Array.from(
    new Set(orders.map(o => (o.governorate || "").trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, 'ar'));

  const availableYears = Array.from(
    new Set([
      parseInt(toCairoDateString(now.toISOString()).slice(0, 4), 10),
      ...orders.map((o) => parseInt(toCairoDateString(o.created_at).slice(0, 4), 10)),
    ])
  ).sort((a, b) => b - a);

  const monthNames = [
    "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
    "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
  ];

  const [counts, setCounts] = useState({ all: 0, "2026": 0, pre2026: 0 });
  useEffect(() => {
    // Skip the expensive global count queries for sales moderators / shipping rep —
    // their RLS forces per-row evaluation across all ~12k orders and the year-tab
    // UI is not shown to them anyway, which used to time out and leave the page
    // stuck loading (so May orders never appeared for the girls).
    if (isSalesModerator || isPrivateDeliveryRep || isShippingCompany) return;
    (async () => {
      const cutoff = cairoYearStartUTC(2026).toISOString();
      const [allRes, y2026Res, preRes] = await Promise.all([
        supabase.from('orders').select('id', { count: 'exact', head: true }),
        supabase.from('orders').select('id', { count: 'exact', head: true }).gte('created_at', cutoff),
        supabase.from('orders').select('id', { count: 'exact', head: true }).lt('created_at', cutoff),
      ]);
      setCounts({
        all: allRes.count || 0,
        "2026": y2026Res.count || 0,
        pre2026: preRes.count || 0,
      });
    })();
  }, [isSalesModerator, isPrivateDeliveryRep, isShippingCompany]);

  // Load this private-delivery-rep's edit-request status (pending / approved)
  useEffect(() => {
    if (!isPrivateDeliveryRep || !user) return;
    (async () => {
      const { data } = await supabase
        .from('order_edit_requests')
        .select('order_id, status')
        .eq('requested_by', user.id);
      const approved = new Set<string>();
      const pending = new Set<string>();
      (data || []).forEach((r: any) => {
        if (r.status === 'approved') approved.add(r.order_id);
        else if (r.status === 'pending') pending.add(r.order_id);
      });
      setApprovedEditOrderIds(approved);
      setPendingEditOrderIds(pending);
    })();

    const ch = supabase
      .channel('edit-requests-rep')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_edit_requests', filter: `requested_by=eq.${user.id}` }, (payload: any) => {
        const row = payload.new || payload.old;
        if (!row) return;
        setApprovedEditOrderIds(prev => {
          const n = new Set(prev);
          if (payload.new?.status === 'approved') n.add(payload.new.order_id);
          else n.delete(row.order_id);
          return n;
        });
        setPendingEditOrderIds(prev => {
          const n = new Set(prev);
          if (payload.new?.status === 'pending') n.add(payload.new.order_id);
          else n.delete(row.order_id);
          return n;
        });
        if (payload.new?.status === 'approved') {
          toast.success('تمت الموافقة على طلب تعديلك');
        } else if (payload.new?.status === 'rejected') {
          toast.error('تم رفض طلب التعديل من مدير المبيعات');
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [isPrivateDeliveryRep, user?.id]);

  const requestEditPermission = async (order: Order) => {
    if (!user) return;
    try {
      const { error } = await supabase.from('order_edit_requests').insert({
        order_id: order.id,
        requested_by: user.id,
        status: 'pending',
      });
      if (error) throw error;
      await supabase.from('notifications').insert({
        title: '🔑 طلب إذن تعديل طلب من كيمو',
        description: `يطلب المندوب الخاص الإذن بتعديل الطلب ${order.order_number} (العميل: ${order.customer_name}). الرجاء الموافقة أو الرفض.`,
        type: 'edit_request',
        order_id: order.id,
        target_user_id: SALES_MANAGER_ID,
      });
      setPendingEditOrderIds(prev => new Set(prev).add(order.id));
      toast.success('تم إرسال طلب التعديل لمدير المبيعات');
    } catch (e: any) {
      console.error(e);
      toast.error('تعذّر إرسال طلب التعديل');
    }
  };

  // Whether the current user may edit this order's items right now
  const canEditThisOrder = (order: Order): boolean => {
    if (order.status === 'delivered' || order.status === 'cancelled') return false;
    if (isPrivateDeliveryRep) return approvedEditOrderIds.has(order.id);
    if (!canEditOrderItems) return false;
    if (isSalesModerator && order.collection_status === 'collected') return false;
    // Sales moderators can only edit orders they created themselves.
    // (e.g. Manal can review Nora & Aya's orders but cannot modify them.)
    if (isSalesModerator && user?.id && order.created_by && order.created_by !== user.id) return false;
    return true;
  };

  // نافذة اختيار طريقة التحصيل قبل تأكيد التسليم (لا تمس منطق التسليم/المخزون/المالية).
  const [pendingDeliveryOrderId, setPendingDeliveryOrderId] = useState<string | null>(null);
  const [pendingDeliveryMethod, setPendingDeliveryMethod] = useState<CollectionMethod>('cash_courier');

  // تحديث طريقة التحصيل + إعادة حساب المبلغ المطلوب من المندوب.
  // لا يمس أي منطق للمخزون أو التسليم أو الحركات المالية.
  // نافذة توزيع "التحصيل المختلط" — تُفتح عند اختيار طريقة mixed_payment.
  const [mixedDlgOrderId, setMixedDlgOrderId] = useState<string | null>(null);
  const [mixedDlgOrderSnap, setMixedDlgOrderSnap] = useState<Order | null>(null);
  const [mixedCash, setMixedCash] = useState<string>('');
  const [mixedVod, setMixedVod] = useState<string>('');
  const [mixedInsta, setMixedInsta] = useState<string>('');
  const [mixedBank, setMixedBank] = useState<string>('');
  const [mixedOther, setMixedOther] = useState<string>('');
  const [mixedFree, setMixedFree] = useState<string>('');
  const [mixedDeposit, setMixedDeposit] = useState<string>('');
  const [mixedRef, setMixedRef] = useState<string>('');
  const [mixedNote, setMixedNote] = useState<string>('');
  // إذا فُتحت النافذة أثناء تدفق تأكيد التسليم، نتابع التحويل إلى delivered بعد الحفظ.
  const [deliverAfterMixedSave, setDeliverAfterMixedSave] = useState<boolean>(false);

  const openMixedDialog = (orderId: string) => {
    const t = orders.find((o) => o.id === orderId);
    if (!t) return;
    setMixedCash(String(t.courier_cash_due ?? 0));
    setMixedVod(String(t.vodafone_cash_amount ?? 0));
    setMixedInsta(String(t.instapay_amount ?? 0));
    setMixedBank(String(t.bank_transfer_amount ?? 0));
    setMixedOther(String(t.other_amount ?? 0));
    setMixedFree(String(t.free_amount ?? 0));
    setMixedDeposit(String((t as any).deposit_amount ?? 0));
    setMixedRef(String(t.transfer_reference ?? ''));
    setMixedNote('');
    setMixedDlgOrderSnap(t);
    setMixedDlgOrderId(orderId);
  };



  // Auto-open mixed collection dialog when navigated with ?mixed=<orderId>
  useEffect(() => {
    if (!mixedParam) return;
    const clearParam = () => {
      const next = new URLSearchParams(searchParams);
      next.delete('mixed');
      setSearchParams(next, { replace: true });
    };
    const found = orders.find((o) => o.id === mixedParam);
    if (found) {
      openMixedDialog(mixedParam);
      clearParam();
      return;
    }
    // الطلب قد يكون خارج نطاق الشهر الحالي المُحمَّل — نجلبه مباشرةً بالمعرّف.
    if (loading) return;
    (async () => {
      const { data } = await (supabase as any)
        .from('orders')
        .select('*')
        .eq('id', mixedParam)
        .maybeSingle();
      if (data) {
        setOrders((prev) => (prev.some((o) => o.id === data.id) ? prev : [{ ...data, items: [] } as any, ...prev]));
        // openMixedDialog سيُستدعى في الدورة التالية بعد دخول الطلب في القائمة.
      } else {
        clearParam();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mixedParam, orders.length, loading]);



  const saveMixedBreakdown = async () => {
    const id = mixedDlgOrderId;
    if (!id) return;
    const target = orders.find((o) => o.id === id) ?? mixedDlgOrderSnap;
    if (!target) return;
    const cash = Number(mixedCash) || 0;
    const vod = Number(mixedVod) || 0;
    const insta = Number(mixedInsta) || 0;
    const bank = Number(mixedBank) || 0;
    const other = Number(mixedOther) || 0;
    const free = Number(mixedFree) || 0;
    const deposit = Number(mixedDeposit) || 0;
    const sum = cash + vod + insta + bank + other + free + deposit;
    const totalVal = Number(target.total || 0);
    if (Math.abs(sum - totalVal) > 0.01) {
      toast.error(`مجموع مبالغ التحصيل (${sum.toFixed(2)}) لا يساوي قيمة الأوردر (${totalVal.toFixed(2)}).`);
      return;
    }
    if ([cash, vod, insta, bank, other, free, deposit].some((v) => v < 0)) {
      toast.error('لا يمكن إدخال مبالغ سالبة.');
      return;
    }
    const nowIso = new Date().toISOString();
    try {
      const { error } = await supabase.from('orders').update({
        collection_method: 'mixed_payment',
        courier_cash_due: cash,
        vodafone_cash_amount: vod,
        instapay_amount: insta,
        bank_transfer_amount: bank,
        other_amount: other,
        free_amount: free,
        deposit_amount: deposit,
        transfer_reference: mixedRef || null,
        collection_note: mixedNote || null,
        collection_updated_at: nowIso,
        collection_updated_by: user?.id ?? null,
      } as any).eq('id', id);
      if (error) throw error;
      // Audit — سجل تاريخي منفصل لكل تعديل (INSERT وليس UPDATE).
      await supabase.from('order_payment_breakdown_audit' as any).insert({
        order_id: id,
        old_collection_method: target.collection_method ?? null,
        new_collection_method: 'mixed_payment',
        old_cash_amount: target.courier_cash_due ?? 0,
        new_cash_amount: cash,
        old_vodafone_cash_amount: target.vodafone_cash_amount ?? 0,
        new_vodafone_cash_amount: vod,
        old_instapay_amount: target.instapay_amount ?? 0,
        new_instapay_amount: insta,
        old_bank_transfer_amount: target.bank_transfer_amount ?? 0,
        new_bank_transfer_amount: bank,
        old_other_amount: target.other_amount ?? 0,
        new_other_amount: other,
        old_free_amount: target.free_amount ?? 0,
        new_free_amount: free,
        old_deposit_amount: (target as any).deposit_amount ?? 0,
        new_deposit_amount: deposit,
        transfer_reference: mixedRef || null,
        note: mixedNote || null,
        changed_by: user?.id ?? null,
      } as any);
      setOrders((prev) => prev.map((o) => o.id === id ? { ...o,
        collection_method: 'mixed_payment',
        courier_cash_due: cash,
        vodafone_cash_amount: vod,
        instapay_amount: insta,
        bank_transfer_amount: bank,
        other_amount: other,
        free_amount: free,
        deposit_amount: deposit,
        transfer_reference: mixedRef || null,
        collection_updated_at: nowIso,
      } as any : o));
      setMixedDlgOrderId(null);
      setMixedDlgOrderSnap(null);

      toast.success('تم حفظ توزيع التحصيل المختلط ✅');
      // إن كانت النافذة فُتحت أثناء تدفق التسليم، تابع الآن.
      if (deliverAfterMixedSave) {
        setDeliverAfterMixedSave(false);
        await handleStatusChange(id, 'delivered');
      }
    } catch (e: any) {
      console.error('saveMixedBreakdown failed', e);
      toast.error(e?.message || 'تعذّر حفظ التوزيع');
    }
  };

  // تحديث طريقة التحصيل + إعادة حساب المبلغ المطلوب من المندوب.
  // لا يمس أي منطق للمخزون أو التسليم أو الحركات المالية.
  const updateCollectionMethod = async (orderId: string, method: CollectionMethod) => {
    const target = orders.find((o) => o.id === orderId);
    if (!target) return;
    // For mixed payment, open the breakdown dialog instead of saving directly.
    if (method === 'mixed_payment') { openMixedDialog(orderId); return; }
    const totalVal = Number(target.total || 0);
    const due = method === 'cash_courier' ? totalVal : 0;
    const vod = method === 'vodafone_cash' ? totalVal : 0;
    const insta = method === 'instapay' ? totalVal : 0;
    const bank = method === 'bank_transfer' ? totalVal : 0;
    const other = method === 'other' ? totalVal : 0;
    const free = method === 'none' ? totalVal : 0;
    const nowIso = new Date().toISOString();
    // تحديث تفاؤلي
    setOrders((prev) =>
      prev.map((o) =>
        o.id === orderId
          ? { ...o, collection_method: method, courier_cash_due: due,
              vodafone_cash_amount: vod, instapay_amount: insta,
              bank_transfer_amount: bank, other_amount: other, free_amount: free,
              collection_updated_at: nowIso }
          : o
      )
    );
    try {
      const { error } = await supabase
        .from('orders')
        .update({
          collection_method: method,
          courier_cash_due: due,
          vodafone_cash_amount: vod,
          instapay_amount: insta,
          bank_transfer_amount: bank,
          other_amount: other,
          free_amount: free,
          collection_updated_at: nowIso,
          collection_updated_by: user?.id ?? null,
        } as any)
        .eq('id', orderId);
      if (error) throw error;
      toast.success(`تم حفظ طريقة التحصيل: ${collectionMethodMeta[method].label}`);
    } catch (e) {
      console.error('updateCollectionMethod failed', e);
      toast.error('تعذّر حفظ طريقة التحصيل');
    }
  };



  // يحدّث "علامة التحديث" لكل أوردر بشكل مستقل (عرض فقط، لا يمس المخزون/المالية).
  // يُستدعى فقط بعد نجاح العملية الأصلية.
  const markOrderUpdate = async (orderId: string, marker: UpdateStatusMarker) => {
    const nowIso = new Date().toISOString();
    // تحديث تفاؤلي فوري في الواجهة.
    setOrders((prev) =>
      prev.map((o) =>
        o.id === orderId
          ? { ...o, update_status_marker: marker, update_status_updated_at: nowIso }
          : o
      )
    );
    try {
      await supabase
        .from('orders')
        .update({
          update_status_marker: marker,
          update_status_updated_at: nowIso,
          update_status_updated_by: user?.id ?? null,
        } as any)
        .eq('id', orderId);
    } catch (e) {
      // best-effort — لا نفشل العملية الأصلية بسبب علامة العرض.
      console.warn('markOrderUpdate failed', e);
    }
  };


  const handleStatusChange = async (orderId: string, newStatus: OrderStatus) => {
    try {
      // M4-B: detect Agouza-only orders BEFORE updating to drive reservation lifecycle.
      // Non-Agouza orders keep the exact previous behaviour.
      const targetOrder = orders.find((o) => o.id === orderId);
      const isAgouza = targetOrder?.source_warehouse_id === AGOUZA_WAREHOUSE_ID;
      const prevStatus = targetOrder?.status as OrderStatus | undefined;

      // إلزامية اختيار طريقة التحصيل قبل تأكيد التسليم — فقط لأدوار التحصيل.
      // الأدوار التسويقية/الموديريتور تحدّث الحالة فقط بدون فتح شاشة التحصيل،
      // ولا تُنشئ أو تعدّل أي بيانات تحصيل (breakdown / cash_due).
      // منع الأدوار غير المصرح لها من تحديث الحالة إلى "تم التسليم للعميل".
      // (مسؤول المخزن/المحاسبة/الخزنة) — دورهم بعد التسليم فقط: ضبط التحصيل.
      if (newStatus === 'delivered' && !canMarkDelivered) {
        toast.error('تحديث حالة التسليم من صلاحيات التسويق فقط. يمكنك ضبط التحصيل بعد التسليم.');
        return;
      }

      // إلزامية اختيار طريقة التحصيل قبل تأكيد التسليم — فقط لأدوار التحصيل.
      // الأدوار التسويقية/الموديريتور تحدّث الحالة فقط بدون فتح شاشة التحصيل،
      // ولا تُنشئ أو تعدّل أي بيانات تحصيل (breakdown / cash_due).
      if (newStatus === 'delivered' && !targetOrder?.collection_method && canSetCollectionMethod) {
        setPendingDeliveryMethod('cash_courier');
        setPendingDeliveryOrderId(orderId);
        return;
      }


      // M4-B: Agouza orders without an active/committed reservation (shortage).
      // Allow override with explicit confirmation; skip commit since there's
      // no reservation to commit. Stock movement is bypassed in that case.
      let agouzaShortageOverride = false;
      if (isAgouza && newStatus === 'delivered') {
        const resv = agouzaResvMap[orderId] ?? 'none';
        if (resv !== 'active' && resv !== 'committed') {
          const ok = window.confirm(
            'تنبيه: هذا الأوردر لا يوجد له حجز نشط في مخزن العجوزة (عجز مخزون).\n\n' +
            'هل تريد تأكيد التسليم رغم العجز؟ (لن يتم خصم المخزون تلقائيًا، ويجب تسوية الفرق يدويًا لاحقًا)'
          );
          if (!ok) return;
          agouzaShortageOverride = true;
        }
      }

      const { error } = await supabase
        .from('orders')
        .update({ status: newStatus })
        .eq('id', orderId);

      if (error) throw error;


      // M4-B: Agouza reservation lifecycle — runs ONLY for Agouza orders.
      // commit = real stock deduction (delivered). release = free hold (cancelled).
      // Skip commit when overriding a shortage (no reservation exists).
      if (isAgouza) {
        if (newStatus === 'delivered' && prevStatus !== 'delivered') {
          if (!agouzaShortageOverride) {
            await commitAgouzaForOrder(orderId);
            setAgouzaResvMap((m) => ({ ...m, [orderId]: 'committed' }));
          } else {
            // Log the override for audit; non-blocking.
            try {
              await (supabase as any).from('agouza_override_audit_log').insert({
                order_id: orderId,
                action: 'deliver_without_reservation',
                reason: 'shortage_override_by_user',
              });
            } catch (e) { /* audit best-effort */ }
            toast.warning('تم تأكيد التسليم رغم العجز — يلزم تسوية مخزنية يدوية.');
          }
        } else if (newStatus === 'cancelled' && prevStatus !== 'cancelled') {
          await releaseAgouzaForOrder(orderId, 'order_cancelled');
          setAgouzaResvMap((m) => ({ ...m, [orderId]: 'released' }));
          toast.success('تم إلغاء الأوردر وفك الحجز من مخزن العجوزة.');
        }
      }


      setOrders((prev) =>
        prev.map((order) => {
          if (order.id !== orderId) return order;
          let delivered_at = order.delivered_at;
          if (newStatus === 'delivered' && !delivered_at) delivered_at = new Date().toISOString();
          else if (newStatus !== 'delivered' && order.status === 'delivered') delivered_at = null;
          return { ...order, status: newStatus, delivered_at };
        })
      );
      // Persist the change so any background pagination batch that arrives
      // afterwards does not overwrite it with the stale value from the server snapshot.
      const deliveredAtForOverride =
        newStatus === 'delivered' ? new Date().toISOString() : null;
      statusOverridesRef.current.set(orderId, { status: newStatus, delivered_at: deliveredAtForOverride });
      toast.success(`تم تحديث حالة الطلب إلى "${statusLabels[newStatus]}"`);
      // علامة "حالة التحديث": delivered/cancelled يقابلان أزرار التسليم/الإلغاء.
      if (newStatus === 'delivered') void markOrderUpdate(orderId, 'delivered');
      else if (newStatus === 'cancelled') void markOrderUpdate(orderId, 'cancelled');
    } catch (error) {
      console.error('Error updating order status:', error);
      toast.error('حدث خطأ أثناء تحديث الحالة');
    }
  };


  const applyCollectionUpdate = async (
    orderId: string,
    value: string,
    mismatch?: { orderNumber: string; deliveredTotal: number; currentTotal: number }
  ) => {
    const { error } = await supabase
      .from('orders')
      .update({ collection_status: value } as any)
      .eq('id', orderId);
    if (error) throw error;
    setOrders(orders.map(o => o.id === orderId ? { ...o, collection_status: value } : o));

    if (mismatch) {
      const diff = mismatch.currentTotal - mismatch.deliveredTotal;
      const diffLabel = `${diff > 0 ? '+' : ''}${diff.toFixed(2)}`;
      const title = '⚠️ اختلاف في قيمة التحصيل — تنبيه للمحاسب';
      const description = `الطلب ${mismatch.orderNumber}: قيمة التسليم ${mismatch.deliveredTotal.toFixed(2)} ر.س — قيمة التحصيل ${mismatch.currentTotal.toFixed(2)} ر.س — الفرق ${diffLabel} ر.س`;
      toast.warning(title, { description, duration: 10000 });
      await supabase.from('notifications').insert({
        title,
        description,
        type: 'collection_mismatch',
        order_id: orderId,
      });
    } else {
      toast.success(value === 'collected' ? 'تم تحديث حالة التحصيل: تم التحصيل' : 'تم تحديث حالة التحصيل: لم يتم التحصيل');
    }
    // زر "كاش" = تم التحصيل نقداً → علامة cash.
    if (value === 'collected') void markOrderUpdate(orderId, 'cash');
  };

  const handleCollectionChange = async (orderId: string, value: string) => {
    try {
      // عند التحويل إلى "تم التحصيل" قارن قيمة التسليم بقيمة التحصيل الحالية أولاً
      if (value === 'collected') {
        const { data: orderRow } = await supabase
          .from('orders')
          .select('order_number, total, total_at_delivery')
          .eq('id', orderId)
          .maybeSingle<any>();

        const currentTotal = Number(orderRow?.total ?? 0);
        const deliveredTotal = orderRow?.total_at_delivery != null ? Number(orderRow.total_at_delivery) : null;

        if (deliveredTotal != null && Math.abs(currentTotal - deliveredTotal) > 0.001) {
          setCollectionMismatch({
            orderId,
            orderNumber: orderRow?.order_number ?? '',
            deliveredTotal,
            currentTotal,
          });
          return; // انتظر تأكيد المستخدم من داخل التنبيه
        }
      }

      await applyCollectionUpdate(orderId, value);
    } catch (e) {
      console.error(e);
      toast.error('تعذّر تحديث حالة التحصيل');
    }
  };

  const handleDeleteOrder = async (orderId: string) => {
    try {
      // M4-B: free any Agouza hold before delete (Agouza-only; no-op otherwise).
      const target = orders.find((o) => o.id === orderId);
      if (target?.source_warehouse_id === AGOUZA_WAREHOUSE_ID) {
        await releaseAgouzaForOrder(orderId, 'order_deleted');
      }
      const { error: itemsErr } = await supabase.from('order_items').delete().eq('order_id', orderId);
      if (itemsErr) throw itemsErr;
      const { error } = await supabase.from('orders').delete().eq('id', orderId);
      if (error) throw error;
      setOrders(orders.filter(o => o.id !== orderId));
      toast.success('تم حذف الطلب بنجاح');
    } catch (e) {
      console.error(e);
      toast.error('تعذّر حذف الطلب');
    }
  };


  const getStatusIcon = (status: OrderStatus) => {
    switch (status) {
      case "pending":
        return <ShoppingCart className="w-4 h-4" />;
      case "processing":
        return <ShoppingCart className="w-4 h-4" />;
      case "shipped":
        return <Truck className="w-4 h-4" />;
      case "delivered":
        return <CheckCircle className="w-4 h-4" />;
      case "cancelled":
        return <XCircle className="w-4 h-4" />;
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <DiscrepancyBanner />
      <OrdersAnalytics orders={orders} />

      <Tabs value={yearGroup} onValueChange={(v) => setYearGroup(v as YearGroup)} className="mb-4">
        <TabsList className="grid w-full max-w-xl grid-cols-3">
          <TabsTrigger value="all">الكل ({counts.all.toLocaleString()})</TabsTrigger>
          <TabsTrigger value="2026">مبيعات 2026 ({counts["2026"].toLocaleString()})</TabsTrigger>
          <TabsTrigger value="pre2026">2025 وما قبله ({counts.pre2026.toLocaleString()})</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card className="glass-card">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 flex-wrap">
            <ShoppingCart className="w-5 h-5 text-primary" />
            قائمة الطلبات ({filteredOrders.length})
            {restrictToCurrentMonth && (
              <Badge variant="outline" className="text-xs font-normal">
                عرض طلبات {monthNames[now.getMonth()]} فقط — اكتب فى البحث لرؤية كل الشهور
              </Badge>
            )}
            {(todayParam || channelParam || rangeParam || productIdParam || productNameParam) && (
              <Badge variant="secondary" className="text-xs font-normal gap-1 bg-primary/10 text-primary border-primary/30">
                فلتر نشط:
                {todayParam ? ' طلبات اليوم' : ''}
                {rangeParam === '1d' ? ' آخر يوم' : rangeParam === '3d' ? ' آخر 3 أيام' : rangeParam === '7d' ? ' آخر 7 أيام' : rangeParam === '30d' ? ' آخر 30 يوم' : ''}
                {channelParam === 'main' ? ' — المخزن الرئيسي' : channelParam === 'agouza' ? ' — مخزن العجوزة' : channelParam === 'unclassified' ? ' — غير مصنف' : ''}
                {(productIdParam || productNameParam) ? ` — المنتج: ${productNameParam || (orders.find(o => (o as any).order_items?.some((it: any) => it.product_id === productIdParam)) as any)?.order_items?.find((it: any) => it.product_id === productIdParam)?.product_name || productIdParam}` : ''}
                <button
                  type="button"
                  onClick={clearDashboardFilter}
                  className="mr-1 rounded-full hover:bg-primary/20 px-1"
                  aria-label="إزالة الفلتر"
                >
                  ✕
                </button>
              </Badge>
            )}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1">
              <Input
                placeholder="ابحث برقم الطلب / رقم الموبايل / اسم العميل / المحافظة"
                value={draftSearch}
                onChange={(e) => setDraftSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); triggerSearchNow(); } }}
                className="w-72 input-modern"
              />
              <Button size="sm" variant="outline" onClick={triggerSearchNow} title="بحث">
                <Search className="w-4 h-4" />
              </Button>
              {draftSearch && (
                <Button size="sm" variant="ghost" onClick={() => { setDraftSearch(""); setAppliedSearch(""); }} title="مسح">
                  <XCircle className="w-4 h-4" />
                </Button>
              )}
            </div>
            <Select value={filterMonth} onValueChange={setFilterMonth}>
              <SelectTrigger className="w-36 input-modern">
                <SelectValue placeholder="الشهر" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الشهور</SelectItem>
                {monthNames.map((name, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterYear} onValueChange={setFilterYear}>
              <SelectTrigger className="w-32 input-modern">
                <SelectValue placeholder="السنة" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل السنوات</SelectItem>
                {availableYears.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-44 input-modern">
                <SelectValue placeholder="فلترة حسب الحالة" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">جميع الحالات</SelectItem>
                {Object.entries(statusLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterProduct} onValueChange={setFilterProduct}>
              <SelectTrigger className="w-48 input-modern">
                <SelectValue placeholder="فلترة حسب المنتج" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">جميع المنتجات</SelectItem>
                {availableProducts.map((name) => (
                  <SelectItem key={name} value={name}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterGovernorate} onValueChange={setFilterGovernorate}>
              <SelectTrigger className="w-44 input-modern">
                <SelectValue placeholder="فلترة حسب المحافظة" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">جميع المحافظات</SelectItem>
                {availableGovernorates.map((g) => (
                  <SelectItem key={g} value={g}>{g}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterRoute} onValueChange={setFilterRoute}>
              <SelectTrigger className="w-48 input-modern">
                <SelectValue placeholder="فلترة حسب خط السير" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">جميع خطوط السير</SelectItem>
                {availableRoutes.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: r.color }} />
                      {r.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterFulfillment} onValueChange={setFilterFulfillment}>
              <SelectTrigger className="w-56 input-modern">
                <SelectValue placeholder="فلترة حسب مصدر التنفيذ" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل مصادر التنفيذ</SelectItem>
                {fulfillmentOptions.map((f) => (
                  <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterCollectionMethod} onValueChange={setFilterCollectionMethod}>
              <SelectTrigger className="w-52 input-modern">
                <SelectValue placeholder="فلترة حسب طريقة التحصيل" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل طرق التحصيل</SelectItem>
                <SelectItem value="unset">لم يحدد التحصيل</SelectItem>
                {(Object.keys(collectionMethodMeta) as CollectionMethod[]).map((k) => (
                  <SelectItem key={k} value={k}>{collectionMethodMeta[k].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm">
              <span className="text-emerald-800 font-semibold">إجمالي المطلوب من المندوب كاش:</span>
              <span className="text-emerald-900 font-bold">{totalCourierCashDue.toLocaleString()} ج</span>
            </div>
            {!isPrivateDeliveryRep && (
              <Select value={filterModerator} onValueChange={setFilterModerator}>
                <SelectTrigger className="w-40 input-modern">
                  <SelectValue placeholder="فلترة حسب المسوقة" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">جميع المسوقات</SelectItem>
                  <SelectItem value="أية">آية</SelectItem>
                  <SelectItem value="نورا">نورا</SelectItem>
                  
                  <SelectItem value="منال">منال</SelectItem>
                </SelectContent>
              </Select>
            )}
            {canExportExcel && (
              <Button variant="outline" className="gap-2" onClick={() => exportOrdersToXLSX(filteredOrders)}>
                <FileDown className="w-4 h-4" /> Excel
              </Button>
            )}
            <Button variant="outline" className="gap-2" onClick={() => exportOrdersToCSV(filteredOrders)}>
              <FileDown className="w-4 h-4" /> CSV
            </Button>
            <Button variant="outline" className="gap-2" onClick={() => exportOrdersToPDF(filteredOrders)}>
              <FileText className="w-4 h-4" /> PDF
            </Button>
            <Button
              onClick={() => setQuickDeliveryOpen(true)}
              className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white shadow-md"
            >
              <Zap className="w-4 h-4" />
              تسليم سريع
            </Button>
            {!isSocialMediaManager && (
              <Button asChild className="gap-2">
                <Link to="/orders/new">
                  <Plus className="w-4 h-4" />
                  طلب جديد
                </Link>
              </Button>
            )}

          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2 mb-2">
            <Button
              variant={filterWarehouseChip === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterWarehouseChip("all")}
            >
              كل المخازن
              <span className="mr-2 inline-flex items-center justify-center rounded-full bg-background/20 px-2 text-xs font-semibold min-w-[1.5rem]">
                {warehouseChipCounts.all}
              </span>
            </Button>
            <Button
              variant={filterWarehouseChip === "main" ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterWarehouseChip("main")}
              className={filterWarehouseChip === "main" ? "bg-primary" : ""}
            >
              المخزن الرئيسي
              <span className="mr-2 inline-flex items-center justify-center rounded-full bg-background/20 px-2 text-xs font-semibold min-w-[1.5rem]">
                {warehouseChipCounts.main}
              </span>
            </Button>
            <Button
              variant={filterWarehouseChip === "agouza" ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterWarehouseChip("agouza")}
              className={filterWarehouseChip === "agouza" ? "bg-primary" : ""}
            >
              مخزن العجوزة
              <span className="mr-2 inline-flex items-center justify-center rounded-full bg-background/20 px-2 text-xs font-semibold min-w-[1.5rem]">
                {warehouseChipCounts.agouza}
              </span>
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 mb-4">
            <Button
              variant={filterStatus === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterStatus("all")}
            >
              الكل
            </Button>
            <Button
              variant={filterStatus === "pending" ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterStatus("pending")}
            >
              قيد الانتظار
            </Button>
            <Button
              variant={filterStatus === "delivered" ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterStatus("delivered")}
            >
              تم التوصيل
            </Button>
            <Button
              variant={filterStatus === "cancelled" ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterStatus("cancelled")}
            >
              مرتجع
            </Button>
          </div>

          {/* Card view (unified for all screens) */}
          <div className="space-y-3">

            {filteredOrders.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground border border-dashed rounded-lg">
                <div className="text-4xl mb-2">📦</div>
                <div className="font-medium text-foreground mb-1">لا توجد طلبات مطابقة</div>
                <div className="text-sm">
                  {(() => {
                    const wh = filterWarehouseChip === "main" ? "المخزن الرئيسي"
                      : filterWarehouseChip === "agouza" ? "مخزن العجوزة"
                      : "كل المخازن";
                    const st = filterStatus === "pending" ? "قيد الانتظار"
                      : filterStatus === "delivered" ? "تم التوصيل"
                      : filterStatus === "cancelled" ? "المرتجعة"
                      : "بكل الحالات";
                    return `لا يوجد أوردرات في ${wh} ${st} حالياً.`;
                  })()}
                </div>
                {(filterWarehouseChip !== "all" || filterStatus !== "all") && (
                  <div className="mt-3 flex gap-2 justify-center">
                    {filterWarehouseChip !== "all" && (
                      <Button size="sm" variant="outline" onClick={() => setFilterWarehouseChip("all")}>
                        عرض كل المخازن
                      </Button>
                    )}
                    {filterStatus !== "all" && (
                      <Button size="sm" variant="outline" onClick={() => setFilterStatus("all")}>
                        عرض كل الحالات
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              filteredOrders.map((order) => {
                const itemLines = order.items.map((it) => {
                  const cleaned = it.product_name
                    .replace(/\s*\(عرض\)\s*/g, ' ')
                    .replace(/(^|\s)نعام(?=\s|$)/g, '$1')
                    .replace(/\s+/g, ' ').trim();
                  return `${formatItemQty(it.quantity, it.unit)} ${cleaned || it.product_name}`;
                });
                const isExpanded = expandedItems.has(order.id);
                const hasMore = itemLines.length > 1;
                const shownLines = isExpanded || !hasMore ? itemLines : [itemLines[0]];
                const cardPalette = [
                  "bg-blue-50 dark:bg-blue-950/30 border-r-4 border-r-blue-500",
                  "bg-emerald-50 dark:bg-emerald-950/30 border-r-4 border-r-emerald-500",
                  "bg-amber-50 dark:bg-amber-950/30 border-r-4 border-r-amber-500",
                  "bg-purple-50 dark:bg-purple-950/30 border-r-4 border-r-purple-500",
                  "bg-pink-50 dark:bg-pink-950/30 border-r-4 border-r-pink-500",
                  "bg-cyan-50 dark:bg-cyan-950/30 border-r-4 border-r-cyan-500",
                  "bg-orange-50 dark:bg-orange-950/30 border-r-4 border-r-orange-500",
                  "bg-teal-50 dark:bg-teal-950/30 border-r-4 border-r-teal-500",
                ];
                let hash = 0;
                for (let i = 0; i < order.id.length; i++) hash = (hash * 31 + order.id.charCodeAt(i)) >>> 0;
                const cardColor = cardPalette[hash % cardPalette.length];
                const isDuplicatePhone = duplicatePhoneOrderIds.has(order.id);
                return (
                  <div
                    key={order.id}
                    className={
                      isDuplicatePhone
                        ? "rounded-lg border-2 border-red-500 bg-red-50 dark:bg-red-950/40 ring-2 ring-red-400/60 p-2.5 sm:p-3 space-y-2 shadow-md"
                        : `rounded-lg border p-2.5 sm:p-3 space-y-2 ${cardColor}`
                    }
                  >
                    {/* السطر 1: رقم الأوردر + الحالة + الإجمالي */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Checkbox
                          checked={reviewedIds.has(order.id)}
                          onCheckedChange={(v) => toggleReviewed(order.id, v === true)}
                          aria-label="تمت المراجعة"
                        />
                        <button
                          type="button"
                          onClick={() => openMixedDialog(order.id)}
                          className="font-mono font-semibold text-[11px] sm:text-xs text-primary hover:underline truncate"
                          title="ضبط التحصيل"
                        >
                          {order.order_number}
                        </button>
                        {order.shipping_bill_no && (
                          <span
                            className="font-mono text-[10px] sm:text-[11px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 border border-orange-300 truncate"
                            title="رقم بوليصة مخزن العجوزة"
                          >
                            {order.shipping_bill_no}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {isDuplicatePhone && (
                          <Badge className="bg-red-600 hover:bg-red-600 text-white text-[10px] gap-1">
                            <AlertCircle className="w-3 h-3" /> مكرر
                          </Badge>
                        )}
                        <Badge className={`${statusColors[order.status]} flex items-center gap-1 text-[11px] py-0.5`}>
                          {getStatusIcon(order.status)}
                          {statusLabels[order.status]}
                        </Badge>
                        <span className="font-bold text-primary text-sm sm:text-base whitespace-nowrap">
                          {order.total.toLocaleString()} ج.م
                        </span>
                      </div>
                    </div>

                    {/* السطر 2: اسم العميل + الهاتف + المسؤولة */}
                    <div className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 ${isDuplicatePhone ? "bg-red-100 dark:bg-red-900/40 border border-red-300" : "bg-primary/10 border border-primary/20"}`}>
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => openMixedDialog(order.id)}
                          className={`block font-bold text-sm sm:text-base truncate hover:underline text-right w-full ${isDuplicatePhone ? "text-red-700 dark:text-red-200" : "text-primary"}`}
                          title="ضبط التحصيل"
                        >
                          {order.customer_name}
                        </button>
                        {order.customer_phone && (
                          <div className="text-right space-y-0.5">
                            <PhoneWithCopy phone={order.customer_phone} className="text-[11px] text-muted-foreground" />
                            {order.customer_phone2 && order.customer_phone2 !== order.customer_phone && (
                              <PhoneWithCopy phone={order.customer_phone2} className="text-[11px] text-muted-foreground" />
                            )}
                          </div>
                        )}
                        {canManageOrders && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setEditCustomerOrder(order); }}
                            className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary"
                            title="تعديل بيانات العميل"
                          >
                            <Pencil className="w-3 h-3" /> تعديل بيانات العميل
                          </button>
                        )}
                      </div>
                      {canReassignOwner ? (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setReassignOrder(order); }}
                          title="اضغط لتغيير المسؤولة عن الأوردر"
                          className="shrink-0"
                        >
                          <Badge variant="secondary" className="text-[10px] cursor-pointer bg-orange-500 hover:bg-orange-600 text-white border-orange-600">
                            {order.moderator_name}
                          </Badge>
                        </button>
                      ) : (
                        <Badge variant="secondary" className="text-[10px] shrink-0">{order.moderator_name}</Badge>
                      )}
                    </div>

                    {/* السطر 3: المنتجات (ملخّص) */}
                    <div className="text-xs sm:text-sm text-foreground/90 break-words">
                      {itemLines.length === 0 ? '-' : (
                        <ul className="space-y-0.5 list-disc pr-4">
                          {shownLines.map((l, i) => <li key={i}>{l}</li>)}
                        </ul>
                      )}
                      {hasMore && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-1.5 mt-0.5 text-[11px] gap-1 text-primary hover:text-primary"
                          onClick={() => toggleExpanded(order.id)}
                        >
                          {isExpanded ? <><ChevronUp className="w-3 h-3" /> إخفاء</> : <><ChevronDown className="w-3 h-3" /> عرض كل المنتجات ({itemLines.length})</>}
                        </Button>
                      )}
                    </div>

                    {(() => {
                      const offers = Array.from(new Set(order.items.map((it) => it.offer_name).filter(Boolean) as string[]));
                      return offers.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {offers.map((name) => (
                            <Badge key={name} className="bg-orange-500 hover:bg-orange-500 text-white text-[10px] py-0">{name}</Badge>
                          ))}
                        </div>
                      ) : null;
                    })()}

                    {order.notes && (
                      <div className="text-[11px] bg-muted/50 border rounded px-2 py-1 break-words">
                        <span className="font-semibold">ملاحظات: </span>{order.notes}
                      </div>
                    )}

                    {/* السطر 4: التوصيل + التاريخ */}
                    <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground flex-wrap">
                      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                        {order.governorate && (
                          <span className="inline-flex items-center gap-0.5">
                            <MapPin className="w-3 h-3" /> {order.governorate}
                          </span>
                        )}
                        {order.source && (
                          <Badge
                            variant="secondary"
                            className="text-[10px] py-0 font-normal bg-primary/10 text-primary border-primary/20"
                            title="مصدر العميل"
                          >
                            📞 {order.source}
                          </Badge>
                        )}
                        {(order.source_warehouse_name || order.shipping_company) && (() => {
                          const wn = order.source_warehouse_name || '';
                          const ch = wn.includes('الرئيسي') ? 'main' : wn.includes('العجوزة') ? 'agouza' : null;
                          const label = `${order.fulfillment_type === 'pickup' ? 'استلام: ' : order.fulfillment_type === 'delivery' ? 'توصيل: ' : ''}${order.source_warehouse_name || order.shipping_company}`;
                          if (ch) {
                            return (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const next = new URLSearchParams(searchParams);
                                  if (channelParam === ch) next.delete('channel'); else next.set('channel', ch);
                                  setSearchParams(next);
                                }}
                                title={channelParam === ch ? 'إزالة فلتر المخزن' : 'عرض أوردرات هذا المخزن فقط'}
                              >
                                <Badge
                                  variant={channelParam === ch ? 'default' : 'outline'}
                                  className="text-[10px] py-0 font-normal cursor-pointer hover:bg-primary/10"
                                >
                                  {label}
                                </Badge>
                              </button>
                            );
                          }
                          return (
                            <Badge variant="outline" className="text-[10px] py-0 font-normal">{label}</Badge>
                          );
                        })()}
                      </div>
                      <span className="shrink-0 flex items-center gap-1">
                        <span>{formatDate(order.created_at)}</span>
                        <span className="text-muted-foreground text-[11px]" dir="ltr">
                          {new Date(order.created_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </span>
                    </div>

                    {/* شريط الأزرار */}
                    {(() => {
                      const isDetailsShown = expandedDetails.has(order.id);
                      const statusOptions = Object.entries(statusLabels).filter(
                        ([value]) =>
                          value === order.status ||
                          value === 'pending' ||
                          value === 'cancelled' ||
                          (value === 'delivered' && canMarkDelivered)
                      );
                      return (
                        <>
                          {/* الصف الأساسي: تحديث الحالة + تفاصيل */}
                          <div className="grid grid-cols-2 gap-1.5 pt-1">
                            {!isSalesModerator ? (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button size="sm" variant="default" className="gap-1 h-9 w-full">
                                    <CheckCircle className="w-3.5 h-3.5" />
                                    تحديث الحالة
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="min-w-[180px]">
                                  <DropdownMenuLabel>اختر الحالة الجديدة</DropdownMenuLabel>
                                  <DropdownMenuSeparator />
                                  {statusOptions.map(([value, label]) => (
                                    <DropdownMenuItem
                                      key={value}
                                      disabled={value === order.status}
                                      onSelect={() => {
                                        if (value === 'cancelled') {
                                          if (!window.confirm('هل أنت متأكد من تحديث حالة هذا الأوردر إلى "مرتجع / ملغي"؟')) return;
                                        }
                                        handleStatusChange(order.id, value as OrderStatus);
                                      }}
                                    >
                                      {value === 'pending' && isPrivateDeliveryRep ? 'مؤجل' : label}
                                      {value === order.status && ' ✓'}
                                    </DropdownMenuItem>
                                  ))}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            ) : (
                              <div />
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1 h-9 w-full"
                              onClick={() => toggleDetails(order.id)}
                            >
                              {isDetailsShown ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                              تفاصيل
                            </Button>
                          </div>

                          {/* الصف الثانوي: فتح + طباعة + ضبط التحصيل */}
                          <div className={`grid ${canSetCollectionMethod ? 'grid-cols-3' : 'grid-cols-2'} gap-1.5`}>
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1 h-8 w-full text-xs"
                              onClick={() => setSelectedOrder(order)}
                            >
                              <Eye className="w-3.5 h-3.5" />
                              فتح
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1 h-8 w-full text-xs"
                              onClick={() => handlePrintOrder(order)}
                            >
                              <Printer className="w-3.5 h-3.5" />
                              طباعة
                            </Button>
                            {canSetCollectionMethod && (
                              <Button
                                size="sm"
                                className="gap-1 h-8 w-full text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                                onClick={() => openMixedDialog(order.id)}
                              >
                                <Wallet className="w-3.5 h-3.5" />
                                ضبط التحصيل
                              </Button>
                            )}
                          </div>


                          {/* التفاصيل الموسّعة */}
                          {isDetailsShown && (
                            <div className="mt-2 pt-2 border-t space-y-2">
                              <div className="flex items-center gap-2 text-xs flex-wrap">
                                <Badge variant="outline" className="text-xs">{paymentLabels[order.payment_method] || order.payment_method}</Badge>
                                <Badge className={`text-xs ${order.payment_status === 'paid' ? 'bg-success text-success-foreground' : order.payment_status === 'failed' ? 'bg-destructive text-destructive-foreground' : 'bg-warning text-warning-foreground'}`}>
                                  {paymentStatusLabels[order.payment_status] || order.payment_status}
                                </Badge>
                                <span className="text-muted-foreground">
                                  {new Date(order.created_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                                </span>
                                <Badge className={`text-xs ${order.collection_status === 'collected' ? 'bg-success text-success-foreground' : 'bg-warning text-warning-foreground'}`}>
                                  {order.collection_status === 'collected' ? 'تم التحصيل' : 'لم يتم التحصيل'}
                                </Badge>
                              </div>

                              <div className="flex items-center gap-2 text-xs">
                                <span className="text-muted-foreground shrink-0">حالة التحديث:</span>
                                {order.update_status_marker ? (
                                  <Badge
                                    className={`text-[11px] border ${updateMarkerMeta[order.update_status_marker].className}`}
                                    title={order.update_status_updated_at ? `آخر تحديث: ${new Date(order.update_status_updated_at).toLocaleString('ar-EG')}` : undefined}
                                  >
                                    {updateMarkerMeta[order.update_status_marker].label}
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-[11px] text-muted-foreground border-muted">
                                    لم يتم التحديث
                                  </Badge>
                                )}
                              </div>

                              <div className="flex flex-col gap-1 text-xs">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-muted-foreground shrink-0">طريقة التحصيل:</span>
                                  {order.collection_method ? (
                                    <Badge className={`text-[11px] border ${collectionMethodMeta[order.collection_method].className}`}>
                                      {collectionMethodMeta[order.collection_method].short}
                                    </Badge>
                                  ) : (
                                    <Badge variant="outline" className="text-[11px] text-muted-foreground border-muted">
                                      لم يحدد التحصيل
                                    </Badge>
                                  )}
                                  {order.collection_method === 'cash_courier' && (
                                    <span className="text-emerald-700 font-bold">
                                      مطلوب: {Number(order.courier_cash_due || order.total).toLocaleString()} ج
                                    </span>
                                  )}
                                  {order.collection_method === 'mixed_payment' && (
                                    <span className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px]">
                                      <span className="text-emerald-700 font-bold">نقدي: {Number(order.courier_cash_due || 0).toLocaleString()}</span>
                                      {Number(order.vodafone_cash_amount || 0) > 0 && <span className="text-rose-700">📱 فودافون: {Number(order.vodafone_cash_amount).toLocaleString()}</span>}
                                      {Number(order.instapay_amount || 0) > 0 && <span className="text-indigo-700">💳 إنستاباي: {Number(order.instapay_amount).toLocaleString()}</span>}
                                      {Number(order.bank_transfer_amount || 0) > 0 && <span className="text-blue-700">🏦 بنكي: {Number(order.bank_transfer_amount).toLocaleString()}</span>}
                                      {Number(order.other_amount || 0) > 0 && <span className="text-zinc-700">💠 أخرى: {Number(order.other_amount).toLocaleString()}</span>}
                                      {Number(order.free_amount || 0) > 0 && <span className="text-slate-600">🎁 مجاني: {Number(order.free_amount).toLocaleString()}</span>}
                                    </span>
                                  )}
                                </div>
                                {canSetCollectionMethod && (
                                  <Select
                                    value={order.collection_method ?? '__unset__'}
                                    onValueChange={(v) => updateCollectionMethod(order.id, v as CollectionMethod)}
                                  >
                                    <SelectTrigger className="w-full h-8 text-xs"><SelectValue placeholder="تغيير طريقة التحصيل" /></SelectTrigger>
                                    <SelectContent>
                                      {(Object.keys(collectionMethodMeta) as CollectionMethod[]).map((k) => (
                                        <SelectItem key={k} value={k}>{collectionMethodMeta[k].label}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                )}
                              </div>

                              {isAccountant && (
                                <Select value={order.collection_status} onValueChange={(v) => handleCollectionChange(order.id, v)}>
                                  <SelectTrigger className="w-full h-9 text-xs"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="collected">تم التحصيل</SelectItem>
                                    <SelectItem value="not_collected">لم يتم التحصيل</SelectItem>
                                  </SelectContent>
                                </Select>
                              )}

                              {isPrivateDeliveryRep && order.delivery_address && (
                                <div className="text-xs bg-primary/5 border border-primary/20 rounded px-2 py-1 break-words">
                                  <span className="font-semibold text-primary">العنوان: </span>
                                  {order.delivery_address}
                                </div>
                              )}

                              {order.source_warehouse_id === AGOUZA_WAREHOUSE_ID && (() => {
                                const resv = agouzaResvMap[order.id] ?? 'none';
                                const isShortage = resv === 'none' && order.status !== 'delivered' && order.status !== 'cancelled';
                                let label = 'حجز عجوزة • محجوز';
                                let cls = 'border-purple-400 text-purple-700 bg-purple-50';
                                if (resv === 'committed') { label = 'حجز عجوزة • تم الخصم'; cls = 'border-emerald-400 text-emerald-700 bg-emerald-50'; }
                                else if (resv === 'released') { label = 'حجز عجوزة • تم فك الحجز'; cls = 'border-slate-400 text-slate-700 bg-slate-50'; }
                                else if (resv === 'active') { label = 'حجز عجوزة • محجوز'; cls = 'border-purple-400 text-purple-700 bg-purple-50'; }
                                else if (isShortage) { label = '⚠ عجز مخزون العجوزة'; cls = 'border-red-500 text-red-700 bg-red-50 font-semibold'; }
                                else { label = 'حجز عجوزة • —'; cls = 'border-slate-300 text-slate-600 bg-slate-50'; }
                                return (
                                  <div className="text-[11px]">
                                    <Badge variant="outline" className={`text-[10px] ${cls}`}>{label}</Badge>
                                  </div>
                                );
                              })()}

                              {/* إجراءات إضافية */}
                              <div className="flex items-center flex-wrap gap-1 pt-1 border-t">
                                {isPrivateDeliveryRep && order.status !== 'delivered' && order.status !== 'cancelled' && !approvedEditOrderIds.has(order.id) && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    disabled={pendingEditOrderIds.has(order.id)}
                                    onClick={() => requestEditPermission(order)}
                                    title={pendingEditOrderIds.has(order.id) ? 'بانتظار موافقة مدير المبيعات' : 'طلب إذن تعديل من مدير المبيعات'}
                                  >
                                    <KeyRound className={`w-4 h-4 ${pendingEditOrderIds.has(order.id) ? 'text-warning' : 'text-primary'}`} />
                                  </Button>
                                )}
                                {canEditThisOrder(order) && (
                                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditingOrder(order)} title="تعديل الطلب">
                                    <Pencil className="w-4 h-4" />
                                  </Button>
                                )}
                                {canEditThisOrder(order) && (
                                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditAddressOrder(order)} title="تعديل العنوان ومخزن الاستلام">
                                    <MapPin className="w-4 h-4 text-primary" />
                                  </Button>
                                )}
                                {canEditThisOrder(order) && (
                                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setAddOfferOrder(order)} title="إضافة بوكس / عرض">
                                    <PackagePlus className="w-4 h-4 text-primary" />
                                  </Button>
                                )}
                                {order.status !== 'delivered' && order.status !== 'cancelled' && order.items.some((it) => it.offer_name) && !isPrivateDeliveryRep && (
                                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSwapOfferOrder(order)} title="استبدال العرض">
                                    <PackageOpen className="w-4 h-4 text-primary" />
                                  </Button>
                                )}
                                {canReassignOwner && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 gap-1 text-xs text-purple-700 hover:text-purple-800 hover:bg-purple-50"
                                    onClick={() => setReassignOrder(order)}
                                    title="نقل الأوردر لمسوقة أخرى"
                                  >
                                    <UserCog className="w-4 h-4" />
                                    تغيير المسؤولة
                                  </Button>
                                )}
                                {canDeleteOrders && (
                                  <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive">
                                        <Trash2 className="w-4 h-4" />
                                      </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                      <AlertDialogHeader>
                                        <AlertDialogTitle>حذف الطلب {order.order_number}؟</AlertDialogTitle>
                                        <AlertDialogDescription>سيتم حذف الطلب وجميع أصنافه نهائيًا. لا يمكن التراجع عن هذا الإجراء.</AlertDialogDescription>
                                      </AlertDialogHeader>
                                      <AlertDialogFooter>
                                        <AlertDialogCancel>إلغاء</AlertDialogCancel>
                                        <AlertDialogAction onClick={() => handleDeleteOrder(order.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">حذف</AlertDialogAction>
                                      </AlertDialogFooter>
                                    </AlertDialogContent>
                                  </AlertDialog>
                                )}
                              </div>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                );
              })
            )}
          </div>



          {/* Desktop table view */}
          <div className="hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-green-100 hover:bg-green-100 dark:bg-green-800/40 dark:hover:bg-green-800/40 [&_th]:text-green-900 dark:[&_th]:text-green-100 [&_th]:font-semibold">
                <TableHead className="text-right w-10">مراجعة</TableHead>
                <TableHead className="text-right">رقم الطلب</TableHead>
                <TableHead className="text-right">العميل</TableHead>
                <TableHead className="text-right">رقم الهاتف</TableHead>
                <TableHead className="text-right">الموديريتور</TableHead>
                <TableHead className="text-right">المنتجات</TableHead>
                <TableHead className="text-right">العرض</TableHead>
                <TableHead className="text-right">الإجمالي</TableHead>
                <TableHead className="text-right">طريقة الدفع</TableHead>
                <TableHead className="text-right">حالة الدفع</TableHead>
                <TableHead className="text-right">الحالة</TableHead>
                <TableHead className="text-right">التحصيل</TableHead>
                <TableHead className="text-right">طريقة التحصيل</TableHead>
                <TableHead className="text-right">التاريخ</TableHead>
                <TableHead className="text-right">التوقيت</TableHead>
                <TableHead className="text-right">تاريخ التسليم</TableHead>
                <TableHead className="text-right">مدة التسليم</TableHead>
                {isPrivateDeliveryRep && <TableHead className="text-right">العنوان</TableHead>}
                <TableHead className="text-right">الإجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredOrders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isPrivateDeliveryRep ? 18 : 17} className="text-center py-8 text-muted-foreground">
                    لا توجد طلبات
                  </TableCell>
                </TableRow>

              ) : (
                filteredOrders.map((order) => (
                  <TableRow key={order.id} className="table-row-hover">
                    <TableCell className="w-10">
                      <Checkbox
                        checked={reviewedIds.has(order.id)}
                        onCheckedChange={(v) => toggleReviewed(order.id, v === true)}
                        aria-label="تمت المراجعة"
                      />
                    </TableCell>
                    <TableCell className="font-mono font-semibold">
                      <button
                        type="button"
                        onClick={() => openMixedDialog(order.id)}
                        className="text-primary hover:underline focus:outline-none"
                        title="ضبط التحصيل"
                      >
                        {order.order_number}
                      </button>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openMixedDialog(order.id)}
                          className="text-right hover:underline focus:outline-none"
                          title="ضبط التحصيل"
                        >
                          {order.customer_name}
                        </button>
                        {canManageOrders && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setEditCustomerOrder(order); }}
                            className="text-muted-foreground hover:text-primary p-0.5"
                            title="تعديل بيانات العميل"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </TableCell>

                    <TableCell className="font-mono text-sm" dir="ltr">
                      {order.customer_phone ? (
                        <div className="space-y-1">
                          <PhoneWithCopy phone={order.customer_phone} className="text-sm" />
                          {order.customer_phone2 && order.customer_phone2 !== order.customer_phone && (
                            <PhoneWithCopy phone={order.customer_phone2} className="text-xs text-muted-foreground" />
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {canReassignOwner ? (
                        <button type="button" onClick={(e) => { e.stopPropagation(); setReassignOrder(order); }} title="اضغط لتغيير المسؤولة عن الأوردر">
                          <Badge className="cursor-pointer bg-orange-500 hover:bg-orange-600 text-white border-orange-600">{order.moderator_name}</Badge>
                        </button>
                      ) : (
                        <Badge variant="secondary">{order.moderator_name}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="max-w-xs">
                      <span className="text-sm whitespace-normal break-words">
                        {order.items.length === 0
                          ? '-'
                          : order.items
                              .map((it) => {
                                const cleaned = it.product_name
                                  .replace(/\s*\(عرض\)\s*/g, ' ')
                                  .replace(/(^|\s)نعام(?=\s|$)/g, '$1')
                                  .replace(/\s+/g, ' ')
                                  .trim();
                                const cleanName = cleaned || it.product_name;
                                return `${formatItemQty(it.quantity, it.unit)} ${cleanName}`;
                              })
                              .join(' + ')}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-[160px]">
                      {(() => {
                        const offers = Array.from(
                          new Set(
                            order.items
                              .map((it) =>
                                it.offer_name ||
                                (/(عرض)/.test(it.product_name) ? 'عرض' : null)
                              )
                              .filter(Boolean) as string[]
                          )
                        );
                        return offers.length === 0 ? (
                          <span className="text-muted-foreground">-</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {offers.map((name) => (
                              <Badge key={name} variant="secondary" className="text-xs">
                                {name}
                              </Badge>
                            ))}
                          </div>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="font-bold">{order.total.toLocaleString()} ج.م</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {paymentLabels[order.payment_method] || order.payment_method}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={
                          order.payment_status === "paid"
                            ? "bg-success text-success-foreground"
                            : order.payment_status === "failed"
                            ? "bg-destructive text-destructive-foreground"
                            : "bg-warning text-warning-foreground"
                        }
                      >
                        {paymentStatusLabels[order.payment_status] || order.payment_status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1.5">
                        {isSalesModerator ? (
                          <Badge className={`${statusColors[order.status]} flex items-center gap-1 w-fit`}>
                            {getStatusIcon(order.status)}
                            {statusLabels[order.status]}
                          </Badge>
                        ) : (
                          <Select
                            value={order.status}
                            onValueChange={(value: OrderStatus) =>
                              handleStatusChange(order.id, value)
                            }
                          >
                            <SelectTrigger className="w-36">
                              <Badge className={`${statusColors[order.status]} flex items-center gap-1`}>
                                {getStatusIcon(order.status)}
                                {statusLabels[order.status]}
                              </Badge>
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(statusLabels)
                                .filter(([value]) => value === order.status || value === 'pending' || value === 'cancelled' || (value === 'delivered' && canMarkDelivered))
                                .map(([value, label]) => (
                                  <SelectItem key={value} value={value}>
                                    {value === 'pending' && isPrivateDeliveryRep ? 'مؤجل' : label}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        )}
                        {/* حالة التحديث — علامة آخر زر تحديث تم استخدامه (عرض فقط). */}
                        <div className="flex items-center gap-1 text-[10px]">
                          <span className="text-muted-foreground">آخر تحديث:</span>
                          {order.update_status_marker ? (
                            <Badge
                              className={`text-[10px] border px-1.5 py-0 ${updateMarkerMeta[order.update_status_marker].className}`}
                              title={order.update_status_updated_at ? new Date(order.update_status_updated_at).toLocaleString('ar-EG') : undefined}
                            >
                              {updateMarkerMeta[order.update_status_marker].label}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] text-muted-foreground border-muted px-1.5 py-0">
                              لم يتم التحديث
                            </Badge>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {isAccountant ? (
                        <Select
                          value={order.collection_status}
                          onValueChange={(v) => handleCollectionChange(order.id, v)}
                        >
                          <SelectTrigger className="w-36">
                            <Badge
                              className={
                                order.collection_status === 'collected'
                                  ? 'bg-success text-success-foreground'
                                  : 'bg-warning text-warning-foreground'
                              }
                            >
                              {order.collection_status === 'collected' ? 'تم التحصيل' : 'لم يتم التحصيل'}
                            </Badge>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="collected">تم التحصيل</SelectItem>
                            <SelectItem value="not_collected">لم يتم التحصيل</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge
                          className={
                            order.collection_status === 'collected'
                              ? 'bg-success text-success-foreground'
                              : 'bg-warning text-warning-foreground'
                          }
                        >
                          {order.collection_status === 'collected' ? 'تم التحصيل' : 'لم يتم التحصيل'}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1 min-w-[170px]">
                        {canSetCollectionMethod ? (
                          <Select
                            value={order.collection_method ?? '__unset__'}
                            onValueChange={(v) => updateCollectionMethod(order.id, v as CollectionMethod)}
                          >
                            <SelectTrigger className="w-full h-8 px-2">
                              {order.collection_method ? (
                                <Badge className={`text-[11px] border ${collectionMethodMeta[order.collection_method].className}`}>
                                  {collectionMethodMeta[order.collection_method].short}
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-[11px] text-muted-foreground border-muted">
                                  لم يحدد التحصيل
                                </Badge>
                              )}
                            </SelectTrigger>
                            <SelectContent>
                              {(Object.keys(collectionMethodMeta) as CollectionMethod[]).map((k) => (
                                <SelectItem key={k} value={k}>{collectionMethodMeta[k].label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          order.collection_method ? (
                            <Badge className={`text-[11px] border ${collectionMethodMeta[order.collection_method].className}`}>
                              {collectionMethodMeta[order.collection_method].short}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[11px] text-muted-foreground border-muted">
                              يحتاج مراجعة تحصيل
                            </Badge>
                          )
                        )}
                        {canSetCollectionMethod && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 w-full text-[11px] gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                            onClick={() => openMixedDialog(order.id)}
                            title="فتح شاشة ضبط التحصيل (فودافون كاش / إنستا / كاش)"
                          >
                            <Wallet className="w-3 h-3" />
                            ضبط التحصيل
                          </Button>
                        )}
                        <span className="text-[11px] text-muted-foreground">
                          {order.collection_method === 'cash_courier'
                            ? <>مطلوب: <span className="font-bold text-emerald-700">{Number(order.courier_cash_due || order.total).toLocaleString()} ج</span></>
                            : order.collection_method === 'mixed_payment'
                              ? <span className="flex flex-col leading-tight">
                                  <span className="font-bold text-emerald-700">نقدي: {Number(order.courier_cash_due || 0).toLocaleString()}</span>
                                  {Number(order.vodafone_cash_amount || 0) > 0 && <span className="text-rose-700">📱 {Number(order.vodafone_cash_amount).toLocaleString()}</span>}
                                  {Number(order.instapay_amount || 0) > 0 && <span className="text-indigo-700">💳 {Number(order.instapay_amount).toLocaleString()}</span>}
                                  {Number(order.bank_transfer_amount || 0) > 0 && <span className="text-blue-700">🏦 {Number(order.bank_transfer_amount).toLocaleString()}</span>}
                                  {Number(order.other_amount || 0) > 0 && <span className="text-zinc-700">💠 {Number(order.other_amount).toLocaleString()}</span>}
                                  {Number(order.free_amount || 0) > 0 && <span className="text-slate-600">🎁 {Number(order.free_amount).toLocaleString()}</span>}
                                </span>
                              : order.collection_method
                                ? <>مطلوب من المندوب: <span className="font-bold">0 ج</span></>
                                : <span className="italic">لم يحدد التحصيل</span>}
                        </span>
                      </div>
                    </TableCell>

                    <TableCell className="text-muted-foreground">
                      {formatDate(order.created_at)}
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono">
                      {new Date(order.created_at).toLocaleTimeString('ar-EG', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {order.delivered_at
                        ? formatDate(order.delivered_at)
                        : '-'}
                    </TableCell>
                    <TableCell>
                      {order.delivered_at ? (
                        <Badge variant="secondary">
                          {Math.max(
                            0,
                            Math.ceil(
                              (new Date(order.delivered_at).getTime() - new Date(order.created_at).getTime()) /
                                (1000 * 60 * 60 * 24)
                            )
                          )}{' '}
                          يوم
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    {isPrivateDeliveryRep && (
                      <TableCell className="max-w-[240px]">
                        <div className="text-xs whitespace-normal break-words">
                          {order.governorate && (
                            <div className="flex items-center gap-1 text-muted-foreground mb-1">
                              <MapPin className="w-3 h-3" /> {order.governorate}
                            </div>
                          )}
                          <span>{order.delivery_address || '-'}</span>
                        </div>
                      </TableCell>
                    )}
                    <TableCell>

                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          asChild
                        >
                          <Link to={`/orders/${order.id}`}>
                            <Eye className="w-4 h-4" />
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handlePrintOrder(order)}
                          title="طباعة الطلب"
                        >
                          <Printer className="w-4 h-4 text-primary" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openMixedDialog(order.id)}
                          title="تعديل / ضبط تحصيل الأوردر"
                        >
                          <Wallet className="w-4 h-4 text-emerald-600" />
                        </Button>
                        {isPrivateDeliveryRep &&
                          order.status !== 'delivered' &&
                          order.status !== 'cancelled' &&
                          !approvedEditOrderIds.has(order.id) && (
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={pendingEditOrderIds.has(order.id)}
                              onClick={() => requestEditPermission(order)}
                              title={pendingEditOrderIds.has(order.id) ? 'بانتظار موافقة مدير المبيعات' : 'طلب إذن تعديل من مدير المبيعات'}
                            >
                              <KeyRound className={`w-4 h-4 ${pendingEditOrderIds.has(order.id) ? 'text-warning' : 'text-primary'}`} />
                            </Button>
                          )}
                        {canEditThisOrder(order) && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setEditingOrder(order)}
                            title="تعديل الطلب"
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                        )}
                        {canEditThisOrder(order) && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setAddOfferOrder(order)}
                            title="إضافة بوكس / عرض"
                          >
                            <PackagePlus className="w-4 h-4 text-primary" />
                          </Button>
                        )}
                        {order.status !== 'delivered' && order.status !== 'cancelled' &&
                          order.items.some((it) => it.offer_name) && !isPrivateDeliveryRep && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setSwapOfferOrder(order)}
                              title="استبدال العرض"
                            >
                              <PackageOpen className="w-4 h-4 text-primary" />
                            </Button>
                          )}
                        {canDeleteOrders && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>حذف الطلب {order.order_number}؟</AlertDialogTitle>
                                <AlertDialogDescription>
                                  سيتم حذف الطلب وجميع أصنافه نهائيًا. لا يمكن التراجع عن هذا الإجراء.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>إلغاء</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleDeleteOrder(order.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                  حذف
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>

      {/* Order Details Dialog */}
      <Dialog
        open={!!selectedOrder}
        onOpenChange={() => setSelectedOrder(null)}
      >
        <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 pt-6 pb-3 border-b shrink-0">
            <DialogTitle>تفاصيل الطلب {selectedOrder?.order_number}</DialogTitle>
          </DialogHeader>
          {selectedOrder && (
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">العميل</p>
                  <div className="flex items-center gap-1 flex-wrap">
                    <p className="font-semibold">{selectedOrder.customer_name}</p>
                    {canManageOrders && (
                      <button
                        type="button"
                        onClick={() => setEditCustomerOrder(selectedOrder)}
                        className="text-muted-foreground hover:text-primary p-0.5"
                        title="تعديل بيانات العميل"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  {selectedOrder.customer_phone && (
                    <div className="space-y-1">
                      <PhoneWithCopy phone={selectedOrder.customer_phone} className="text-xs text-primary" />
                      {selectedOrder.customer_phone2 && selectedOrder.customer_phone2 !== selectedOrder.customer_phone && (
                        <PhoneWithCopy phone={selectedOrder.customer_phone2} className="text-xs text-muted-foreground" />
                      )}
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">التاريخ</p>
                  <p className="font-semibold">{formatDate(selectedOrder.created_at)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">الحالة</p>
                  <Badge className={`${statusColors[selectedOrder.status]} flex items-center gap-1 text-xs w-fit`}>
                    {getStatusIcon(selectedOrder.status)}
                    {statusLabels[selectedOrder.status]}
                  </Badge>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">طريقة الدفع</p>
                  <p className="font-semibold text-sm">{paymentLabels[selectedOrder.payment_method] || selectedOrder.payment_method}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-sm text-muted-foreground">المحافظة / عنوان التوصيل</p>
                  <p className="font-semibold text-sm">
                    {selectedOrder.governorate ? `${selectedOrder.governorate} — ` : ''}
                    {selectedOrder.delivery_address || 'غير محدد'}
                  </p>
                </div>
                {selectedOrder.notes && (
                  <div className="col-span-2">
                    <p className="text-sm text-muted-foreground">ملاحظات</p>
                    <p className="text-sm bg-muted/50 border rounded p-2">{selectedOrder.notes}</p>
                  </div>
                )}
              </div>


              <div>
                <p className="text-sm text-muted-foreground mb-3">المنتجات</p>
                <div className="rounded-lg border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="text-right">المنتج</TableHead>
                        <TableHead className="text-center">الكمية</TableHead>
                        <TableHead className="text-center">الوحدة</TableHead>
                        <TableHead className="text-center">سعر الوحدة</TableHead>
                        <TableHead className="text-left">الإجمالي</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedOrder.items.map((item) => {
                        const qty = Number(item.quantity) || 0;
                        const lineTotal = Number(item.total_price) || 0;
                        const rawUnit = Number(item.unit_price) || 0;
                        const unit = rawUnit > 0
                          ? rawUnit
                          : (qty > 0 && lineTotal > 0 ? lineTotal / qty : 0);
                        const noPrice = unit === 0 && lineTotal === 0;
                        const isGift = (item as any).is_gift === true;
                        const unitLabel = (item as any).is_half_kg ? 'كجم' : ((item as any).unit || 'قطعة');
                        return (
                          <TableRow key={item.id}>
                            <TableCell className="font-medium text-right">
                              {item.product_name}
                              {(item as any).is_half_kg && (
                                <span className="mr-2 text-[10px] px-2 py-0.5 rounded bg-secondary text-secondary-foreground">نصف كيلو</span>
                              )}
                              {isGift && (
                                <span className="mr-2 text-[10px] px-2 py-0.5 rounded bg-pink-100 text-pink-700 border border-pink-200">🎁 هدية</span>
                              )}
                            </TableCell>
                            <TableCell className="text-center">{qty.toLocaleString()}</TableCell>
                            <TableCell className="text-center text-xs text-muted-foreground">{unitLabel}</TableCell>
                            <TableCell className="text-center">
                              {noPrice
                                ? <span className="text-muted-foreground text-xs">غير محسوب</span>
                                : `${unit.toLocaleString(undefined,{maximumFractionDigits:2})} ج.م`}
                            </TableCell>
                            <TableCell className="text-left font-bold">
                              {noPrice
                                ? <span className="text-muted-foreground text-xs">—</span>
                                : `${lineTotal.toLocaleString()} ج.م`}
                            </TableCell>
                          </TableRow>
                        );
                      })}

                    </TableBody>
                  </Table>
                </div>
              </div>

              <div className="space-y-2 border-t pt-4">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground flex items-center gap-1">
                    إجمالي المنتجات
                    <span
                      title="قيمة المنتجات فقط (subtotal) — كما في عمود «قيمة الاوردر بدون شحن» في ملف Excel."
                      className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-muted text-[10px] cursor-help"
                    >؟</span>
                  </span>
                  <span>{selectedOrder.subtotal.toLocaleString()} ج.م</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">رسوم التوصيل</span>
                  <span>{selectedOrder.delivery_fee.toLocaleString()} ج.م</span>
                </div>
                {selectedOrder.discount > 0 && (
                  <div className="flex justify-between text-sm text-green-600">
                    <span>الخصم</span>
                    <span>- {selectedOrder.discount.toLocaleString()} ج.م</span>
                  </div>
                )}
                <div className="flex items-center justify-between pt-2 border-t">
                  <span className="text-lg font-semibold">إجمالي الأوردر</span>
                  <span className="text-2xl font-bold text-primary">
                    {selectedOrder.total.toLocaleString()} ج.م
                  </span>
                </div>
                {(() => {
                  const diff = Number(selectedOrder.total) - (Number(selectedOrder.subtotal) + Number(selectedOrder.delivery_fee) - Number(selectedOrder.discount||0));
                  if (Math.abs(diff) > 0.01) {
                    return (
                      <div className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded p-2">
                        ملاحظة: يوجد فرق قدره {diff.toLocaleString()} ج.م بين مجموع (منتجات + شحن − خصم) وإجمالي الأوردر المُخزَّن.
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>

              {/* تفاصيل التحصيل */}
              {selectedOrder.collection_method && (
                <div className="border-t pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-semibold">تفاصيل التحصيل</p>
                    <Badge className={`text-[11px] border ${collectionMethodMeta[selectedOrder.collection_method].className}`}>
                      {collectionMethodMeta[selectedOrder.collection_method].label}
                    </Badge>
                  </div>
                  <div className="rounded-lg bg-muted/40 border p-3 space-y-1.5 text-sm">
                    {Number(selectedOrder.courier_cash_due || 0) > 0 && (
                      <div className="flex justify-between"><span>نقدي مع المندوب</span><span className="font-semibold">{Number(selectedOrder.courier_cash_due).toLocaleString()} ج.م</span></div>
                    )}
                    {Number(selectedOrder.vodafone_cash_amount || 0) > 0 && (
                      <div className="flex justify-between"><span>📱 فودافون كاش</span><span className="font-semibold">{Number(selectedOrder.vodafone_cash_amount).toLocaleString()} ج.م</span></div>
                    )}
                    {Number((selectedOrder as any).instapay_amount || 0) > 0 && (
                      <div className="flex justify-between"><span>إنستاباي</span><span className="font-semibold">{Number((selectedOrder as any).instapay_amount).toLocaleString()} ج.م</span></div>
                    )}
                    {Number((selectedOrder as any).bank_transfer_amount || 0) > 0 && (
                      <div className="flex justify-between"><span>تحويل بنكي</span><span className="font-semibold">{Number((selectedOrder as any).bank_transfer_amount).toLocaleString()} ج.م</span></div>
                    )}
                    {Number((selectedOrder as any).other_amount || 0) > 0 && (
                      <div className="flex justify-between"><span>أخرى</span><span className="font-semibold">{Number((selectedOrder as any).other_amount).toLocaleString()} ج.م</span></div>
                    )}
                    {Number((selectedOrder as any).free_amount || 0) > 0 && (
                      <div className="flex justify-between text-pink-600"><span>مجاني</span><span className="font-semibold">{Number((selectedOrder as any).free_amount).toLocaleString()} ج.م</span></div>
                    )}
                    {(selectedOrder as any).transfer_reference && (
                      <div className="flex justify-between border-t pt-1.5 text-xs"><span className="text-muted-foreground">رقم المرجع</span><span>{(selectedOrder as any).transfer_reference}</span></div>
                    )}
                    {(selectedOrder as any).collection_note && (
                      <div className="border-t pt-1.5 text-xs text-muted-foreground">📝 {(selectedOrder as any).collection_note}</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
          {selectedOrder && (
            <div className="border-t px-6 py-3 flex items-center justify-between gap-2 shrink-0 bg-background">
              {canSetCollectionMethod ? (
                <Button
                  variant="default"
                  onClick={() => { const id = selectedOrder.id; setSelectedOrder(null); openMixedDialog(id); }}
                  className="gap-2"
                >
                  <Wallet className="w-4 h-4" />
                  ضبط التحصيل
                </Button>
              ) : <span />}
              <Button variant="outline" onClick={() => setSelectedOrder(null)}>إغلاق</Button>
            </div>
          )}

        </DialogContent>
      </Dialog>


      {/* توزيع مبالغ التحصيل المختلط */}
      <Dialog
        open={!!mixedDlgOrderId}
        onOpenChange={(open) => { if (!open) { setMixedDlgOrderId(null); setMixedDlgOrderSnap(null); } }}
      >

        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>🧩 توزيع التحصيل المختلط</DialogTitle>
          </DialogHeader>
          {(() => {
            const t = orders.find((o) => o.id === mixedDlgOrderId) ?? mixedDlgOrderSnap;
            if (!t) return <div className="p-4 text-sm text-muted-foreground text-center">جارٍ تحميل بيانات الأوردر…</div>;

            const cash = Number(mixedCash) || 0;
            const vod = Number(mixedVod) || 0;
            const insta = Number(mixedInsta) || 0;
            const bank = Number(mixedBank) || 0;
            const other = Number(mixedOther) || 0;
            const free = Number(mixedFree) || 0;
            const deposit = Number(mixedDeposit) || 0;
            const sum = cash + vod + insta + bank + other + free + deposit;

            const totalVal = Number(t.total || 0);
            const diff = totalVal - sum;
            const ok = Math.abs(diff) <= 0.01;
            return (
              <div className="space-y-3">
                <div className="rounded-md border bg-muted/40 p-3 text-sm flex justify-between">
                  <span className="text-muted-foreground">إجمالي قيمة الأوردر</span>
                  <span className="font-bold">{totalVal.toLocaleString()} ج</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">💵 كاش مع المندوب</label>
                    <Input type="number" min={0} step="0.01" value={mixedCash} onChange={(e) => setMixedCash(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">📱 Vodafone Cash</label>
                    <Input type="number" min={0} step="0.01" value={mixedVod} onChange={(e) => setMixedVod(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">💳 InstaPay</label>
                    <Input type="number" min={0} step="0.01" value={mixedInsta} onChange={(e) => setMixedInsta(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">🏦 تحويل بنكي</label>
                    <Input type="number" min={0} step="0.01" value={mixedBank} onChange={(e) => setMixedBank(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">💠 أخرى</label>
                    <Input type="number" min={0} step="0.01" value={mixedOther} onChange={(e) => setMixedOther(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">🎁 مجاني / معفى</label>
                    <Input type="number" min={0} step="0.01" value={mixedFree} onChange={(e) => setMixedFree(e.target.value)} />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">🔖 رقم مرجع التحويل (اختياري)</label>
                  <Input value={mixedRef} onChange={(e) => setMixedRef(e.target.value)} placeholder="رقم عملية / رقم مرجع البنك" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">ملاحظات التحصيل</label>
                  <Input value={mixedNote} onChange={(e) => setMixedNote(e.target.value)} placeholder="اختياري" />
                </div>
                <div className={`rounded-md border p-3 text-sm flex justify-between ${ok ? 'bg-emerald-50 border-emerald-300 text-emerald-800' : 'bg-rose-50 border-rose-300 text-rose-800'}`}>
                  <span>المجموع: <b>{sum.toLocaleString()}</b> ج</span>
                  <span>{ok ? '✓ مطابق' : `فرق: ${diff.toLocaleString()} ج`}</span>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setMixedDlgOrderId(null)}>إلغاء</Button>
                  <Button onClick={saveMixedBreakdown} disabled={!ok}>حفظ التوزيع</Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>


      {/* اختيار طريقة التحصيل قبل تأكيد التسليم — لا يمس منطق التسليم/المخزون/المالية */}
      <AlertDialog
        open={!!pendingDeliveryOrderId}
        onOpenChange={(open) => { if (!open) setPendingDeliveryOrderId(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>طريقة التحصيل</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-right">
                <p className="text-sm">اختر طريقة التحصيل قبل تأكيد التسليم:</p>
                <div className="grid gap-2">
                  {(Object.keys(collectionMethodMeta) as CollectionMethod[]).map((k) => (
                    <label
                      key={k}
                      className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 cursor-pointer transition ${pendingDeliveryMethod === k ? 'border-primary bg-primary/5' : 'border-muted hover:bg-muted/40'}`}
                    >
                      <span className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="pendingDeliveryMethod"
                          checked={pendingDeliveryMethod === k}
                          onChange={() => setPendingDeliveryMethod(k)}
                        />
                        <span className="text-sm">{collectionMethodMeta[k].label}</span>
                      </span>
                      <Badge className={`text-[11px] border ${collectionMethodMeta[k].className}`}>
                        {collectionMethodMeta[k].short}
                      </Badge>
                    </label>
                  ))}
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const id = pendingDeliveryOrderId;
                const method = pendingDeliveryMethod;
                setPendingDeliveryOrderId(null);
                if (!id) return;
                // للتحصيل المختلط: افتح نافذة توزيع المبالغ أولًا، ولا تُغيّر الحالة حتى الحفظ.
                if (method === 'mixed_payment') {
                  setDeliverAfterMixedSave(true);
                  openMixedDialog(id);
                  return;
                }
                await updateCollectionMethod(id, method);
                await handleStatusChange(id, 'delivered');
              }}
            >
              حفظ ومتابعة التسليم
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!collectionMismatch} onOpenChange={(open) => { if (!open) setCollectionMismatch(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive flex items-center gap-2">
              ⚠️ اختلاف في قيمة التحصيل
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-right">
                <p>
                  تم اكتشاف فرق بين قيمة الأوردر وقت التسليم وقيمته الحالية عند التحصيل
                  للطلب رقم <span className="font-bold">{collectionMismatch?.orderNumber}</span>.
                </p>
                {collectionMismatch && (() => {
                  const diff = collectionMismatch.currentTotal - collectionMismatch.deliveredTotal;
                  return (
                    <div className="rounded-lg border bg-muted/40 p-3 space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">قيمة التسليم:</span>
                        <span className="font-semibold">{collectionMismatch.deliveredTotal.toFixed(2)} ر.س</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">قيمة التحصيل الحالية:</span>
                        <span className="font-semibold">{collectionMismatch.currentTotal.toFixed(2)} ر.س</span>
                      </div>
                      <div className="flex justify-between border-t pt-2">
                        <span className="text-muted-foreground">الفرق:</span>
                        <span className={`font-bold ${diff > 0 ? 'text-success' : 'text-destructive'}`}>
                          {diff > 0 ? '+' : ''}{diff.toFixed(2)} ر.س
                        </span>
                      </div>
                    </div>
                  );
                })()}
                <p className="text-xs text-muted-foreground">
                  سيتم إرسال تنبيه للمحاسب بهذا الفرق عند المتابعة.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!collectionMismatch) return;
                const m = collectionMismatch;
                setCollectionMismatch(null);
                try {
                  await applyCollectionUpdate(m.orderId, 'collected', {
                    orderNumber: m.orderNumber,
                    deliveredTotal: m.deliveredTotal,
                    currentTotal: m.currentTotal,
                  });
                } catch (e) {
                  console.error(e);
                  toast.error('تعذّر تحديث حالة التحصيل');
                }
              }}
            >
              متابعة وتأكيد التحصيل
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {editingOrder && (
        <EditOrderItemsDialog
          open={!!editingOrder}
          onOpenChange={(o) => !o && setEditingOrder(null)}
          orderId={editingOrder.id}
          initialItems={editingOrder.items.map((it) => ({
            id: it.id,
            product_id: it.product_id,
            product_name: it.product_name,
            quantity: it.quantity,
            unit_price: it.unit_price,
            is_half_kg: !!(it as any).is_half_kg,
            is_gift: !!(it as any).is_gift,
          }))}
          initialDiscount={editingOrder.discount}
          initialDeliveryFee={editingOrder.delivery_fee}
          onSaved={() => {
            setEditingOrder(null);
            fetchOrders();
          }}
        />
      )}

      {editAddressOrder && (
        <EditAddressWarehouseDialog
          open={!!editAddressOrder}
          onOpenChange={(o) => !o && setEditAddressOrder(null)}
          orderId={editAddressOrder.id}
          initialAddress={editAddressOrder.delivery_address}
          initialWarehouseId={editAddressOrder.source_warehouse_id}
          initialFulfillmentType={editAddressOrder.fulfillment_type}
          initialShippingCompany={editAddressOrder.shipping_company}
          onSaved={(next) => {
            setOrders((prev) => prev.map((o) => o.id === editAddressOrder.id ? { ...o, ...next } : o));
            setEditAddressOrder(null);
          }}
        />
      )}

      {editCustomerOrder && (
        <EditCustomerInfoDialog
          open={!!editCustomerOrder}
          onOpenChange={(o) => !o && setEditCustomerOrder(null)}
          orderId={editCustomerOrder.id}
          customerId={editCustomerOrder.customer_id}
          initialName={editCustomerOrder.customer_name}
          initialPhone={editCustomerOrder.customer_phone}
          initialAddress={editCustomerOrder.delivery_address}
          onSaved={(next) => {
            setOrders((prev) => prev.map((o) => o.id === editCustomerOrder.id ? { ...o, ...next } : o));
            setEditCustomerOrder(null);
          }}
        />
      )}

      {swapOfferOrder && (
        <SwapOfferDialog
          open={!!swapOfferOrder}
          onOpenChange={(o) => !o && setSwapOfferOrder(null)}
          orderId={swapOfferOrder.id}
          currentItems={swapOfferOrder.items.map((it) => ({
            id: it.id,
            product_name: it.product_name,
            quantity: it.quantity,
            unit_price: it.unit_price,
            total_price: it.total_price,
            offer_name: it.offer_name ?? null,
          }))}
          onSaved={() => {
            setSwapOfferOrder(null);
            fetchOrders();
          }}
        />
      )}
      {addOfferOrder && (
        <AddOfferDialog
          open={!!addOfferOrder}
          onOpenChange={(o) => !o && setAddOfferOrder(null)}
          orderId={addOfferOrder.id}
          onSaved={() => {
            setAddOfferOrder(null);
            fetchOrders();
          }}
        />
      )}



      {/* Per-moderator quick access — only for the private delivery rep here
          (filtered to "مندوب خاص"). The general view was moved to /sales-targets. */}
      {!isSalesModerator && isPrivateDeliveryRep && (
        <ModeratorQuickAccessCards privateDeliveryOnly />
      )}

      {/* Popup alert for م. آلاء حامد عند فتح التطبيق إذا كان هناك طلبات بأرقام مكررة */}
      <Dialog open={showDupAlert} onOpenChange={setShowDupAlert}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-5 h-5" />
              تنبيه: طلبات بأرقام هواتف مكررة
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              تم رصد {dupAlertOrders.length} طلب لعملاء سبق تسجيل طلب لهم بنفس رقم الهاتف.
              برجاء المراجعة لتجنب التكرار.
            </p>
            <div className="max-h-64 overflow-auto space-y-2">
              {dupAlertOrders.map((o) => (
                <div key={o.id} className="border border-red-300 bg-red-50 dark:bg-red-950/40 rounded-md p-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs">{o.order_number}</span>
                    <span className="font-bold text-red-700 dark:text-red-200">{o.customer_name}</span>
                  </div>
                  {o.customer_phone && (
                    <div className="text-xs font-mono text-muted-foreground" dir="ltr">{o.customer_phone}</div>
                  )}
                </div>
              ))}
            </div>
            <Button className="w-full" onClick={() => setShowDupAlert(false)}>
              فهمت، سأراجع الطلبات
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <QuickDeliveryDialog
        open={quickDeliveryOpen}
        onOpenChange={setQuickDeliveryOpen}
        orders={orders as any}
        statusLabels={statusLabels}
        canMarkDelivered={canMarkDelivered}
        onUpdateStatus={async (id, status) => {
          await handleStatusChange(id, status);
        }}
      />

      {reassignOrder && (
        <ReassignOwnerDialog
          open={!!reassignOrder}
          onOpenChange={(v) => { if (!v) setReassignOrder(null); }}
          orderId={reassignOrder.id}
          orderNumber={reassignOrder.order_number}
          currentOwnerId={reassignOrder.created_by}
          currentOwnerName={reassignOrder.moderator_name}
          onDone={() => { setReassignOrder(null); fetchOrders(); }}
        />
      )}
    </DashboardLayout>
  );
};

export default Orders;
