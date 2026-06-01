import { useState, useEffect, useMemo } from 'react';
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
import { normalizePhone } from '@/lib/normalizePhone';
import { Skeleton } from '@/components/ui/skeleton';

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
  phone2?: string | null;
  address: string | null;
  city: string | null;
  governorate?: string | null;
  source?: string | null;
  shipping_company?: string | null;
  total_orders?: number | null;
  total_spent?: number | null;
}

type CustomerSearchRow = Pick<
  Customer,
  'id' | 'name' | 'phone' | 'phone2' | 'address' | 'city' | 'governorate' | 'source' | 'shipping_company' | 'total_orders' | 'total_spent'
>;

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

const QUERY_TIMEOUT_MS = 12000;

const getErrorMessage = (error: unknown, timeoutFallback: string) => {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (message.startsWith('TIMEOUT:')) return timeoutFallback;
  return message || timeoutFallback;
};

const withTimedQuery = async <T,>(
  label: string,
  query: () => T | PromiseLike<T>,
  timeoutMs = QUERY_TIMEOUT_MS,
): Promise<T> => {
  console.time(label);
  let timeoutId: number | undefined;

  try {
    return await Promise.race([
      Promise.resolve(query()),
      new Promise<T>((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error(`TIMEOUT:${label}`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    console.timeEnd(label);
  }
};

const NewOrder = () => {
  const navigate = useNavigate();
  const { user, isSalesModerator } = useAuth();
  const [approvalDialog, setApprovalDialog] = useState<{ open: boolean; status: 'idle'|'pending'|'rejected'; reason?: string }>({ open: false, status: 'idle' });
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
      try {
        const { data } = await withTimedQuery(
          '[NewOrder] moderator profile query',
          () => supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle(),
        );
        const m = findModeratorByName(data?.full_name);
        if (m) setModeratorName(m.canonicalModerator);
      } catch (error) {
        console.error('Moderator profile query failed:', error);
      }
    })();
  }, [user, searchParams]);

  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [offerBoxes, setOfferBoxes] = useState<OfferBox[]>([]);
  const [offerContentsById, setOfferContentsById] = useState<Record<string, string[]>>({});
  const [pageShellLoading, setPageShellLoading] = useState(true);
  const [productsLoading, setProductsLoading] = useState(true);
  const [offersLoading, setOffersLoading] = useState(true);
  const [warehousesLoading, setWarehousesLoading] = useState(true);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [offerContentsLoading, setOfferContentsLoading] = useState(false);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [offersError, setOffersError] = useState<string | null>(null);
  const [warehousesError, setWarehousesError] = useState<string | null>(null);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const [offerContentsError, setOfferContentsError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  
  // Cart state
  const [cart, setCart] = useState<CartItem[]>([]);
  // Tracks how many times each offer box was added (for shipping = N × 110).
  const [offerInstanceCounts, setOfferInstanceCounts] = useState<Record<string, number>>({});
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'online'>('cash');
  const [deliveryFee, setDeliveryFee] = useState(110);
  const [discount, setDiscount] = useState(0);
  const [extraCharge, setExtraCharge] = useState(0);
  const [extraChargeReason, setExtraChargeReason] = useState('');
  const [notes, setNotes] = useState('');
  const [depositReceiptFile, setDepositReceiptFile] = useState<File | null>(null);
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [source, setSource] = useState<string>('');
  const [sourceCustom, setSourceCustom] = useState('');
  const [shippingCompany, setShippingCompany] = useState<string>('');
  const [shippingCustom, setShippingCustom] = useState('');
  // Fulfillment source — مصدر تنفيذ الطلب
  const [fulfillmentKey, setFulfillmentKey] = useState<'pickup_agouza'|'delivery_agouza'|'pickup_main'|'delivery_main'|''>('');
  const [warehousesList, setWarehousesList] = useState<Array<{id:string;name:string}>>([]);
  const agouzaWh = useMemo(() => warehousesList.find(w => w.name?.includes('العجوزة')), [warehousesList]);
  const mainWh = useMemo(() => warehousesList.find(w => w.name?.includes('الرئيسي') || w.name?.includes('المقر')), [warehousesList]);
  // Available stock per product per warehouse (stock - reserved - blocked)
  const [agouzaStock, setAgouzaStock] = useState<Record<string, number>>({});
  const [mainStock, setMainStock] = useState<Record<string, number>>({});

  // عند اختيار "توصيل من المخزن الرئيسى" → الأوردر يتسجل تلقائياً على المندوب الخاص (كيمو)
  useEffect(() => {
    if (fulfillmentKey === 'delivery_main') {
      setShippingCompany('مندوب خاص');
      setShippingCustom('');
    }
  }, [fulfillmentKey]);
  
  
  // Search
  const [productSearch, setProductSearch] = useState('');
  const [customQty, setCustomQty] = useState<Record<string, string>>({});
  const [customerSearch, setCustomerSearch] = useState('');
  const [searchingCustomers, setSearchingCustomers] = useState(false);
  
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
    console.time('[NewOrder] page shell visible');
    const firstFrame = window.requestAnimationFrame(() => {
      const secondFrame = window.requestAnimationFrame(() => {
        setPageShellLoading(false);
        console.timeEnd('[NewOrder] page shell visible');
      });

      return () => window.cancelAnimationFrame(secondFrame);
    });

    fetchData();

    return () => window.cancelAnimationFrame(firstFrame);
  }, []);

  const fetchData = () => {
    setCustomers([]);
    setProductsLoading(true);
    setOffersLoading(true);
    setWarehousesLoading(true);
    setInventoryLoading(false);
    setOfferContentsLoading(false);
    setProductsError(null);
    setOffersError(null);
    setWarehousesError(null);
    setInventoryError(null);
    setOfferContentsError(null);
    setOfferContentsById({});

    const loadProducts = async () => {
      try {
        const productsRes = await withTimedQuery(
          '[NewOrder] products query',
          () => supabase.from('products').select('*').eq('is_active', true),
        );
        if (productsRes.error) throw productsRes.error;
        setProducts(productsRes.data || []);
      } catch (error) {
        console.error('Products fetch failed:', error);
        setProductsError(getErrorMessage(error, 'استغرق تحميل المنتجات وقتًا أطول من المتوقع.'));
      } finally {
        setProductsLoading(false);
      }
    };

    const loadOffers = async () => {
      try {
        const offersRes = await withTimedQuery(
          '[NewOrder] offers query',
          () => supabase.from('offer_boxes').select('*').eq('is_active', true),
        );
        if (offersRes.error) throw offersRes.error;

        const now = new Date();
        const activeOffers = (offersRes.data || []).filter((offer: any) => {
          if (offer.expires_at && new Date(offer.expires_at) <= now) return false;
          if (offer.starts_at && new Date(offer.starts_at) > now) return false;
          return true;
        });

        setOfferBoxes(activeOffers);
        return activeOffers as OfferBox[];
      } catch (error) {
        console.error('Offers fetch failed:', error);
        setOffersError(getErrorMessage(error, 'استغرق تحميل العروض وقتًا أطول من المتوقع.'));
        return [] as OfferBox[];
      } finally {
        setOffersLoading(false);
      }
    };

    const loadWarehouses = async () => {
      try {
        const whRes = await withTimedQuery(
          '[NewOrder] warehouses query',
          () => supabase.from('warehouses').select('id, name').eq('is_active', true),
        );
        if (whRes.error) throw whRes.error;
        const whs = whRes.data || [];
        setWarehousesList(whs);
        return whs as Array<{ id: string; name: string }>;
      } catch (error) {
        console.error('Warehouses fetch failed:', error);
        setWarehousesError(getErrorMessage(error, 'استغرق تحميل المخازن وقتًا أطول من المتوقع.'));
        return [] as Array<{ id: string; name: string }>;
      } finally {
        setWarehousesLoading(false);
      }
    };

    void loadProducts();

    void loadWarehouses().then(async (whs) => {
      const agouza = whs.find((w) => w.name?.includes('العجوزة'));
      const main = whs.find((w) => w.name?.includes('الرئيسي') || w.name?.includes('المقر'));
      const whIds = [agouza?.id, main?.id].filter(Boolean) as string[];

      if (whIds.length === 0) {
        setAgouzaStock({});
        setMainStock({});
        return;
      }

      setInventoryLoading(true);
      try {
        const { data: invRows, error } = await withTimedQuery(
          '[NewOrder] inventory_items query',
          () => supabase
            .from('inventory_items')
            .select('warehouse_id, product_id, stock, reserved_qty, blocked_qty')
            .in('warehouse_id', whIds)
            .not('product_id', 'is', null),
        );
        if (error) throw error;

        const ag: Record<string, number> = {};
        const mn: Record<string, number> = {};
        (invRows || []).forEach((r: any) => {
          const avail = Number(r.stock || 0) - Number(r.reserved_qty || 0) - Number(r.blocked_qty || 0);
          if (r.warehouse_id === agouza?.id) ag[r.product_id] = (ag[r.product_id] || 0) + avail;
          if (r.warehouse_id === main?.id) mn[r.product_id] = (mn[r.product_id] || 0) + avail;
        });
        setAgouzaStock(ag);
        setMainStock(mn);
      } catch (error) {
        console.error('Inventory fetch failed:', error);
        setInventoryError(getErrorMessage(error, 'استغرق تحميل المخزون وقتًا أطول من المتوقع.'));
      } finally {
        setInventoryLoading(false);
      }
    });

    void loadOffers().then(async (activeOffers) => {
      if (activeOffers.length === 0) {
        setOfferContentsById({});
        return;
      }

      setOfferContentsLoading(true);
      try {
        const { data: offerItemsRes, error: offerItemsError } = await withTimedQuery(
          '[NewOrder] offer_box_items query',
          () => supabase
            .from('offer_box_items')
            .select('offer_box_id, product_id, quantity')
            .in('offer_box_id', activeOffers.map((offer) => offer.id)),
        );
        if (offerItemsError) throw offerItemsError;

        const productIds = Array.from(new Set((offerItemsRes || []).map((item) => item.product_id).filter(Boolean)));
        const offerProductsRes = productIds.length === 0
          ? { data: [], error: null }
          : await withTimedQuery(
              '[NewOrder] offer content products query',
              () => supabase.from('products').select('id, name').in('id', productIds),
            );
        if (offerProductsRes.error) throw offerProductsRes.error;

        const productNameById = new Map((offerProductsRes.data || []).map((product: any) => [product.id, product.name]));
        const nextContents = (offerItemsRes || []).reduce((acc, item: any) => {
          const productName = productNameById.get(item.product_id);
          if (!productName) return acc;
          const line = `${Number(item.quantity || 0).toLocaleString()} × ${productName}`;
          acc[item.offer_box_id] = [...(acc[item.offer_box_id] || []), line];
          return acc;
        }, {} as Record<string, string[]>);

        setOfferContentsById(nextContents);
      } catch (error) {
        console.error('Offer contents fetch failed:', error);
        setOfferContentsError(getErrorMessage(error, 'استغرق تحميل محتويات البوكسات وقتًا أطول من المتوقع.'));
      } finally {
        setOfferContentsLoading(false);
      }
    });
  };

  useEffect(() => {
    const query = customerSearch.trim();
    const normalized = normalizePhone(query);

    if (!query) {
      setCustomers([]);
      setSearchingCustomers(false);
      return;
    }

    const timer = window.setTimeout(async () => {
      setSearchingCustomers(true);
      try {
        const CUSTOMER_COLS = 'id,name,phone,phone2,address,city,governorate,source,shipping_company,total_orders,total_spent';
        const terms = Array.from(new Set([query, normalized].filter(Boolean)));
        const collected = new Map<string, CustomerSearchRow>();

        const requests = terms.slice(0, 2).map((term) =>
          supabase
            .from('customers')
            .select(CUSTOMER_COLS)
            .or(`name.ilike.%${term}%,phone.ilike.%${term}%,phone2.ilike.%${term}%`)
            .order('name')
            .limit(25)
        );

        const results = await Promise.all(requests);
        for (const res of results) {
          if (res.error) throw res.error;
          (res.data || []).forEach((customer: any) => collected.set(customer.id, customer));
        }

        setCustomers(Array.from(collected.values()));
      } catch (error) {
        console.error('Error searching customers:', error);
      } finally {
        setSearchingCustomers(false);
      }
    }, 250);

    return () => window.clearTimeout(timer);
  }, [customerSearch]);

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

  const addCustomKgToCart = (product: Product, qty: number) => {
    if (!qty || qty <= 0 || !isFinite(qty)) return;
    const existing = cart.find(
      i => !i.isOfferItem && i.product.id === product.id && !i.isHalfKg && i.customPrice === undefined
    );
    if (existing) {
      setCart(cart.map(i => i.cartItemId === existing.cartItemId ? { ...i, quantity: i.quantity + qty } : i));
    } else {
      setCart(prev => [...prev, { cartItemId: genCartId(), product, quantity: qty }]);
    }
    setCustomQty(s => ({ ...s, [product.id]: '' }));
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
    const cur = offerPreview?.items.find(i => i.id === id);
    const patch: Partial<OfferPreviewItem> = { product_id: newProductId, product: newProduct };
    // Auto-fill price from the newly selected product (skip if it's a gift)
    if (!cur?.is_gift) patch.custom_price = Number(newProduct.price) || 0;
    updateOfferPreviewItem(id, patch);
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
    const boxId = offerPreview.box.id;
    const boxName = offerPreview.box.name;
    let added = 0;
    setCart(prev => {
      const next = [...prev];
      for (const it of offerPreview.items) {
        if (!it.product) continue;
        // Merge with an existing offer line for the SAME offer box + product + price
        // so two of the same offer combine quantities (e.g., نص كيلو + نص كيلو = كيلو).
        const idx = next.findIndex(c =>
          c.isOfferItem &&
          c.offerBoxId === boxId &&
          c.product.id === it.product!.id &&
          (c.customPrice ?? c.product.price) === it.custom_price
        );
        if (idx >= 0) {
          next[idx] = { ...next[idx], quantity: next[idx].quantity + it.quantity };
        } else {
          next.push({
            cartItemId: genCartId(),
            product: it.product!,
            quantity: it.quantity,
            customPrice: it.custom_price,
            isOfferItem: true,
            offerBoxId: boxId,
            offerBoxName: boxName,
          });
        }
        added++;
      }
      return next;
    });
    setOfferInstanceCounts(prev => ({ ...prev, [boxId]: (prev[boxId] || 0) + 1 }));
    if (added > 0) toast.success(`تم إضافة عرض "${boxName}" للسلة`);
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
    const removed = cart.find(i => i.cartItemId === cartItemId);
    setCart(cart.filter(item => item.cartItemId !== cartItemId));
    // If we removed the last line of an offer box, clear its instance counter too.
    if (removed?.isOfferItem && removed.offerBoxId) {
      const boxId = removed.offerBoxId;
      const stillHas = cart.some(i => i.cartItemId !== cartItemId && i.isOfferItem && i.offerBoxId === boxId);
      if (!stillHas) {
        setOfferInstanceCounts(prev => {
          const next = { ...prev };
          delete next[boxId];
          return next;
        });
      }
    }
  };

  const decrementOfferInstance = (boxId: string) => {
    setOfferInstanceCounts(prev => {
      const cur = prev[boxId] || 0;
      const next = { ...prev };
      if (cur <= 1) {
        delete next[boxId];
        // Remove all cart lines tied to this offer box.
        setCart(c => c.filter(i => !(i.isOfferItem && i.offerBoxId === boxId)));
      } else {
        next[boxId] = cur - 1;
        // Subtract one instance worth of quantities from merged cart lines.
        const box = offerBoxes.find(b => b.id === boxId);
        // Reload offer item template quantities to subtract correctly.
        (async () => {
          const { data: items } = await supabase
            .from('offer_box_items')
            .select('product_id, quantity, custom_price, is_gift')
            .eq('offer_box_id', boxId);
          if (!items) return;
          setCart(c => {
            const out: CartItem[] = [];
            for (const line of c) {
              if (!(line.isOfferItem && line.offerBoxId === boxId)) { out.push(line); continue; }
              const match = items.find((bi: any) =>
                bi.product_id === line.product.id &&
                Number(bi.is_gift ? 0 : bi.custom_price) === (line.customPrice ?? line.product.price)
              );
              if (!match) { out.push(line); continue; }
              const newQty = line.quantity - Number(match.quantity || 0);
              if (newQty > 0) out.push({ ...line, quantity: newQty });
            }
            return out;
          });
        })();
      }
      return next;
    });
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

  // Each added offer instance carries its own bundled shipping (e.g., 110).
  // Selecting the same 1500 offer twice => shipping = 2 × 110, not 110.
  const offerShippingTotal = useMemo(() => {
    return Object.entries(offerInstanceCounts).reduce((sum, [boxId, count]) => {
      const box = offerBoxes.find(b => b.id === boxId);
      return sum + Number(box?.shipping_cost || 0) * Number(count || 0);
    }, 0);
  }, [offerInstanceCounts, offerBoxes]);

  useEffect(() => {
    if (hasOfferInCart) {
      setDeliveryFee(offerShippingTotal);
    }
  }, [hasOfferInCart, offerShippingTotal]);

  // For offer orders, the offer's bundled shipping stays inside the total.
  // For regular orders, shipping is tracked separately and not added to the total.
  const total = subtotal - discount + Number(extraCharge || 0) + (hasOfferInCart ? Number(deliveryFee || 0) : 0);

  const handleAddCustomer = async () => {
    const normalizedPhone = normalizePhone(newCustomerPhone);
    const normalizedPhone2 = normalizePhone(newCustomerPhone2);
    if (!newCustomerName.trim() || !normalizedPhone) {
      toast.error('يرجى إدخال اسم العميل ورقم الهاتف');
      return;
    }

    try {
      const finalSource = (newCustomerSource === 'أخرى' ? newCustomerSourceCustom.trim() : newCustomerSource) || null;
      const finalShipping = (newCustomerShipping === 'أخرى' ? newCustomerShippingCustom.trim() : newCustomerShipping) || null;
      const payload = {
        name: newCustomerName.trim(),
        phone: normalizedPhone,
        phone2: normalizedPhone2 || null,
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

  // Products that require a deposit (عربون) transfer receipt before submission
  const requiresDepositReceipt = useMemo(() => {
    return cart.some(item => {
      const n = (item.product?.name || '').replace(/\s+/g, ' ').trim();
      const hasBone = n.includes('عظم') || n.includes('عضم');
      if (n.includes('دبوس') && hasBone) return true;
      if ((n.includes('فخدة') || n.includes('فخده')) && hasBone) return true;
      if ((n.includes('نعامة') || n.includes('نعامه')) && n.includes('صندوق')) return true;
      return false;
    });
  }, [cart]);

  const handleSubmitOrder = async () => {
    if (cart.length === 0) {
      toast.error('يرجى إضافة منتجات للطلب');
      return;
    }

    if (isSalesModerator && requiresDepositReceipt && !depositReceiptFile) {
      toast.error('يجب رفع إيصال تحويل العربون قبل تسجيل الطلب', {
        description: 'الطلب يحتوي على منتج (دبوس بالعظم / فخدة بالعظم / نعامة صندوق) ويتطلب إثبات تحويل العربون',
      });
      return;
    }

    if (!selectedCustomer) {
      toast.error('يرجى اختيار العميل');
      return;
    }

    setSubmitting(true);

    // Duplicate order pre-check (sales_moderator only)
    if (isSalesModerator && user?.id && selectedCustomer?.id) {
      try {
        const [{ data: hasOther }, { data: approved }] = await Promise.all([
          supabase.rpc('customer_has_other_order_today', { p_customer_id: selectedCustomer.id, p_user_id: user.id }),
          supabase.rpc('has_approved_duplicate_order', { p_customer_id: selectedCustomer.id, p_user_id: user.id }),
        ]);
        if (hasOther && !approved) {
          setSubmitting(false);
          // Check if a pending request already exists
          const { data: pending } = await supabase
            .from('duplicate_order_approvals')
            .select('status, reason')
            .eq('customer_id', selectedCustomer.id)
            .eq('requested_by', user.id)
            .gt('expires_at', new Date().toISOString())
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          setApprovalDialog({
            open: true,
            status: pending?.status === 'rejected' ? 'rejected' : (pending?.status === 'pending' ? 'pending' : 'idle'),
            reason: pending?.reason || undefined,
          });
          return;
        }
      } catch (e) {
        console.warn('duplicate check failed', e);
      }
    }

    try {
      // Generate order number
      const { data: orderNumberData, error: orderNumberError } = await supabase
        .rpc('generate_order_number');

      if (orderNumberError) throw orderNumberError;

      // Resolve fulfillment source warehouse
      if (!fulfillmentKey) {
        toast.error('يرجى اختيار مصدر تنفيذ الطلب');
        setSubmitting(false);
        return;
      }
      const isAgouza = fulfillmentKey.endsWith('_agouza');
      const fulfillmentType = fulfillmentKey.startsWith('pickup') ? 'pickup' : 'delivery';
      const sourceWh = isAgouza ? agouzaWh : mainWh;
      if (!sourceWh) {
        toast.error('تعذر تحديد المخزن المختار');
        setSubmitting(false);
        return;
      }

      // Upload deposit receipt (if required/provided) BEFORE inserting the order
      let depositReceiptPath: string | null = null;
      let depositReceiptName: string | null = null;
      if (depositReceiptFile && user?.id) {
        const ext = depositReceiptFile.name.split('.').pop() ?? 'bin';
        const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from('order-deposit-receipts')
          .upload(path, depositReceiptFile, { contentType: depositReceiptFile.type, upsert: false });
        if (upErr) {
          toast.error('تعذّر رفع إيصال العربون', { description: upErr.message });
          setSubmitting(false);
          return;
        }
        depositReceiptPath = path;
        depositReceiptName = depositReceiptFile.name;
      }

      // Create order
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert({
          order_number: orderNumberData,
          customer_id: selectedCustomer.id,
          payment_method: paymentMethod,
          subtotal,
          discount,
          delivery_fee: hasOfferInCart ? deliveryFee : 0,
          total,
          notes: notes.trim() || null,
          delivery_address: deliveryAddress.trim() || selectedCustomer.address,
          created_by: user?.id,
          moderator: moderatorName,
          source: (source === 'أخرى' ? sourceCustom.trim() : source) || null,
          shipping_company: fulfillmentKey === 'delivery_main'
            ? 'مندوب خاص'
            : ((shippingCompany === 'أخرى' ? shippingCustom.trim() : shippingCompany) || null),
          extra_charge: Number(extraCharge) || 0,
          extra_charge_reason: extraChargeReason.trim() || null,
          fulfillment_type: fulfillmentType,
          source_warehouse_id: sourceWh.id,
          deposit_receipt_url: depositReceiptPath,
          deposit_receipt_name: depositReceiptName,
        })
        .select()
        .single();

      if (orderError) throw orderError;

      // Build raw rows (preserving offer/non-offer pricing), then merge same-product lines
      // so an offer-box item + an extra outside-the-box item of the same product appear as
      // a single combined line in the order (e.g. نص استيك + نص استيك = 1 كجم استيك)
      type RawRow = {
        order_id: string;
        product_id: string;
        product_name: string;
        quantity: number;
        unit_price: number;
        total_price: number;
        is_half_kg: boolean;
        offer_name: string | null;
        _isKg: boolean;
      };
      const rawRows: RawRow[] = cart.map(item => {
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
          _isKg: isKgUnit(item.product.unit || ''),
        };
      });

      const grouped = new Map<string, RawRow[]>();
      for (const r of rawRows) {
        const arr = grouped.get(r.product_id) || [];
        arr.push(r);
        grouped.set(r.product_id, arr);
      }

      const orderItems = Array.from(grouped.values()).map(arr => {
        if (arr.length === 1) {
          const { _isKg, ...rest } = arr[0];
          return rest as any;
        }
        const isKg = arr[0]._isKg;
        let totalQty = 0;
        let totalPrice = 0;
        let offerName: string | null = null;
        for (const r of arr) {
          const qty = isKg && r.is_half_kg ? r.quantity * 0.5 : r.quantity;
          totalQty += qty;
          totalPrice += r.total_price;
          if (!offerName && r.offer_name) offerName = r.offer_name;
        }
        return {
          order_id: order.id,
          product_id: arr[0].product_id,
          product_name: arr[0].product_name,
          quantity: totalQty,
          unit_price: totalQty > 0 ? totalPrice / totalQty : 0,
          total_price: totalPrice,
          is_half_kg: isKg ? false : arr[0].is_half_kg,
          offer_name: offerName,
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

      // Auto-create production/slaughter dispatch orders for any shortages
      try {
        const { data: short } = await supabase.rpc('request_production_for_order_shortages', { p_order_id: order.id });
        const shortLines = (short as any)?.shortage_lines || 0;
        if (shortLines > 0) {
          toast.success(`تم إنشاء الطلب ${orderNumberData} • تم تحويل ${shortLines} صنف ناقص لأمر إنتاج/ذبح تلقائياً`);
        } else {
          toast.success(`تم إنشاء الطلب رقم ${orderNumberData} بنجاح`);
        }
      } catch (e) {
        toast.success(`تم إنشاء الطلب رقم ${orderNumberData} بنجاح`);
      }
      navigate('/orders');
    } catch (error: any) {
      console.error('Error creating order:', error);
      const msg = String(error?.message || '');
      if (msg.includes('DUPLICATE_ORDER_REQUIRES_APPROVAL')) {
        setApprovalDialog({ open: true, status: 'idle' });
      } else {
        toast.error('حدث خطأ أثناء إنشاء الطلب');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Custom display order grouped by category (exact DB names)
  const PRODUCT_ORDER = [
    // أولاً: اللحوم
    "لحم قطع", "موزة", "استيك", "قطعية الدبوس", "رول", "فراشة", "تربيانكو", "اسكالوب", "قطع كباب",
    // ثانياً: المصنعات
    "كفتة", "برجر", "سجق", "مفروم", "برجر جبنة", "حواوشي", "شاورما", "شيش", "كفتة الرز", "طرب", "ممبار",
    // ثالثاً: القطع الجانبية
    "كبدة", "رقاب", "قلب", "قوانص", "نخاع", "دهن",
    // رابعاً: اللحوم بالعظم
    "دبوس بالعظم 6 كيلو", "فخدة  بالعظم", "نعامة صندوق بالعظم",
  ];
  const HIDDEN_PRODUCTS = ["فرم نعام", "شغت نعام", "طرب تصنيع"];
  const normalizeName = (s: string) => (s || "").replace(/\s+/g, " ").trim();
  const orderIndexOf = (name: string) => {
    const n = normalizeName(name);
    const idx = PRODUCT_ORDER.findIndex((p) => normalizeName(p) === n);
    return idx === -1 ? 999 : idx;
  };

  const filteredProducts = products
    .filter(p => !HIDDEN_PRODUCTS.includes(normalizeName(p.name)))
    .filter(p => p.name.toLowerCase().includes(productSearch.toLowerCase()))
    .sort((a, b) => {
      const ai = orderIndexOf(a.name);
      const bi = orderIndexOf(b.name);
      if (ai !== bi) return ai - bi;
      return a.name.localeCompare(b.name, "ar");
    });

  const normalizedSearch = normalizePhone(customerSearch);
  const filteredCustomers = customers.filter(c =>
    c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
    (normalizedSearch && (c.phone.includes(normalizedSearch) || ((c as any).phone2 || '').includes(normalizedSearch))) ||
    c.phone.includes(customerSearch) ||
    ((c as any).phone2 || '').includes(customerSearch)
  );

  // كشف عميل موجود بنفس رقم الهاتف داخل فورم "عميل جديد"
  const existingCustomerMatch = useMemo(() => {
    const p1 = normalizePhone(newCustomerPhone);
    const p2 = normalizePhone(newCustomerPhone2);
    if (!p1 && !p2) return null;
    const match = customers.find(c => {
      if (editingCustomerId && c.id === editingCustomerId) return false;
      const cp1 = normalizePhone(c.phone || '');
      const cp2 = normalizePhone((c as any).phone2 || '');
      return (p1 && (cp1 === p1 || cp2 === p1)) || (p2 && (cp1 === p2 || cp2 === p2));
    });
    return match || null;
  }, [newCustomerPhone, newCustomerPhone2, customers, editingCustomerId]);

  const useExistingCustomer = () => {
    if (!existingCustomerMatch) return;
    setSelectedCustomer(existingCustomerMatch);
    setDeliveryAddress(existingCustomerMatch.address || '');
    setIsNewCustomerOpen(false);
    resetCustomerForm();
    toast.success(`تم اختيار العميل: ${existingCustomerMatch.name}`);
  };

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
                    {searchingCustomers && (
                      <p className="mt-2 text-xs text-muted-foreground">جاري البحث عن العملاء...</p>
                    )}
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
                    <DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                      <DialogHeader>
                        <DialogTitle>{editingCustomerId ? 'تعديل بيانات العميل' : 'إضافة عميل جديد'}</DialogTitle>
                        <DialogDescription>{editingCustomerId ? 'قم بتحديث أي من بيانات العميل' : 'أدخل بيانات العميل الجديد'}</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="space-y-2 md:col-span-2">
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
                          {existingCustomerMatch && (
                            <div className="md:col-span-2 rounded-lg border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2 animate-in fade-in slide-in-from-top-2">
                              <div className="flex items-start justify-between gap-2 flex-wrap">
                                <div className="space-y-1">
                                  <p className="text-sm font-bold text-amber-900 dark:text-amber-200">
                                    ⚠️ هذا الرقم مسجّل مسبقًا لعميل آخر
                                  </p>
                                  <p className="text-sm font-semibold">{existingCustomerMatch.name}</p>
                                  <p className="text-xs text-muted-foreground" dir="ltr">
                                    {existingCustomerMatch.phone}
                                    {(existingCustomerMatch as any).phone2 ? ` / ${(existingCustomerMatch as any).phone2}` : ''}
                                  </p>
                                  {(existingCustomerMatch as any).address && (
                                    <p className="text-xs text-muted-foreground">
                                      📍 {(existingCustomerMatch as any).address}
                                      {(existingCustomerMatch as any).city ? ` - ${(existingCustomerMatch as any).city}` : ''}
                                      {(existingCustomerMatch as any).governorate ? ` - ${(existingCustomerMatch as any).governorate}` : ''}
                                    </p>
                                  )}
                                  {(existingCustomerMatch as any).source && (
                                    <p className="text-xs text-muted-foreground">
                                      المصدر: {(existingCustomerMatch as any).source}
                                    </p>
                                  )}
                                </div>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="default"
                                  onClick={useExistingCustomer}
                                >
                                  استخدام هذا العميل
                                </Button>
                              </div>
                            </div>
                          )}

                          <div className="space-y-2 md:col-span-2">
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
                           <div className="space-y-2 md:col-span-2">
                             <Label>مصدر تنفيذ الطلب <span className="text-destructive">*</span></Label>
                             <Select value={fulfillmentKey} onValueChange={(v) => setFulfillmentKey(v as any)}>
                               <SelectTrigger><SelectValue placeholder="اختر من أين يستلم العميل" /></SelectTrigger>
                               <SelectContent>
                                 <SelectItem value="pickup_agouza">استلام من مخزن العجوزة</SelectItem>
                                 <SelectItem value="delivery_agouza">توصيل من منفذ العجوزة</SelectItem>
                                 <SelectItem value="pickup_main">استلام من المخزن الرئيسى</SelectItem>
                                 <SelectItem value="delivery_main">توصيل من المخزن الرئيسى</SelectItem>
                               </SelectContent>
                             </Select>
                             <p className="text-xs text-muted-foreground">
                               سيتم خصم المخزون من المخزن المختار. لو الكمية غير كافية يدخل تلقائياً فى أمر إنتاج/ذبح.
                             </p>
                           </div>
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
                {pageShellLoading && (
                  <div className="space-y-3 mb-4">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-24 w-full" />
                  </div>
                )}
                {(productsError || offersError || warehousesError || inventoryError || offerContentsError) && (
                  <div className="mb-4 space-y-1 rounded-lg border border-amber-200 bg-amber-50/70 dark:bg-amber-950/20 p-3 text-xs text-amber-800 dark:text-amber-300">
                    {productsError && <p>المنتجات: {productsError}</p>}
                    {offersError && <p>العروض: {offersError}</p>}
                    {warehousesError && <p>المخازن: {warehousesError}</p>}
                    {inventoryError && <p>المخزون: {inventoryError}</p>}
                    {offerContentsError && <p>محتويات البوكسات: {offerContentsError}</p>}
                  </div>
                )}
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
                    <div className="mb-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline">المنتجات: {productsLoading ? 'جاري التحميل' : `${products.length} عنصر`}</Badge>
                      <Badge variant="outline">المخازن: {warehousesLoading ? 'جاري التحميل' : `${warehousesList.length} مخزن`}</Badge>
                      <Badge variant="outline">المخزون: {inventoryLoading ? 'جاري التحميل' : 'محمّل'}</Badge>
                    </div>
                    <div className="relative mb-4">
                      <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        placeholder="بحث عن منتج..."
                        className="pr-10"
                        value={productSearch}
                        onChange={(e) => setProductSearch(e.target.value)}
                        disabled={productsLoading && products.length === 0}
                      />
                    </div>

                    {productsLoading && products.length === 0 ? (
                      <div className="space-y-3">
                        {Array.from({ length: 6 }).map((_, index) => (
                          <Skeleton key={index} className="h-16 w-full" />
                        ))}
                      </div>
                    ) : (

                    {/* Desktop/tablet table view */}
                    <div className="hidden md:block border rounded-lg overflow-x-auto">
                      <table className="w-full min-w-[640px] text-right text-sm">
                        <thead className="bg-muted/60 text-xs">
                          <tr>
                            <th className="p-2 font-semibold">المنتج</th>
                            <th className="p-2 font-semibold whitespace-nowrap">السعر</th>
                            <th className="p-2 font-semibold whitespace-nowrap">المتاح</th>
                            <th className="p-2 font-semibold w-[180px]">إضافة</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredProducts.map((product) => {
                            const kg = isKgUnit(product.unit);
                            return (
                              <tr key={product.id} className="border-t hover:bg-muted/30 transition-colors">
                                <td className="p-2 align-middle">
                                  <span
                                    className="font-bold text-base text-green-600 dark:text-green-400 break-words"
                                    title={product.name}
                                  >
                                    {product.name}
                                  </span>
                                </td>
                                <td className="p-2 align-middle whitespace-nowrap text-primary font-bold">
                                  {product.price.toLocaleString()} ج.م / {product.unit}
                                </td>
                                <td className="p-2 align-middle">
                                  <div className="flex flex-col gap-1">
                                    <Badge variant={(agouzaStock[product.id] ?? 0) <= 0 ? 'destructive' : 'outline'} className="text-[10px] whitespace-nowrap">
                                      العجوزة: {agouzaStock[product.id] ?? 0}
                                    </Badge>
                                    <Badge variant={(mainStock[product.id] ?? 0) <= 0 ? 'destructive' : 'outline'} className="text-[10px] whitespace-nowrap">
                                      الرئيسي: {mainStock[product.id] ?? 0}
                                    </Badge>
                                  </div>
                                </td>
                                <td className="p-2 align-middle">
                                  {kg ? (
                                    <div className="flex flex-col gap-1.5">
                                      <div className="grid grid-cols-2 gap-1.5">
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="h-8 text-xs"
                                          onClick={() => addToCart(product)}
                                        >
                                          <Plus className="w-3 h-3 ml-1" />
                                          كيلو
                                        </Button>
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
                                      </div>
                                      <div className="flex gap-1.5">
                                        <Input
                                          type="number"
                                          min="0"
                                          step="0.5"
                                          inputMode="decimal"
                                          placeholder="عدد الكيلو"
                                          className="h-8 text-xs flex-1"
                                          value={customQty[product.id] ?? ''}
                                          onChange={(e) => setCustomQty(s => ({ ...s, [product.id]: e.target.value }))}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                              e.preventDefault();
                                              addCustomKgToCart(product, parseFloat(customQty[product.id] || '0'));
                                            }
                                          }}
                                        />
                                        <Button
                                          size="sm"
                                          variant="default"
                                          className="h-8 text-xs px-2"
                                          onClick={() => addCustomKgToCart(product, parseFloat(customQty[product.id] || '0'))}
                                          title="إضافة كمية مخصصة"
                                        >
                                          <Plus className="w-3 h-3" />
                                        </Button>
                                      </div>
                                    </div>
                                  ) : (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-8 text-xs w-full"
                                      onClick={() => addToCart(product)}
                                    >
                                      <Plus className="w-3 h-3 ml-1" />
                                      إضافة
                                    </Button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile card view */}
                    <div className="md:hidden space-y-2">
                      {filteredProducts.map((product) => {
                        const kg = isKgUnit(product.unit);
                        return (
                          <div
                            key={product.id}
                            className="border rounded-lg p-3 bg-card hover:bg-muted/30 transition-colors"
                          >
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <span className="font-bold text-base text-green-600 dark:text-green-400 break-words flex-1">
                                {product.name}
                              </span>
                              <div className="flex flex-col items-end gap-1 shrink-0">
                                <Badge variant={(agouzaStock[product.id] ?? 0) <= 0 ? 'destructive' : 'outline'} className="text-[10px] whitespace-nowrap">
                                  العجوزة: {agouzaStock[product.id] ?? 0}
                                </Badge>
                                <Badge variant={(mainStock[product.id] ?? 0) <= 0 ? 'destructive' : 'outline'} className="text-[10px] whitespace-nowrap">
                                  الرئيسي: {mainStock[product.id] ?? 0}
                                </Badge>
                              </div>
                            </div>
                            <div className="text-primary font-bold text-sm mb-2">
                              {product.price.toLocaleString()} ج.م / {product.unit}
                            </div>
                            {kg ? (
                              <div className="flex flex-col gap-1.5">
                                <div className="grid grid-cols-2 gap-1.5">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-9 text-xs"
                                    onClick={() => addToCart(product)}
                                  >
                                    <Plus className="w-3 h-3 ml-1" />
                                    كيلو
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    className="h-9 text-xs"
                                    onClick={() => addToCart(product, undefined, false, true)}
                                    title="2 = 1 كيلو"
                                  >
                                    <Plus className="w-3 h-3 ml-1" />
                                    ½ كيلو
                                  </Button>
                                </div>
                                <div className="flex gap-1.5">
                                  <Input
                                    type="number"
                                    min="0"
                                    step="0.5"
                                    inputMode="decimal"
                                    placeholder="عدد الكيلو"
                                    className="h-9 text-xs flex-1"
                                    value={customQty[product.id] ?? ''}
                                    onChange={(e) => setCustomQty(s => ({ ...s, [product.id]: e.target.value }))}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        addCustomKgToCart(product, parseFloat(customQty[product.id] || '0'));
                                      }
                                    }}
                                  />
                                  <Button
                                    size="sm"
                                    variant="default"
                                    className="h-9 text-xs px-3"
                                    onClick={() => addCustomKgToCart(product, parseFloat(customQty[product.id] || '0'))}
                                  >
                                    <Plus className="w-3 h-3" />
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-9 text-xs w-full"
                                onClick={() => addToCart(product)}
                              >
                                <Plus className="w-3 h-3 ml-1" />
                                إضافة
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    )}
                  </TabsContent>

                  <TabsContent value="offers" className="mt-0">
                    <div className="mb-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline">العروض: {offersLoading ? 'جاري التحميل' : `${offerBoxes.length} عرض`}</Badge>
                      <Badge variant="outline">محتويات البوكسات: {offerContentsLoading ? 'جاري التحميل' : 'محمّلة'}</Badge>
                    </div>
                    {offersLoading && offerBoxes.length === 0 ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {Array.from({ length: 4 }).map((_, index) => (
                          <Skeleton key={index} className="h-32 w-full" />
                        ))}
                      </div>
                    ) : offerBoxes.length === 0 ? (
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
                            {offerContentsById[offer.id]?.length ? (
                              <p className="mt-2 text-xs text-muted-foreground line-clamp-2">
                                {offerContentsById[offer.id].join(' + ')}
                              </p>
                            ) : offerContentsLoading ? (
                              <p className="mt-2 text-xs text-muted-foreground">جاري تحميل محتويات البوكس...</p>
                            ) : null}
                            <Badge className="mt-2 bg-green-100 text-green-700 hover:bg-green-100">
                              اضغط لعرض التفاصيل
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
                    {Object.keys(offerInstanceCounts).length > 0 && (
                      <div className="rounded-lg border border-green-200 bg-green-50/60 dark:bg-green-950/20 p-2 space-y-2">
                        <p className="text-xs font-medium text-green-800 dark:text-green-300">العروض المختارة (الشحن 110 لكل عرض)</p>
                        {Object.entries(offerInstanceCounts).map(([boxId, count]) => {
                          const box = offerBoxes.find(b => b.id === boxId);
                          return (
                            <div key={boxId} className="flex items-center justify-between gap-2 text-sm">
                              <span className="truncate">{box?.name || 'عرض'}</span>
                              <div className="flex items-center gap-1">
                                <Button variant="outline" size="icon" className="h-7 w-7"
                                  onClick={() => decrementOfferInstance(boxId)}>
                                  <Minus className="w-3 h-3" />
                                </Button>
                                <span className="w-8 text-center font-medium">×{count}</span>
                                <Button variant="outline" size="icon" className="h-7 w-7"
                                  onClick={() => box && openOfferPreview(box as any)}>
                                  <Plus className="w-3 h-3" />
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
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
                              {item.isOfferItem && item.offerBoxId && offerContentsById[item.offerBoxId]?.length ? (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {offerContentsById[item.offerBoxId].join(' + ')}
                                </p>
                              ) : null}
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

                    {isSalesModerator && requiresDepositReceipt && (
                      <div className="space-y-2 rounded-lg border-2 border-orange-400 dark:border-orange-700 bg-orange-50/60 dark:bg-orange-950/30 p-3">
                        <Label className="flex items-center gap-1 font-semibold text-orange-900 dark:text-orange-200">
                          إيصال تحويل العربون <span className="text-destructive">*</span>
                        </Label>
                        <p className="text-xs text-orange-800 dark:text-orange-300">
                          الطلب يحتوي على (دبوس بالعظم / فخدة بالعظم / نعامة صندوق). يجب رفع صورة إيصال تحويل العربون قبل تأكيد الطلب.
                        </p>
                        <Input
                          type="file"
                          accept="image/*,application/pdf"
                          onChange={(e) => {
                            const f = e.target.files?.[0] ?? null;
                            if (f && f.size > 10 * 1024 * 1024) {
                              toast.error('حجم الملف يجب ألا يتجاوز 10 ميجابايت');
                              return;
                            }
                            setDepositReceiptFile(f);
                          }}
                        />
                        {depositReceiptFile && (
                          <div className="flex items-center justify-between p-2 rounded-md bg-background/60 text-xs">
                            <span className="truncate">{depositReceiptFile.name} ({(depositReceiptFile.size / 1024).toFixed(0)} KB)</span>
                            <Button type="button" variant="ghost" size="sm" onClick={() => setDepositReceiptFile(null)}>
                              إزالة
                            </Button>
                          </div>
                        )}
                      </div>
                    )}

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
                    <div className={`grid gap-3 ${hasOfferInCart ? "grid-cols-2" : "grid-cols-1"}`}>
                      {hasOfferInCart && (
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
                          <p className="text-xs text-muted-foreground">
                            العرض يشمل رسوم الشحن — يمكنك تعديل الرسوم يدويًا إن لزم الأمر.
                          </p>
                        </div>
                      )}
                      <div className="space-y-2">
                        <Label>الخصم</Label>
                        <Input
                          type="number"
                          value={discount}
                          onChange={(e) => setDiscount(Number(e.target.value))}
                        />
                    </div>

                    {/* Extra charge */}
                    <div className="space-y-2 rounded-lg border border-dashed border-amber-300 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/20 p-3">
                      <div className="space-y-3">
                        <div className="space-y-2">
                          <Label>سعر إضافي</Label>
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            placeholder="0"
                            value={extraCharge}
                            onChange={(e) => setExtraCharge(Number(e.target.value))}
                            className="w-full text-base h-11"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>سبب السعر الإضافي</Label>
                          <Textarea
                            placeholder="مثال: تشفيه الدبوس"
                            value={extraChargeReason}
                            onChange={(e) => setExtraChargeReason(e.target.value)}
                            rows={3}
                            className="w-full text-base"
                          />
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        يُضاف هذا المبلغ إلى إجمالي الطلب مع توضيح السبب.
                      </p>
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

                    {/* Fulfillment Source — مصدر تنفيذ الطلب */}
                    <div className="space-y-2">
                      <Label>مصدر تنفيذ الطلب <span className="text-destructive">*</span></Label>
                      <Select value={fulfillmentKey} onValueChange={(v) => setFulfillmentKey(v as any)}>
                        <SelectTrigger><SelectValue placeholder="اختر من أين يستلم العميل" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pickup_agouza">استلام من مخزن العجوزة</SelectItem>
                          <SelectItem value="delivery_agouza">توصيل من منفذ العجوزة</SelectItem>
                          <SelectItem value="pickup_main">استلام من المخزن الرئيسى</SelectItem>
                          <SelectItem value="delivery_main">توصيل من المخزن الرئيسى</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        سيتم خصم المخزون من المخزن المختار. لو الكمية غير كافية يدخل تلقائياً فى أمر إنتاج/ذبح.
                      </p>
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
                      {hasOfferInCart && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">رسوم التوصيل</span>
                          <span>{deliveryFee.toLocaleString()} ج.م</span>
                        </div>
                      )}
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
                      {Number(extraCharge) > 0 && (
                        <div className="flex justify-between text-sm text-amber-700 dark:text-amber-400">
                          <span>سعر إضافي{extraChargeReason ? ` (${extraChargeReason})` : ''}</span>
                          <span>+ {Number(extraCharge).toLocaleString()} ج.م</span>
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
                      disabled={submitting || !selectedCustomer || (isSalesModerator && requiresDepositReceipt && !depositReceiptFile)}
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
              {offerPreview.items.map(it => {
                const lineTotal = it.is_gift ? 0 : it.custom_price * it.quantity;
                return (
                <div key={it.id} className={`grid grid-cols-12 gap-2 items-end p-3 border rounded-lg ${it.is_gift ? 'bg-primary/5 border-primary/30' : 'bg-muted/30'}`}>
                  <div className="col-span-4">
                    <Label className="text-xs flex items-center gap-1 flex-wrap">
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
                    <Input
                      type="number"
                      min={0.25}
                      step={0.25}
                      className="h-9"
                      value={it.quantity}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        updateOfferPreviewItem(it.id, { quantity: isNaN(v) || v <= 0 ? 0.5 : v });
                      }}
                    />
                  </div>
                  <div className="col-span-2 text-xs text-muted-foreground text-center pb-2">
                    {it.is_gift ? 'مجاني' : lineTotal.toLocaleString()}
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
                );
              })}
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
              {(() => {
                const itemsTotal = offerPreview.items.reduce((s, i) => s + (i.is_gift ? 0 : i.custom_price * i.quantity), 0);
                const shipping = Number(offerPreview.box.shipping_cost || 0);
                const grand = itemsTotal + shipping;
                return (
                  <div className="p-3 bg-primary/10 rounded-lg space-y-1 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">إجمالي المنتجات</span>
                      <span>{itemsTotal.toLocaleString()} ج.م</span>
                    </div>
                    {shipping > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">الشحن (مضمّن في العرض)</span>
                        <span>{shipping.toLocaleString()} ج.م</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between pt-2 border-t font-semibold text-base">
                      <span>إجمالي العرض</span>
                      <span>{grand.toLocaleString()} ج.م</span>
                    </div>
                  </div>
                );
              })()}
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

      {/* Duplicate order approval dialog */}
      <Dialog open={approvalDialog.open} onOpenChange={(o) => setApprovalDialog((s) => ({ ...s, open: o }))}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>يلزم موافقة مديرة التسويق</DialogTitle>
            <DialogDescription>
              العميل ده عنده طلب اليوم من بنت تانية. عشان متبقاش فيه تكرار، لازم موافقة مديرة التسويق آلاء حامد قبل تسجيل الطلب.
            </DialogDescription>
          </DialogHeader>

          {approvalDialog.status === 'pending' && (
            <div className="rounded-md border bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-800 dark:text-amber-200">
              طلب الموافقة اتبعت بالفعل ومستنى الرد. هترجعى تسجلى الطلب أول ما يتم القبول.
            </div>
          )}
          {approvalDialog.status === 'rejected' && (
            <div className="rounded-md border bg-destructive/10 p-3 text-sm">
              <div className="font-semibold text-destructive mb-1">تم رفض الطلب السابق</div>
              {approvalDialog.reason && <div className="text-muted-foreground">{approvalDialog.reason}</div>}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setApprovalDialog({ open: false, status: 'idle' })}>
              إغلاق
            </Button>
            {approvalDialog.status !== 'pending' && (
              <Button
                onClick={async () => {
                  if (!selectedCustomer?.id) return;
                  const { error } = await supabase.rpc('request_duplicate_order_approval', {
                    p_customer_id: selectedCustomer.id,
                    p_note: notes.trim() || null,
                  });
                  if (error) {
                    toast.error('تعذر إرسال طلب الموافقة');
                  } else {
                    toast.success('تم إرسال طلب الموافقة لمديرة التسويق آلاء حامد');
                    setApprovalDialog({ open: false, status: 'pending' });
                  }
                }}
              >
                اطلب الموافقة
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default NewOrder;
