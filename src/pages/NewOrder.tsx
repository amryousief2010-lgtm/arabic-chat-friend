import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { 
  ShoppingCart, 
  Plus, 
  Minus, 
  Trash2, 
  CreditCard, 
  Banknote,
  UserPlus,
  Search,
  Package
} from 'lucide-react';

interface Product {
  id: string;
  name: string;
  price: number;
  unit: string;
  stock: number;
  category: string | null;
}

interface Customer {
  id: string;
  name: string;
  phone: string;
  address: string | null;
  city: string | null;
}

interface CartItem {
  product: Product;
  quantity: number;
}

const NewOrder = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  
  // Cart state
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'online'>('cash');
  const [deliveryFee, setDeliveryFee] = useState(50);
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  
  // Search
  const [productSearch, setProductSearch] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  
  // New customer dialog
  const [isNewCustomerOpen, setIsNewCustomerOpen] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  const [newCustomerAddress, setNewCustomerAddress] = useState('');
  const [newCustomerCity, setNewCustomerCity] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [productsRes, customersRes] = await Promise.all([
        supabase.from('products').select('*').eq('is_active', true).gt('stock', 0),
        supabase.from('customers').select('*').order('name'),
      ]);

      if (productsRes.error) throw productsRes.error;
      if (customersRes.error) throw customersRes.error;

      setProducts(productsRes.data || []);
      setCustomers(customersRes.data || []);
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('حدث خطأ أثناء جلب البيانات');
    } finally {
      setLoading(false);
    }
  };

  const addToCart = (product: Product) => {
    const existingItem = cart.find(item => item.product.id === product.id);
    
    if (existingItem) {
      if (existingItem.quantity >= product.stock) {
        toast.error('الكمية المطلوبة أكبر من المتاحة');
        return;
      }
      setCart(cart.map(item =>
        item.product.id === product.id
          ? { ...item, quantity: item.quantity + 1 }
          : item
      ));
    } else {
      setCart([...cart, { product, quantity: 1 }]);
    }
  };

  const updateQuantity = (productId: string, delta: number) => {
    setCart(cart.map(item => {
      if (item.product.id === productId) {
        const newQuantity = item.quantity + delta;
        if (newQuantity <= 0) return item;
        if (newQuantity > item.product.stock) {
          toast.error('الكمية المطلوبة أكبر من المتاحة');
          return item;
        }
        return { ...item, quantity: newQuantity };
      }
      return item;
    }));
  };

  const removeFromCart = (productId: string) => {
    setCart(cart.filter(item => item.product.id !== productId));
  };

  const subtotal = cart.reduce((sum, item) => sum + (item.product.price * item.quantity), 0);
  const total = subtotal - discount + deliveryFee;

  const handleAddCustomer = async () => {
    if (!newCustomerName.trim() || !newCustomerPhone.trim()) {
      toast.error('يرجى إدخال اسم العميل ورقم الهاتف');
      return;
    }

    try {
      const { data, error } = await supabase
        .from('customers')
        .insert({
          name: newCustomerName.trim(),
          phone: newCustomerPhone.trim(),
          address: newCustomerAddress.trim() || null,
          city: newCustomerCity.trim() || null,
        })
        .select()
        .single();

      if (error) throw error;

      setCustomers([...customers, data]);
      setSelectedCustomer(data);
      setDeliveryAddress(data.address || '');
      setIsNewCustomerOpen(false);
      resetCustomerForm();
      toast.success('تم إضافة العميل بنجاح');
    } catch (error) {
      console.error('Error adding customer:', error);
      toast.error('حدث خطأ أثناء إضافة العميل');
    }
  };

  const resetCustomerForm = () => {
    setNewCustomerName('');
    setNewCustomerPhone('');
    setNewCustomerAddress('');
    setNewCustomerCity('');
  };

  const handleSubmitOrder = async () => {
    if (cart.length === 0) {
      toast.error('يرجى إضافة منتجات للطلب');
      return;
    }

    if (!selectedCustomer) {
      toast.error('يرجى اختيار العميل');
      return;
    }

    setSubmitting(true);

    try {
      // Generate order number
      const { data: orderNumberData, error: orderNumberError } = await supabase
        .rpc('generate_order_number');

      if (orderNumberError) throw orderNumberError;

      // Create order
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert({
          order_number: orderNumberData,
          customer_id: selectedCustomer.id,
          payment_method: paymentMethod,
          subtotal,
          discount,
          delivery_fee: deliveryFee,
          total,
          notes: notes.trim() || null,
          delivery_address: deliveryAddress.trim() || selectedCustomer.address,
          created_by: user?.id,
        })
        .select()
        .single();

      if (orderError) throw orderError;

      // Create order items
      const orderItems = cart.map(item => ({
        order_id: order.id,
        product_id: item.product.id,
        product_name: item.product.name,
        quantity: item.quantity,
        unit_price: item.product.price,
        total_price: item.product.price * item.quantity,
      }));

      const { error: itemsError } = await supabase
        .from('order_items')
        .insert(orderItems);

      if (itemsError) throw itemsError;

      // Update customer stats
      await supabase
        .from('customers')
        .update({
          total_orders: (selectedCustomer as any).total_orders + 1,
          total_spent: (selectedCustomer as any).total_spent + total,
        })
        .eq('id', selectedCustomer.id);

      toast.success(`تم إنشاء الطلب رقم ${orderNumberData} بنجاح`);
      navigate('/orders');
    } catch (error) {
      console.error('Error creating order:', error);
      toast.error('حدث خطأ أثناء إنشاء الطلب');
    } finally {
      setSubmitting(false);
    }
  };

  const filteredProducts = products.filter(p =>
    p.name.toLowerCase().includes(productSearch.toLowerCase())
  );

  const filteredCustomers = customers.filter(c =>
    c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
    c.phone.includes(customerSearch)
  );

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
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">طلب جديد</h1>
            <p className="text-muted-foreground mt-1">إنشاء طلب جديد للعميل</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Products Section */}
          <div className="lg:col-span-2 space-y-4">
            {/* Customer Selection */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <UserPlus className="w-5 h-5" />
                  العميل
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-3">
                  <div className="flex-1 relative">
                    <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="بحث عن عميل..."
                      className="pr-10"
                      value={customerSearch}
                      onChange={(e) => setCustomerSearch(e.target.value)}
                    />
                  </div>
                  <Dialog open={isNewCustomerOpen} onOpenChange={setIsNewCustomerOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline" className="gap-2">
                        <Plus className="w-4 h-4" />
                        عميل جديد
                      </Button>
                    </DialogTrigger>
                    <DialogContent dir="rtl">
                      <DialogHeader>
                        <DialogTitle>إضافة عميل جديد</DialogTitle>
                        <DialogDescription>أدخل بيانات العميل الجديد</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <Label>الاسم *</Label>
                          <Input
                            placeholder="اسم العميل"
                            value={newCustomerName}
                            onChange={(e) => setNewCustomerName(e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>رقم الهاتف *</Label>
                          <Input
                            placeholder="01xxxxxxxxx"
                            value={newCustomerPhone}
                            onChange={(e) => setNewCustomerPhone(e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>العنوان</Label>
                          <Input
                            placeholder="عنوان التوصيل"
                            value={newCustomerAddress}
                            onChange={(e) => setNewCustomerAddress(e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>المدينة</Label>
                          <Input
                            placeholder="المدينة"
                            value={newCustomerCity}
                            onChange={(e) => setNewCustomerCity(e.target.value)}
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setIsNewCustomerOpen(false)}>
                          إلغاء
                        </Button>
                        <Button onClick={handleAddCustomer}>إضافة</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>

                {customerSearch && filteredCustomers.length > 0 && !selectedCustomer && (
                  <div className="mt-2 border rounded-lg max-h-48 overflow-auto">
                    {filteredCustomers.map((customer) => (
                      <button
                        key={customer.id}
                        className="w-full text-right p-3 hover:bg-muted/50 border-b last:border-b-0 transition-colors"
                        onClick={() => {
                          setSelectedCustomer(customer);
                          setDeliveryAddress(customer.address || '');
                          setCustomerSearch('');
                        }}
                      >
                        <p className="font-medium">{customer.name}</p>
                        <p className="text-sm text-muted-foreground">{customer.phone}</p>
                      </button>
                    ))}
                  </div>
                )}

                {selectedCustomer && (
                  <div className="mt-3 p-3 bg-muted/50 rounded-lg flex items-center justify-between">
                    <div>
                      <p className="font-medium">{selectedCustomer.name}</p>
                      <p className="text-sm text-muted-foreground">{selectedCustomer.phone}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedCustomer(null)}
                    >
                      تغيير
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Products */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Package className="w-5 h-5" />
                  المنتجات
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="relative mb-4">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="بحث عن منتج..."
                    className="pr-10"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {filteredProducts.map((product) => (
                    <button
                      key={product.id}
                      onClick={() => addToCart(product)}
                      className="p-4 border rounded-lg text-right hover:border-primary hover:bg-primary/5 transition-all"
                    >
                      <p className="font-medium text-sm line-clamp-1">{product.name}</p>
                      <p className="text-primary font-bold mt-1">
                        {product.price.toLocaleString()} ج.م / {product.unit}
                      </p>
                      <Badge variant="outline" className="mt-2 text-xs">
                        متاح: {product.stock}
                      </Badge>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Cart Section */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <ShoppingCart className="w-5 h-5" />
                  سلة المشتريات
                  {cart.length > 0 && (
                    <Badge>{cart.length}</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {cart.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">
                    السلة فارغة
                  </p>
                ) : (
                  <>
                    <div className="space-y-3 max-h-64 overflow-auto">
                      {cart.map((item) => (
                        <div
                          key={item.product.id}
                          className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                        >
                          <div className="flex-1">
                            <p className="font-medium text-sm">{item.product.name}</p>
                            <p className="text-sm text-muted-foreground">
                              {item.product.price.toLocaleString()} × {item.quantity}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => updateQuantity(item.product.id, -1)}
                            >
                              <Minus className="w-3 h-3" />
                            </Button>
                            <span className="w-8 text-center font-medium">
                              {item.quantity}
                            </span>
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => updateQuantity(item.product.id, 1)}
                            >
                              <Plus className="w-3 h-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive"
                              onClick={() => removeFromCart(item.product.id)}
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Delivery Address */}
                    <div className="space-y-2">
                      <Label>عنوان التوصيل</Label>
                      <Textarea
                        placeholder="عنوان التوصيل..."
                        value={deliveryAddress}
                        onChange={(e) => setDeliveryAddress(e.target.value)}
                        rows={2}
                      />
                    </div>

                    {/* Payment Method */}
                    <div className="space-y-2">
                      <Label>طريقة الدفع</Label>
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          type="button"
                          variant={paymentMethod === 'cash' ? 'default' : 'outline'}
                          className="gap-2"
                          onClick={() => setPaymentMethod('cash')}
                        >
                          <Banknote className="w-4 h-4" />
                          نقدي
                        </Button>
                        <Button
                          type="button"
                          variant={paymentMethod === 'online' ? 'default' : 'outline'}
                          className="gap-2"
                          onClick={() => setPaymentMethod('online')}
                        >
                          <CreditCard className="w-4 h-4" />
                          إلكتروني
                        </Button>
                      </div>
                    </div>

                    {/* Fees */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label>رسوم التوصيل</Label>
                        <Input
                          type="number"
                          value={deliveryFee}
                          onChange={(e) => setDeliveryFee(Number(e.target.value))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>الخصم</Label>
                        <Input
                          type="number"
                          value={discount}
                          onChange={(e) => setDiscount(Number(e.target.value))}
                        />
                      </div>
                    </div>

                    {/* Notes */}
                    <div className="space-y-2">
                      <Label>ملاحظات</Label>
                      <Textarea
                        placeholder="ملاحظات إضافية..."
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        rows={2}
                      />
                    </div>

                    {/* Totals */}
                    <div className="border-t pt-4 space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">المجموع الفرعي</span>
                        <span>{subtotal.toLocaleString()} ج.م</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">رسوم التوصيل</span>
                        <span>{deliveryFee.toLocaleString()} ج.م</span>
                      </div>
                      {discount > 0 && (
                        <div className="flex justify-between text-sm text-green-600">
                          <span>الخصم</span>
                          <span>- {discount.toLocaleString()} ج.م</span>
                        </div>
                      )}
                      <div className="flex justify-between font-bold text-lg border-t pt-2">
                        <span>الإجمالي</span>
                        <span className="text-primary">{total.toLocaleString()} ج.م</span>
                      </div>
                    </div>

                    <Button
                      className="w-full gap-2"
                      size="lg"
                      onClick={handleSubmitOrder}
                      disabled={submitting || !selectedCustomer}
                    >
                      {submitting ? (
                        <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-primary-foreground"></div>
                      ) : (
                        <>
                          <ShoppingCart className="w-4 h-4" />
                          تأكيد الطلب
                        </>
                      )}
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default NewOrder;
