import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { PROCESSED_SCHEDULES_KEY, useProcessedKgSchedules } from '@/hooks/useProcessedKgSchedules';
import {
  APPROVED_OCT_2026_SCHEDULE,
  MARGINAL_SCHEME_START,
  type BonusBand,
  type MarginalSchedule,
  bandsToJson,
  validateScheduleDraft,
} from '@/lib/processedKgBonus';

const monthNames = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

const labelOf = (iso: string) => {
  const [year, month] = iso.slice(0, 10).split('-').map(Number);
  return `${monthNames[(month || 1) - 1]} ${year}`;
};

const cloneBands = (bands: BonusBand[]): BonusBand[] => bands.map((band) => ({ ...band }));

const chainFrom = (bands: BonusBand[]): BonusBand[] => {
  let cursor = 0;
  return bands.map((band, index) => {
    const next = { ...band, fromKg: cursor };
    if (index === bands.length - 1) next.toKg = null;
    cursor = next.toKg ?? cursor;
    return next;
  });
};

const ProcessedKgBonusSettings = () => {
  const { role, isGeneralManager, isExecutiveManager, isSalesManager, user } = useAuth();
  const canEdit = isGeneralManager || isExecutiveManager || isSalesManager || role === 'marketing_sales_manager';
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, schedules, isError } = useProcessedKgSchedules();
  const saved = (data && data.length > 0 ? data : schedules) as MarginalSchedule[];
  const [selected, setSelected] = useState(saved[saved.length - 1]?.effectiveFrom || MARGINAL_SCHEME_START);
  const current = saved.find((row) => row.effectiveFrom === selected) || saved[saved.length - 1] || APPROVED_OCT_2026_SCHEDULE;
  const [minimumKg, setMinimumKg] = useState(current.minimumKg);
  const [bands, setBands] = useState<BonusBand[]>(cloneBands(current.bands));
  const [newMonth, setNewMonth] = useState(11);
  const [newYear, setNewYear] = useState(2026);

  useEffect(() => {
    setMinimumKg(current.minimumKg);
    setBands(cloneBands(current.bands));
  }, [current.effectiveFrom, current.minimumKg, current.bands]);

  const save = useMutation({
    mutationFn: async () => {
      const next = chainFrom(bands);
      const problem = validateScheduleDraft(minimumKg, next);
      if (problem) throw new Error(problem);
      if (!current.id) {
        const { error } = await supabase.from('processed_kg_bonus_schedules').insert({
          effective_from: current.effectiveFrom,
          minimum_kg: minimumKg,
          bands: bandsToJson(next),
          updated_by: user?.id ?? null,
        });
        if (error) throw error;
        return;
      }
      const { error } = await supabase
        .from('processed_kg_bonus_schedules')
        .update({ minimum_kg: minimumKg, bands: bandsToJson(next), updated_by: user?.id ?? null })
        .eq('id', current.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PROCESSED_SCHEDULES_KEY });
      toast({ title: 'تم حفظ شرائح المصنّعات' });
    },
    onError: (error: Error) => toast({ title: 'تعذر الحفظ', description: error.message, variant: 'destructive' }),
  });

  const createVersion = useMutation({
    mutationFn: async () => {
      const effective = `${newYear}-${String(newMonth).padStart(2, '0')}-01`;
      if (effective < MARGINAL_SCHEME_START) throw new Error('لا يمكن سريان الشرائح قبل أكتوبر 2026.');
      if (saved.some((row) => row.effectiveFrom === effective)) throw new Error('توجد نسخة لهذا الشهر بالفعل.');
      const next = chainFrom(bands);
      const problem = validateScheduleDraft(minimumKg, next);
      if (problem) throw new Error(problem);
      const { error } = await supabase.from('processed_kg_bonus_schedules').insert({
        effective_from: effective,
        minimum_kg: minimumKg,
        bands: bandsToJson(next),
        updated_by: user?.id ?? null,
      });
      if (error) throw error;
      return effective;
    },
    onSuccess: (effective) => {
      if (effective) setSelected(effective);
      queryClient.invalidateQueries({ queryKey: PROCESSED_SCHEDULES_KEY });
      toast({ title: 'أُضيفت نسخة جديدة', description: 'الأشهر السابقة تبقى على نسختها.' });
    },
    onError: (error: Error) => toast({ title: 'تعذر إنشاء النسخة', description: error.message, variant: 'destructive' }),
  });

  const updateTo = (index: number, value: string) => {
    setBands((prev) => {
      const next = cloneBands(prev);
      if (index === next.length - 1) return next;
      const parsed = Number(value);
      next[index].toKg = Number.isFinite(parsed) ? parsed : next[index].toKg;
      return chainFrom(next);
    });
  };

  return (
    <Card className="glass-card mb-6" dir="rtl">
      <CardHeader>
        <CardTitle className="text-sm md:text-base">حافز المصنّعات التراكمي</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-3 md:p-4 text-sm">
        <p className="text-xs leading-6 text-muted-foreground">
          من أكتوبر 2026 يُحسب كل كيلو مصنّعات بسعر الشريحة التي يقع فيها، من أول كيلو، بعد بلوغ الحد الأدنى. أقل من الحد: لا حافز مصنّعات. شهور ما قبل أكتوبر تبقى على جدول قيمة المبيعات أعلاه. اعتماد القبض يثبّت نتيجة الشهر ولا تُعاد كتابته.
        </p>
        {isError && (
          <p className="text-xs text-destructive">تعذر تحميل النسخ من قاعدة البيانات. الحساب يستخدم الجدول المعتمد حتى تتوفر الهجرة.</p>
        )}
        <div className="flex flex-wrap gap-2">
          {saved.map((row) => (
            <Button
              key={row.effectiveFrom}
              type="button"
              size="sm"
              variant={row.effectiveFrom === current.effectiveFrom ? 'default' : 'outline'}
              onClick={() => setSelected(row.effectiveFrom)}
            >
              من {labelOf(row.effectiveFrom)}
            </Button>
          ))}
        </div>
        <label className="flex items-center gap-2">
          <span className="whitespace-nowrap">الحد الأدنى (كجم)</span>
          <Input
            type="number"
            min={0}
            disabled={!canEdit}
            value={minimumKg}
            className="h-8 w-28"
            onChange={(event) => setMinimumKg(Number(event.target.value))}
          />
        </label>
        <div className="overflow-x-auto">
          <table className="w-full border text-xs">
            <thead>
              <tr className="bg-muted/40">
                <th className="border p-2">من كجم</th>
                <th className="border p-2">إلى كجم</th>
                <th className="border p-2">جنيه / كجم</th>
              </tr>
            </thead>
            <tbody>
              {bands.map((band, index) => (
                <tr key={`${band.fromKg}-${index}`}>
                  <td className="border p-2 text-center">{band.fromKg}</td>
                  <td className="border p-1 text-center">
                    {index === bands.length - 1 ? (
                      <span>فما فوق</span>
                    ) : (
                      <Input
                        type="number"
                        disabled={!canEdit}
                        value={band.toKg ?? ''}
                        className="h-8 text-center"
                        onChange={(event) => updateTo(index, event.target.value)}
                      />
                    )}
                  </td>
                  <td className="border p-1 text-center">
                    <Input
                      type="number"
                      min={0}
                      step="0.5"
                      disabled={!canEdit}
                      value={band.rate}
                      className="h-8 text-center"
                      onChange={(event) => {
                        const rate = Number(event.target.value);
                        setBands((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, rate } : item));
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
              حفظ هذه النسخة
            </Button>
            <span className="text-xs text-muted-foreground">نسخة جديدة من</span>
            <Input type="number" className="h-8 w-24" value={newYear} onChange={(event) => setNewYear(Number(event.target.value))} />
            <select
              className="h-8 rounded-md border bg-background px-2"
              value={newMonth}
              onChange={(event) => setNewMonth(Number(event.target.value))}
            >
              {monthNames.map((name, index) => (
                <option key={name} value={index + 1}>{name}</option>
              ))}
            </select>
            <Button type="button" size="sm" variant="outline" onClick={() => createVersion.mutate()} disabled={createVersion.isPending}>
              إضافة
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ProcessedKgBonusSettings;
