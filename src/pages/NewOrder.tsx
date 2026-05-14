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
  Gift,
  Pencil
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
  shipping_cost?: number | null;
}

interface OfferBoxItem {
  id: string;
  product_id: string;
  custom_price: number;
  quantity: number;
  product: Product | null;
}

interface CartItem {
  cartItemId: string; // unique line id
  product: Product;
  quantity: number;
  customPrice?: number; // For offer box items
  isOfferItem?: boolean;
  isHalfKg?: boolean; // نصف كيلو: السعر = price/2 ، الكمية 2 = 1 كيلو
  offerBoxId?: string;
  offerBoxName?: string;
}

interface OfferPreviewItem {
  id: string;
  product_id: string;
  product: Product | null;
  custom_price: number;
  quantity: number;
  is_gift?: boolean;
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
  
  // New/Edit customer dialog
  const [isNewCustomerOpen, setIsNewCustomerOpen] = useState(false);
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(null);
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  const [newCustomerPhone2, setNewCustomerPhone2] = useState('');
  const [newCustomerAddress, setNewCustomerAddress] = useState('');
  const [newCustomerCity, setNewCustomerCity] = useState('');
  const [newCustomerGovernorate, setNewCustomerGovernorate] = useState('');
  const [newCustomerSource, setNewCustomerSource] = useState('');
  const [newCustomerSourceCustom, setNewCustomerSourceCustom] = useState('');
  const [newCustomerShipping, setNewCustomerShipping] = useState('');
  const [newCustomerShippingCustom, setNewCustomerShippingCustom] = useState('');

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
      
