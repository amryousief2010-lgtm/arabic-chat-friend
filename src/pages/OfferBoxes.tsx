import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Gift, Plus, Edit, Trash2, Package, X } from 'lucide-react';

interface OfferBox {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
}

interface OfferBoxItem {
  id: string;
  offer_box_id: string;
  product_id: string;
  custom_price: number;
  quantity: number;
  product?: {
    id: string;
    name: string;
    price: number;
    image_url: string | null;
  };
}

interface Product {
  id: string;
  name: string;
  price: number;
  image_url: string | null;
}

const OfferBoxes = () => {
  const { toast } = useToast();
  const { role, user } = useAuth();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isItemsDialogOpen, setIsItemsDialogOpen] = useState(false);
  const [editingBox, setEditingBox] = useState<OfferBox | null>(null);
  const [selectedBox, setSelectedBox] = useState<OfferBox | null>(null);
  const [formData, setFormData] = useState({ name: '', description: '' });
  const [newItem, setNewItem] = useState({ product_id: '', custom_price: '', quantity: '1' });

  const isManager = role === 'general_manager' || role === 'executive_manager' || role === 'sales_manager';

  // Fetch offer boxes
  const { data: offerBoxes = [], isLoading } = useQuery({
    queryKey: ['offer-boxes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('offer_boxes')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as OfferBox[];
    },
  });

  // Fetch products
  const { data: products = [] } = useQuery({
    queryKey: ['products-for-offers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, price, image_url')
        .eq('is_active', true);
      if (error) throw error;
      return data as Product[];
    },
  });

  // Fetch items for selected box
  const { data: boxItems = [] } = useQuery({
    queryKey: ['offer-box-items', selectedBox?.id],
    queryFn: async () => {
      if (!selectedBox) return [];
      const { data, error } = await supabase
        .from('offer_box_items')
        .select('*')
        .eq('offer_box_id', selectedBox.id);
      if (error) throw error;
      
      // Fetch product details
      const productIds = data.map(item => item.product_id);
      const { data: productData } = await supabase
        .from('products')
        .select('id, name, price, image_url')
        .in('id', productIds);
      
      return data.map(item => ({
        ...item,
        product: productData?.find(p => p.id === item.product_id),
      })) as OfferBoxItem[];
    },
    enabled: !!selectedBox,
  });

  // Create box
  const createBoxMutation = useMutation({
    mutationFn: async (data: { name: string; description: string }) => {
      const { error } = await supabase.from('offer_boxes').insert({
        name: data.name,
        description: data.description || null,
        created_by: user?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['offer-boxes'] });
      toast({ title: 'تم إنشاء صندوق العرض بنجاح' });
      setIsDialogOpen(false);
      setFormData({ name: '', description: '' });
    },
    onError: () => {
      toast({ title: 'حدث خطأ', variant: 'destructive' });
    },
  });

  // Update box
  const updateBoxMutation = useMutation({
    mutationFn: async (data: { id: string; name: string; description: string; is_active: boolean }) => {
      const { error } = await supabase
        .from('offer_boxes')
        .update({ name: data.name, description: data.description, is_active: data.is_active })
        .eq('id', data.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['offer-boxes'] });
      toast({ title: 'تم تحديث صندوق العرض' });
      setIsDialogOpen(false);
      setEditingBox(null);
      setFormData({ name: '', description: '' });
    },
  });

  // Delete box
  const deleteBoxMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('offer_boxes').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['offer-boxes'] });
      toast({ title: 'تم حذف صندوق العرض' });
    },
  });

  // Add item to box
  const addItemMutation = useMutation({
    mutationFn: async (data: { offer_box_id: string; product_id: string; custom_price: number; quantity: number }) => {
      const { error } = await supabase.from('offer_box_items').insert(data);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['offer-box-items'] });
      toast({ title: 'تم إضافة المنتج' });
      setNewItem({ product_id: '', custom_price: '', quantity: '1' });
    },
  });

  // Remove item
  const removeItemMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('offer_box_items').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['offer-box-items'] });
      toast({ title: 'تم حذف المنتج' });
    },
  });

  const handleOpenDialog = (box?: OfferBox) => {
    if (box) {
      setEditingBox(box);
      setFormData({ name: box.name, description: box.description || '' });
    } else {
      setEditingBox(null);
      setFormData({ name: '', description: '' });
    }
    setIsDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!formData.name) {
      toast({ title: 'يرجى إدخال اسم العرض', variant: 'destructive' });
      return;
    }
    if (editingBox) {
      updateBoxMutation.mutate({ ...editingBox, ...formData });
    } else {
      createBoxMutation.mutate(formData);
    }
  };

  const handleAddItem = () => {
    if (!newItem.product_id || !newItem.custom_price || !selectedBox) return;
    addItemMutation.mutate({
      offer_box_id: selectedBox.id,
      product_id: newItem.product_id,
      custom_price: Number(newItem.custom_price),
      quantity: Number(newItem.quantity),
    });
  };

  const selectedProduct = products.find(p => p.id === newItem.product_id);
  const totalBoxPrice = boxItems.reduce((sum, item) => sum + item.custom_price * item.quantity, 0);
  const originalPrice = boxItems.reduce((sum, item) => sum + (item.product?.price || 0) * item.quantity, 0);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Gift className="h-8 w-8 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">صناديق العروض</h1>
              <p className="text-muted-foreground">إنشاء وإدارة عروض المنتجات المجمعة</p>
            </div>
          </div>
          {isManager && (
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button onClick={() => handleOpenDialog()}>
                  <Plus className="h-4 w-4 ml-2" />
                  إنشاء عرض جديد
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{editingBox ? 'تعديل العرض' : 'إنشاء عرض جديد'}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <Label>اسم العرض</Label>
                    <Input
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="عرض الصيف المميز"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>الوصف (اختياري)</Label>
                    <Input
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      placeholder="وصف العرض"
                    />
                  </div>
                  <Button className="w-full" onClick={handleSubmit}>
                    {editingBox ? 'حفظ التعديلات' : 'إنشاء العرض'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>

        {/* Offer Boxes Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {isLoading ? (
            <div className="col-span-full text-center py-8 text-muted-foreground">جاري التحميل...</div>
          ) : offerBoxes.length === 0 ? (
            <div className="col-span-full text-center py-12 text-muted-foreground">
              <Gift className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>لا توجد عروض حالياً</p>
            </div>
          ) : (
            offerBoxes.map((box) => (
              <Card key={box.id} className={`${!box.is_active ? 'opacity-60' : ''}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Gift className="h-5 w-5 text-primary" />
                      {box.name}
                    </CardTitle>
                    <Badge variant={box.is_active ? 'default' : 'secondary'}>
                      {box.is_active ? 'نشط' : 'معطل'}
                    </Badge>
                  </div>
                  {box.description && (
                    <p className="text-sm text-muted-foreground">{box.description}</p>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => {
                        setSelectedBox(box);
                        setIsItemsDialogOpen(true);
                      }}
                    >
                      <Package className="h-4 w-4 ml-1" />
                      إدارة المنتجات
                    </Button>
                    {isManager && (
                      <>
                        <Button variant="ghost" size="icon" onClick={() => handleOpenDialog(box)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive"
                          onClick={() => deleteBoxMutation.mutate(box.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        {/* Items Dialog */}
        <Dialog open={isItemsDialogOpen} onOpenChange={setIsItemsDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Gift className="h-5 w-5" />
                منتجات العرض: {selectedBox?.name}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {/* Add Item Form */}
              {isManager && (
                <div className="p-4 bg-muted/50 rounded-lg space-y-3">
                  <Label className="text-sm font-medium">إضافة منتج</Label>
                  <div className="grid grid-cols-4 gap-2">
                    <Select
                      value={newItem.product_id}
                      onValueChange={(v) => {
                        const product = products.find(p => p.id === v);
                        setNewItem({ 
                          ...newItem, 
                          product_id: v, 
                          custom_price: product?.price.toString() || '' 
                        });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="اختر منتج" />
                      </SelectTrigger>
                      <SelectContent>
                        {products.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name} - {p.price} ج.م
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      placeholder="السعر المخفض"
                      value={newItem.custom_price}
                      onChange={(e) => setNewItem({ ...newItem, custom_price: e.target.value })}
                    />
                    <Input
                      type="number"
                      placeholder="الكمية"
                      value={newItem.quantity}
                      onChange={(e) => setNewItem({ ...newItem, quantity: e.target.value })}
                    />
                    <Button onClick={handleAddItem} disabled={!newItem.product_id || !newItem.custom_price}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  {selectedProduct && (
                    <p className="text-xs text-muted-foreground">
                      السعر الأصلي: {selectedProduct.price} ج.م
                      {newItem.custom_price && (
                        <span className="text-green-600 mr-2">
                          (توفير {((selectedProduct.price - Number(newItem.custom_price)) / selectedProduct.price * 100).toFixed(0)}%)
                        </span>
                      )}
                    </p>
                  )}
                </div>
              )}

              {/* Items List */}
              {boxItems.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>لا توجد منتجات في هذا العرض</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>المنتج</TableHead>
                      <TableHead>السعر الأصلي</TableHead>
                      <TableHead>سعر العرض</TableHead>
                      <TableHead>الكمية</TableHead>
                      <TableHead>التوفير</TableHead>
                      {isManager && <TableHead></TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {boxItems.map((item) => {
                      const originalItemPrice = item.product?.price || 0;
                      const savings = ((originalItemPrice - item.custom_price) / originalItemPrice) * 100;
                      return (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">{item.product?.name}</TableCell>
                          <TableCell className="line-through text-muted-foreground">
                            {originalItemPrice} ج.م
                          </TableCell>
                          <TableCell className="text-green-600 font-semibold">
                            {item.custom_price} ج.م
                          </TableCell>
                          <TableCell>{item.quantity}</TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="bg-green-100 text-green-700">
                              {savings.toFixed(0)}%
                            </Badge>
                          </TableCell>
                          {isManager && (
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-destructive"
                                onClick={() => removeItemMutation.mutate(item.id)}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}

              {/* Summary */}
              {boxItems.length > 0 && (
                <div className="p-4 bg-primary/5 rounded-lg flex justify-between items-center">
                  <div>
                    <p className="text-sm text-muted-foreground">السعر الأصلي</p>
                    <p className="line-through">{originalPrice.toLocaleString()} ج.م</p>
                  </div>
                  <div className="text-left">
                    <p className="text-sm text-muted-foreground">سعر العرض</p>
                    <p className="text-2xl font-bold text-primary">{totalBoxPrice.toLocaleString()} ج.م</p>
                  </div>
                  <Badge className="bg-green-500 text-white text-lg px-3 py-1">
                    توفير {((originalPrice - totalBoxPrice) / originalPrice * 100).toFixed(0)}%
                  </Badge>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
};

export default OfferBoxes;
