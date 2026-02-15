import { useState, useEffect } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import * as XLSX from "xlsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface SalesRecord {
  timestamp: string;
  moderator: string;
  customerSource: string;
  customerName: string;
  customerPhone: string;
  customerPhone2?: string;
  address: string;
  shippingCompany: string;
  orderValue: number;
  offerType: string;
  notes?: string;
  governorate: string;
  city: string;
  products: { name: string; quantity: number }[];
}

// Product column mapping for 2025 full year file
const PRODUCT_COLUMNS = [
  { name: 'لحم', index: 8 },
  { name: 'دبوس/فخدة/نعامة', index: 9 },
  { name: 'استيك', index: 10 },
  { name: 'موزة', index: 11 },
  { name: 'فراشة', index: 12 },
  { name: 'قطعية الدبوس', index: 13 },
  { name: 'تربيانكو', index: 14 },
  { name: 'اسكالوب', index: 15 },
  { name: 'ميت رول', index: 16 },
  { name: 'كبدة', index: 17 },
  { name: 'قلب', index: 18 },
  { name: 'قوانص', index: 19 },
  { name: 'رقاب', index: 20 },
  { name: 'دهن', index: 21 },
  { name: 'كوارع', index: 22 },
  { name: 'كفتة', index: 23 },
  { name: 'سجق', index: 24 },
  { name: 'برجر', index: 25 },
  { name: 'لانشون سادة', index: 26 },
  { name: 'لانشون فلفل أسود', index: 27 },
  { name: 'لانشون بيبروني', index: 28 },
  { name: 'مفروم حواوشي', index: 29 },
  { name: 'مفروم', index: 30 },
  { name: 'كريم المفاصل', index: 31 },
  { name: 'زيت الشعر', index: 32 },
  { name: 'كريم الشعر', index: 33 },
  { name: 'كريم للبشرة', index: 34 },
  { name: 'لحم غزال', index: 40 },
];

