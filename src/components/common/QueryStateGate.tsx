import type { ReactNode } from 'react';
import { queryErrorMessage, type CombinedQueryState } from '@/lib/queryGuard';

interface Props {
  state: CombinedQueryState;
  children: ReactNode;
  loading?: ReactNode;
  errorTitle?: string;
}

/** يعرض المحتوى بس لما كل البيانات الأساسية توصل. عند الفشل: رسالة + زر إعادة المحاولة بدل الأصفار. */
const QueryStateGate = ({ state, children, loading, errorTitle = 'تعذّر تحميل الكميات' }: Props) => {
  if (state.isError) {
    const detail = queryErrorMessage(state.error);
    return (
      <div role="alert" dir="rtl" data-testid="query-state-error" className="rounded-3xl border border-[#F37346] bg-[#FFF4EF] p-5 text-center">
        <p className="font-bold text-[#A4288A]">{errorTitle}</p>
        <p className="mt-1 text-sm text-muted-foreground">الأرقام مش معروضة عشان متظهرش أصفار غلط.</p>
        {detail ? <p className="mt-1 text-xs text-muted-foreground" dir="auto">{detail}</p> : null}
        <button
          type="button"
          onClick={state.retry}
          className="mt-3 rounded-full bg-[#A4288A] px-5 py-2 text-sm font-bold text-white"
        >
          إعادة المحاولة
        </button>
      </div>
    );
  }
  if (!state.isReady) {
    return <>{loading ?? <div data-testid="query-state-loading" className="h-40 animate-pulse rounded-3xl bg-[#A4288A]/15" />}</>;
  }
  return <>{children}</>;
};

export default QueryStateGate;
