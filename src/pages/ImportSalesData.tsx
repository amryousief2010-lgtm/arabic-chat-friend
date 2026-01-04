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
  date: string;
  customerName: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  total: number;
  status: "delivered" | "pending" | "cancelled";
  paymentStatus: "paid" | "pending";
  notes?: string;
}

const ImportSalesData = () => {
  const [records, setRecords] = useState<SalesRecord[]>([]);
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
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
      const response = await fetch('/data/sales-october-2025.xlsx');
      const arrayBuffer = await response.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      
      // Get raw data
      const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
      
      console.log("Raw data from Excel:", rawData.slice(0, 20));
      console.log("Sheet names:", workbook.SheetNames);
      
      // Show headers (first row)
      if (rawData.length > 0) {
        setRawHeaders(rawData[0]?.map((h: any) => String(h || '')) || []);
        setRawPreview(rawData.slice(0, 15));
      }
      
      // Parse the data based on actual structure
      const parsedRecords: SalesRecord[] = [];
      
      // Find column indices by common names
      const headers = rawData[0] || [];
      const findColIndex = (names: string[]) => {
        return headers.findIndex((h: any) => 
          names.some(name => String(h || '').includes(name))
        );
      };
      
      const dateCol = findColIndex(['تاريخ', 'التاريخ', 'date', 'Date']);
      const customerCol = findColIndex(['عميل', 'العميل', 'اسم العميل', 'customer', 'Customer', 'الاسم']);
      const productCol = findColIndex(['منتج', 'المنتج', 'صنف', 'الصنف', 'product', 'Product', 'البيان']);
      const qtyCol = findColIndex(['كمية', 'الكمية', 'quantity', 'Quantity', 'عدد']);
      const priceCol = findColIndex(['سعر', 'السعر', 'price', 'Price', 'سعر الوحدة']);
      const totalCol = findColIndex(['إجمالي', 'الإجمالي', 'المجموع', 'total', 'Total', 'المبلغ', 'القيمة']);
      
      console.log("Column indices:", { dateCol, customerCol, productCol, qtyCol, priceCol, totalCol });
      
      // Process data rows
      for (let i = 1; i < rawData.length; i++) {
        const row = rawData[i];
        if (!row || row.length < 2) continue;
        
        // Skip empty rows
        const hasData = row.some((cell: any) => cell !== null && cell !== undefined && cell !== '');
        if (!hasData) continue;
        
        const record: SalesRecord = {
          date: parseExcelDate(row[dateCol >= 0 ? dateCol : 0]) || `2025-10-${String(i).padStart(2, '0')}`,
          customerName: String(row[customerCol >= 0 ? customerCol : 1] || `عميل ${i}`).trim(),
          productName: String(row[productCol >= 0 ? productCol : 2] || 'منتج').trim(),
          quantity: parseFloat(row[qtyCol >= 0 ? qtyCol : 3]) || 1,
          unitPrice: parseFloat(row[priceCol >= 0 ? priceCol : 4]) || 0,
          total: parseFloat(row[totalCol >= 0 ? totalCol : 5]) || 0,
          status: "delivered",
          paymentStatus: "paid",
          notes: undefined
        };
        
        // Only add if has meaningful data
        if (record.customerName && record.customerName !== 'undefined' && (record.total > 0 || record.quantity > 0)) {
          parsedRecords.push(record);
        }
      }
      
      setRecords(parsedRecords);
      toast.success(`تم تحميل ${parsedRecords.length} سجل من الملف`);
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
      return date.toISOString().split('T')[0];
    }
    
    // If it's already a string
    if (typeof value === 'string') {
      const parsed = new Date(value);
      if (!isNaN(parsed.getTime())) {
        return parsed.toISOString().split('T')[0];
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
      // Group records by customer
      const customerOrders = new Map<string, SalesRecord[]>();
      
      for (const record of records) {
        const existing = customerOrders.get(record.customerName) || [];
        existing.push(record);
        customerOrders.set(record.customerName, existing);
      }

      let customersCreated = 0;
      let ordersCreated = 0;
      let itemsCreated = 0;

      // Process each customer
      for (const [customerName, customerRecords] of customerOrders) {
        // Check if customer exists
        let { data: existingCustomer } = await supabase
          .from('customers')
          .select('id')
          .eq('name', customerName)
          .single();

        let customerId: string;

        if (!existingCustomer) {
          // Create new customer
          const { data: newCustomer, error: customerError } = await supabase
            .from('customers')
            .insert({
              name: customerName,
              phone: '0000000000',
              address: 'عنوان غير محدد',
              city: 'غير محدد'
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

        setImportProgress(prev => ({ ...prev, customers: customersCreated }));

        // Group by date to create orders
        const ordersByDate = new Map<string, SalesRecord[]>();
        for (const record of customerRecords) {
          const existing = ordersByDate.get(record.date) || [];
          existing.push(record);
          ordersByDate.set(record.date, existing);
        }

        // Create orders
        for (const [date, orderRecords] of ordersByDate) {
          const subtotal = orderRecords.reduce((sum, r) => sum + r.total, 0);
          
          // Generate order number
          const orderNumber = `ORD-${date.replace(/-/g, '')}-${String(ordersCreated + 1).padStart(4, '0')}`;

          const { data: newOrder, error: orderError } = await supabase
            .from('orders')
            .insert({
              order_number: orderNumber,
              customer_id: customerId,
              subtotal: subtotal,
              total: subtotal,
              status: orderRecords[0].status === 'delivered' ? 'delivered' : 'pending',
              payment_status: orderRecords[0].paymentStatus,
              payment_method: 'cash',
              delivery_address: 'عنوان التسليم',
              created_at: `${date}T12:00:00Z`,
              notes: `مستورد من ملف Excel - شهر 10/2025`
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
          for (const record of orderRecords) {
            // Try to find product
            let { data: product } = await supabase
              .from('products')
              .select('id, price')
              .eq('name', record.productName)
              .single();

            const { error: itemError } = await supabase
              .from('order_items')
              .insert({
                order_id: newOrder.id,
                product_id: product?.id || null,
                product_name: record.productName,
                quantity: record.quantity,
                unit_price: record.unitPrice || (product?.price || 0),
                total_price: record.total
              });

            if (!itemError) {
              itemsCreated++;
              setImportProgress(prev => ({ ...prev, items: itemsCreated }));
            }
          }
        }
      }

      // Update customer totals
      for (const [customerName] of customerOrders) {
        const { data: customer } = await supabase
          .from('customers')
          .select('id')
          .eq('name', customerName)
          .single();

        if (customer) {
          const { data: orderStats } = await supabase
            .from('orders')
            .select('total')
            .eq('customer_id', customer.id);

          if (orderStats) {
            const totalSpent = orderStats.reduce((sum, o) => sum + Number(o.total), 0);
            await supabase
              .from('customers')
              .update({
                total_orders: orderStats.length,
                total_spent: totalSpent
              })
              .eq('id', customer.id);
          }
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

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'delivered':
        return <Badge className="bg-green-500">تم التسليم</Badge>;
      case 'pending':
        return <Badge className="bg-yellow-500">قيد الانتظار</Badge>;
      case 'cancelled':
        return <Badge className="bg-red-500">ملغي</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  return (
    <DashboardLayout>
      <Header 
        title="استيراد بيانات المبيعات" 
        subtitle="استيراد بيانات شهر 10/2025 من ملف Excel"
      />
      
      <div className="p-4 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              ملف المبيعات
            </CardTitle>
            <CardDescription>
              تم تحميل ملف مبيعات شهر 10 لعام 2025
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
                    {loading ? 'جاري تحميل البيانات...' : `${records.length} سجل جاهز للاستيراد`}
                  </span>
                </div>
                
                <Button 
                  onClick={importToDatabase}
                  disabled={importing || records.length === 0}
                >
                  {importing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin ml-2" />
                      جاري الاستيراد...
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4 ml-2" />
                      استيراد للقاعدة
                    </>
                  )}
                </Button>
              </div>

              {importing && (
                <div className="bg-muted p-4 rounded-lg">
                  <p className="font-medium mb-2">تقدم الاستيراد:</p>
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <p className="text-2xl font-bold text-primary">{importProgress.customers}</p>
                      <p className="text-sm text-muted-foreground">عميل</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-primary">{importProgress.orders}</p>
                      <p className="text-sm text-muted-foreground">طلب</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-primary">{importProgress.items}</p>
                      <p className="text-sm text-muted-foreground">عنصر</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Raw data preview to understand file structure */}
        {rawPreview.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>البيانات الخام من الملف</CardTitle>
              <CardDescription>
                أعمدة الملف: {rawHeaders.join(' | ')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[300px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">#</TableHead>
                      {rawHeaders.map((header, idx) => (
                        <TableHead key={idx} className="text-right text-xs">
                          {header || `عمود ${idx + 1}`}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rawPreview.slice(1).map((row, rowIdx) => (
                      <TableRow key={rowIdx}>
                        <TableCell className="font-bold">{rowIdx + 1}</TableCell>
                        {row.map((cell, cellIdx) => (
                          <TableCell key={cellIdx} className="text-xs">
                            {cell !== null && cell !== undefined ? String(cell) : '-'}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        )}

        {records.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>معاينة البيانات المحللة</CardTitle>
              <CardDescription>أول 50 سجل بعد التحليل</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">التاريخ</TableHead>
                      <TableHead className="text-right">العميل</TableHead>
                      <TableHead className="text-right">المنتج</TableHead>
                      <TableHead className="text-right">الكمية</TableHead>
                      <TableHead className="text-right">السعر</TableHead>
                      <TableHead className="text-right">الإجمالي</TableHead>
                      <TableHead className="text-right">الحالة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {records.slice(0, 50).map((record, index) => (
                      <TableRow key={index}>
                        <TableCell>{record.date}</TableCell>
                        <TableCell>{record.customerName}</TableCell>
                        <TableCell>{record.productName}</TableCell>
                        <TableCell>{record.quantity}</TableCell>
                        <TableCell>{record.unitPrice?.toFixed(2)} ر.س</TableCell>
                        <TableCell>{record.total?.toFixed(2)} ر.س</TableCell>
                        <TableCell>{getStatusBadge(record.status)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
};

export default ImportSalesData;
