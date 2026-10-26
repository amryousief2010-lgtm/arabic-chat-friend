export const PAY_DAYS = [1, 5, 15] as const;

/** تعديل يوم الصرف للمدير العام والمدير التنفيذي فقط */
export const canEditPayDay = (a: { isGeneralManager: boolean; isExecutiveManager: boolean }) =>
  a.isGeneralManager || a.isExecutiveManager;

/** الحقول المرسلة للحفظ: لا شيء لغير المخوّلين، والقيمة "auto" تعيد الحساب الآلي */
export function payDayPatch(
  allowed: boolean,
  choice: "auto" | number | undefined,
): { pay_day_manual?: boolean; pay_day?: number } {
  if (!allowed || choice === undefined) return {};
  if (choice === "auto") return { pay_day_manual: false };
  if (!PAY_DAYS.includes(choice as any)) return {};
  return { pay_day_manual: true, pay_day: choice };
}
