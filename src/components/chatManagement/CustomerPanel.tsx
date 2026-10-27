import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

const db = supabase as any;
interface Customer { id: string; name: string | null; phone: string | null; phone2: string | null; city: string | null; governorate: string | null; total_orders: number | null }
interface Order { id: string; order_number: string | null; status: string | null; total: number | null; created_at: string }

/** بيانات العميل في coceg (قراءة فقط): بالعميل المربوط بالمحادثة، وإلا بالرقم المطبَّع. صلاحيات customers/orders الحالية كما هي. */
export default function CustomerPanel({ customerId, phoneNorm }: { customerId: string | null; phoneNorm: string | null }) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "none" | "ok">("idle");

  useEffect(() => {
    let live = true;
    (async () => {
      setCustomer(null); setOrders([]);
      if (!customerId && !phoneNorm) { setState("idle"); return; }
      setState("loading");
      let id = customerId;
      if (!id && phoneNorm) {
        const r = await db.rpc("cm_customer_for_phone", { _phone: phoneNorm });
        id = r.data ?? null;
      }
      if (!id) { if (live) setState("none"); return; }
      const [c, o] = await Promise.all([
        db.from("customers").select("id,name,phone,phone2,city,governorate,total_orders").eq("id", id).maybeSingle(),
        db.from("orders").select("id,order_number,status,total,created_at").eq("customer_id", id).order("created_at", { ascending: false }).limit(10),
      ]);
      if (!live) return;
      setCustomer(c.data ?? null); setOrders(o.data ?? []);
      setState(c.data ? "ok" : "none");
    })();
    return () => { live = false; };
  }, [customerId, phoneNorm]);

  return (
    <Card dir="rtl" data-testid="customer-panel">
      <CardHeader className="py-3"><CardTitle className="text-base">بيانات العميل <Badge variant="secondary">قراءة فقط</Badge></CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        {state === "idle" && <p className="text-muted-foreground">اختاري محادثة</p>}
        {state === "loading" && <p className="text-muted-foreground">جارٍ البحث…</p>}
        {state === "none" && <p className="text-muted-foreground">لا يوجد عميل مسجّل بهذا الرقم</p>}
        {customer && (
          <>
            <div className="font-semibold">{customer.name ?? "—"}</div>
            <div>{customer.phone}{customer.phone2 ? ` / ${customer.phone2}` : ""}</div>
            <div className="text-muted-foreground">{[customer.governorate, customer.city].filter(Boolean).join(" — ")}</div>
            <div>عدد الطلبات: {customer.total_orders ?? orders.length}</div>
            <div className="border-t pt-2 space-y-1">
              {orders.length === 0 && <p className="text-muted-foreground">لا توجد طلبات ظاهرة لكِ</p>}
              {orders.map((o) => (
                <div key={o.id} className="flex justify-between gap-2">
                  <span>#{o.order_number ?? o.id.slice(0, 8)}</span>
                  <span className="text-muted-foreground">{o.status}</span>
                  <span>{o.total ?? 0} ج</span>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
