import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export interface CarriedDetail {
  orderId: string;
  orderNumber: string;
  girl: string;
  originLabel: string;
  closureApprovedAt: string | null;
  deliveredAt: string | null;
  category: 'مصنعات' | 'لحوم' | 'لحوم بالعظم';
  quantity: number;
  tierLabel: string;
  rate: number;
  bonus: number;
}

const fmtDT = (v: string | null) =>
  v ? new Date(v).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo', dateStyle: 'short', timeStyle: 'short' }) : '-';
const fmtN = (n: number) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  girl: string;
  details: CarriedDetail[];
}

const PrevMonthBonusDialog = ({ open, onOpenChange, girl, details }: Props) => {
  const sum = (cat: CarriedDetail['category']) =>
    details.filter((d) => d.category === cat).reduce((s, d) => s + d.bonus, 0);
  const total = details.reduce((s, d) => s + d.bonus, 0);
  const showRate = details.some((detail) => detail.rate > 0);
  const categories = (['مصنعات', 'لحوم', 'لحوم بالعظم'] as const).filter(
    (category) => details.some((detail) => detail.category === category),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[85vh] overflow-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle>تفاصيل بونص الشهر السابق — {girl}</DialogTitle>
        </DialogHeader>
        {details.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">لا توجد أوردرات مرحّلة.</p>
        ) : (
          <>
            <Table className="text-xs border">
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-right border">رقم الأوردر</TableHead>
                  <TableHead className="text-center border">الموظفة</TableHead>
                  <TableHead className="text-center border">شهر الأوردر</TableHead>
                  <TableHead className="text-center border">اعتماد قبض الشهر</TableHead>
                  <TableHead className="text-center border">تاريخ التسليم الناجح</TableHead>
                  <TableHead className="text-center border">التصنيف</TableHead>
                  <TableHead className="text-center border">الكمية</TableHead>
                  <TableHead className="text-center border">البيان</TableHead>
                  {showRate && <TableHead className="text-center border">بونص الكيلو</TableHead>}
                  <TableHead className="text-center border">قيمة البونص</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {details.map((d) => (
                  <TableRow key={`${d.orderId}-${d.category}`}>
                    <TableCell className="border">{d.orderNumber}</TableCell>
                    <TableCell className="text-center border">{d.girl}</TableCell>
                    <TableCell className="text-center border">{d.originLabel}</TableCell>
                    <TableCell className="text-center border">{fmtDT(d.closureApprovedAt)}</TableCell>
                    <TableCell className="text-center border">{fmtDT(d.deliveredAt)}</TableCell>
                    <TableCell className="text-center border">{d.category}</TableCell>
                    <TableCell className="text-center border">{fmtN(d.quantity)}</TableCell>
                    <TableCell className="text-center border">{d.tierLabel}</TableCell>
                    {showRate && <TableCell className="text-center border">{fmtN(d.rate)}</TableCell>}
                    <TableCell className="text-center border font-semibold text-primary">{fmtN(d.bonus)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="mt-4 grid gap-2 text-sm">
              {categories.map((category) => (
                <div key={category} className="flex justify-between border-b pb-1">
                  <span>إجمالي بونص {category} المرحّل</span><span className="font-semibold">{fmtN(sum(category))} ج.م</span>
                </div>
              ))}
              <div className="flex justify-between text-primary font-bold">
                <span>إجمالي بونص الشهر السابق</span><span>{fmtN(total)} ج.م</span>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default PrevMonthBonusDialog;
