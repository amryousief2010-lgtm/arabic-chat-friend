import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BONUS_MILESTONES, formatBonusEgp, moderatorKgBonus, moderatorSalary } from '@/lib/moderatorKgBonus';

const CHECKS = [400, 1000, 1500, 2000, 2500];

/** شرح ثابت للنظام المعتمد. تعديل الشرائح القديمة اتلغى عشان مايبقاش ليها أثر على القبض. */
const ProcessedKgBonusSettings = () => (
  <Card className="glass-card mb-6" dir="rtl">
    <CardHeader>
      <CardTitle className="text-sm md:text-base">نظام البونص المعتمد</CardTitle>
    </CardHeader>
    <CardContent className="space-y-3 text-sm leading-7">
      <p>
        البونص بقى معادلة واحدة على كيلوات المصنّعات المسلّمة. تحت ٤٠٠ كجم مفيش بونص،
        وعند ٤٠٠ يفتح بـ {formatBonusEgp(moderatorKgBonus(400))} جنيه. بعد كده بيزيد لحد الطن وطن ونص و٢ طن،
        وفوق الـ ٢ طن كل كيلو لسه بيزوّده. الأساسي الافتراضي ٢٬٥٠٠، وآية ٣٬٠٠٠ لو أساسيها محفوظ.
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {CHECKS.map((kg) => {
          const title = BONUS_MILESTONES.find((item) => item.kg === kg)?.title ?? `${formatBonusEgp(kg)} كجم`;
          return (
            <div key={kg} className="rounded-xl bg-[#F6ECF4] px-3 py-2 text-center">
              <div className="text-xs text-[#A4288A]">{title}</div>
              <div className="font-extrabold">{formatBonusEgp(moderatorKgBonus(kg))}</div>
              <div className="text-[11px] text-muted-foreground">مرتب {formatBonusEgp(moderatorSalary(kg, 2500))}</div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        جداول التارجت وشرائح المصنّعات القديمة محفوظة في قاعدة البيانات ومش بتتحسب في القبض المفتوح.
        لقطات الشهور المعتمدة متسيبة زي ما هي للإدارة.
      </p>
    </CardContent>
  </Card>
);

export default ProcessedKgBonusSettings;
