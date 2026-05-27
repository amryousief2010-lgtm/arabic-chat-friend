import { useState, useEffect } from "react";
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
import { ShoppingCart, Eye, Truck, CheckCircle, XCircle, Plus, Trash2, Pencil, ChevronDown, ChevronUp, PackageOpen, PackagePlus, FileDown, FileText, KeyRound, MapPin, Printer } from "lucide-react";
import { printOrderInvoice } from "@/lib/printUtils";
import { exportOrdersToCSV, exportOrdersToPDF, exportOrdersToXLSX } from "@/utils/exportOrders";
import EditOrderItemsDialog from "@/components/orders/EditOrderItemsDialog";
import SwapOfferDialog from "@/components/orders/SwapOfferDialog";
import AddOfferDialog from "@/components/orders/AddOfferDialog";
import DiscrepancyBanner from "@/components/orders/DiscrepancyBanner";
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
  items: OrderItem[];
}

// Sales manager who must approve private-delivery-rep edits (م. آلاء حامد)
const SALES_MANAGER_ID = '77b71c5f-cfa8-42bc-85de-ae536a3ec1c1';

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

  if (!suffix) return qtyStr || String(q);
  return qtyStr ? `${qtyStr} ${suffix}` : suffix;
};

const Orders = () => {
  const { user, isShippingCompany, isAccountant, isSalesModerator, isPrivateDeliveryRep, canUpdateOrderStatusForOrder, canDeleteOrders, canEditOrderItems } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
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
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [swapOfferOrder, setSwapOfferOrder] = useState<Order | null>(null);
  const [addOfferOrder, setAddOfferOrder] = useState<Order | null>(null);

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
      created_by_name: order.moderator_name,
    });
  };
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterModerator, setFilterModerator] = useState<string>("all");
  const [filterProduct, setFilterProduct] = useState<string>("all");
  const [filterGovernorate, setFilterGovernorate] = useState<string>("all");
  const [availableProducts, setAvailableProducts] = useState<string[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const yearParam = searchParams.get("year");
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
  const [searchQuery, setSearchQuery] = useState("");
  const now = new Date();
  const [filterMonth, setFilterMonth] = useState<string>(String(now.getUTCMonth() + 1));
  const [filterYear, setFilterYear] = useState<string>(String(now.getUTCFullYear()));
  const [collectionMismatch, setCollectionMismatch] = useState<{
    orderId: string;
    orderNumber: string;
    deliveredTotal: number;
    currentTotal: number;
  } | null>(null);

  useEffect(() => {
    fetchOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterMonth, filterYear, yearGroup]);

  const fetchOrders = async () => {
    setLoading(true);
    try {
      // حساب نطاق التواريخ على الخادم لتقليل البيانات (افتراضياً الشهر/السنة الحاليان)
      let startDate: string | null = null;
      let endDate: string | null = null;
      if (filterYear !== 'all') {
        const y = Number(filterYear);
        if (filterMonth !== 'all') {
          const m = Number(filterMonth);
          startDate = new Date(Date.UTC(y, m - 1, 1)).toISOString();
          endDate = new Date(Date.UTC(y, m, 1)).toISOString();
        } else {
          startDate = new Date(Date.UTC(y, 0, 1)).toISOString();
          endDate = new Date(Date.UTC(y + 1, 0, 1)).toISOString();
        }
      } else if (yearGroup === '2026') {
        startDate = new Date(Date.UTC(2026, 0, 1)).toISOString();
      } else if (yearGroup === 'pre2026') {
        endDate = new Date(Date.UTC(2026, 0, 1)).toISOString();
      }

      let ordersData: any[] = [];
      const ORDERS_PAGE = 1000;
      let oPage = 0;
      while (true) {
        let q = supabase
          .from('orders')
          .select(`*, customers (name, phone, governorate)`)
          .order('created_at', { ascending: false })
          .range(oPage * ORDERS_PAGE, (oPage + 1) * ORDERS_PAGE - 1);
        if (startDate) q = q.gte('created_at', startDate);
        if (endDate) q = q.lt('created_at', endDate);
        const { data, error: ordersError } = await q;
        if (ordersError) throw ordersError;
        if (!data || data.length === 0) break;
        ordersData = ordersData.concat(data);
        if (data.length < ORDERS_PAGE) break;
        oPage++;
      }

      const orderIds = (ordersData || []).map((o: any) => o.id);
      let itemsData: any[] = [];
      // جلب الأصناف على دفعات من 300 طلب مع ترقيم داخلي بـ1000 صف لتجاوز الحد الافتراضي
      const PAGE = 1000;
      for (let i = 0; i < orderIds.length; i += 300) {
        const slice = orderIds.slice(i, i + 300);
        let from = 0;
        // نكرر حتى نستنفذ كل أصناف هذه الدفعة
        // (الحد الأقصى الافتراضي لكل استعلام في Supabase هو 1000)
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { data: chunk, error: itemsError } = await supabase
            .from('order_items')
            .select('*')
            .in('order_id', slice)
            .range(from, from + PAGE - 1);
          if (itemsError) throw itemsError;
          if (!chunk || chunk.length === 0) break;
          itemsData = itemsData.concat(chunk);
          if (chunk.length < PAGE) break;
          from += PAGE;
        }
      }

      const creatorIds = Array.from(
        new Set((ordersData || []).map((o: any) => o.created_by).filter(Boolean))
      );
      let profilesMap: Record<string, string> = {};
      if (creatorIds.length > 0) {
        const { data: profilesData } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', creatorIds as string[]);
        profilesMap = Object.fromEntries(
          (profilesData || []).map((p: any) => [p.id, p.full_name])
        );
      }

      const productIds = Array.from(
        new Set((itemsData || []).map((it: any) => it.product_id).filter(Boolean))
      );
      let productsMap: Record<string, string> = {};
      if (productIds.length > 0) {
        const { data: productsData } = await supabase
          .from('products')
          .select('id, unit')
          .in('id', productIds as string[]);
        productsMap = Object.fromEntries(
          (productsData || []).map((p: any) => [p.id, p.unit])
        );
      }

      const formattedOrders: Order[] = (ordersData || []).map(order => ({
        id: order.id,
        order_number: order.order_number,
        customer_id: order.customer_id,
        customer_name: order.customers?.name || 'عميل غير معروف',
        customer_phone: order.customers?.phone || '',
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
        items: (itemsData || [])
          .filter(item => item.order_id === order.id)
          .map(item => ({
            id: item.id,
            product_id: item.product_id ?? null,
            product_name: item.product_name,
            quantity: Number(item.quantity),
            unit_price: Number(item.unit_price),
            total_price: Number(item.total_price),
            unit: (item.product_id && productsMap[item.product_id]) || 'كجم',
            offer_name: (item as any).offer_name ?? null,
          })),
      }));

      setOrders(formattedOrders);

      // استخراج قائمة المنتجات الفريدة
      const productNames = Array.from(
        new Set(itemsData.map((it: any) => it.product_name).filter(Boolean))
      ).sort((a: string, b: string) => a.localeCompare(b, 'ar'));
      setAvailableProducts(productNames);
    } catch (error) {
      console.error('Error fetching orders:', error);
      toast.error('حدث خطأ أثناء جلب الطلبات');
    } finally {
      setLoading(false);
    }
  };

  const filteredOrders = orders.filter((order) => {
    const matchesStatus =
      filterStatus === "all" || order.status === filterStatus;
    const q = searchQuery.trim().toLowerCase();
    const normalizedPhoneQuery = q.replace(/[^\d]/g, "");
    const normalizedOrderPhone = (order.customer_phone || "").replace(/[^\d]/g, "");
    const matchesSearch =
      !q ||
      order.order_number.toLowerCase().includes(q) ||
      order.customer_name.toLowerCase().includes(q) ||
      (normalizedPhoneQuery.length > 0 && normalizedOrderPhone.includes(normalizedPhoneQuery));
    const d = new Date(order.created_at);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    const matchesYearGroup =
      yearGroup === "all" ||
      (yearGroup === "2026" && year >= 2026) ||
      (yearGroup === "pre2026" && year < 2026);
    const matchesMonth = filterMonth === "all" || String(month) === filterMonth;
    const matchesYear = filterYear === "all" || String(year) === filterYear;
    const matchesProduct =
      filterProduct === "all" ||
      order.items.some((it) => it.product_name === filterProduct);
    const matchesModerator =
      filterModerator === "all" ||
      order.moderator_name === filterModerator;
    const matchesGovernorate =
      filterGovernorate === "all" ||
      (order.governorate || "").trim() === filterGovernorate;
    return matchesStatus && matchesSearch && matchesYearGroup && matchesMonth && matchesYear && matchesProduct && matchesModerator && matchesGovernorate;
  });

  const availableGovernorates = Array.from(
    new Set(orders.map(o => (o.governorate || "").trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, 'ar'));

  const availableYears = Array.from(
    new Set([
      now.getFullYear(),
      ...orders.map((o) => new Date(o.created_at).getUTCFullYear()),
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
      const cutoff = new Date(Date.UTC(2026, 0, 1)).toISOString();
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
    return true;
  };


  const handleStatusChange = async (orderId: string, newStatus: OrderStatus) => {
    try {
      const { error } = await supabase
        .from('orders')
        .update({ status: newStatus })
        .eq('id', orderId);

      if (error) throw error;

      setOrders(
        orders.map((order) => {
          if (order.id !== orderId) return order;
          let delivered_at = order.delivered_at;
          if (newStatus === 'delivered' && !delivered_at) delivered_at = new Date().toISOString();
          else if (newStatus !== 'delivered' && order.status === 'delivered') delivered_at = null;
          return { ...order, status: newStatus, delivered_at };
        })
      );
      toast.success(`تم تحديث حالة الطلب إلى "${statusLabels[newStatus]}"`);
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
          <CardTitle className="flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-primary" />
            قائمة الطلبات ({filteredOrders.length})
          </CardTitle>
          <div className="flex flex-wrap items-center gap-3">
            <Input
              placeholder="بحث برقم الطلب أو اسم العميل أو رقم الهاتف..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-64 input-modern"
            />
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
            {!isPrivateDeliveryRep && (
              <Select value={filterModerator} onValueChange={setFilterModerator}>
                <SelectTrigger className="w-40 input-modern">
                  <SelectValue placeholder="فلترة حسب المسوقة" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">جميع المسوقات</SelectItem>
                  <SelectItem value="أية">آية</SelectItem>
                  <SelectItem value="نورا">نورا</SelectItem>
                  <SelectItem value="سارة">سارة</SelectItem>
                  <SelectItem value="منال">منال</SelectItem>
                </SelectContent>
              </Select>
            )}
            <Button variant="outline" className="gap-2" onClick={() => exportOrdersToXLSX(filteredOrders)}>
              <FileDown className="w-4 h-4" /> Excel
            </Button>
            <Button variant="outline" className="gap-2" onClick={() => exportOrdersToCSV(filteredOrders)}>
              <FileDown className="w-4 h-4" /> CSV
            </Button>
            <Button variant="outline" className="gap-2" onClick={() => exportOrdersToPDF(filteredOrders)}>
              <FileText className="w-4 h-4" /> PDF
            </Button>
            <Button asChild className="gap-2">
              <Link to="/orders/new">
                <Plus className="w-4 h-4" />
                طلب جديد
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
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

          {/* Mobile card view */}
          <div className="md:hidden space-y-3">
            {filteredOrders.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">لا توجد طلبات</div>
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
                return (
                  <div key={order.id} className="rounded-lg border bg-card p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-semibold text-sm">{order.order_number}</span>
                      <Badge className={`${statusColors[order.status]} flex items-center gap-1 text-xs`}>
                        {getStatusIcon(order.status)}
                        {statusLabels[order.status]}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="font-semibold truncate">{order.customer_name}</span>
                      <Badge variant="secondary" className="text-xs shrink-0">{order.moderator_name}</Badge>
                    </div>
                    <div className="text-sm text-foreground/90 break-words">
                      {itemLines.length === 0 ? '-' : (
                        <ul className="space-y-0.5 list-disc pr-4">
                          {shownLines.map((l, i) => <li key={i}>{l}</li>)}
                        </ul>
                      )}
                      {hasMore && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 mt-1 text-xs gap-1 text-primary hover:text-primary"
                          onClick={() => toggleExpanded(order.id)}
                        >
                          {isExpanded ? <><ChevronUp className="w-3 h-3" /> إخفاء التفاصيل</> : <><ChevronDown className="w-3 h-3" /> عرض كل المنتجات ({itemLines.length})</>}
                        </Button>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-1 border-t">
                      <span className="font-bold text-primary">{order.total.toLocaleString()} ج.م</span>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Badge variant="outline" className="text-xs">{paymentLabels[order.payment_method] || order.payment_method}</Badge>
                        <Badge className={`text-xs ${order.payment_status === 'paid' ? 'bg-success text-success-foreground' : order.payment_status === 'failed' ? 'bg-destructive text-destructive-foreground' : 'bg-warning text-warning-foreground'}`}>
                          {paymentStatusLabels[order.payment_status] || order.payment_status}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>{formatDate(order.created_at)} — {new Date(order.created_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</span>
                      <Badge className={`text-xs ${order.collection_status === 'collected' ? 'bg-success text-success-foreground' : 'bg-warning text-warning-foreground'}`}>
                        {order.collection_status === 'collected' ? 'تم التحصيل' : 'لم يتم التحصيل'}
                      </Badge>
                    </div>
                    {!isSalesModerator && (
                      <Select value={order.status} onValueChange={(v: OrderStatus) => handleStatusChange(order.id, v)}>
                        <SelectTrigger className="w-full h-9 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(statusLabels)
                            .filter(([value]) => {
                              if (isPrivateDeliveryRep) {
                                return value === order.status || value === 'delivered' || value === 'cancelled' || value === 'pending';
                              }
                              if (isShippingCompany) {
                                return value === order.status || value === 'delivered' || value === 'cancelled' || value === 'shipped' || value === 'pending';
                              }
                              return true;
                            })
                            .map(([value, label]) => (
                              <SelectItem key={value} value={value}>
                                {value === 'pending' && isPrivateDeliveryRep ? 'مؤجل' : label}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    )}
                    {isAccountant && (
                      <Select value={order.collection_status} onValueChange={(v) => handleCollectionChange(order.id, v)}>
                        <SelectTrigger className="w-full h-9 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="collected">تم التحصيل</SelectItem>
                          <SelectItem value="not_collected">لم يتم التحصيل</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                    {order.governorate && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="w-3 h-3" /> {order.governorate}
                      </div>
                    )}
                    <div className="flex items-center justify-end gap-1 pt-1">
                       <Button variant="ghost" size="icon" asChild className="h-8 w-8">
                         <Link to={`/orders/${order.id}`}><Eye className="w-4 h-4" /></Link>
                       </Button>
                       <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handlePrintOrder(order)} title="طباعة الطلب">
                         <Printer className="w-4 h-4 text-primary" />
                       </Button>
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
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setAddOfferOrder(order)} title="إضافة بوكس / عرض">
                          <PackagePlus className="w-4 h-4 text-primary" />
                        </Button>
                      )}
                      {order.status !== 'delivered' && order.status !== 'cancelled' && order.items.some((it) => it.offer_name) && !isPrivateDeliveryRep && (
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSwapOfferOrder(order)} title="استبدال العرض">
                          <PackageOpen className="w-4 h-4 text-primary" />
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
                );
              })
            )}
          </div>

          {/* Desktop table view */}
          <div className="hidden md:block overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-green-100 hover:bg-green-100 dark:bg-green-800/40 dark:hover:bg-green-800/40 [&_th]:text-green-900 dark:[&_th]:text-green-100 [&_th]:font-semibold">
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
                <TableHead className="text-right">التاريخ</TableHead>
                <TableHead className="text-right">التوقيت</TableHead>
                <TableHead className="text-right">تاريخ التسليم</TableHead>
                <TableHead className="text-right">مدة التسليم</TableHead>
                <TableHead className="text-right">الإجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredOrders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={16} className="text-center py-8 text-muted-foreground">
                    لا توجد طلبات
                  </TableCell>
                </TableRow>
              ) : (
                filteredOrders.map((order) => (
                  <TableRow key={order.id} className="table-row-hover">
                    <TableCell className="font-mono font-semibold">
                      {order.order_number}
                    </TableCell>
                    <TableCell>{order.customer_name}</TableCell>
                    <TableCell className="font-mono text-sm" dir="ltr">
                      {order.customer_phone ? (
                        <a href={`tel:${order.customer_phone}`} className="hover:underline">{order.customer_phone}</a>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{order.moderator_name}</Badge>
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
                              .filter(([value]) => {
                                if (isPrivateDeliveryRep) {
                                  return value === order.status || value === 'delivered' || value === 'cancelled' || value === 'pending';
                                }
                                if (isShippingCompany) {
                                  return value === order.status || value === 'delivered' || value === 'cancelled' || value === 'shipped' || value === 'pending';
                                }
                                return true;
                              })
                              .map(([value, label]) => (
                                <SelectItem key={value} value={value}>
                                  {value === 'pending' && isPrivateDeliveryRep ? 'مؤجل' : label}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      )}
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
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>تفاصيل الطلب {selectedOrder?.order_number}</DialogTitle>
          </DialogHeader>
          {selectedOrder && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">العميل</p>
                  <p className="font-semibold">{selectedOrder.customer_name}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">التاريخ</p>
                  <p className="font-semibold">
                    {formatDate(selectedOrder.created_at)}
                  </p>
                </div>
                <div className="col-span-2">
                  <p className="text-sm text-muted-foreground">عنوان التوصيل</p>
                  <p className="font-semibold">{selectedOrder.delivery_address || 'غير محدد'}</p>
                </div>
              </div>

              <div>
                <p className="text-sm text-muted-foreground mb-3">المنتجات</p>
                <div className="space-y-2">
                  {selectedOrder.items.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                    >
                      <div>
                        <p className="font-medium">{item.product_name}</p>
                        <p className="text-sm text-muted-foreground">
                          {item.unit_price.toLocaleString()} ج.م × {item.quantity}
                        </p>
                      </div>
                      <p className="font-bold">
                        {item.total_price.toLocaleString()} ج.م
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2 border-t pt-4">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground flex items-center gap-1">
                    المجموع الفرعي
                    <span
                      title="قيمة المنتجات فقط (subtotal) — كما في عمود «قيمة الاوردر بدون شحن» في ملف Excel. لا يشمل رسوم التوصيل إلا للعروض."
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
                  <span className="text-lg font-semibold">الإجمالي</span>
                  <span className="text-2xl font-bold text-primary">
                    {selectedOrder.total.toLocaleString()} ج.م
                  </span>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

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
          }))}
          initialDiscount={editingOrder.discount}
          initialDeliveryFee={editingOrder.delivery_fee}
          onSaved={() => {
            setEditingOrder(null);
            fetchOrders();
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
    </DashboardLayout>
  );
};

export default Orders;
