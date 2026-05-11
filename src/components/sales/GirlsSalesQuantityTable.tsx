import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ClipboardList } from 'lucide-react';

const GIRLS = ['اية', 'نورا', 'سارة', 'منال'];

type FieldKey = 'meat_qty' | 'meat_price' | 'processed_qty' | 'processed_price';

interface GirlData {
  meat_qty: number;
  meat_price: number;
  processed_qty: number;
  processed_price: number;
}

const emptyData = (): Record<string, GirlData> =>
  GIRLS.reduce((acc, g) => {
    acc[g] = { meat_qty: 0, meat_price: 390, processed_qty: 0, processed_price: 160 };
    return acc;
  }, {} as Record<string, GirlData>);

const STORAGE_KEY = 'girls-sales-quantity-table';

const GirlsSalesQuantityTable = () => {
  const [data, setData] = useState<Record<string, GirlData>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return { ...emptyData(), ...JSON.parse(saved) };
    } catch {}
    return emptyData();
  });

  const update = (girl: string, field: FieldKey, value: number) => {
    setData(prev => {
      const next = { ...prev, [girl]: { ...prev[girl], [field]: value } };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const totals = useMemo(() => {
    return GIRLS.reduce((acc, g) => {
      const d = data[g];
      acc[g] = {
        meat_total: d.meat_qty * d.meat_price,
        processed_total: d.processed_qty * d.processed_price,
      };
      return acc;
    }, {} as Record<string, { meat_total: number; processed_total: number }>);
  }, [data]);

  const numInput = (girl: string, field: FieldKey) => (
    <Input
      type="number"
      min="0"
      value={data[girl][field] || ''}
      onChange={(e) => update(girl, field, Number(e.target.value) || 0)}
      className="w-24 text-center"
    />
  );

  const rows: { label: string; render: (g: string) => React.ReactNode }[] = [
    { label: 'كمية مبيعات اللحوم (كجم)', render: (g) => numInput(g, 'meat_qty') },
    { label: 'سعر كيلو اللحوم', render: (g) => numInput(g, 'meat_price') },
    {
      label: 'مبلغ اللحوم (ج.م)',
      render: (g) => (
        <span className="font-bold text-primary">
          {totals[g].meat_total.toLocaleString()}
        </span>
      ),
    },
    { label: 'كمية المصنعات (كجم)', render: (g) => numInput(g, 'processed_qty') },
    { label: 'سعر كيلو المصنعات', render: (g) => numInput(g, 'processed_price') },
    {
      label: 'مبلغ المصنعات (ج.م)',
      render: (g) => (
        <span className="font-bold text-primary">
          {totals[g].processed_total.toLocaleString()}
        </span>
      ),
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-primary" />
          جدول مبيعات المسوقات (اللحوم والمصنعات)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right font-bold">البيان</TableHead>
                {GIRLS.map((g) => (
                  <TableHead key={g} className="text-center font-bold text-primary">
                    {g}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.label}>
                  <TableCell className="font-medium">{row.label}</TableCell>
                  {GIRLS.map((g) => (
                    <TableCell key={g} className="text-center">
                      {row.render(g)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};

export default GirlsSalesQuantityTable;
