import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Target } from "lucide-react";

// التارجت الشهري لموديريتور نعام العاصمة
const tiers = [
  "التاريخ الأول",
  "التاريخ الثاني",
  "التاريخ الثالث",
  "التاريخ الرابع",
  "التاريخ الخامس",
  "التاريخ السادس",
  "التاريخ السابع",
];

type Row = {
  label: string;
  // For مصنعات/لحوم: [sales, bonus] per tier. For أساسي: single value per tier.
  cells: Array<{ sales?: number; bonus?: number; flat?: number }>;
};

const rows: Row[] = [
  {
    label: "مصنعات",
    cells: [
      { sales: 50000, bonus: 5 },
      { sales: 60000, bonus: 6 },
      { sales: 80000, bonus: 8 },
      { sales: 100000, bonus: 10 },
      { sales: 125000, bonus: 12 },
      { sales: 150000, bonus: 15 },
      { sales: 185000, bonus: 18 },
    ],
  },
  {
    label: "لحوم",
    cells: [
      { sales: 100000, bonus: 5 },
      { sales: 125000, bonus: 5 },
      { sales: 200000, bonus: 5 },
      { sales: 300000, bonus: 7 },
      { sales: 300000, bonus: 7 },
      { sales: 300000, bonus: 7 },
      { sales: 300000, bonus: 7 },
    ],
  },
  {
    label: "أساسي",
    cells: Array.from({ length: 7 }, () => ({ flat: 2500 })),
  },
];

const fmt = (n: number) => n.toLocaleString("en-US");

const MonthlyTargetTable = () => {
  return (
    <Card className="glass-card mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="w-5 h-5 text-primary" />
          جدول التارجت — التارجت الشهري لموديريتور نعام العاصمة
        </CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table className="min-w-[900px] border">
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead rowSpan={2} className="text-center font-bold border align-middle">
                التارجت
              </TableHead>
              {tiers.map((t) => (
                <TableHead key={t} colSpan={2} className="text-center font-bold border text-primary">
                  {t}
                </TableHead>
              ))}
            </TableRow>
            <TableRow className="bg-muted/30">
              {tiers.map((t) => (
                <>
                  <TableHead key={`${t}-s`} className="text-center border text-xs">قيمة المبيعات</TableHead>
                  <TableHead key={`${t}-b`} className="text-center border text-xs">مبلغ البونص</TableHead>
                </>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.label}>
                <TableCell className="text-center font-bold border bg-muted/30">{row.label}</TableCell>
                {row.cells.map((c, i) =>
                  c.flat !== undefined ? (
                    <TableCell key={i} colSpan={2} className="text-center border font-semibold">
                      {fmt(c.flat)}
                    </TableCell>
                  ) : (
                    <>
                      <TableCell key={`${i}-s`} className="text-center border">{fmt(c.sales || 0)}</TableCell>
                      <TableCell key={`${i}-b`} className="text-center border font-semibold text-primary">{c.bonus}</TableCell>
                    </>
                  )
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="text-xs text-muted-foreground mt-3">
          * "أساسي" يمثل المرتب الأساسي الثابت لكل مرحلة. "مبلغ البونص" يُحتسب عند بلوغ "قيمة المبيعات" المقابلة.
        </p>
      </CardContent>
    </Card>
  );
};

export default MonthlyTargetTable;
