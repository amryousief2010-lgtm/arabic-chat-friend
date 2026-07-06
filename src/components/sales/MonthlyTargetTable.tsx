import { Fragment, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Target } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

const tiers = [
  "التارجت الأول",
  "التارجت الثاني",
  "التارجت الثالث",
  "التارجت الرابع",
  "التارجت الخامس",
  "التارجت السادس",
  "التارجت السابع",
];

const categories = ["مصنعات", "لحوم"] as const;
type Category = typeof categories[number];

interface BonusRow {
  id: string;
  category: string;
  tier: number;
  sales_amount: number;
  bonus_amount: number;
}

const fmt = (n: number) => Number(n || 0).toLocaleString("en-US");

const MonthlyTargetTable = () => {
  const { role, isGeneralManager, isExecutiveManager, isSalesManager } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const canEdit =
    isGeneralManager || isExecutiveManager || isSalesManager || role === "marketing_sales_manager";

  const { data: rows = [] } = useQuery({
    queryKey: ["target_bonus_settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("target_bonus_settings")
        .select("*")
        .order("category")
        .order("tier");
      if (error) throw error;
      return data as BonusRow[];
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, field, value }: { id: string; field: "sales_amount" | "bonus_amount"; value: number }) => {
      const payload: any = { [field]: value };
      const { error } = await supabase
        .from("target_bonus_settings")
        .update(payload)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["target_bonus_settings"] });
    },
    onError: (e: any) => {
      toast({ title: "تعذر الحفظ", description: e.message, variant: "destructive" });
    },
  });

  const grouped = useMemo(() => {
    const map: Record<Category, BonusRow[]> = {
      "مصنعات": [],
      "لحوم": [],
    };
    rows.forEach((r) => {
      if (map[r.category as Category]) map[r.category as Category].push(r);
    });
    Object.values(map).forEach((arr) => arr.sort((a, b) => a.tier - b.tier));
    return map;
  }, [rows]);

  const renderCell = (row: BonusRow | undefined, field: "sales_amount" | "bonus_amount") => {
    if (!row) return <span>-</span>;
    if (canEdit) {
      return (
        <Input
          type="number"
          defaultValue={row[field]}
          className="h-8 text-center w-full px-1 text-xs"
          onBlur={(e) => {
            const v = Number(e.target.value);
            if (v !== Number(row[field])) {
              updateMutation.mutate({ id: row.id, field, value: v });
            }
          }}
        />
      );
    }
    return <span className={field === "bonus_amount" ? "font-semibold text-primary" : ""}>{fmt(row[field])}</span>;
  };

  return (
    <Card className="glass-card mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 flex-wrap text-sm md:text-base">
          <Target className="w-5 h-5 text-primary" />
          جدول التارجت الشهري لموديريتور نعام العاصمة
          {canEdit && (
            <span className="text-xs font-normal text-muted-foreground mr-2">
              (اضغط على الخانة للتعديل)
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-2 md:p-4">
        <Table className="border w-full text-xs md:text-sm">
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead rowSpan={2} className="text-center font-bold border align-middle px-1 md:px-2">
                التارجت
              </TableHead>
              {categories.map((cat) => (
                <TableHead key={cat} colSpan={2} className="text-center font-bold border text-primary px-1 md:px-2">
                  {cat}
                </TableHead>
              ))}
            </TableRow>
            <TableRow className="bg-muted/30">
              {categories.map((cat) => (
                <Fragment key={cat}>
                  <TableHead key={`${cat}-s`} className="text-center border text-[10px] md:text-xs px-1">
                    قيمة المبيعات
                  </TableHead>
                  <TableHead key={`${cat}-b`} className="text-center border text-[10px] md:text-xs px-1">
                    البونص
                  </TableHead>
                </Fragment>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {tiers.map((t, i) => (
              <TableRow key={t}>
                <TableCell className="text-center font-bold border bg-muted/30 whitespace-nowrap px-1 md:px-2">
                  {t}
                </TableCell>
                {categories.map((cat) => {
                  const row = grouped[cat].find((r) => r.tier === i + 1);
                  return (
                    <Fragment key={`${cat}-${i}`}>
                      <TableCell className="text-center border p-1">{renderCell(row, "sales_amount")}</TableCell>
                      <TableCell className="text-center border p-1">{renderCell(row, "bonus_amount")}</TableCell>
                    </Fragment>
                  );
                })}
              </TableRow>
            ))}
            <TableRow>
              <TableCell className="text-center font-bold border bg-muted/30 whitespace-nowrap px-1 md:px-2">
                أساسي
              </TableCell>
              {categories.map((cat) => (
                <TableCell key={cat} colSpan={2} className="text-center border font-semibold">
                  2,500
                </TableCell>
              ))}
            </TableRow>
          </TableBody>
        </Table>
        <p className="text-[10px] md:text-xs text-muted-foreground mt-3">
          * "أساسي" يمثل المرتب الأساسي الثابت لكل مرحلة. "البونص" يُحتسب عند بلوغ "قيمة المبيعات" المقابلة.
        </p>
      </CardContent>
    </Card>
  );
};

export default MonthlyTargetTable;
