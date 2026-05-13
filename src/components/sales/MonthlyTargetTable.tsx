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
      "لحوم بالعظم": [],
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
          className="h-8 text-center w-24 mx-auto"
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
        <CardTitle className="flex items-center gap-2">
          <Target className="w-5 h-5 text-primary" />
          جدول التارجت — التارجت الشهري لموديريتور نعام العاصمة
          {canEdit && (
            <span className="text-xs font-normal text-muted-foreground mr-2">
              (يمكنك تعديل القيم بالنقر على الخانة)
            </span>
          )}
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
                <Fragment key={t}>
                  <TableHead key={`${t}-s`} className="text-center border text-xs">قيمة المبيعات</TableHead>
                  <TableHead key={`${t}-b`} className="text-center border text-xs">مبلغ البونص</TableHead>
                </Fragment>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.map((cat) => (
              <TableRow key={cat}>
                <TableCell className="text-center font-bold border bg-muted/30">{cat}</TableCell>
                {Array.from({ length: 7 }).map((_, i) => {
                  const row = grouped[cat].find((r) => r.tier === i + 1);
                  return (
                    <Fragment key={i}>
                      <TableCell className="text-center border">{renderCell(row, "sales_amount")}</TableCell>
                      <TableCell className="text-center border">{renderCell(row, "bonus_amount")}</TableCell>
                    </Fragment>
                  );
                })}
              </TableRow>
            ))}
            <TableRow>
              <TableCell className="text-center font-bold border bg-muted/30">أساسي</TableCell>
              {tiers.map((t) => (
                <TableCell key={t} colSpan={2} className="text-center border font-semibold">
                  2,500
                </TableCell>
              ))}
            </TableRow>
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
