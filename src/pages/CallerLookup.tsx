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
};

const emptyResult = (match: LookupResult["match"]): LookupResult => ({
  match,
  customer: null,
  orders: [],
});

const formatAmount = (value: number) =>
  `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ج.م`;

const areaLabel = (customer: LookupCustomer) =>
  customer.area?.trim() || customer.governorate?.trim() || "غير محددة";

const CallerLookup = () => {
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [error, setError] = useState("");

  const search = async (event?: FormEvent) => {
    event?.preventDefault();
    setError("");
    setResult(null);

    const normalized = normalizePhone(phone);
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
    });
  };

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
            <div className="text-sm">
              <span className="text-muted-foreground">المنطقة: </span>
              <span className="font-medium">{areaLabel(customer)}</span>
            </div>
            {customer.last_contact && (
              <div className="text-sm">
                <span className="text-muted-foreground">آخر تواصل: </span>
                <span className="font-medium">{formatDateTime(customer.last_contact)}</span>
              </div>
            )}
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
