import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowRight,
  Package,
  User,
  MapPin,
  Calendar,
  CreditCard,
  Truck,
  CheckCircle,
  XCircle,
  Clock,
  ShoppingCart,
  FileText,
  Pencil,
  Printer,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { printOrderInvoice } from "@/lib/printUtils";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import EditOrderItemsDialog from "@/components/orders/EditOrderItemsDialog";
import SwapOfferDialog from "@/components/orders/SwapOfferDialog";

type OrderStatus = 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
type PaymentStatus = 'pending' | 'paid' | 'failed';

interface OrderItem {
  id: string;
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  is_half_kg?: boolean;
  product_unit?: string | null;
  production_status?: 'pending' | 'in_progress' | 'completed';
  offer_name?: string | null;
}

const productionStatusLabels: Record<string, string> = {
  pending: 'بانتظار التصنيع',
  in_progress: 'جارٍ التصنيع',
  completed: 'مكتمل',
};
const productionStatusColors: Record<string, string> = {
  pending: 'bg-warning/15 text-warning border-warning/30',
  in_progress: 'bg-primary/15 text-primary border-primary/30',
  completed: 'bg-success/15 text-success border-success/30',
};

const isKgUnit = (unit?: string | null) => {
  const u = (unit || '').trim().toLowerCase().replace(/\s+/g, '');
  return /^(كجم|كيلو|كيلوجرام|كيلوغرام|كغم|كغ|kg|kgs|kilogram|kilogramme|kilo)$/i.test(u);
};
const itemKg = (it: { is_half_kg?: boolean; quantity: number; product_unit?: string | null }) => {
  if (it.is_half_kg) return it.quantity / 2;
  if (isKgUnit(it.product_unit)) return it.quantity;
  return null;
};

interface Order {
  id: string;
  order_number: string;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string;
  status: OrderStatus;
  payment_method: string;
  payment_status: PaymentStatus;
  subtotal: number;
  discount: number;
  delivery_fee: number;
  total: number;
  notes: string | null;
  delivery_address: string | null;
  created_at: string;
  created_by: string | null;
  created_by_name: string | null;
  source_warehouse_name: string | null;
  items: OrderItem[];
}

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
  cancelled: "ملغي",
};

const paymentLabels: Record<string, string> = {
  cash: "نقدي (عند الاستلام)",
  online: "إلكتروني",
};

const paymentStatusColors: Record<PaymentStatus, string> = {
  pending: "bg-warning text-warning-foreground",
  paid: "bg-success text-success-foreground",
  failed: "bg-destructive text-destructive-foreground",
};

const paymentStatusLabels: Record<PaymentStatus, string> = {
  pending: "قيد الانتظار",
  paid: "مدفوع",
  failed: "فشل الدفع",
};

