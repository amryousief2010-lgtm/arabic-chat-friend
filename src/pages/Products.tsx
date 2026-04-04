import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import ProductsAnalytics from "@/components/dashboard/ProductsAnalytics";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Edit, Trash2, Package, Minus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const categories = ["لحوم طازجة", "لحوم مصنعة", "منتجات أخرى"];

interface Product {
  id: string;
  name: string;
  category: string | null;
  price: number;
  stock: number;
  unit: string;
  image_url: string | null;
  is_active: boolean;
}

const Products = () => {
  const { role, canManageStock } = useAuth();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [stockAdjustment, setStockAdjustment] = useState<{ [key: string]: number }>({});
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    name: "",
    category: "",
    price: "",
    stock: "",
    unit: "كيلو",
    image_url: "",
  });

  // Permission checks
  const canAddProducts = role === 'general_manager' || role === 'executive_manager' || role === 'sales_manager' || role === 'warehouse_supervisor';
  const canEditPrice = role === 'general_manager' || role === 'executive_manager' || role === 'sales_manager' || role === 'accountant';
  const canManageProducts = role === 'general_manager' || role === 'executive_manager' || role === 'sales_manager' || role === 'warehouse_supervisor';

  // Fetch products from Supabase
  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .order('name');
      if (error) throw error;
      return data as Product[];
    },
  });

  const filteredProducts = products.filter(
    (product) =>
      product.name.includes(searchQuery) ||
      (product.category && product.category.includes(searchQuery))
  );

  const handleOpenDialog = (product?: Product) => {
    if (product) {
      setEditingProduct(product);
      setFormData({
        name: product.name,
        category: product.category || "",
        price: product.price.toString(),
        stock: product.stock.toString(),
        unit: product.unit,
        image_url: product.image_url || "",
      });
    } else {
      setEditingProduct(null);
      setFormData({
        name: "",
        category: "",
        price: "",
        stock: "",
        unit: "كيلو",
        image_url: "",
      });
    }
    setIsDialogOpen(true);
  };

  // Create product mutation
  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const { error } = await supabase.from('products').insert({
        name: data.name,
        category: data.category || null,
        price: parseFloat(data.price),
        stock: parseInt(data.stock) || 0,
        unit: data.unit,
        image_url: data.image_url || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast({ title: 'تم إضافة المنتج بنجاح' });
      setIsDialogOpen(false);
    },
    onError: () => {
      toast({ title: 'حدث خطأ', variant: 'destructive' });
    },
  });

  // Update product mutation
  const updateMutation = useMutation({
    mutationFn: async (data: { id: string; updates: Partial<Product> }) => {
      const { error } = await supabase
        .from('products')
        .update(data.updates)
        .eq('id', data.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast({ title: 'تم تحديث المنتج بنجاح' });
      setIsDialogOpen(false);
    },
    onError: () => {
      toast({ title: 'حدث خطأ', variant: 'destructive' });
    },
  });

  // Delete product mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('products').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast({ title: 'تم حذف المنتج' });
    },
  });

  // Update stock mutation
  const updateStockMutation = useMutation({
    mutationFn: async (data: { id: string; newStock: number }) => {
      const { error } = await supabase
        .from('products')
        .update({ stock: data.newStock })
        .eq('id', data.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast({ title: 'تم تحديث المخزون بنجاح' });
    },
    onError: () => {
      toast({ title: 'حدث خطأ في تحديث المخزون', variant: 'destructive' });
    },
  });

  const handleStockAdjust = (productId: string, currentStock: number, adjustment: number) => {
    const newStock = Math.max(0, currentStock + adjustment);
    updateStockMutation.mutate({ id: productId, newStock });
  };

  const handleSubmit = () => {
    if (!formData.name || !formData.category || !formData.price) {
      toast({
        title: "خطأ",
        description: "يرجى ملء جميع الحقول المطلوبة",
        variant: "destructive",
      });
      return;
    }

    if (editingProduct) {
      const updates: Partial<Product> = {
        name: formData.name,
        category: formData.category,
        stock: parseInt(formData.stock) || 0,
        unit: formData.unit,
        image_url: formData.image_url || null,
      };
      // Only include price if user can edit it
      if (canEditPrice) {
        updates.price = parseFloat(formData.price);
      }
      updateMutation.mutate({ id: editingProduct.id, updates });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleDelete = (id: string) => {
    deleteMutation.mutate(id);
  };

  return (
    <DashboardLayout>
      <Header title="المنتجات" subtitle="إدارة منتجات لحوم النعام" />
      
      <ProductsAnalytics products={filteredProducts} />

      <Card className="glass-card">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Package className="w-5 h-5 text-primary" />
            قائمة المنتجات ({filteredProducts.length})
          </CardTitle>
          <div className="flex items-center gap-4">
            <Input
              placeholder="بحث عن منتج..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-64 input-modern"
            />
            {canAddProducts && (
              <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogTrigger asChild>
                  <Button
                    className="btn-primary"
                    onClick={() => handleOpenDialog()}
                  >
                    <Plus className="w-4 h-4 ml-2" />
                    إضافة منتج
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>
                      {editingProduct ? "تعديل المنتج" : "إضافة منتج جديد"}
                    </DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label>اسم المنتج *</Label>
                      <Input
                        value={formData.name}
                        onChange={(e) =>
                          setFormData({ ...formData, name: e.target.value })
                        }
                        placeholder="أدخل اسم المنتج"
                        className="input-modern"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>التصنيف *</Label>
                      <Select
                        value={formData.category}
                        onValueChange={(value) =>
                          setFormData({ ...formData, category: value })
                        }
                      >
                        <SelectTrigger className="input-modern">
                          <SelectValue placeholder="اختر التصنيف" />
                        </SelectTrigger>
                        <SelectContent>
                          {categories.map((cat) => (
                            <SelectItem key={cat} value={cat}>
                              {cat}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>السعر (ج.م) *</Label>
                        <Input
                          type="number"
                          value={formData.price}
                          onChange={(e) =>
                            setFormData({ ...formData, price: e.target.value })
                          }
                          placeholder="0"
                          className="input-modern"
                          disabled={editingProduct !== null && !canEditPrice}
                        />
                        {editingProduct && !canEditPrice && (
                          <p className="text-xs text-muted-foreground">
                            تعديل السعر متاح للمديرين والمحاسب فقط
                          </p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label>المخزون</Label>
                        <Input
                          type="number"
                          value={formData.stock}
                          onChange={(e) =>
                            setFormData({ ...formData, stock: e.target.value })
                          }
                          placeholder="0"
                          className="input-modern"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>الوحدة</Label>
                      <Select
                        value={formData.unit}
                        onValueChange={(value) =>
                          setFormData({ ...formData, unit: value })
                        }
                      >
                        <SelectTrigger className="input-modern">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="كيلو">كيلو</SelectItem>
                          <SelectItem value="عبوة">عبوة</SelectItem>
                          <SelectItem value="قطعة">قطعة</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>رابط الصورة</Label>
                      <Input
                        value={formData.image_url}
                        onChange={(e) =>
                          setFormData({ ...formData, image_url: e.target.value })
                        }
                        placeholder="https://..."
                        className="input-modern"
                      />
                    </div>
                    <Button onClick={handleSubmit} className="w-full btn-primary">
                      {editingProduct ? "حفظ التعديلات" : "إضافة المنتج"}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">جاري التحميل...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">المنتج</TableHead>
                  <TableHead className="text-right">التصنيف</TableHead>
                  <TableHead className="text-right">السعر</TableHead>
                  <TableHead className="text-right">المخزون</TableHead>
                  <TableHead className="text-right">الحالة</TableHead>
                  {canManageProducts && <TableHead className="text-right">الإجراءات</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProducts.map((product) => (
                  <TableRow key={product.id} className="table-row-hover">
                    <TableCell>
                      <div className="flex items-center gap-3">
                        {product.image_url && (
                          <img
                            src={product.image_url}
                            alt={product.name}
                            className="w-12 h-12 rounded-lg object-cover"
                          />
                        )}
                        <span className="font-medium">{product.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{product.category}</Badge>
                    </TableCell>
                    <TableCell className="font-semibold">
                      {product.price} ج.م / {product.unit}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{product.stock}</span>
                        {canManageStock && (
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button variant="outline" size="sm" className="h-7 px-2">
                                تعديل
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-64" align="start">
                              <div className="space-y-3">
                                <div className="text-sm font-medium">تعديل كمية {product.name}</div>
                                <div className="flex items-center gap-2">
                                  <Input
                                    type="number"
                                    placeholder="الكمية"
                                    value={stockAdjustment[product.id] || ''}
                                    onChange={(e) => setStockAdjustment({ 
                                      ...stockAdjustment, 
                                      [product.id]: parseInt(e.target.value) || 0 
                                    })}
                                    className="flex-1"
                                  />
                                </div>
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    className="flex-1 bg-success hover:bg-success/90"
                                    onClick={() => {
                                      handleStockAdjust(product.id, product.stock, stockAdjustment[product.id] || 0);
                                      setStockAdjustment({ ...stockAdjustment, [product.id]: 0 });
                                    }}
                                  >
                                    <Plus className="w-3 h-3 ml-1" />
                                    إضافة
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    className="flex-1"
                                    onClick={() => {
                                      handleStockAdjust(product.id, product.stock, -(stockAdjustment[product.id] || 0));
                                      setStockAdjustment({ ...stockAdjustment, [product.id]: 0 });
                                    }}
                                  >
                                    <Minus className="w-3 h-3 ml-1" />
                                    خصم
                                  </Button>
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  الرصيد الحالي: {product.stock} {product.unit}
                                </div>
                              </div>
                            </PopoverContent>
                          </Popover>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={
                          product.stock < 25
                            ? "bg-destructive text-destructive-foreground"
                            : product.stock < 35
                            ? "bg-warning text-warning-foreground"
                            : "bg-success text-success-foreground"
                        }
                      >
                        {product.stock < 25
                          ? "منخفض جداً"
                          : product.stock < 35
                          ? "منخفض"
                          : "متوفر"}
                      </Badge>
                    </TableCell>
                    {canManageProducts && (
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleOpenDialog(product)}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive"
                            onClick={() => handleDelete(product.id)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </DashboardLayout>
  );
};

export default Products;
