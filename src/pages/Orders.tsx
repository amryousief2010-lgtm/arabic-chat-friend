import { useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import OrdersAnalytics from "@/components/dashboard/OrdersAnalytics";
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
import { ShoppingCart, Eye, Truck, CheckCircle, XCircle, Plus, Trash2 } from "lucide-react";
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

type YearGroup = "all" | "2026" | "pre2026";

type OrderStatus = 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled';

interface OrderItem {
  id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
}

interface Order {
  id: string;
  order_number: string;
  customer_id: string | null;
  customer_name: string;
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

const Orders = () => {
  const { isShippingCompany, isAccountant, canUpdateOrderStatusForOrder, canDeleteOrders } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("all");
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
  const [filterMonth, setFilterMonth] = useState<string>(String(now.getMonth() + 1));
  const [filterYear, setFilterYear] = useState<string>(String(now.getFullYear()));

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
          .select(`*, customers (name)`)
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

      const formattedOrders: Order[] = (ordersData || []).map(order => ({
        id: order.id,
        order_number: order.order_number,
        customer_id: order.customer_id,
        customer_name: order.customers?.name || 'عميل غير معروف',
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
        items: (itemsData || [])
          .filter(item => item.order_id === order.id)
          .map(item => ({
            id: item.id,
            product_name: item.product_name,
            quantity: Number(item.quantity),
            unit_price: Number(item.unit_price),
            total_price: Number(item.total_price),
          })),
      }));

      setOrders(formattedOrders);
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
    const matchesSearch =
      order.order_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
      order.customer_name.toLowerCase().includes(searchQuery.toLowerCase());
    const d = new Date(order.created_at);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const matchesYearGroup =
      yearGroup === "all" ||
      (yearGroup === "2026" && year >= 2026) ||
      (yearGroup === "pre2026" && year < 2026);
    const matchesMonth = filterMonth === "all" || String(month) === filterMonth;
    const matchesYear = filterYear === "all" || String(year) === filterYear;
    return matchesStatus && matchesSearch && matchesYearGroup && matchesMonth && matchesYear;
  });

  const availableYears = Array.from(
    new Set([
      now.getFullYear(),
      ...orders.map((o) => new Date(o.created_at).getFullYear()),
    ])
  ).sort((a, b) => b - a);

  const monthNames = [
    "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
    "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
  ];

  const [counts, setCounts] = useState({ all: 0, "2026": 0, pre2026: 0 });
  useEffect(() => {
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
  }, []);

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

  const handleCollectionChange = async (orderId: string, value: string) => {
    try {
      const { error } = await supabase
        .from('orders')
        .update({ collection_status: value } as any)
        .eq('id', orderId);
      if (error) throw error;
      setOrders(orders.map(o => o.id === orderId ? { ...o, collection_status: value } : o));
      toast.success(value === 'collected' ? 'تم تحديث حالة التحصيل: تم التحصيل' : 'تم تحديث حالة التحصيل: لم يتم التحصيل');
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
              placeholder="بحث برقم الطلب أو اسم العميل..."
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
            <Button asChild className="gap-2">
              <Link to="/orders/new">
                <Plus className="w-4 h-4" />
                طلب جديد
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">رقم الطلب</TableHead>
                <TableHead className="text-right">العميل</TableHead>
                <TableHead className="text-right">الموديريتور</TableHead>
                <TableHead className="text-right">المنتجات</TableHead>
                <TableHead className="text-right">الإجمالي</TableHead>
                <TableHead className="text-right">طريقة الدفع</TableHead>
                <TableHead className="text-right">حالة الدفع</TableHead>
                <TableHead className="text-right">الحالة</TableHead>
                <TableHead className="text-right">التحصيل</TableHead>
                <TableHead className="text-right">التاريخ</TableHead>
                <TableHead className="text-right">التوقيت</TableHead>
                <TableHead className="text-right">الإجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredOrders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={12} className="text-center py-8 text-muted-foreground">
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
                    <TableCell>
                      <Badge variant="secondary">{order.moderator_name}</Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-muted-foreground">
                        {order.items.length} منتج
                      </span>
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
                            .filter(([value]) =>
                              !isShippingCompany || value === order.status || value === "delivered" || value === "cancelled"
                            )
                            .map(([value, label]) => (
                              <SelectItem key={value} value={value}>
                                {label}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
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
                      {new Date(order.created_at).toLocaleDateString('ar-EG')}
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono">
                      {new Date(order.created_at).toLocaleTimeString('ar-EG', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
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
                    {new Date(selectedOrder.created_at).toLocaleDateString('ar-EG')}
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
                  <span className="text-muted-foreground">المجموع الفرعي</span>
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
    </DashboardLayout>
  );
};

export default Orders;