      // Filter out expired offers and not-yet-started offers
      const now = new Date();
      const activeOffers = (offersRes.data || []).filter((offer: any) => {
        if (offer.expires_at && new Date(offer.expires_at) <= now) return false;
        if (offer.starts_at && new Date(offer.starts_at) > now) return false;
        return true;
      });
      setOfferBoxes(activeOffers);
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('حدث خطأ أثناء جلب البيانات');
    } finally {
      setLoading(false);
    }
  };

  const genCartId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const addToCart = (product: Product, customPrice?: number, isOfferItem?: boolean, isHalfKg?: boolean, offerBoxId?: string, offerBoxName?: string) => {
    // For non-offer items, merge identical lines
    if (!isOfferItem) {
      const existingItem = cart.find(item =>
        !item.isOfferItem &&
        item.product.id === product.id &&
        item.customPrice === customPrice &&
        item.isHalfKg === isHalfKg
      );
      if (existingItem) {
        setCart(cart.map(item =>
          item.cartItemId === existingItem.cartItemId
            ? { ...item, quantity: item.quantity + 1 }
            : item
        ));
        return;
      }
    }
    setCart(prev => [...prev, {
      cartItemId: genCartId(),
      product,
      quantity: 1,
      customPrice,
      isOfferItem,
      isHalfKg,
      offerBoxId,
      offerBoxName,
    }]);
  };

  // Offer preview dialog state
  const [offerPreview, setOfferPreview] = useState<{ box: OfferBox; items: OfferPreviewItem[] } | null>(null);

  const openOfferPreview = async (offerBox: OfferBox) => {
    try {
      const { data: items, error } = await supabase
        .from('offer_box_items')
        .select('*')
        .eq('offer_box_id', offerBox.id);
      if (error) throw error;
      if (!items || items.length === 0) {
        toast.error('هذا العرض لا يحتوي على منتجات');
        return;
      }
      const productIds = items.map(i => i.product_id);
      const { data: productData } = await supabase
        .from('products')
        .select('*')
        .in('id', productIds);

      const previewItems: OfferPreviewItem[] = items.map(it => ({
        id: it.id,
        product_id: it.product_id,
        product: (productData?.find(p => p.id === it.product_id) as Product) || null,
        custom_price: (it as any).is_gift ? 0 : Number(it.custom_price),
        quantity: Number(it.quantity),
        is_gift: !!(it as any).is_gift,
      }));
      setOfferPreview({ box: offerBox, items: previewItems });
    } catch (e) {
      console.error(e);
      toast.error('حدث خطأ أثناء جلب تفاصيل العرض');
    }
  };

  const updateOfferPreviewItem = (id: string, patch: Partial<OfferPreviewItem>) => {
    if (!offerPreview) return;
    setOfferPreview({
      ...offerPreview,
      items: offerPreview.items.map(it => it.id === id ? { ...it, ...patch } : it),
    });
  };

  const swapOfferPreviewProduct = (id: string, newProductId: string) => {
    const newProduct = products.find(p => p.id === newProductId);
    if (!newProduct) return;
    updateOfferPreviewItem(id, { product_id: newProductId, product: newProduct });
  };

  const removeOfferPreviewItem = (id: string) => {
    if (!offerPreview) return;
    setOfferPreview({
      ...offerPreview,
      items: offerPreview.items.filter(it => it.id !== id),
    });
  };

  const addOfferPreviewItem = (asGift: boolean = false) => {
    if (!offerPreview) return;
    const firstProduct = products[0];
    if (!firstProduct) {
      toast.error('لا توجد منتجات متاحة للإضافة');
      return;
    }
    const newItem: OfferPreviewItem = {
      id: `new-${genCartId()}`,
      product_id: firstProduct.id,
      product: firstProduct,
      custom_price: asGift ? 0 : (Number(firstProduct.price) || 0),
      quantity: 1,
      is_gift: asGift,
    };
    setOfferPreview({
      ...offerPreview,
      items: [...offerPreview.items, newItem],
    });
  };

  const toggleOfferPreviewGift = (id: string) => {
    if (!offerPreview) return;
    setOfferPreview({
      ...offerPreview,
      items: offerPreview.items.map(it => {
        if (it.id !== id) return it;
        const becomingGift = !it.is_gift;
        return {
          ...it,
          is_gift: becomingGift,
          custom_price: becomingGift ? 0 : (Number(it.product?.price) || it.custom_price || 0),
        };
      }),
    });
  };

  const confirmAddOfferToCart = () => {
    if (!offerPreview) return;
    let added = 0;
    for (const it of offerPreview.items) {
      if (!it.product) continue;
      setCart(prev => [...prev, {
        cartItemId: genCartId(),
        product: it.product!,
        quantity: it.quantity,
        customPrice: it.custom_price,
        isOfferItem: true,
        offerBoxId: offerPreview.box.id,
        offerBoxName: offerPreview.box.name,
      }]);
      added++;
    }
    if (added > 0) toast.success(`تم إضافة عرض "${offerPreview.box.name}" للسلة`);
    setOfferPreview(null);
  };

  const updateQuantityById = (cartItemId: string, delta: number) => {
    setCart(cart.map(item => {
      if (item.cartItemId === cartItemId) {
        const newQuantity = item.quantity + delta;
        if (newQuantity <= 0) return item;
        return { ...item, quantity: newQuantity };
      }
      return item;
    }));
  };

  const removeFromCartById = (cartItemId: string) => {
    setCart(cart.filter(item => item.cartItemId !== cartItemId));
  };

  const updateCartItem = (cartItemId: string, patch: Partial<CartItem>) => {
    setCart(cart.map(item => item.cartItemId === cartItemId ? { ...item, ...patch } : item));
  };

  const swapCartProduct = (cartItemId: string, newProductId: string) => {
    const newProduct = products.find(p => p.id === newProductId);
    if (!newProduct) return;
    updateCartItem(cartItemId, { product: newProduct });
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
  const hasOfferInCart = cart.some(item => item.isOfferItem);

  // When offers are present, the delivery fee equals the sum of the offers' bundled shipping
  // (shipping_cost stored on offer_boxes). This avoids charging shipping twice and keeps the
  // box at its advertised price (e.g., 1485 = items 1375 + 110 bundled shipping).
  const offerShippingTotal = useMemo(() => {
    const offerIds = Array.from(new Set(cart.filter(i => i.isOfferItem && i.offerBoxId).map(i => i.offerBoxId as string)));
    return offerIds.reduce((sum, id) => {
      const box = offerBoxes.find(b => b.id === id);
      return sum + Number(box?.shipping_cost || 0);
    }, 0);
  }, [cart, offerBoxes]);

  useEffect(() => {
    if (hasOfferInCart) {
      setDeliveryFee(offerShippingTotal);
    }
  }, [hasOfferInCart, offerShippingTotal]);

  const total = subtotal - discount + deliveryFee;

  const handleAddCustomer = async () => {
    if (!newCustomerName.trim() || !newCustomerPhone.trim()) {
      toast.error('يرجى إدخال اسم العميل ورقم الهاتف');
      return;
    }

    try {
      const finalSource = (newCustomerSource === 'أخرى' ? newCustomerSourceCustom.trim() : newCustomerSource) || null;
      const finalShipping = (newCustomerShipping === 'أخرى' ? newCustomerShippingCustom.trim() : newCustomerShipping) || null;
      const payload = {
        name: newCustomerName.trim(),
        phone: newCustomerPhone.trim(),
        phone2: newCustomerPhone2.trim() || null,
        address: newCustomerAddress.trim() || null,
        city: newCustomerCity.trim() || null,
        governorate: newCustomerGovernorate.trim() || null,
        source: finalSource,
        shipping_company: finalShipping,
      };

      let data: Customer;
      if (editingCustomerId) {
        const res = await supabase
          .from('customers')
          .update(payload)
          .eq('id', editingCustomerId)
          .select()
          .single();
        if (res.error) throw res.error;
        data = res.data as Customer;
        setCustomers(customers.map(c => c.id === data.id ? data : c));
      } else {
        const res = await supabase
          .from('customers')
          .insert(payload)
          .select()
          .single();
        if (res.error) throw res.error;
        data = res.data as Customer;
        setCustomers([...customers, data]);
      }

      setSelectedCustomer(data);
      setDeliveryAddress(data.address || '');
      if (finalSource) setSource(finalSource === newCustomerSourceCustom.trim() ? 'أخرى' : finalSource);
      if (newCustomerSource === 'أخرى') setSourceCustom(newCustomerSourceCustom);
      if (finalShipping) setShippingCompany(finalShipping === newCustomerShippingCustom.trim() ? 'أخرى' : finalShipping);
      if (newCustomerShipping === 'أخرى') setShippingCustom(newCustomerShippingCustom);
      setIsNewCustomerOpen(false);
      resetCustomerForm();
      toast.success(editingCustomerId ? 'تم تحديث بيانات العميل' : 'تم إضافة العميل بنجاح');
    } catch (error) {
      console.error('Error saving customer:', error);
      toast.error(editingCustomerId ? 'حدث خطأ أثناء تحديث بيانات العميل' : 'حدث خطأ أثناء إضافة العميل');
    }
  };

  const openEditCustomer = (c: Customer) => {
    setEditingCustomerId(c.id);
    setNewCustomerName(c.name || '');
    setNewCustomerPhone(c.phone || '');
    setNewCustomerPhone2((c as any).phone2 || '');
    setNewCustomerAddress((c as any).address || '');
    setNewCustomerCity((c as any).city || '');
    setNewCustomerGovernorate((c as any).governorate || '');
    const knownSources = ['فيسبوك','حملات فيسبوك','انستجرام','تيك توك','واتساب','حملات واتساب','تلجرام','ويب سايت','إعلان','تسويق','مكالمة','شركة الشحن','استلام من المقر'];
    const src = (c as any).source || '';
    if (src && !knownSources.includes(src)) {
      setNewCustomerSource('أخرى');
      setNewCustomerSourceCustom(src);
    } else {
      setNewCustomerSource(src);
      setNewCustomerSourceCustom('');
    }
    const knownShip = ['مندوب من المزرعة','استلام من المزرعة','العاصمة','مندوب خاص'];
    const ship = (c as any).shipping_company || '';
    if (ship && !knownShip.includes(ship)) {
      setNewCustomerShipping('أخرى');
      setNewCustomerShippingCustom(ship);
    } else {
      setNewCustomerShipping(ship);
      setNewCustomerShippingCustom('');
    }
    setIsNewCustomerOpen(true);
  };

  const resetCustomerForm = () => {
    setEditingCustomerId(null);
    setNewCustomerName('');
    setNewCustomerPhone('');
    setNewCustomerPhone2('');
    setNewCustomerAddress('');
    setNewCustomerCity('');
    setNewCustomerGovernorate('');
    setNewCustomerSource('');
    setNewCustomerSourceCustom('');
    setNewCustomerShipping('');
    setNewCustomerShippingCustom('');
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
          product_name: item.product.name,
          quantity: item.quantity,
          unit_price: unitPrice,
          total_price: unitPrice * item.quantity,
          is_half_kg: !!item.isHalfKg,
          offer_name: item.isOfferItem ? (item.offerBoxName || 'عرض') : null,
        } as any;
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
    c.phone.includes(customerSearch) ||
    ((c as any).phone2 || '').includes(customerSearch)
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
                  <Dialog
                    open={isNewCustomerOpen}
                    onOpenChange={(open) => {
                      setIsNewCustomerOpen(open);
                      if (!open) resetCustomerForm();
                    }}
                  >
                    <DialogTrigger asChild>
                      <Button variant="outline" className="gap-2" onClick={() => resetCustomerForm()}>
                        <Plus className="w-4 h-4" />
                        عميل جديد
                      </Button>
                    </DialogTrigger>
                    <DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto">
                      <DialogHeader>
                        <DialogTitle>{editingCustomerId ? 'تعديل بيانات العميل' : 'إضافة عميل جديد'}</DialogTitle>
                        <DialogDescription>{editingCustomerId ? 'قم بتحديث أي من بيانات العميل' : 'أدخل بيانات العميل الجديد'}</DialogDescription>
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
                          <Label>رقم هاتف آخر (اختياري)</Label>
                          <Input
                            placeholder="01xxxxxxxxx"
                            value={newCustomerPhone2}
                            onChange={(e) => setNewCustomerPhone2(e.target.value)}
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
                        <div className="space-y-2">
                          <Label>المحافظة</Label>
                          <Input
                            placeholder="المحافظة"
                            value={newCustomerGovernorate}
                            onChange={(e) => setNewCustomerGovernorate(e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>مصدر العميل</Label>
                          <Select value={newCustomerSource} onValueChange={setNewCustomerSource}>
                            <SelectTrigger><SelectValue placeholder="اختر المصدر" /></SelectTrigger>
                            <SelectContent>
                              {['فيسبوك','حملات فيسبوك','انستجرام','تيك توك','واتساب','حملات واتساب','تلجرام','ويب سايت','إعلان','تسويق','مكالمة','شركة الشحن','استلام من المقر','أخرى'].map(s => (
                                <SelectItem key={s} value={s}>{s}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {newCustomerSource === 'أخرى' && (
                            <Input placeholder="أدخل المصدر" value={newCustomerSourceCustom} onChange={(e) => setNewCustomerSourceCustom(e.target.value)} />
                          )}
                        </div>
                        <div className="space-y-2">
                          <Label>شركة الشحن</Label>
                          <Select value={newCustomerShipping} onValueChange={setNewCustomerShipping}>
                            <SelectTrigger><SelectValue placeholder="اختر شركة الشحن" /></SelectTrigger>
                            <SelectContent>
                              {['مندوب من المزرعة','استلام من المزرعة','العاصمة','مندوب خاص','أخرى'].map(s => (
                                <SelectItem key={s} value={s}>{s}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {newCustomerShipping === 'أخرى' && (
                            <Input placeholder="أدخل اسم شركة الشحن" value={newCustomerShippingCustom} onChange={(e) => setNewCustomerShippingCustom(e.target.value)} />
                          )}
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => { setIsNewCustomerOpen(false); resetCustomerForm(); }}>
                          إلغاء
                        </Button>
                        <Button onClick={handleAddCustomer}>{editingCustomerId ? 'حفظ التعديلات' : 'إضافة'}</Button>
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
                  <div className="mt-3 p-3 bg-muted/50 rounded-lg flex items-center justify-between gap-2 flex-wrap">
                    <div className="min-w-0">
                      <p className="font-medium">{selectedCustomer.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {selectedCustomer.phone}
                        {(selectedCustomer as any).phone2 ? ` / ${(selectedCustomer as any).phone2}` : ''}
                      </p>
                      {((selectedCustomer as any).address || (selectedCustomer as any).governorate) && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {[(selectedCustomer as any).governorate, (selectedCustomer as any).city, (selectedCustomer as any).address].filter(Boolean).join(' - ')}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1"
                        onClick={() => openEditCustomer(selectedCustomer)}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        تعديل
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedCustomer(null)}
                      >
                        تغيير
                      </Button>
                    </div>
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
                            onClick={() => openOfferPreview(offer)}
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
                              عرض ضع تفاصيله
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
                    <div className="space-y-3 max-h-96 overflow-auto">
                      {cart.map((item) => {
                        const basePrice = item.customPrice ?? item.product.price;
                        const unitPrice = item.isHalfKg ? basePrice / 2 : basePrice;
                        const kgEquivalent = isKgUnit(item.product.unit)
                          ? (item.isHalfKg ? item.quantity / 2 : item.quantity)
                          : null;
                        return (
                        <div
                          key={item.cartItemId}
                          className={`p-3 rounded-lg ${
                            item.isOfferItem ? 'bg-green-50 dark:bg-green-950/20 border border-green-200' : 'bg-muted/50'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-medium text-sm truncate">{item.product.name}</p>
                                {item.isOfferItem && (
                                  <Badge variant="secondary" className="text-xs bg-green-100 text-green-700">
                                    {item.offerBoxName ? `عرض: ${item.offerBoxName}` : 'عرض'}
                                  </Badge>
                                )}
                                {item.isHalfKg && (
                                  <Badge variant="secondary" className="text-xs">نصف كيلو</Badge>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground">
                                {unitPrice.toLocaleString()} × {item.quantity}
                                {kgEquivalent !== null && (
                                  <span className="mr-2 text-primary">= {kgEquivalent} كجم</span>
                                )}
                              </p>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button variant="outline" size="icon" className="h-7 w-7"
                                onClick={() => updateQuantityById(item.cartItemId, -1)}>
                                <Minus className="w-3 h-3" />
                              </Button>
                              <span className="w-8 text-center font-medium">{item.quantity}</span>
                              <Button variant="outline" size="icon" className="h-7 w-7"
                                onClick={() => updateQuantityById(item.cartItemId, 1)}>
                                <Plus className="w-3 h-3" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                                onClick={() => removeFromCartById(item.cartItemId)}>
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          </div>
                          {item.isOfferItem && (
                            <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-green-200">
                              <div>
                                <Label className="text-xs">السعر</Label>
                                <Input
                                  type="number"
                                  className="h-8 text-sm"
                                  value={item.customPrice ?? item.product.price}
                                  onChange={(e) => updateCartItem(item.cartItemId, { customPrice: Number(e.target.value) })}
                                />
                              </div>
                              <div>
                                <Label className="text-xs">تبديل المنتج</Label>
                                <Select value={item.product.id} onValueChange={(v) => swapCartProduct(item.cartItemId, v)}>
                                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {products.map(p => (
                                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                          )}
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
                        <div className="flex gap-2">
                          <Input
                            type="number"
                            value={deliveryFee}
                            onChange={(e) => setDeliveryFee(Number(e.target.value))}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            title="مسح رسوم الشحن"
                            onClick={() => setDeliveryFee(0)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                        {hasOfferInCart && (
                          <p className="text-xs text-muted-foreground">
                            العرض يشمل رسوم الشحن — يمكنك تعديل الرسوم يدويًا إن لزم الأمر.
                          </p>
                        )}
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

                    {/* Source */}
                    <div className="space-y-2">
                      <Label>مصدر العميل</Label>
                      <Select value={source} onValueChange={setSource}>
                        <SelectTrigger><SelectValue placeholder="اختر المصدر" /></SelectTrigger>
                        <SelectContent>
                          {['فيسبوك','حملات فيسبوك','انستجرام','تيك توك','واتساب','حملات واتساب','تلجرام','ويب سايت','إعلان','تسويق','مكالمة','شركة الشحن','استلام من المقر','أخرى'].map(s => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {source === 'أخرى' && (
                        <Input placeholder="أدخل المصدر" value={sourceCustom} onChange={(e) => setSourceCustom(e.target.value)} />
                      )}
                    </div>

                    {/* Shipping Company */}
                    <div className="space-y-2">
                      <Label>شركة الشحن</Label>
                      <Select value={shippingCompany} onValueChange={setShippingCompany}>
                        <SelectTrigger><SelectValue placeholder="اختر شركة الشحن" /></SelectTrigger>
                        <SelectContent>
                          {['مندوب من المزرعة','استلام من المزرعة','العاصمة','مندوب خاص','أخرى'].map(s => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {shippingCompany === 'أخرى' && (
                        <Input placeholder="أدخل اسم شركة الشحن" value={shippingCustom} onChange={(e) => setShippingCustom(e.target.value)} />
                      )}
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

      {/* Offer Preview Dialog */}
      <Dialog open={!!offerPreview} onOpenChange={(o) => !o && setOfferPreview(null)}>
        <DialogContent dir="rtl" className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Gift className="w-5 h-5 text-primary" />
              تفاصيل العرض: {offerPreview?.box.name}
            </DialogTitle>
            {offerPreview?.box.description && (
              <DialogDescription>{offerPreview.box.description}</DialogDescription>
            )}
          </DialogHeader>
          {offerPreview && (
            <div className="space-y-3 max-h-[60vh] overflow-auto">
              <p className="text-sm text-muted-foreground">
                يمكنك تعديل المنتج أو السعر أو الكمية قبل إضافة العرض للسلة.
              </p>
              {offerPreview.items.map(it => (
                <div key={it.id} className={`grid grid-cols-12 gap-2 items-end p-3 border rounded-lg ${it.is_gift ? 'bg-primary/5 border-primary/30' : 'bg-muted/30'}`}>
                  <div className="col-span-4">
                    <Label className="text-xs flex items-center gap-1">
                      المنتج
                      {it.is_gift && (
                        <span className="inline-flex items-center gap-1 text-primary text-[10px] px-1.5 py-0.5 rounded bg-primary/10 border border-primary/30">
                          <Gift className="w-3 h-3" /> هدية مجانية
                        </span>
                      )}
                    </Label>
                    <Select value={it.product_id} onValueChange={(v) => swapOfferPreviewProduct(it.id, v)}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {products.map(p => (
                          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-3">
                    <Label className="text-xs">السعر</Label>
                    <Input type="number" className="h-9" value={it.is_gift ? 0 : it.custom_price}
                      disabled={it.is_gift}
                      onChange={(e) => updateOfferPreviewItem(it.id, { custom_price: Number(e.target.value) })} />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">الكمية</Label>
                    <Input type="number" min={1} className="h-9" value={it.quantity}
                      onChange={(e) => updateOfferPreviewItem(it.id, { quantity: Math.max(1, Number(e.target.value)) })} />
                  </div>
                  <div className="col-span-2 text-xs text-muted-foreground text-center pb-2">
                    {it.is_gift ? 'مجاني' : (it.custom_price * it.quantity).toLocaleString()}
                  </div>
                  <div className="col-span-1 flex flex-col items-center gap-1 pb-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => removeOfferPreviewItem(it.id)}
                      title="حذف المنتج من العرض"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2 border-dashed"
                  onClick={() => addOfferPreviewItem(false)}
                >
                  <Plus className="w-4 h-4" />
                  إضافة منتج للعرض
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2 border-dashed text-primary border-primary/40 hover:bg-primary/5"
                  onClick={() => addOfferPreviewItem(true)}
                >
                  <Gift className="w-4 h-4" />
                  إضافة هدية مجانية
                </Button>
              </div>
              <div className="flex items-center justify-between p-3 bg-primary/10 rounded-lg font-semibold">
                <span>إجمالي العرض</span>
                <span>{offerPreview.items.reduce((s, i) => s + (i.is_gift ? 0 : i.custom_price * i.quantity), 0).toLocaleString()} ج.م</span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOfferPreview(null)}>إلغاء</Button>
            <Button onClick={confirmAddOfferToCart}>
              <Plus className="w-4 h-4 ml-1" />
              إضافة العرض للسلة
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default NewOrder;
