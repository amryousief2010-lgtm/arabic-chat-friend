import { Fragment, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Target } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { DEFAULT_BASE_SALARY } from "@/constants/moderators";

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

// صفوف إعداد بقيمة واحدة (tier 1 / bonus_amount) — نفس نمط "كتاكيت".
const BASE_CATEGORY = "أساسي";
const BONE_RATE_CATEGORY = "لحوم بالعظم/كجم";
const DEFAULT_BONE_RATE = 3.5;

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

  // حفظ قيمة واحدة (الأساسي): تحديث الصف لو موجود، وإلا إنشاؤه.
  const singleValueMutation = useMutation({
    mutationFn: async ({ category, value }: { category: string; value: number }) => {
      const existing = rows.find((r) => r.category === category && r.tier === 1);
      if (existing) {
        const { error } = await supabase
          .from("target_bonus_settings")
          .update({ bonus_amount: value })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("target_bonus_settings")
          .insert({ category, tier: 1, sales_amount: 0, bonus_amount: value });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["target_bonus_settings"] });
    },
    onError: (e: any) => {
      toast({ title: "تعذر الحفظ", description: e.message, variant: "destructive" });
    },
  });

  const baseRow = rows.find((r) => r.category === BASE_CATEGORY && r.tier === 1);
  const boneRow = rows.find((r) => r.category === BONE_RATE_CATEGORY && r.tier === 1);
  const baseSalary = baseRow ? Number(baseRow.bonus_amount) : DEFAULT_BASE_SALARY;
  const boneRate = boneRow ? Number(boneRow.bonus_amount) : DEFAULT_BONE_RATE;

  const renderSingleValue = (category: string, value: number, suffix: string) => {
    if (canEdit) {
      return (
        <div className="flex items-center justify-center gap-1">
          <Input
            key={`${category}-${value}`}
            type="number"
            step="any"
            min={0}
            defaultValue={value}
            className="h-8 text-center w-28 px-1 text-xs"
            onBlur={(e) => {
              const raw = e.target.value.trim();
              const v = Number(raw);
              if (raw === "" || !Number.isFinite(v) || v < 0) {
                e.target.value = String(value);
                return;
              }
              if (v !== value) singleValueMutation.mutate({ category, value: v });
            }}
          />
          {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
        </div>
      );
    }
    return <span>{fmt(value)}{suffix ? ` ${suffix}` : ""}</span>;
  };

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

  return (
    <Card className="glass-card mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 flex-wrap text-sm md:text-base">
          <Target className="w-5 h-5 text-primary" />
          المرتب الأساسي
          {canEdit && (
            <span className="text-xs font-normal text-muted-foreground mr-2">
              (اضغط على الخانة للتعديل)
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-2 md:p-4">
        <Table className="border w-full text-xs md:text-sm">
          <TableBody>
            <TableRow>
              <TableCell className="text-center font-bold border bg-muted/30 whitespace-nowrap px-1 md:px-2">
                أساسي افتراضي
              </TableCell>
              <TableCell className="text-center border font-semibold p-1">
                {renderSingleValue(BASE_CATEGORY, baseSalary, "ج")}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <p className="text-[10px] md:text-xs text-muted-foreground mt-3">
          الأساسي ده لكل مسوقة ما عدا اللي لها أساسي خاص محفوظ، زي آية ٣٬٠٠٠. التعديل يسري على الشهور المفتوحة فقط.
        </p>
        <details className="mt-3 rounded-xl border bg-muted/30 p-3">
          <summary className="cursor-pointer text-xs font-bold">أرشيف تارجت النظام السابق — مش بيتطبّق</summary>
          <p className="mt-2 text-[10px] text-muted-foreground">
            الأرقام دي محفوظة للمراجعة. القبض المفتوح مش بيقراها، ومفيش تعديل من هنا عشان محدّش يفتكر إنها لسه شغالة.
          </p>
          <Table className="mt-2 border w-full text-xs">
            <TableHeader>
              <TableRow>
                <TableHead className="border text-center">التارجت</TableHead>
                {categories.map((cat) => (
                  <Fragment key={cat}>
                    <TableHead className="border text-center">{cat} قيمة</TableHead>
                    <TableHead className="border text-center">{cat} بونص قديم</TableHead>
                  </Fragment>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {tiers.map((tier, index) => (
                <TableRow key={tier}>
                  <TableCell className="border text-center">{tier}</TableCell>
                  {categories.map((cat) => {
                    const row = grouped[cat].find((item) => item.tier === index + 1);
                    return (
                      <Fragment key={`${cat}-${index}`}>
                        <TableCell className="border text-center">{row ? fmt(row.sales_amount) : "—"}</TableCell>
                        <TableCell className="border text-center">{row ? fmt(row.bonus_amount) : "—"}</TableCell>
                      </Fragment>
                    );
                  })}
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="border text-center">لحوم بالعظم</TableCell>
                <TableCell className="border text-center" colSpan={categories.length * 2}>
                  {fmt(boneRate)} ج/كجم — متوقف
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </details>
      </CardContent>
    </Card>
  );
};

export default MonthlyTargetTable;
