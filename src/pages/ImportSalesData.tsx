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
import { Progress } from "@/components/ui/progress";

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

// Product column mapping for the 2025 analysis file (Page 7 raw data sheet)
// Columns start at index 25 based on header: اللحم, الاستيك, الموزه, ...
const PRODUCT_COLUMNS = [
  { name: 'اللحم', index: 25 },
  { name: 'الاستيك', index: 26 },
  { name: 'الموزه', index: 27 },
  { name: 'الفراشه', index: 28 },
  { name: 'قطعية الدبوس', index: 29 },
  { name: 'قطعية التريبيانكو', index: 30 },
  { name: 'قطعية الاسكلوب', index: 31 },
  { name: 'ميت رول', index: 32 },
  { name: 'الكبده', index: 33 },
  { name: 'القلب', index: 34 },
  { name: 'القوانص', index: 35 },
  { name: 'الرقاب', index: 36 },
  { name: 'الدهن', index: 37 },
  { name: 'الكوارع', index: 38 },
  { name: 'كفتة', index: 39 },
  { name: 'سجق', index: 40 },
  { name: 'برجر', index: 41 },
  { name: 'لانشون سادة', index: 42 },
  { name: 'لانشون بالفلفل الاسود', index: 43 },
  { name: 'لانشون ببروني', index: 44 },
  { name: 'مفروم حواوشي', index: 45 },
  { name: 'مفروم', index: 46 },
  { name: 'كريم المفاصل', index: 47 },
  { name: 'زيت الشعر', index: 48 },
  { name: 'كريم الشعر', index: 49 },
  { name: 'كريم للبشرة', index: 50 },
  { name: 'لحم غزال', index: 51 },
  { name: 'شاورما', index: 52 },
  { name: 'كباب', index: 53 },
  { name: 'شيش', index: 54 },
  { name: 'ممبار', index: 55 },
  { name: 'كفتة أرز', index: 56 },
  { name: 'بيض', index: 57 },
  { name: 'دبوس 7 كيلو', index: 58 },
  { name: 'طرب', index: 59 },
  { name: 'برجر بالجبنة', index: 60 },
];

