import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, ChefHat, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Customer { id: string; name: string; phone: string; address: string | null; customer_type: string; }
interface Product { id: string; name: string; image_url: string | null; kitchen_section: string; unit: string; sale_price: number; }
interface OrderItem { product_id: string; product_name: string; product_image: string | null; kitchen_section: string; quantity: number; unit_price: number; notes: string; }

const NewCateringOrder = () => {
  const nav = useNavigate();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [salesTeam, setSalesTeam] = useState("b2c");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [deliveryTime, setDeliveryTime] = useState("");
  const [kitchenOutTime, setKitchenOutTime] = useState("");
  const [servingTime, setServingTime] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("bank_transfer");
  const [customerNotes, setCustomerNotes] = useState("");
  const [items, setItems] = useState<OrderItem[]>([]);
  const [discount, setDiscount] = useState(0);
  const [tax, setTax] = useState(0);
  const [deliveryFee, setDeliveryFee] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [c, p] = await Promise.all([
        supabase.from("catering_customers").select("id, name, phone, address, customer_type").order("name").limit(1000),
        supabase.from("catering_products").select("id, name, image_url, kitchen_section, unit, sale_price").eq("is_active", true).order("name").limit(1000),
      ]);
      setCustomers((c.data || []) as Customer[]);
      setProducts((p.data || []) as Product[]);
    })();
  }, []);

  const subtotal = useMemo(() => items.reduce((s, i) => s + i.quantity * i.unit_price, 0), [items]);
  const total = useMemo(() => subtotal - discount + tax + deliveryFee, [subtotal, discount, tax, deliveryFee]);

  const addProduct = (p: Product) => {
    setItems((arr) => [...arr, { product_id: p.id, product_name: p.name, product_image: p.image_url, kitchen_section: p.kitchen_section, quantity: 1, unit_price: Number(p.sale_price), notes: "" }]);
  };
  const updateItem = (i: number, patch: Partial<OrderItem>) => setItems((arr) => arr.map((x, idx) => idx === i ? { ...x, ...patch } : x));
  const removeItem = (i: number) => setItems((arr) => arr.filter((_, idx) => idx !== i));

  const pickCustomer = (id: string) => {
    setCustomerId(id);
    const c = customers.find((x) => x.id === id);
    if (c) {
      setCustomerName(c.name);
      if (!deliveryAddress && c.address) setDeliveryAddress(c.address);
    }
  };

  const filteredCustomers = customers.filter((c) => !customerSearch || c.name.includes(customerSearch) || c.phone.includes(customerSearch)).slice(0, 50);

  const save = async () => {
    if (!customerName.trim()) return toast.error("اختر عميلًا");
    if (items.length === 0) return toast.error("أضف صنفًا واحدًا على الأقل");
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const order_number = `SIS-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(Math.random() * 10000).toString().padStart(4, "0")}`;
      const { data: order, error } = await supabase.from("catering_orders").insert({
        order_number,
        customer_id: customerId || null,
        customer_name_snapshot: customerName,
        sales_team: salesTeam,
        delivery_address: deliveryAddress || null,
        delivery_date: deliveryDate || null,
        delivery_time: deliveryTime || null,
        kitchen_out_time: kitchenOutTime || null,
        serving_time: servingTime || null,
        customer_notes: customerNotes || null,
        payment_method: paymentMethod,
        subtotal, discount, tax, delivery_fee: deliveryFee, total,
        created_by: user?.id,
      }).select("id").single();
      if (error) throw error;

      const itemRows = items.map((it) => ({
        order_id: order.id,
        product_id: it.product_id,
        product_name: it.product_name,
        product_image: it.product_image,
        kitchen_section: it.kitchen_section,
        quantity: it.quantity,
        unit_price: it.unit_price,
        total_price: it.quantity * it.unit_price,
        notes: it.notes || null,
      }));
      const { error: ie } = await supabase.from("catering_order_items").insert(itemRows);
      if (ie) throw ie;

      toast.success("تم إنشاء الطلب");
      nav("/catering/orders");
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setSaving(false); }
  };

  return (
    <DashboardLayout>
      <Header title="طلب كاترينج جديد" subtitle="بيانات العميل والتسليم والأصناف" />
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader><CardTitle>بيانات العميل</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>قسم البيع</Label>
                  <Select value={salesTeam} onValueChange={setSalesTeam}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="b2c">أفراد</SelectItem><SelectItem value="b2b">شركات</SelectItem></SelectContent>
                  </Select>
                </div>
                <div><Label>بحث عميل سابق</Label>
                  <Input value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} placeholder="اسم أو هاتف..." />
                </div>
              </div>
              {customerSearch && (
                <div className="border rounded-lg max-h-40 overflow-y-auto">
                  {filteredCustomers.map((c) => (
                    <button key={c.id} onClick={() => { pickCustomer(c.id); setCustomerSearch(""); }} className="w-full text-right p-2 hover:bg-muted border-b text-sm">
                      <strong>{c.name}</strong> — <span className="text-muted-foreground" dir="ltr">{c.phone}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div><Label>اسم العميل *</Label><Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} /></div>
                <div><Label>عنوان التسليم</Label><Input value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} /></div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>المواعيد</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div><Label>تاريخ الاستلام</Label><Input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} /></div>
                <div><Label>وقت التسليم</Label><Input type="time" value={deliveryTime} onChange={(e) => setDeliveryTime(e.target.value)} /></div>
                <div><Label>خروج من المطبخ</Label><Input type="time" value={kitchenOutTime} onChange={(e) => setKitchenOutTime(e.target.value)} /></div>
                <div><Label>وقت تقديم الأكل</Label><Input type="time" value={servingTime} onChange={(e) => setServingTime(e.target.value)} /></div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>الأصناف</CardTitle>
                <Select onValueChange={(id) => { const p = products.find((x) => x.id === id); if (p) addProduct(p); }}>
                  <SelectTrigger className="w-64"><SelectValue placeholder="إضافة صنف..." /></SelectTrigger>
                  <SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {items.length === 0 ? <p className="text-center py-8 text-muted-foreground">أضف صنفًا للبدء</p> : items.map((it, i) => (
                <div key={i} className="flex items-center gap-2 p-2 border rounded-lg">
                  {it.product_image ? <img src={it.product_image} alt={it.product_name} className="w-14 h-14 rounded object-cover" /> : <div className="w-14 h-14 rounded bg-muted flex items-center justify-center"><ChefHat className="w-5 h-5" /></div>}
                  <div className="flex-1">
                    <p className="font-bold">{it.product_name}</p>
                    <p className="text-xs text-muted-foreground">القسم: {it.kitchen_section}</p>
                  </div>
                  <Input type="number" className="w-20" value={it.quantity} onChange={(e) => updateItem(i, { quantity: Number(e.target.value) })} />
                  <Input type="number" step="0.01" className="w-24" value={it.unit_price} onChange={(e) => updateItem(i, { unit_price: Number(e.target.value) })} />
                  <span className="w-24 text-end font-bold">{(it.quantity * it.unit_price).toFixed(2)} ر.س</span>
                  <Button variant="ghost" size="icon" onClick={() => removeItem(i)} className="text-destructive"><Trash2 className="w-4 h-4" /></Button>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>ملاحظات العميل</CardTitle></CardHeader>
            <CardContent><Textarea value={customerNotes} onChange={(e) => setCustomerNotes(e.target.value)} rows={3} placeholder="أي ملاحظات خاصة..." /></CardContent>
          </Card>
        </div>

        <div>
          <Card className="sticky top-4">
            <CardHeader><CardTitle>الملخص</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div><Label>طريقة الدفع</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bank_transfer">تحويل بنكي</SelectItem>
                    <SelectItem value="cash">نقدي</SelectItem>
                    <SelectItem value="credit">آجل</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div><Label>خصم</Label><Input type="number" step="0.01" value={discount} onChange={(e) => setDiscount(Number(e.target.value))} /></div>
                <div><Label>ضريبة</Label><Input type="number" step="0.01" value={tax} onChange={(e) => setTax(Number(e.target.value))} /></div>
                <div><Label>توصيل</Label><Input type="number" step="0.01" value={deliveryFee} onChange={(e) => setDeliveryFee(Number(e.target.value))} /></div>
              </div>
              <div className="border-t pt-3 space-y-1 text-sm">
                <div className="flex justify-between"><span>المجموع الفرعي</span><span>{subtotal.toFixed(2)} ر.س</span></div>
                <div className="flex justify-between text-lg font-bold text-primary"><span>الإجمالي</span><span>{total.toFixed(2)} ر.س</span></div>
              </div>
              <Button onClick={save} disabled={saving} className="w-full bg-gradient-to-r from-primary to-accent gap-2">
                <Save className="w-4 h-4" /> {saving ? "جارِ الحفظ..." : "حفظ الطلب"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
};
export default NewCateringOrder;