const getStatusIcon = (status: OrderStatus) => {
  switch (status) {
    case "pending":
      return <Clock className="w-4 h-4" />;
    case "processing":
      return <Package className="w-4 h-4" />;
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

const OrderDetails = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { role, canUpdateOrderStatusForOrder, canUpdatePaymentStatus, isGeneralManager, isExecutiveManager, isSalesManager, isShippingCompany, isSalesModerator, canManageStock } = useAuth();
  const isMarketingSalesManager = role === 'marketing_sales_manager';
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [editItemsOpen, setEditItemsOpen] = useState(false);
  const [swapOfferOpen, setSwapOfferOpen] = useState(false);
  const [editCustomerOpen, setEditCustomerOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [savingCustomer, setSavingCustomer] = useState(false);
  // Moderators (and shipping) can't edit orders that are already delivered or cancelled/returned
  const isLockedForModerators = order ? (order.status === 'delivered' || order.status === 'cancelled') : false;
  const canEditItems = (isGeneralManager || isExecutiveManager || isSalesManager || isMarketingSalesManager)
    || ((isShippingCompany || isSalesModerator) && !isLockedForModerators);
  // Swap-offer button: customers often change the chosen offer after registration,
  // so the 4 sales moderators and the marketing manager can swap only on non-delivered, non-cancelled orders.
  const canSwapOffer = (isGeneralManager || isExecutiveManager || isSalesManager || isMarketingSalesManager || isSalesModerator)
    && order?.status !== 'delivered' && order?.status !== 'cancelled';
  const canEditCustomerInfo = (isGeneralManager || isExecutiveManager || isSalesManager || isMarketingSalesManager)
    || (isSalesModerator && !isLockedForModerators);

  const openEditCustomer = () => {
    if (!order) return;
    setEditName(order.customer_name || "");
    setEditPhone(order.customer_phone || "");
    setEditAddress(order.delivery_address || "");
    setEditCustomerOpen(true);
  };

  const saveCustomerInfo = async () => {
    if (!order) return;
    setSavingCustomer(true);
    try {
      if (order.customer_id) {
        const { error: cErr } = await supabase
          .from('customers')
          .update({ name: editName.trim(), phone: editPhone.trim() })
          .eq('id', order.customer_id);
        if (cErr) throw cErr;
      }
      const { error: oErr } = await supabase
        .from('orders')
        .update({ delivery_address: editAddress.trim() || null })
        .eq('id', order.id);
      if (oErr) throw oErr;
      toast.success('تم تحديث بيانات العميل');
      setEditCustomerOpen(false);
      fetchOrder(order.id);
    } catch (e: any) {
      toast.error(e.message || 'فشل تحديث البيانات');
    } finally {
      setSavingCustomer(false);
    }
  };

  useEffect(() => {
    if (id) {
      fetchOrder(id);
    }
  }, [id]);

  const fetchOrder = async (orderId: string) => {
    try {
      const { data: orderData, error: orderError } = await supabase
        .from('orders')
        .select(`
          *,
          customers (name, phone)
        `)
        .eq('id', orderId)
        .maybeSingle();

      if (orderError) throw orderError;
      if (!orderData) {
        toast.error('الطلب غير موجود');
        navigate('/orders');
        return;
      }

      const { data: itemsData, error: itemsError } = await supabase
        .from('order_items')
        .select('*')
        .eq('order_id', orderId);

      if (itemsError) throw itemsError;

      // Fetch product units for kg detection
      const productIds = Array.from(new Set((itemsData || []).map((i: any) => i.product_id).filter(Boolean)));
      const unitMap = new Map<string, string>();
      if (productIds.length) {
        const { data: prodData } = await supabase
          .from('products')
          .select('id, unit')
          .in('id', productIds as string[]);
        (prodData || []).forEach((p: any) => unitMap.set(p.id, p.unit));
      }

      // Fetch creator's name if created_by exists
      let createdByName: string | null = null;
      if (orderData.created_by) {
        const { data: profileData } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', orderData.created_by)
          .maybeSingle();
        createdByName = profileData?.full_name || null;
      }

      // Fetch source warehouse name if any
      let sourceWarehouseName: string | null = null;
      if ((orderData as any).source_warehouse_id) {
        const { data: whData } = await supabase
          .from('warehouses')
          .select('name')
          .eq('id', (orderData as any).source_warehouse_id)
          .maybeSingle();
        sourceWarehouseName = whData?.name || null;
      }

      const formattedOrder: Order = {
        id: orderData.id,
        order_number: orderData.order_number,
        customer_id: orderData.customer_id,
        customer_name: orderData.customers?.name || 'عميل غير معروف',
        customer_phone: orderData.customers?.phone || '',
        status: orderData.status as OrderStatus,
        payment_method: orderData.payment_method,
        payment_status: orderData.payment_status as PaymentStatus,
        subtotal: Number(orderData.subtotal),
        discount: Number(orderData.discount),
        delivery_fee: Number(orderData.delivery_fee),
        total: Number(orderData.total),
        notes: orderData.notes,
        delivery_address: orderData.delivery_address,
        created_at: orderData.created_at,
        created_by: orderData.created_by,
        created_by_name: createdByName,
        source_warehouse_name: sourceWarehouseName,
        items: (itemsData || []).map((item: any) => ({
          id: item.id,
          product_id: item.product_id ?? null,
          product_name: item.product_name,
          quantity: Number(item.quantity),
          unit_price: Number(item.unit_price),
          total_price: Number(item.total_price),
          is_half_kg: !!item.is_half_kg,
          product_unit: item.product_id ? unitMap.get(item.product_id) ?? null : null,
          production_status: (item.production_status || 'pending') as 'pending' | 'in_progress' | 'completed',
          offer_name: item.offer_name ?? null,
        })),
      };

      setOrder(formattedOrder);
    } catch (error) {
      console.error('Error fetching order:', error);
      toast.error('حدث خطأ أثناء جلب بيانات الطلب');
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (newStatus: OrderStatus) => {
    if (!order || !canUpdateOrderStatusForOrder(order.created_by)) return;
    
    setUpdating(true);
    try {
      const { error } = await supabase
        .from('orders')
        .update({ status: newStatus })
        .eq('id', order.id);

      if (error) throw error;

      setOrder({ ...order, status: newStatus });
      toast.success(`تم تحديث حالة الطلب إلى "${statusLabels[newStatus]}"`);
    } catch (error) {
      console.error('Error updating order status:', error);
      toast.error('حدث خطأ أثناء تحديث حالة الطلب');
    } finally {
      setUpdating(false);
    }
  };

  const handlePaymentStatusChange = async (newStatus: PaymentStatus) => {
    if (!order || !canUpdatePaymentStatus) return;
    
    setUpdating(true);
    try {
      const { error } = await supabase
        .from('orders')
        .update({ payment_status: newStatus })
        .eq('id', order.id);

      if (error) throw error;

      setOrder({ ...order, payment_status: newStatus });
      toast.success(`تم تحديث حالة الدفع إلى "${paymentStatusLabels[newStatus]}"`);
    } catch (error) {
      console.error('Error updating payment status:', error);
      toast.error('حدث خطأ أثناء تحديث حالة الدفع');
    } finally {
      setUpdating(false);
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

  if (!order) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <p className="text-muted-foreground">الطلب غير موجود</p>
          <Button asChild>
            <Link to="/orders">العودة للطلبات</Link>
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" asChild>
              <Link to="/orders">
                <ArrowRight className="w-5 h-5" />
              </Link>
            </Button>
            <Header 
              title={`طلب ${order.order_number}`} 
              subtitle={`تم الإنشاء في ${new Date(order.created_at).toLocaleDateString('en-GB', { 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })}`} 
            />
          </div>
          <div className="flex items-center gap-2">
            <Badge className={`${statusColors[order.status]} flex items-center gap-1 text-sm px-3 py-1`}>
              {getStatusIcon(order.status)}
              {statusLabels[order.status]}
            </Badge>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Products Card */}
            <Card className="glass-card">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Package className="w-5 h-5 text-primary" />
                    المنتجات ({order.items.length})
                  </CardTitle>
                  {((canEditItems && order.status !== 'cancelled') || canSwapOffer) && (
                    <div className="flex flex-wrap gap-2">
                      {canSwapOffer && order.items.some((it) => it.offer_name) && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSwapOfferOpen(true)}
                          className="gap-1"
                        >
                          <Package className="w-4 h-4" />
                          استبدال العرض
                        </Button>
                      )}
                      {canEditItems && order.status !== 'cancelled' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditItemsOpen(true)}
                          className="gap-1"
                        >
                          <Pencil className="w-4 h-4" />
                          تعديل المنتجات
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {order.items.map((item) => {
                    const kg = itemKg(item);
                    return (
                    <div
                      key={item.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-lg bg-muted/50 hover:bg-muted/70 transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                          <ShoppingCart className="w-6 h-6 text-primary" />
                        </div>
                        <div>
                          <p className="font-semibold">
                            {item.product_name}
                            {item.is_half_kg && (
                              <span className="mr-2 text-xs px-2 py-0.5 rounded bg-secondary text-secondary-foreground">نصف كيلو</span>
                            )}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {item.unit_price.toLocaleString()} ج.م × {item.quantity}
                            {kg !== null && (
                              <span className="mr-2 text-primary font-medium">= {kg} كجم</span>
                            )}
                          </p>
                          <div className="mt-2 flex items-center gap-2">
                            {canManageStock ? (
                              <select
                                className={`text-xs px-2 py-1 rounded-md border ${productionStatusColors[item.production_status || 'pending']}`}
                                value={item.production_status || 'pending'}
                                onChange={async (e) => {
                                  const newStatus = e.target.value as 'pending' | 'in_progress' | 'completed';
                                  const { error } = await supabase
                                    .from('order_items')
                                    .update({ production_status: newStatus })
                                    .eq('id', item.id);
                                  if (error) { toast.error('تعذر تحديث حالة التصنيع'); return; }
                                  setOrder(prev => prev ? { ...prev, items: prev.items.map(i => i.id === item.id ? { ...i, production_status: newStatus } : i) } : prev);
                                  toast.success('تم تحديث حالة التصنيع');
                                }}
                              >
                                <option value="pending">بانتظار التصنيع</option>
                                <option value="in_progress">جارٍ التصنيع</option>
                                <option value="completed">مكتمل</option>
                              </select>
                            ) : (
                              <span className={`text-xs px-2 py-1 rounded-md border ${productionStatusColors[item.production_status || 'pending']}`}>
                                {productionStatusLabels[item.production_status || 'pending']}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <p className="font-bold text-lg">
                        {item.total_price.toLocaleString()} ج.م
                      </p>
                    </div>
                    );
                  })}
                </div>

                <Separator className="my-4" />

                {/* Order Summary */}
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">المجموع الفرعي</span>
                    <span>{order.subtotal.toLocaleString()} ج.م</span>
                  </div>
                  {(() => {
                    const totalKg = order.items.reduce((s, it) => s + (itemKg(it) ?? 0), 0);
                    return totalKg > 0 ? (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">إجمالي الوزن</span>
                        <span className="font-medium text-primary">{totalKg.toLocaleString()} كجم</span>
                      </div>
                    ) : null;
                  })()}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">رسوم التوصيل</span>
                    <span>{order.delivery_fee.toLocaleString()} ج.م</span>
                  </div>
                  {order.discount > 0 && (
                    <div className="flex justify-between text-success">
                      <span>الخصم</span>
                      <span>- {order.discount.toLocaleString()} ج.م</span>
                    </div>
                  )}
                  <Separator />
                  <div className="flex items-center justify-between pt-2">
                    <span className="text-lg font-semibold">الإجمالي</span>
                    <span className="text-2xl font-bold text-primary">
                      {order.total.toLocaleString()} ج.م
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Notes Card */}
            {order.notes && (
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-primary" />
                    ملاحظات
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground whitespace-pre-wrap">{order.notes}</p>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Customer Info */}
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <User className="w-5 h-5 text-primary" />
                    معلومات العميل
                  </span>
                  {canEditCustomerInfo && (
                    <Button size="sm" variant="ghost" onClick={openEditCustomer} className="gap-1">
                      <Pencil className="w-4 h-4" /> تعديل
                    </Button>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-sm text-muted-foreground">الاسم</p>
                  <p className="font-semibold">{order.customer_name}</p>
                </div>
                {order.customer_phone && (
                  <div>
                    <p className="text-sm text-muted-foreground">رقم الهاتف</p>
                    <p className="font-semibold" dir="ltr">{order.customer_phone}</p>
                  </div>
                )}
                {order.delivery_address && (
                  <div>
                    <p className="text-sm text-muted-foreground flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      عنوان التوصيل
                    </p>
                    <p className="font-semibold">{order.delivery_address}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Order Status */}
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Truck className="w-5 h-5 text-primary" />
                  حالة الطلب
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {canUpdateOrderStatusForOrder(order.created_by) ? (
                  <Select
                    value={order.status}
                    onValueChange={(value: OrderStatus) => handleStatusChange(value)}
                    disabled={updating}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(statusLabels).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          <div className="flex items-center gap-2">
                            {getStatusIcon(value as OrderStatus)}
                            {label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Badge className={`${statusColors[order.status]} flex items-center gap-1 w-full justify-center py-2`}>
                    {getStatusIcon(order.status)}
                    {statusLabels[order.status]}
                  </Badge>
                )}
              </CardContent>
            </Card>

            {/* Payment Info */}
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CreditCard className="w-5 h-5 text-primary" />
                  معلومات الدفع
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-sm text-muted-foreground">طريقة الدفع</p>
                  <p className="font-semibold">
                    {paymentLabels[order.payment_method] || order.payment_method}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-2">حالة الدفع</p>
                  {canUpdatePaymentStatus ? (
                    <Select
                      value={order.payment_status}
                      onValueChange={(value: PaymentStatus) => handlePaymentStatusChange(value)}
                      disabled={updating}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(paymentStatusLabels).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge className={`${paymentStatusColors[order.payment_status]} w-full justify-center py-2`}>
                      {paymentStatusLabels[order.payment_status]}
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Order Creator */}
            {order.created_by_name && (
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <User className="w-5 h-5 text-primary" />
                    منشئ الطلب
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="font-semibold">{order.created_by_name}</p>
                </CardContent>
              </Card>
            )}

            {/* Order Date */}
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-primary" />
                  تاريخ الطلب
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="font-semibold">
                  {new Date(order.created_at).toLocaleDateString('en-GB', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </p>
                <p className="text-sm text-muted-foreground">
                  {new Date(order.created_at).toLocaleTimeString('ar-EG', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {order && (
        <EditOrderItemsDialog
          open={editItemsOpen}
          onOpenChange={setEditItemsOpen}
          orderId={order.id}
          initialItems={order.items.map(it => ({
            id: it.id,
            product_id: it.product_id,
            product_name: it.product_name,
            quantity: it.quantity,
            unit_price: it.unit_price,
            offer_name: it.offer_name ?? null,
          }))}
          initialDiscount={order.discount}
          initialDeliveryFee={order.delivery_fee}
          onSaved={() => id && fetchOrder(id)}
        />
      )}

      {order && (
        <SwapOfferDialog
          open={swapOfferOpen}
          onOpenChange={setSwapOfferOpen}
          orderId={order.id}
          currentItems={order.items.map((it) => ({
            id: it.id,
            product_name: it.product_name,
            quantity: it.quantity,
            unit_price: it.unit_price,
            total_price: it.total_price,
            offer_name: it.offer_name ?? null,
          }))}
          onSaved={() => id && fetchOrder(id)}
        />
      )}

      <Dialog open={editCustomerOpen} onOpenChange={setEditCustomerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تعديل بيانات العميل</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>اسم العميل</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} disabled={!order?.customer_id} />
              {!order?.customer_id && (
                <p className="text-xs text-muted-foreground mt-1">لا يوجد عميل مرتبط بهذا الطلب</p>
              )}
            </div>
            <div>
              <Label>رقم الهاتف</Label>
              <Input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} dir="ltr" disabled={!order?.customer_id} />
            </div>
            <div>
              <Label>عنوان التوصيل</Label>
              <Textarea value={editAddress} onChange={(e) => setEditAddress(e.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditCustomerOpen(false)}>إلغاء</Button>
            <Button onClick={saveCustomerInfo} disabled={savingCustomer}>
              {savingCustomer ? 'جارِ الحفظ...' : 'حفظ'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default OrderDetails;
