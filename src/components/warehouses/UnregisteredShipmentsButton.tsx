import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Loader2, UserPlus, XCircle, RefreshCw, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

const AGOUZA_WAREHOUSE_ID = "a970d469-37df-40e1-b99f-a49195a3778e";

interface UnregShipment {
  id: string;
  bill_no: string;
  phone: string;
  customer_name: string;
  cod: number;
  shipment_date: string | null;
  raw_products: string | null;
  parsed_items: any[];
  unknown_tokens: any[];
  status: "pending" | "registered" | "dismissed";
  uploaded_from_filename: string | null;
  created_at: string;
  registered_order_id: string | null;
}

export function UnregisteredShipmentsButton() {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const { count: c } = await supabase
        .from("unregistered_bostta_shipments")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      if (mounted) setCount(c || 0);
    };
    load();
    const ch = supabase
      .channel("unreg_ship_count")
      .on("postgres_changes", { event: "*", schema: "public", table: "unregistered_bostta_shipments" }, load)
      .subscribe();
    return () => {
      mounted = false;
      supabase.removeChannel(ch);
    };
  }, []);

  return (
    <>
      <Button
        variant="outline"
        className="border-orange-500 text-orange-700 hover:bg-orange-50 relative"
        onClick={() => setOpen(true)}
      >
        <AlertCircle className="w-4 h-4 ml-2" />
        شحنات محتاجة تسجيل
        {count > 0 && (
          <Badge className="ml-2 bg-orange-600 hover:bg-orange-600 text-white">{count}</Badge>
        )}
      </Button>
      {open && <UnregisteredDialog open={open} onClose={() => setOpen(false)} />}
    </>
  );
}

function UnregisteredDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<UnregShipment[]>([]);
  const [tab, setTab] = useState<"pending" | "registered" | "dismissed">("pending");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("unregistered_bostta_shipments")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) toast.error(error.message);
    setRows((data as any) || []);
    setLoading(false);
  };

  useEffect(() => {
    if (open) load();
  }, [open]);

  const filtered = useMemo(() => rows.filter((r) => r.status === tab), [rows, tab]);
  const counts = useMemo(() => ({
    pending: rows.filter((r) => r.status === "pending").length,
    registered: rows.filter((r) => r.status === "registered").length,
    dismissed: rows.filter((r) => r.status === "dismissed").length,
  }), [rows]);

  const handleRegister = async (r: UnregShipment) => {
    if (!user) return;
    setBusyId(r.id);
    try {
      // 1. Find or create customer by phone
      let customerId: string | null = null;
      const { data: existing } = await supabase
        .from("customers").select("id").eq("phone", r.phone).limit(1);
      if (existing && existing.length > 0) {
        customerId = existing[0].id;
      } else {
        const { data: newCust, error: cErr } = await supabase
          .from("customers")
          .insert({
            name: r.customer_name || "غير معروف",
            phone: r.phone,
            source: "bostta_sheet",
          } as any)
          .select("id").single();
        if (cErr) throw new Error(`إنشاء العميل: ${cErr.message}`);
        customerId = newCust.id;
      }


      // 2. Create the order (delivered immediately, source = Agouza)
      const items = Array.isArray(r.parsed_items) ? r.parsed_items : [];
      const subtotal = items.reduce((s, it: any) => s + Number(it.quantity || 0) * Number(it.unit_price || 0), 0);
      const shipDate = r.shipment_date ? new Date(r.shipment_date + "T12:00:00Z") : new Date();

      const { data: newOrder, error: oErr } = await supabase
        .from("orders")
        .insert({
          customer_id: customerId,
          status: "delivered",
          delivered_at: shipDate.toISOString(),
          created_at: shipDate.toISOString(),
          total: r.cod,
          subtotal,
          payment_method: "cash",
          source: "bostta_sheet",
          shipping_company: "bostta",
          source_warehouse_id: AGOUZA_WAREHOUSE_ID,
          fulfillment_type: "delivery",
          stock_status: "dispatched",
          created_by: user.id,
          notes: `تم إنشاؤه من شيت بوسطة — بوليصة ${r.bill_no}`,
          stock_router_log: {
            bostta_unregistered: {
              bill_no: r.bill_no,
              created_from_shipment_id: r.id,
              raw_products: r.raw_products,
              parsed_items: items,
              cod: r.cod,
              created_at: new Date().toISOString(),
              created_by: user.id,
            },
          },
        })
        .select("id, order_number").single();
      if (oErr) throw new Error(`إنشاء الأوردر: ${oErr.message}`);

      // 3. Insert items
      if (items.length > 0) {
        const rowsToInsert = items.map((it: any) => ({
          order_id: newOrder.id,
          product_id: it.product_id,
          product_name: it.product_name,
          quantity: Number(it.quantity),
          unit_price: Number(it.unit_price || 0),
          total_price: Number(it.quantity) * Number(it.unit_price || 0),
        }));
        const { error: iErr } = await supabase.from("order_items").insert(rowsToInsert);
        if (iErr) throw new Error(`إضافة المنتجات: ${iErr.message}`);
      }

      // 4. Deduct Agouza stock (allow negative — same as bulk-upload behavior)
      await supabase.rpc("reserve_agouza_stock_for_order", { p_order_id: newOrder.id });
      await supabase.rpc("commit_agouza_stock_on_delivery", { p_order_id: newOrder.id });

      // 5. Mark shipment as registered
      await supabase
        .from("unregistered_bostta_shipments")
        .update({
          status: "registered",
          registered_order_id: newOrder.id,
          registered_by: user.id,
          registered_at: new Date().toISOString(),
        })
        .eq("id", r.id);

      toast.success(`تم إنشاء الأوردر ${newOrder.order_number}`);
      await load();
    } catch (e: any) {
      toast.error(e?.message || "فشل التسجيل");
    } finally {
      setBusyId(null);
    }
  };

  const handleDismiss = async (r: UnregShipment) => {
    if (!user) return;
    const reason = prompt("سبب التجاهل؟", "شحنة ملغية / خطأ في الشيت");
    if (!reason) return;
    setBusyId(r.id);
    try {
      await supabase
        .from("unregistered_bostta_shipments")
        .update({
          status: "dismissed",
          dismissed_reason: reason,
          dismissed_by: user.id,
          dismissed_at: new Date().toISOString(),
        })
        .eq("id", r.id);
      toast.success("تم التجاهل");
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const handleReopen = async (r: UnregShipment) => {
    setBusyId(r.id);
    try {
      await supabase
        .from("unregistered_bostta_shipments")
        .update({ status: "pending", dismissed_reason: null })
        .eq("id", r.id);
      await load();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-orange-600" />
            شحنات محتاجة تسجيل
            <Button variant="ghost" size="sm" onClick={load} className="ml-auto">
              <RefreshCw className="w-4 h-4" />
            </Button>
          </DialogTitle>
          <DialogDescription>
            الشحنات دي جت من شيت بوسطة بس مالهاش أوردر مطابق على السيستم. سجّلها هنا عشان تتحسب delivered.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList>
            <TabsTrigger value="pending">
              في الانتظار
              {counts.pending > 0 && <Badge className="ml-2 bg-orange-600">{counts.pending}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="registered">
              تم التسجيل ({counts.registered})
            </TabsTrigger>
            <TabsTrigger value="dismissed">
              متجاهَل ({counts.dismissed})
            </TabsTrigger>
          </TabsList>

          <TabsContent value={tab}>
            {loading ? (
              <div className="text-center py-8">
                <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <Alert className="my-4">
                <AlertDescription>مفيش شحنات في القسم ده.</AlertDescription>
              </Alert>
            ) : (
              <div className="border rounded overflow-x-auto max-h-[60vh]">
                <table className="w-full text-xs text-right">
                  <thead className="bg-muted/60 sticky top-0">
                    <tr>
                      <th className="p-2">البوليصة</th>
                      <th className="p-2">التاريخ</th>
                      <th className="p-2">العميل</th>
                      <th className="p-2">الموبايل</th>
                      <th className="p-2">COD</th>
                      <th className="p-2">المنتجات</th>
                      <th className="p-2">إجراء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => (
                      <tr key={r.id} className="border-t hover:bg-muted/30">
                        <td className="p-2 font-mono">{r.bill_no}</td>
                        <td className="p-2 whitespace-nowrap">{r.shipment_date || "—"}</td>
                        <td className="p-2">{r.customer_name}</td>
                        <td className="p-2 font-mono">{r.phone}</td>
                        <td className="p-2 font-bold">{r.cod}</td>
                        <td className="p-2">
                          {r.parsed_items?.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {r.parsed_items.map((it: any, j: number) => (
                                <Badge key={j} variant="outline" className="border-emerald-400 text-emerald-700">
                                  {it.quantity} × {it.product_name}
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-[10px]">{r.raw_products || "—"}</span>
                          )}
                        </td>
                        <td className="p-2 whitespace-nowrap">
                          {r.status === "pending" && (
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                                onClick={() => handleRegister(r)}
                                disabled={busyId === r.id || r.parsed_items?.length === 0}
                                title={r.parsed_items?.length === 0 ? "مفيش منتجات مفكوكة — راجع الشيت" : ""}
                              >
                                {busyId === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <><UserPlus className="w-3 h-3 ml-1" /> سجّل</>}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs border-red-400 text-red-700 hover:bg-red-50"
                                onClick={() => handleDismiss(r)}
                                disabled={busyId === r.id}
                              >
                                <XCircle className="w-3 h-3 ml-1" /> تجاهل
                              </Button>
                            </div>
                          )}
                          {r.status === "registered" && (
                            <Badge className="bg-emerald-100 text-emerald-800 border border-emerald-300">
                              <CheckCircle2 className="w-3 h-3 ml-1" /> اتسجل
                            </Badge>
                          )}
                          {r.status === "dismissed" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => handleReopen(r)}
                              disabled={busyId === r.id}
                            >
                              رجّع للانتظار
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>إغلاق</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