const ImportSalesData = () => {
  const [records, setRecords] = useState<SalesRecord[]>([]);
  const [rawPreview, setRawPreview] = useState<any[][]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ customers: 0, orders: 0, items: 0 });

  useEffect(() => {
    loadExcelFile();
  }, []);

  const loadExcelFile = async () => {
    setLoading(true);
    try {
      const response = await fetch('/data/sales-2025-full.xlsx');
      const arrayBuffer = await response.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      
      const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
      
      console.log("Raw data from Excel:", rawData.slice(0, 5));
      setRawPreview(rawData.slice(0, 10));
      
      const parsedRecords: SalesRecord[] = [];
      
      // Skip header row and process data
      for (let i = 1; i < rawData.length; i++) {
        const row = rawData[i];
        if (!row || row.length < 5) continue;
        
        // Skip empty rows
        const customerName = row[3];
        if (!customerName || String(customerName).trim() === '') continue;
        
        // Parse products
        const products: { name: string; quantity: number }[] = [];
        for (const product of PRODUCT_COLUMNS) {
          const qty = parseFloat(row[product.index]) || 0;
          if (qty > 0) {
            products.push({ name: product.name, quantity: qty });
          }
        }
        
        const record: SalesRecord = {
          timestamp: parseExcelDate(row[0]) || new Date().toISOString(),
          moderator: String(row[1] || '').trim(),
          customerSource: String(row[2] || '').trim(),
          customerName: String(row[3] || '').trim(),
          customerPhone: String(row[4] || '').replace(/\s/g, ''),
          customerPhone2: row[5] ? String(row[5]).replace(/\s/g, '') : undefined,
          address: String(row[6] || '').trim(),
          shippingCompany: String(row[7] || '').trim(),
          orderValue: parseFloat(row[35]) || 0,
          offerType: String(row[36] || '').trim(),
          notes: row[37] ? String(row[37]).trim() : undefined,
          governorate: String(row[38] || '').trim(),
          city: String(row[39] || '').trim(),
          products
        };
        
        if (record.customerName && record.orderValue > 0) {
          parsedRecords.push(record);
        }
      }
      
      setRecords(parsedRecords);
      toast.success(`تم تحميل ${parsedRecords.length} طلب من الملف`);
    } catch (error) {
      console.error("Error loading Excel file:", error);
      toast.error("فشل في تحميل الملف");
    } finally {
      setLoading(false);
    }
  };

  const parseExcelDate = (value: any): string | null => {
    if (!value) return null;
    
    // If it's a number (Excel date serial)
    if (typeof value === 'number') {
      const date = new Date((value - 25569) * 86400 * 1000);
      return date.toISOString();
    }
    
    // If it's already a string like "10/1/2025 10:39:53"
    if (typeof value === 'string') {
      const parts = value.split(' ');
      if (parts.length >= 1) {
        const dateParts = parts[0].split('/');
        if (dateParts.length === 3) {
          const month = dateParts[0].padStart(2, '0');
          const day = dateParts[1].padStart(2, '0');
          const year = dateParts[2];
          const time = parts[1] || '12:00:00';
          return `${year}-${month}-${day}T${time}Z`;
        }
      }
      const parsed = new Date(value);
      if (!isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    }
    
    return null;
  };

  const importToDatabase = async () => {
    if (records.length === 0) {
      toast.error("لا توجد بيانات للاستيراد");
      return;
    }

    setImporting(true);
    setImportProgress({ customers: 0, orders: 0, items: 0 });

    try {
      let customersCreated = 0;
      let ordersCreated = 0;
      let itemsCreated = 0;
      
      // Track processed customers to avoid duplicates
      const processedCustomers = new Map<string, string>();

      for (const record of records) {
        // Use phone as unique identifier for customer
        const customerKey = record.customerPhone;
        let customerId: string;

        if (processedCustomers.has(customerKey)) {
          customerId = processedCustomers.get(customerKey)!;
        } else {
          // Check if customer exists
          let { data: existingCustomer } = await supabase
            .from('customers')
            .select('id')
            .eq('phone', record.customerPhone)
            .single();

          if (!existingCustomer) {
            // Create new customer
            const { data: newCustomer, error: customerError } = await supabase
              .from('customers')
              .insert({
                name: record.customerName,
                phone: record.customerPhone,
                address: record.address,
                city: record.city,
                notes: `المحافظة: ${record.governorate} | المصدر: ${record.customerSource}${record.customerPhone2 ? ` | هاتف آخر: ${record.customerPhone2}` : ''}`
              })
              .select('id')
              .single();

            if (customerError) {
              console.error("Error creating customer:", customerError);
              continue;
            }
            customerId = newCustomer.id;
            customersCreated++;
          } else {
            customerId = existingCustomer.id;
          }
          
          processedCustomers.set(customerKey, customerId);
        }

        setImportProgress(prev => ({ ...prev, customers: customersCreated }));

        // Generate order number
        const orderDate = new Date(record.timestamp);
        const orderNumber = `ORD-${orderDate.getFullYear()}${String(orderDate.getMonth() + 1).padStart(2, '0')}${String(orderDate.getDate()).padStart(2, '0')}-${String(ordersCreated + 1).padStart(4, '0')}`;

        // Create order
        const { data: newOrder, error: orderError } = await supabase
          .from('orders')
          .insert({
            order_number: orderNumber,
            customer_id: customerId,
            subtotal: record.orderValue,
            total: record.orderValue,
            status: 'delivered', // الأخضر والأزرق = تم التسليم
            payment_status: 'paid',
            payment_method: 'cash',
            delivery_address: record.address,
            created_at: record.timestamp,
            notes: `العرض: ${record.offerType} | شركة الشحن: ${record.shippingCompany} | المندوب: ${record.moderator}${record.notes ? ` | ملاحظات: ${record.notes}` : ''}`
          })
          .select('id')
          .single();

        if (orderError) {
          console.error("Error creating order:", orderError);
          continue;
        }

        ordersCreated++;
        setImportProgress(prev => ({ ...prev, orders: ordersCreated }));

        // Create order items
        for (const product of record.products) {
          // Try to find product in database
          let { data: existingProduct } = await supabase
            .from('products')
            .select('id, price')
            .ilike('name', `%${product.name}%`)
            .single();

          const unitPrice = record.products.length > 0 
            ? record.orderValue / record.products.reduce((sum, p) => sum + p.quantity, 0)
            : existingProduct?.price || 0;

          const { error: itemError } = await supabase
            .from('order_items')
            .insert({
              order_id: newOrder.id,
              product_id: existingProduct?.id || null,
              product_name: product.name,
              quantity: product.quantity,
              unit_price: unitPrice,
              total_price: unitPrice * product.quantity
            });

          if (!itemError) {
            itemsCreated++;
            setImportProgress(prev => ({ ...prev, items: itemsCreated }));
          }
        }

        // If no products, create a single item for the offer
        if (record.products.length === 0) {
          const { error: itemError } = await supabase
            .from('order_items')
            .insert({
              order_id: newOrder.id,
              product_id: null,
              product_name: record.offerType || 'طلب',
              quantity: 1,
              unit_price: record.orderValue,
              total_price: record.orderValue
            });

          if (!itemError) {
            itemsCreated++;
            setImportProgress(prev => ({ ...prev, items: itemsCreated }));
          }
        }
      }

      // Update customer totals
      for (const [_, customerId] of processedCustomers) {
        const { data: orderStats } = await supabase
          .from('orders')
          .select('total')
          .eq('customer_id', customerId);

        if (orderStats) {
          const totalSpent = orderStats.reduce((sum, o) => sum + Number(o.total), 0);
          await supabase
            .from('customers')
            .update({
              total_orders: orderStats.length,
              total_spent: totalSpent
            })
            .eq('id', customerId);
        }
      }

      toast.success(`تم استيراد البيانات بنجاح! العملاء: ${customersCreated}, الطلبات: ${ordersCreated}, العناصر: ${itemsCreated}`);
    } catch (error) {
      console.error("Import error:", error);
      toast.error("حدث خطأ أثناء الاستيراد");
    } finally {
      setImporting(false);
    }
  };

  return (
    <DashboardLayout>
      <Header 
        title="استيراد بيانات المبيعات" 
        subtitle="استيراد بيانات مبيعات عام 2025 كامل من ملف Excel"
      />
      
      <div className="p-4 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              ملف مبيعات عام 2025 كامل
            </CardTitle>
            <CardDescription>
              سيتم إنشاء العملاء والطلبات تلقائياً من البيانات
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {loading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : records.length > 0 ? (
                    <CheckCircle className="h-5 w-5 text-green-500" />
                  ) : (
                    <AlertCircle className="h-5 w-5 text-yellow-500" />
                  )}
                  <span>
                    {loading ? 'جاري تحميل البيانات...' : `${records.length} طلب جاهز للاستيراد`}
                  </span>
                </div>
                
                <Button 
                  onClick={importToDatabase}
                  disabled={importing || records.length === 0}
                  size="lg"
                >
                  {importing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin ml-2" />
                      جاري الاستيراد...
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4 ml-2" />
                      استيراد {records.length} طلب
                    </>
                  )}
                </Button>
              </div>

              {importing && (
                <div className="bg-muted p-4 rounded-lg">
                  <p className="font-medium mb-2">تقدم الاستيراد:</p>
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <p className="text-2xl font-bold text-green-600">{importProgress.customers}</p>
                      <p className="text-sm text-muted-foreground">عميل جديد</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-blue-600">{importProgress.orders}</p>
                      <p className="text-sm text-muted-foreground">طلب</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-purple-600">{importProgress.items}</p>
                      <p className="text-sm text-muted-foreground">منتج</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {records.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>معاينة الطلبات</CardTitle>
              <CardDescription>أول 30 طلب من الملف</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">#</TableHead>
                      <TableHead className="text-right">التاريخ</TableHead>
                      <TableHead className="text-right">المندوب</TableHead>
                      <TableHead className="text-right">العميل</TableHead>
                      <TableHead className="text-right">الهاتف</TableHead>
                      <TableHead className="text-right">المدينة</TableHead>
                      <TableHead className="text-right">القيمة</TableHead>
                      <TableHead className="text-right">العرض</TableHead>
                      <TableHead className="text-right">المنتجات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {records.slice(0, 30).map((record, index) => (
                      <TableRow key={index}>
                        <TableCell className="font-medium">{index + 1}</TableCell>
                        <TableCell className="text-xs">
                          {new Date(record.timestamp).toLocaleDateString('ar-EG')}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{record.moderator}</Badge>
                        </TableCell>
                        <TableCell className="font-medium">{record.customerName}</TableCell>
                        <TableCell className="text-xs font-mono">{record.customerPhone}</TableCell>
                        <TableCell>{record.city}</TableCell>
                        <TableCell className="font-bold text-green-600">
                          {record.orderValue.toLocaleString()} ج.م
                        </TableCell>
                        <TableCell className="text-xs">{record.offerType}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {record.products.slice(0, 3).map((p, i) => (
                              <Badge key={i} variant="secondary" className="text-xs">
                                {p.name} ({p.quantity})
                              </Badge>
                            ))}
                            {record.products.length > 3 && (
                              <Badge variant="outline" className="text-xs">
                                +{record.products.length - 3}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        )}

        {/* Statistics */}
        {records.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-3xl font-bold text-primary">
                    {records.length}
                  </p>
                  <p className="text-sm text-muted-foreground">إجمالي الطلبات</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-3xl font-bold text-green-600">
                    {records.reduce((sum, r) => sum + r.orderValue, 0).toLocaleString()}
                  </p>
                  <p className="text-sm text-muted-foreground">إجمالي المبيعات (ج.م)</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-3xl font-bold text-blue-600">
                    {new Set(records.map(r => r.customerPhone)).size}
                  </p>
                  <p className="text-sm text-muted-foreground">عملاء فريدين</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-3xl font-bold text-purple-600">
                    {new Set(records.map(r => r.moderator)).size}
                  </p>
                  <p className="text-sm text-muted-foreground">مندوبين</p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default ImportSalesData;
