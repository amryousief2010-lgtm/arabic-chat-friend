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

  // حفظ قيمة واحدة (الأساسي / بونص اللحوم بالعظم لكل كجم): تحديث الصف لو موجود، وإلا إنشاؤه.
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
              <TableCell colSpan={categories.length * 2} className="text-center border font-semibold p-1">
                {renderSingleValue(BASE_CATEGORY, baseSalary, "ج")}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-center font-bold border bg-muted/30 whitespace-nowrap px-1 md:px-2">
                اللحوم بالعظم
              </TableCell>
              <TableCell colSpan={categories.length * 2} className="text-center border font-semibold p-1">
                {renderSingleValue(BONE_RATE_CATEGORY, boneRate, "ج/كجم")}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <p className="text-[10px] md:text-xs text-muted-foreground mt-3">
          * "أساسي" يمثل المرتب الأساسي الثابت لكل مسوقة ما عدا من لها أساسي خاص مثل آية 3,000. بونص اللحوم يُحتسب عند بلوغ قيمة المبيعات، وبونص اللحوم بالعظم {fmt(boneRate)} ج لكل كجم. أعمدة المصنعات هنا تبقى لحساب الشهور قبل أكتوبر 2026. من أكتوبر يُستخدم جدول الشرائح التراكمي أسفل هذه البطاقة. التعديل يسري على الشهور غير المعتمدة فقط.
        </p>
      </CardContent>
    </Card>
  );
};

export default MonthlyTargetTable;
