import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { findModeratorBySlug, findModeratorByName } from '@/constants/moderators';
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
  Package,
  Gift
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

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

interface OfferBox {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  expires_at: string | null;
}

interface OfferBoxItem {
  id: string;
  product_id: string;
  custom_price: number;
  quantity: number;
  product: Product | null;
}

interface CartItem {
  product: Product;
  quantity: number;
  customPrice?: number; // For offer box items
  isOfferItem?: boolean;
  isHalfKg?: boolean; // نصف كيلو: السعر = price/2 ، الكمية 2 = 1 كيلو
}

const isKgUnit = (unit: string) => {
  const u = (unit || '').trim().toLowerCase().replace(/\s+/g, '');
  return /^(كجم|كيلو|كيلوجرام|كيلوغرام|كغم|كغ|kg|kgs|kilogram|kilogramme|kilo)$/i.test(u);
};

const NewOrder = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();

  // Determine the moderator name to attribute this new order to.
  // Priority: ?moderator=<slug> query param → fallback to detecting from
  // the logged-in user's profile full_name.
  const [moderatorName, setModeratorName] = useState<string | null>(null);
  useEffect(() => {
    const slug = searchParams.get('moderator');
    if (slug) {
      const m = findModeratorBySlug(slug);
      if (m) { setModeratorName(m.canonicalModerator); return; }
    }
    (async () => {
      if (!user) return;
      const { data } = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle();
      const m = findModeratorByName(data?.full_name);
      if (m) setModeratorName(m.canonicalModerator);
    })();
  }, [user, searchParams]);

  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [offerBoxes, setOfferBoxes] = useState<OfferBox[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  
  // Cart state
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'online'>('cash');
  const [deliveryFee, setDeliveryFee] = useState(110);
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [source, setSource] = useState<string>('');
  const [sourceCustom, setSourceCustom] = useState('');
  const [shippingCompany, setShippingCompany] = useState<string>('');
  const [shippingCustom, setShippingCustom] = useState('');
  
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
      const [productsRes, customersRes, offersRes] = await Promise.all([
        supabase.from('products').select('*').eq('is_active', true),
        supabase.from('customers').select('*').order('name'),
        supabase.from('offer_boxes').select('*').eq('is_active', true),
      ]);

      if (productsRes.error) throw productsRes.error;
      if (customersRes.error) throw customersRes.error;
      if (offersRes.error) throw offersRes.error;

      setProducts(productsRes.data || []);
      setCustomers(customersRes.data || []);
      
      // Filter out expired offers
      const activeOffers = (offersRes.data || []).filter(offer => {
        if (!offer.expires_at) return true;
        return new Date(offer.expires_at) > new Date();
      });
      setOfferBoxes(activeOffers);
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('حدث خطأ أثناء جلب البيانات');
    } finally {
      setLoading(false);
    }
  };

  const addToCart = (product: Product, customPrice?: number, isOfferItem?: boolean, isHalfKg?: boolean) => {
    const existingItem = cart.find(item =>
      item.product.id === product.id &&
      item.customPrice === customPrice &&
      item.isOfferItem === isOfferItem &&
      item.isHalfKg === isHalfKg
    );

    if (existingItem) {
      setCart(cart.map(item =>
        item.product.id === product.id && item.customPrice === customPrice && item.isOfferItem === isOfferItem && item.isHalfKg === isHalfKg
          ? { ...item, quantity: item.quantity + 1 }
          : item
      ));
    } else {
      setCart([...cart, { product, quantity: 1, customPrice, isOfferItem, isHalfKg }]);
    }
  };

  const addOfferBoxToCart = async (offerBox: OfferBox) => {
    try {
      // Fetch offer box items with product details
      const { data: items, error } = await supabase
        .from('offer_box_items')
        .select('*')
        .eq('offer_box_id', offerBox.id);

      if (error) throw error;

      if (!items || items.length === 0) {
        toast.error('هذا العرض لا يحتوي على منتجات');
        return;
      }

      // Get product details for each item
      const productIds = items.map(item => item.product_id);
      const { data: productData, error: productError } = await supabase
        .from('products')
        .select('*')
        .in('id', productIds);

      if (productError) throw productError;

      // Add each item to cart with custom price (no stock check)
      let addedCount = 0;
      for (const item of items) {
        const product = productData?.find(p => p.id === item.product_id);
        if (product) {
          for (let i = 0; i < item.quantity; i++) {
            addToCart(product as Product, item.custom_price, true);
          }
          addedCount++;
        }
      }

      if (addedCount > 0) {
        toast.success(`تم إضافة ${addedCount} منتج من عرض "${offerBox.name}" للسلة`);
      } else {
        toast.error('المنتجات في هذا العرض غير متاحة حالياً');
      }
    } catch (error) {
      console.error('Error adding offer box:', error);
      toast.error('حدث خطأ أثناء إضافة العرض');
    }
  };

  const updateQuantity = (productId: string, delta: number, customPrice?: number, isOfferItem?: boolean, isHalfKg?: boolean) => {
    setCart(cart.map(item => {
      if (item.product.id === productId && item.customPrice === customPrice && item.isOfferItem === isOfferItem && item.isHalfKg === isHalfKg) {
        const newQuantity = item.quantity + delta;
        if (newQuantity <= 0) return item;
        return { ...item, quantity: newQuantity };
      }
      return item;
    }));
  };

  const removeFromCart = (productId: string, customPrice?: number, isOfferItem?: boolean, isHalfKg?: boolean) => {
    setCart(cart.filter(item =>
      !(item.product.id === productId && item.customPrice === customPrice && item.isOfferItem === isOfferItem && item.isHalfKg === isHalfKg)
    ));
  };

  const subtotal = cart.reduce((sum, item) => {
    const basePrice = item.customPrice ?? item.product.price;
    const unitPrice = item.isHalfKg ? basePrice / 2 : basePrice;
    return sum + (unitPrice * item.quantity);
  }, 0);
  const totalKg = cart.reduce((sum, item) => {
    if (!isKgUnit(item.product.unit)) return sum;
    const kg = item.isHalfKg ? item.quantity / 2 : item.quantity;
    return sum + kg;
  }, 0);
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
          moderator: moderatorName,
          source: (source === 'أخرى' ? sourceCustom.trim() : source) || null,
          shipping_company: (shippingCompany === 'أخرى' ? shippingCustom.trim() : shippingCompany) || null,
        })
        .select()
        .single();

      if (orderError) throw orderError;

      // Create order items
      const orderItems = cart.map(item => {
        const basePrice = item.customPrice ?? item.product.price;
        const unitPrice = item.isHalfKg ? basePrice / 2 : basePrice;
        return {
          order_id: order.id,
          product_id: item.product.id,
          product_name: item.isOfferItem ? `${item.product.name} (عرض)` : item.product.name,
          quantity: item.quantity,
          unit_price: unitPrice,
          total_price: unitPrice * item.quantity,
          is_half_kg: !!item.isHalfKg,
        };
      });

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

            {/* Products & Offers */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Package className="w-5 h-5" />
                  المنتجات والعروض
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="products" className="w-full">
                  <TabsList className="grid w-full grid-cols-2 mb-4">
                    <TabsTrigger value="products" className="gap-2">
                      <Package className="w-4 h-4" />
                      المنتجات
                    </TabsTrigger>
                    <TabsTrigger value="offers" className="gap-2">
                      <Gift className="w-4 h-4" />
                      العروض
                      {offerBoxes.length > 0 && (
                        <span className="bg-primary text-primary-foreground text-xs px-1.5 py-0.5 rounded-full">
                          {offerBoxes.length}
                        </span>
                      )}
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="products" className="mt-0">
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
                      {filteredProducts.map((product) => {
                        const kg = isKgUnit(product.unit);
                        return (
                          <div
                            key={product.id}
                            className="p-3 border rounded-lg text-right hover:border-primary transition-all flex flex-col"
                          >
                            <p className="font-medium text-sm line-clamp-1">{product.name}</p>
                            <p className="text-primary font-bold mt-1 text-sm">
                              {product.price.toLocaleString()} ج.م / {product.unit}
                            </p>
                            <Badge
                              variant={product.stock <= 0 ? 'destructive' : 'outline'}
                              className="mt-2 text-xs self-start"
                            >
                              {product.stock <= 0 ? 'بانتظار التصنيع' : `متاح: ${product.stock}`}
                            </Badge>
                            <div className={`mt-2 grid ${kg ? 'grid-cols-2' : 'grid-cols-1'} gap-1.5`}>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 text-xs"
                                onClick={() => addToCart(product)}
                              >
                                <Plus className="w-3 h-3 ml-1" />
                                {kg ? 'كيلو' : 'إضافة'}
                              </Button>
                              {kg && (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  className="h-8 text-xs"
                                  onClick={() => addToCart(product, undefined, false, true)}
                                  title="2 = 1 كيلو"
                                >
                                  <Plus className="w-3 h-3 ml-1" />
                                  ½ كيلو
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </TabsContent>

                  <TabsContent value="offers" className="mt-0">
                    {offerBoxes.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <Gift className="h-12 w-12 mx-auto mb-2 opacity-50" />
                        <p>لا توجد عروض متاحة حالياً</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {offerBoxes.map((offer) => (
                          <button
                            key={offer.id}
                            onClick={() => addOfferBoxToCart(offer)}
                            className="p-4 border rounded-lg text-right hover:border-primary hover:bg-primary/5 transition-all group"
                          >
                            <div className="flex items-center gap-2 mb-2">
                              <Gift className="w-5 h-5 text-primary" />
                              <p className="font-medium">{offer.name}</p>
                            </div>
                            {offer.description && (
                              <p className="text-sm text-muted-foreground line-clamp-2">{offer.description}</p>
                            )}
                            <Badge className="mt-2 bg-green-100 text-green-700 hover:bg-green-100">
                              أسعار مخفضة
                            </Badge>
                          </button>
                        ))}
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
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
                      {cart.map((item, index) => {
                        const basePrice = item.customPrice ?? item.product.price;
                        const unitPrice = item.isHalfKg ? basePrice / 2 : basePrice;
                        const kgEquivalent = isKgUnit(item.product.unit)
                          ? (item.isHalfKg ? item.quantity / 2 : item.quantity)
                          : null;
                        return (
                        <div
                          key={`${item.product.id}-${item.customPrice}-${item.isHalfKg ? 'h' : 'f'}-${index}`}
                          className={`flex items-center justify-between p-3 rounded-lg ${
                            item.isOfferItem ? 'bg-green-50 dark:bg-green-950/20 border border-green-200' : 'bg-muted/50'
                          }`}
                        >
                          <div className="flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-medium text-sm">{item.product.name}</p>
                              {item.isOfferItem && (
                                <Badge variant="secondary" className="text-xs bg-green-100 text-green-700">
                                  عرض
                                </Badge>
                              )}
                              {item.isHalfKg && (
                                <Badge variant="secondary" className="text-xs">
                                  نصف كيلو
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {unitPrice.toLocaleString()} × {item.quantity}
                              {kgEquivalent !== null && (
                                <span className="mr-2 text-primary">= {kgEquivalent} كجم</span>
                              )}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => updateQuantity(item.product.id, -1, item.customPrice, item.isOfferItem, item.isHalfKg)}
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
                              onClick={() => updateQuantity(item.product.id, 1, item.customPrice, item.isOfferItem, item.isHalfKg)}
                            >
                              <Plus className="w-3 h-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive"
                              onClick={() => removeFromCart(item.product.id, item.customPrice, item.isOfferItem, item.isHalfKg)}
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                        );
                      })}
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
                      {totalKg > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">إجمالي الوزن</span>
                          <span className="font-medium text-primary">{totalKg.toLocaleString()} كجم</span>
                        </div>
                      )}
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

                    {!selectedCustomer && (
                      <p className="text-sm text-amber-600 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-md p-2 text-center">
                        يرجى اختيار العميل أولاً لتفعيل زر تأكيد الطلب
                      </p>
                    )}
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
