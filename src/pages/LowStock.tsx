import { useState, useEffect } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  Search,
  Package,
  RefreshCw,
  Download,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import * as XLSX from "xlsx";
import { formatDate } from "@/lib/dateFormat";

interface LowStockProduct {
  id: string;
  name: string;
  category: string | null;
  stock: number;
  low_stock_threshold: number;
  unit: string;
  price: number;
}

const LowStock = () => {
  const [products, setProducts] = useState<LowStockProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  const fetchLowStockProducts = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, category, stock, low_stock_threshold, unit, price')
        .filter('is_active', 'eq', true)
        .order('stock', { ascending: true });

      if (error) throw error;

      // Filter products where stock <= low_stock_threshold
      const lowStockProducts = (data || []).filter(
        product => product.stock <= product.low_stock_threshold
      );

      setProducts(lowStockProducts);
    } catch (error) {
      console.error('Error fetching low stock products:', error);
      toast.error('حدث خطأ أثناء جلب المنتجات');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLowStockProducts();
  }, []);

  const filteredProducts = products.filter(product =>
    product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (product.category && product.category.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const getStockStatus = (stock: number, threshold: number) => {
    if (stock === 0) {
      return { label: "نفذ المخزون", variant: "destructive" as const };
    } else if (stock <= threshold / 2) {
      return { label: "حرج", variant: "destructive" as const };
    } else {
      return { label: "منخفض", variant: "warning" as const };
    }
  };

  const getStockStatusLabel = (stock: number, threshold: number) => {
    if (stock === 0) return "نفذ المخزون";
    if (stock <= threshold / 2) return "حرج";
    return "منخفض";
  };

  const exportToExcel = () => {
    if (filteredProducts.length === 0) {
      toast.error("لا توجد منتجات للتصدير");
      return;
    }

    const exportData = filteredProducts.map(product => ({
      "اسم المنتج": product.name,
      "الفئة": product.category || "غير محدد",
      "المخزون الحالي": product.stock,
      "الوحدة": product.unit,
      "الحد الأدنى": product.low_stock_threshold,
      "الحالة": getStockStatusLabel(product.stock, product.low_stock_threshold),
      "السعر": product.price,
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "منتجات منخفضة المخزون");

    const today = formatDate(new Date()).replace(/\//g, '-');
    XLSX.writeFile(workbook, `منتجات-منخفضة-المخزون-${today}.xlsx`);
    toast.success("تم تصدير الملف بنجاح");
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <Header 
          title="المنتجات منخفضة المخزون" 
          subtitle={`${products.length} منتج يحتاج إلى إعادة تعبئة`}
        />

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="glass-card border-destructive/20 bg-destructive/5">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-destructive/10 flex items-center justify-center">
                  <AlertTriangle className="w-6 h-6 text-destructive" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">نفذ المخزون</p>
                  <p className="text-2xl font-bold text-destructive">
                    {products.filter(p => p.stock === 0).length}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card border-warning/20 bg-warning/5">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-warning/10 flex items-center justify-center">
                  <Package className="w-6 h-6 text-warning" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">مخزون حرج</p>
                  <p className="text-2xl font-bold text-warning">
                    {products.filter(p => p.stock > 0 && p.stock <= p.low_stock_threshold / 2).length}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card border-primary/20 bg-primary/5">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Package className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">مخزون منخفض</p>
                  <p className="text-2xl font-bold text-primary">
                    {products.filter(p => p.stock > p.low_stock_threshold / 2).length}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Search and Actions */}
        <Card className="glass-card">
          <CardHeader>
            <div className="flex flex-col sm:flex-row gap-4 justify-between">
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-warning" />
                قائمة المنتجات
              </CardTitle>
              <div className="flex gap-2">
                <div className="relative flex-1 sm:w-64">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="بحث عن منتج..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pr-10"
                  />
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={fetchLowStockProducts}
                  disabled={loading}
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </Button>
                <Button
                  variant="outline"
                  onClick={exportToExcel}
                  disabled={loading || filteredProducts.length === 0}
                  className="gap-2"
                >
                  <Download className="w-4 h-4" />
                  <span className="hidden sm:inline">تصدير Excel</span>
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center h-32">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div>
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="text-center py-12">
                <Package className="w-16 h-16 mx-auto text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground">
                  {searchTerm ? "لا توجد نتائج للبحث" : "لا توجد منتجات منخفضة المخزون"}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">المنتج</TableHead>
                      <TableHead className="text-right">الفئة</TableHead>
                      <TableHead className="text-center">المخزون الحالي</TableHead>
                      <TableHead className="text-center">الحد الأدنى</TableHead>
                      <TableHead className="text-center">الحالة</TableHead>
                      <TableHead className="text-center">السعر</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredProducts.map((product) => {
                      const status = getStockStatus(product.stock, product.low_stock_threshold);
                      return (
                        <TableRow key={product.id} className="hover:bg-muted/50">
                          <TableCell>
                            <Link 
                              to="/products" 
                              className="font-medium hover:text-primary transition-colors"
                            >
                              {product.name}
                            </Link>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {product.category || "غير محدد"}
                          </TableCell>
                          <TableCell className="text-center">
                            <span className={`font-bold ${product.stock === 0 ? 'text-destructive' : 'text-warning'}`}>
                              {product.stock} {product.unit}
                            </span>
                          </TableCell>
                          <TableCell className="text-center text-muted-foreground">
                            {product.low_stock_threshold} {product.unit}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant={status.variant}>
                              {status.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center font-medium">
                            {product.price.toLocaleString()} ج.م
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default LowStock;
