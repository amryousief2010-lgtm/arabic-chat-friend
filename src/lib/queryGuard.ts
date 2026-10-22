/**
 * حارس حالة الاستعلامات لشاشات البونص والتارجت.
 *
 * القاعدة: ممنوع تحويل استعلام لسه بيحمّل أو فشل إلى أصفار (`?? {}` / `= {}`).
 * الصفر رقم حقيقي بيتعرض للمسوقة كأنه مبيعاتها، فلازم الشاشة تعرض
 * «جاري التحميل» أو «تعذّر تحميل الكميات» بدل ما تعرض صفر.
 */
export interface GuardableQuery {
  isPending?: boolean;
  isLoading?: boolean;
  isError?: boolean;
  isSuccess?: boolean;
  data?: unknown;
  error?: unknown;
  refetch?: () => unknown;
}

export interface CombinedQueryState {
  /** لسه في استعلام أساسي ماوصلش بياناته. */
  isPending: boolean;
  /** استعلام أساسي فشل ومعندوش بيانات صالحة. */
  isError: boolean;
  /** كل الاستعلامات الأساسية وصلت بياناتها. */
  isReady: boolean;
  error: unknown;
  retry: () => void;
}

const hasData = (q: GuardableQuery) => q.data !== undefined || q.isSuccess === true;

/** يجمع حالة أكتر من استعلام أساسي. الاستعلام اللي عنده بيانات قديمة صالحة يُعتبر جاهز. */
export const combineQueryStates = (queries: Array<GuardableQuery | null | undefined>): CombinedQueryState => {
  const list = queries.filter(Boolean) as GuardableQuery[];
  const failed = list.filter((q) => q.isError && !hasData(q));
  const pending = list.filter((q) => !hasData(q) && !q.isError);
  return {
    isPending: failed.length === 0 && pending.length > 0,
    isError: failed.length > 0,
    isReady: failed.length === 0 && pending.length === 0,
    error: failed[0]?.error ?? null,
    retry: () => {
      list.forEach((q) => {
        if (!hasData(q) || q.isError) q.refetch?.();
      });
    },
  };
};

/**
 * يرجّع بيانات الاستعلام بس لو وصلت فعلًا. غير كده يرجّع null،
 * عشان المستدعي يضطر يتعامل مع حالة التحميل/الخطأ بدل ما ياخد أصفار.
 */
export const readyDataOrNull = <T>(q: { data?: T }): T | null => (q.data === undefined ? null : q.data);

export const queryErrorMessage = (error: unknown): string => {
  if (!error) return '';
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error && 'message' in error) return String((error as { message: unknown }).message);
  return String(error);
};
