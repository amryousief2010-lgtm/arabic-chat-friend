import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ClipboardList } from 'lucide-react';

const GIRLS = ['اية', 'نورا', 'سارة', 'منال'];

interface GirlData {
  meat_qty: number;
  processed_qty: number;
}

interface Prices {
  meat_price: number;
  processed_price: number;
}

const STORAGE_KEY = 'girls-sales-quantity-table-v2';
const PRICES_KEY = 'girls-sales-prices';

const emptyData = (): Record<string, GirlData> =>
  GIRLS.reduce((acc, g) => {
    acc[g] = { meat_qty: 0, processed_qty: 0 };
    return acc;
  }, {} as Record<string, GirlData>);

const GirlsSalesQuantityTable = () => {
  const [data, setData] = useState<Record<string, GirlData>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return { ...emptyData(), ...JSON.parse(saved) };
    } catch {}
    return emptyData();
  });

  const [prices, setPrices] = useState<Prices>(() => {
    try {
      const saved = localStorage.getItem(PRICES_KEY);
      if (saved) return JSON.parse(saved);
    } catch {}
    return { meat_price: 390, processed_price: 160 };
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {}
  }, [data]);

  useEffect(() => {
    try { localStorage.setItem(PRICES_KEY, JSON.stringify(prices)); } catch {}
  }, [prices]);

  const updateQty = (girl: string, field: keyof GirlData, value: number) => {
    setData(prev => ({ ...prev, [girl]: { ...prev[girl], [field]: value } }));
  };

  const totals = useMemo(() => {
    return GIRLS.reduce((acc, g) => {
      const d = data[g];
      acc[g] = {
        meat_total: d.meat_qty * prices.meat_price,
        processed_total: d.processed_qty * prices.processed_price,
      };
      return acc;
    }, {} as Record<string, { meat_total: number; processed_total: number }>);
  }, [data, prices]);

  const qtyInput = (girl: string, field: keyof GirlData) => (
    <Input
      type="number"
      min="0"
      value={data[girl][field] || ''}
      onChange={(e) => updateQty(girl, field, Number(e.target.value) || 0)}
      className="w-24 text-center mx-auto"
    />
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-primary" />
          جدول مبيعات المسوقات (اللحوم والمصنعات)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Price controls */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-lg bg-muted/40 border">
          <div className="space-y-2">
            <Label>سعر كيلو اللحوم (ج.م)</Label>
            <Input
              type="number"
              min="0"
              value={prices.meat_price || ''}
              onChange={(e) => setPrices(p => ({ ...p, meat_price: Number(e.target.value) || 0 }))}
            />
          </div>
          <div className="space-y-2">
            <Label>سعر كيلو المصنعات (ج.م)</Label>
            <Input
              type="number"
              min="0"
              value={prices.processed_price || ''}
              onChange={(e) => setPrices(p => ({ ...p, processed_price: Number(e.target.value) || 0 }))}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right font-bold">البيان</TableHead>
                {GIRLS.map((g) => (
                  <TableHead key={g} className="text-center font-bold text-primary">{g}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">كمية مبيعات اللحوم (كجم)</TableCell>
                {GIRLS.map(g => <TableCell key={g} className="text-center">{qtyInput(g, 'meat_qty')}</TableCell>)}
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">سعر كيلو اللحوم</TableCell>
                {GIRLS.map(g => <TableCell key={g} className="text-center">{prices.meat_price.toLocaleString()}</TableCell>)}
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">مبلغ اللحوم (ج.م)</TableCell>
                {GIRLS.map(g => (
                  <TableCell key={g} className="text-center font-bold text-primary">
                    {totals[g].meat_total.toLocaleString()}
                  </TableCell>
                ))}
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">كمية المصنعات (كجم)</TableCell>
                {GIRLS.map(g => <TableCell key={g} className="text-center">{qtyInput(g, 'processed_qty')}</TableCell>)}
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">سعر كيلو المصنعات</TableCell>
                {GIRLS.map(g => <TableCell key={g} className="text-center">{prices.processed_price.toLocaleString()}</TableCell>)}
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">مبلغ المصنعات (ج.م)</TableCell>
                {GIRLS.map(g => (
                  <TableCell key={g} className="text-center font-bold text-primary">
                    {totals[g].processed_total.toLocaleString()}
                  </TableCell>
                ))}
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};

export default GirlsSalesQuantityTable;
