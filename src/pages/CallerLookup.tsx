import { FormEvent, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Phone, Search, UserRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { normalizePhone } from "@/lib/normalizePhone";
import { formatDateTime } from "@/lib/dateFormat";

const statusLabels: Record<string, string> = {
  pending: "قيد الانتظار",
  processing: "جاري التجهيز",
  shipped: "تم الشحن",
  delivered: "تم التوصيل",
  cancelled: "مرتجع",
  canceled: "مرتجع",
  void: "ملغي",
  rejected: "مرفوض",
};

const statusColors: Record<string, string> = {
  pending: "bg-warning text-warning-foreground",
  processing: "bg-primary text-primary-foreground",
  shipped: "bg-chart-4 text-primary-foreground",
  delivered: "bg-success text-success-foreground",
  cancelled: "bg-destructive text-destructive-foreground",
};

type LookupOrder = {
  created_at: string;
  status: string;
  total: number;
};

type LookupOrderBrief = {
  order_number: string;
  created_at: string;
  total: number;
  status: string;
};

type LookupProduct = {
  name: string;
  qty: number;
};

type LookupCustomer = {
  id: string;
  name: string;
  area: string | null;
  governorate: string | null;
  last_contact: string | null;
};

type LookupResult = {
  match: "customer" | "new" | "none" | "invalid";
  customer: LookupCustomer | null;
  orders: LookupOrder[];
  total_spent: number;
  orders_count: number;
  last_order: LookupOrderBrief | null;
  open_order: LookupOrderBrief | null;
  address: string | null;
  governorate: string | null;
  moderator: string | null;
  top_products: LookupProduct[];
};

const emptySummary = () => ({
  total_spent: 0,
  orders_count: 0,
  last_order: null,
  open_order: null,
  address: null,
  governorate: null,
  moderator: null,
  top_products: [] as LookupProduct[],
});

const emptyResult = (match: LookupResult["match"]): LookupResult => ({
  match,
  customer: null,
  orders: [],
  ...emptySummary(),
});

const readSummary = (payload: Partial<LookupResult>) => ({
  total_spent: Number(payload.total_spent ?? 0),
  orders_count: Number(payload.orders_count ?? 0),
  last_order: payload.last_order ?? null,
  open_order: payload.open_order ?? null,
  address: payload.address?.trim() ? payload.address : null,
  governorate: payload.governorate?.trim() ? payload.governorate : null,
  moderator: payload.moderator?.trim() ? payload.moderator : null,
  top_products: Array.isArray(payload.top_products) ? payload.top_products : [],
});

const formatAmount = (value: number) =>
  `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ج.م`;

const areaLabel = (customer: LookupCustomer) =>
  customer.area?.trim() || customer.governorate?.trim() || "غير محددة";

// Hotline calls arrive as the Cairo area code 02 in front of the full mobile
// (0201xxxxxxxxx), and +20 2 01xxxxxxxxx normalizes to 201xxxxxxxxx.
// Drop that extra prefix for the local check only; lookup_caller_by_phone
// does the same on the server. A real landline (02 + 8 digits) stays invalid.
const stripHotlinePrefix = (value: string) => {
  if (/^0201\d{9}$/.test(value)) return value.slice(2);
  if (/^201\d{9}$/.test(value)) return value.slice(1);
  return value;
};

const CallerLookup = () => {
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [error, setError] = useState("");

  const search = async (event?: FormEvent) => {
    event?.preventDefault();
    setError("");
    setResult(null);

    const normalized = stripHotlinePrefix(normalizePhone(phone));
    if (!/^01\d{9}$/.test(normalized)) {
      setResult(emptyResult("invalid"));
      return;
    }

    setLoading(true);
    const { data, error: rpcError } = await (supabase as any).rpc("lookup_caller_by_phone", {
      p_phone: phone,
    });
    setLoading(false);

    if (rpcError) {
      setError("لا يمكنك عرض بيانات العملاء");
      return;
    }

    const payload = (data || {}) as Partial<LookupResult>;
    const match = payload.match;
    if (match !== "customer" && match !== "new" && match !== "none" && match !== "invalid") {
      setError("لا يمكنك عرض بيانات العملاء");
      return;
    }

    setResult({
      match,
      customer: match === "customer" ? payload.customer ?? null : null,
      orders: match === "customer" && Array.isArray(payload.orders) ? payload.orders : [],
      ...(match === "customer" ? readSummary(payload) : emptySummary()),
    });
  };

  const orderBrief = (order: LookupOrderBrief) => (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2">
      <span className="text-sm font-medium" dir="ltr">{order.order_number}</span>
      <span className="text-sm">{formatDateTime(order.created_at)}</span>
      <Badge className={statusColors[order.status] || ""}>
        {statusLabels[order.status] || order.status}
      </Badge>
      <span className="text-sm font-bold">{formatAmount(order.total)}</span>
    </div>
  );

  const customer = result?.match === "customer" ? result.customer : null;

  return (
    <DashboardLayout>
      <Header title="استعلام عن متصل" subtitle="ابحث برقم الموبايل قبل الرد على المكالمة" />

      <Card className="glass-card max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Phone className="w-5 h-5 text-primary" />
            رقم الموبايل
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={search} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="space-y-1 flex-1">
              <Label htmlFor="caller-phone">المصري 01 أو +20 أو 0020</Label>
              <Input
                id="caller-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="01xxxxxxxxx"
                inputMode="tel"
                dir="ltr"
                className="input-modern"
                autoComplete="off"
              />
            </div>
            <Button type="submit" className="btn-primary" disabled={loading}>
              <Search className="w-4 h-4 ml-2" />
              {loading ? "جاري البحث..." : "بحث"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {error && (
        <Card className="glass-card max-w-2xl mt-4">
          <CardContent className="py-6 text-destructive">{error}</CardContent>
        </Card>
      )}

      {result?.match === "invalid" && (
        <Card className="glass-card max-w-2xl mt-4">
          <CardContent className="py-6 text-muted-foreground">
            أدخل رقم موبايل مصري. المسافات والشرطات مقبولة.
          </CardContent>
        </Card>
      )}

      {result?.match === "new" && (
        <Card className="glass-card max-w-2xl mt-4">
          <CardContent className="py-8 text-center">
            <p className="text-xl font-bold">عميل جديد</p>
          </CardContent>
        </Card>
      )}

      {result?.match === "none" && (
        <Card className="glass-card max-w-2xl mt-4">
          <CardContent className="py-6 text-muted-foreground">لا يمكنك عرض بيانات العملاء</CardContent>
        </Card>
      )}

      {customer && (
        <Card className="glass-card max-w-2xl mt-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserRound className="w-5 h-5 text-primary" />
              {customer.name}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <span className="text-muted-foreground">المنطقة: </span>
                <span className="font-medium">{areaLabel(customer)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">المحافظة: </span>
                <span className="font-medium">{result?.governorate || customer.governorate?.trim() || "غير محددة"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">العنوان: </span>
                <span className="font-medium">{result?.address || "غير محدد"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">المودريتور: </span>
                <span className="font-medium">{result?.moderator || "غير محدد"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">إجمالي المشتريات: </span>
                <span className="font-medium">{formatAmount(result?.total_spent ?? 0)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">عدد الطلبات: </span>
                <span className="font-medium">{result?.orders_count ?? 0}</span>
              </div>
            </div>
            {customer.last_contact && (
              <div className="text-sm">
                <span className="text-muted-foreground">آخر تواصل: </span>
                <span className="font-medium">{formatDateTime(customer.last_contact)}</span>
              </div>
            )}
            <div>
              <p className="text-sm font-medium mb-2">آخر طلب</p>
              {result?.last_order ? orderBrief(result.last_order) : (
                <p className="text-sm text-muted-foreground">لا يوجد طلب</p>
              )}
            </div>
            <div>
              <p className="text-sm font-medium mb-2">طلب مفتوح</p>
              {result?.open_order ? orderBrief(result.open_order) : (
                <p className="text-sm text-muted-foreground">لا يوجد طلب مفتوح</p>
              )}
            </div>
            <div>
              <p className="text-sm font-medium mb-2">أكثر المنتجات</p>
              {(result?.top_products.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">لا توجد منتجات</p>
              ) : (
                <div className="space-y-2">
                  {(result?.top_products ?? []).map((product) => (
                    <div
                      key={product.name}
                      className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
                    >
                      <span className="text-sm">{product.name}</span>
                      <span className="text-sm font-bold">
                        {Number(product.qty || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <p className="text-sm font-medium mb-2">آخر الطلبات</p>
              {(result?.orders.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">لا توجد طلبات حديثة</p>
              ) : (
                <div className="space-y-2">
                  {(result?.orders ?? []).map((order, index) => (
                    <div
                      key={`${order.created_at}-${index}`}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2"
                    >
                      <span className="text-sm">{formatDateTime(order.created_at)}</span>
                      <Badge className={statusColors[order.status] || ""}>
                        {statusLabels[order.status] || order.status}
                      </Badge>
                      <span className="text-sm font-bold">{formatAmount(order.total)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </DashboardLayout>
  );
};

export default CallerLookup;