const ImportSalesData = () => {
  const [records, setRecords] = useState<SalesRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    success: boolean;
    customersCreated: number;
    ordersCreated: number;
    itemsCreated: number;
  } | null>(null);

  useEffect(() => {
    loadExcelFile();
  }, []);

  const parseExcelDate = (value: any): string | null => {
    if (!value) return null;
    if (typeof value === 'number') {
      return new Date((value - 25569) * 86400 * 1000).toISOString();
    }
    if (typeof value === 'string') {
      const parts = value.split(' ');
      if (parts.length >= 1) {
        const dateParts = parts[0].split('/');
        if (dateParts.length === 3) {
          const month = dateParts[0].padStart(2, '0');
          const day = dateParts[1].padStart(2, '0');
          const year = dateParts[2].length === 2 ? `20${dateParts[2]}` : dateParts[2];
          const time = parts[1] || '12:00:00';
          return `${year}-${month}-${day}T${time}Z`;
        }
      }
      const parsed = new Date(value);
      if (!isNaN(parsed.getTime())) return parsed.toISOString();
    }
    return null;
  };

  const loadExcelFile = async () => {
    setLoading(true);
    try {
      const response = await fetch('/data/sales-2025-full.xlsx');
      const arrayBuffer = await response.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, {
        type: 'array',
        cellFormula: false,
        cellHTML: false,
        cellStyles: false,
        bookVBA: false,
      });

      // Find the sheet with raw order data (the one with most rows, typically named with order data)
      let bestSheet: any = null;
      let bestRowCount = 0;
      for (const sheetName of workbook.SheetNames) {
        const s = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(s, { header: 1 }) as any[][];
        if (data.length > bestRowCount) {
          bestRowCount = data.length;
          bestSheet = s;
        }
      }

      if (!bestSheet) throw new Error("لم يتم العثور على بيانات");

      const rawData = XLSX.utils.sheet_to_json(bestSheet, { header: 1 }) as any[][];
      console.log(`[IMPORT] Sheet rows: ${rawData.length}`);
      console.log(`[IMPORT] Header row (all):`, JSON.stringify(rawData[0]));
      console.log(`[IMPORT] Row 1 data (all):`, JSON.stringify(rawData[1]));
      console.log(`[IMPORT] Row 2 data (all):`, JSON.stringify(rawData[2]));
      // Log all sheet names for debugging
      console.log(`[IMPORT] All sheets:`, workbook.SheetNames);

      const parsedRecords: SalesRecord[] = [];
      for (let i = 1; i < rawData.length; i++) {
        const row = rawData[i];
        if (!row || row.length < 20) continue;

        // Column mapping based on the 2025 analysis file structure:
        // 4: OrderDateTime, 6: Moderator_Norm, 8: Source_Norm, 10: Shipping_Norm
        // 12: Governorate_Norm, 13: City, 15: Customer Name, 16: Phone, 17: Phone2
        // 18: Address, 19: OrderValue, 22: BigItem_Desc
        const customerName = row[15];
        if (!customerName || String(customerName).trim() === '') continue;

        const orderValue = parseFloat(String(row[19]).replace(/,/g, '')) || 0;
        if (orderValue <= 0) continue;

        const products: { name: string; quantity: number }[] = [];
        for (const col of PRODUCT_COLUMNS) {
          const rawQty = row[col.index];
          const qty = parseFloat(String(rawQty).replace(/\./g, '').replace(',', '.')) || parseFloat(rawQty) || 0;
          if (qty > 0) products.push({ name: col.name, quantity: Math.round(qty) || qty });
        }

        const bigItemDesc = String(row[22] || '').trim();
        const offerType = bigItemDesc && bigItemDesc !== 'nan' ? bigItemDesc : '';

        parsedRecords.push({
          timestamp: parseExcelDate(row[4]) || new Date().toISOString(),
          moderator: String(row[6] || '').trim(), // Moderator_Norm
          customerSource: String(row[8] || '').trim(), // Source_Norm
          customerName: String(customerName).trim(),
          customerPhone: String(row[16] || '').replace(/\s/g, '').replace(/\+/g, ''),
          customerPhone2: row[17] ? String(row[17]).replace(/\s/g, '').replace(/\+/g, '') : undefined,
          address: String(row[18] || '').trim(),
          shippingCompany: String(row[10] || '').trim(), // Shipping_Norm
          orderValue,
          offerType,
          notes: '',
          governorate: String(row[12] || '').trim(), // Governorate_Norm
          city: String(row[13] || '').trim(), // City/Centre
          products,
        });
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

  const importToDatabase = async () => {
    if (records.length === 0) {
      toast.error("لا توجد بيانات للاستيراد");
      return;
    }

    setImporting(true);
    setImportResult(null);

    try {
      const CHUNK_SIZE = 100;
      let totalCustomers = 0;
      let totalOrders = 0;
      let totalItems = 0;

      for (let i = 0; i < records.length; i += CHUNK_SIZE) {
        const chunk = records.slice(i, i + CHUNK_SIZE);
        toast.info(`جاري استيراد الدفعة ${Math.floor(i / CHUNK_SIZE) + 1} من ${Math.ceil(records.length / CHUNK_SIZE)}...`);

      const { data, error } = await supabase.functions.invoke('import-sales', {
          body: { records: chunk, batchSize: 25 },
        });

        if (error) throw error;

        totalCustomers += data.customersCreated || 0;
        totalOrders += data.ordersCreated || 0;
        totalItems += data.itemsCreated || 0;
      }

      setImportResult({
        success: true,
        customersCreated: totalCustomers,
        ordersCreated: totalOrders,
        itemsCreated: totalItems,
      });

      toast.success(
        `تم الاستيراد! عملاء: ${totalCustomers}, طلبات: ${totalOrders}, عناصر: ${totalItems}`
      );
    } catch (error: any) {
      console.error("Import error:", error);
      toast.error(`خطأ في الاستيراد: ${error.message || 'خطأ غير معروف'}`);
    } finally {
      setImporting(false);
    }
  };

  return (
    <DashboardLayout>
      <Header
        title="استيراد بيانات المبيعات"
        subtitle="استيراد بيانات تحليل مبيعات عام 2025 كامل من ملف Excel"
      />

      <div className="p-4 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              ملف مبيعات عام 2025 كامل
            </CardTitle>
            <CardDescription>
              سيتم إنشاء العملاء والطلبات تلقائياً عبر الخادم (بدون حاجة لتسجيل الدخول)
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
                      جاري الاستيراد (قد يستغرق دقائق)...
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
                <div className="bg-muted p-4 rounded-lg space-y-3">
                  <p className="font-medium">جاري الاستيراد عبر الخادم... يرجى الانتظار</p>
                  <Progress value={undefined} className="w-full animate-pulse" />
                  <p className="text-sm text-muted-foreground">
                    العملية تتم على الخادم مباشرة وقد تستغرق عدة دقائق حسب حجم البيانات
                  </p>
                </div>
              )}

              {importResult && (
                <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 p-4 rounded-lg">
                  <p className="font-bold text-green-700 dark:text-green-300 mb-3">✅ تم الاستيراد بنجاح!</p>
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <p className="text-2xl font-bold text-green-600">{importResult.customersCreated}</p>
                      <p className="text-sm text-muted-foreground">عميل جديد</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-blue-600">{importResult.ordersCreated}</p>
                      <p className="text-sm text-muted-foreground">طلب</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-purple-600">{importResult.itemsCreated}</p>
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
                  <p className="text-3xl font-bold text-primary">{records.length}</p>
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
