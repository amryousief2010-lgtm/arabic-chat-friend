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
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

      const parsedRecords: SalesRecord[] = [];
      for (let i = 1; i < rawData.length; i++) {
        const row = rawData[i];
        if (!row || row.length < 5) continue;
        const customerName = row[3];
        if (!customerName || String(customerName).trim() === '') continue;

        const products: { name: string; quantity: number }[] = [];
        for (const col of PRODUCT_COLUMNS) {
          const qty = parseFloat(row[col.index]) || 0;
          if (qty > 0) products.push({ name: col.name, quantity: qty });
        }

        const orderValue = parseFloat(row[35]) || 0;
        if (orderValue <= 0) continue;

        parsedRecords.push({
          timestamp: parseExcelDate(row[0]) || new Date().toISOString(),
          moderator: String(row[1] || '').trim(),
          customerSource: String(row[2] || '').trim(),
          customerName: String(row[3] || '').trim(),
          customerPhone: String(row[4] || '').replace(/\s/g, ''),
          customerPhone2: row[5] ? String(row[5]).replace(/\s/g, '') : undefined,
          address: String(row[6] || '').trim(),
          shippingCompany: String(row[7] || '').trim(),
          orderValue,
          offerType: String(row[36] || '').trim(),
          notes: row[37] ? String(row[37]).trim() : undefined,
          governorate: String(row[38] || '').trim(),
          city: String(row[39] || '').trim(),
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
      const fileUrl = `${window.location.origin}/data/sales-2025-full.xlsx`;

      const { data, error } = await supabase.functions.invoke('import-sales', {
        body: { fileUrl },
      });

      if (error) throw error;

      setImportResult({
        success: true,
        customersCreated: data.customersCreated,
        ordersCreated: data.ordersCreated,
        itemsCreated: data.itemsCreated,
      });

      toast.success(
        `تم الاستيراد! عملاء: ${data.customersCreated}, طلبات: ${data.ordersCreated}, عناصر: ${data.itemsCreated}`
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
