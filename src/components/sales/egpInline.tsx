import { formatBonusEgp } from '@/lib/moderatorKgBonus';

const isolate = { unicodeBidi: 'isolate' as const };

/** رقم معزول عشان ما ينعكسش وسط الجملة العربية. */
export const LtrNum = ({ value }: { value: string }) => (
  <bdi dir="ltr" className="tabular-nums" style={isolate}>{value}</bdi>
);

/**
 * «رقم ج» في عزل LTR.
 * من غيره الصفر في فقرة RTL يظهر «ج 0»، وحرف الجيم يتلخبط مع الأرقام اللي حواليه.
 */
export const EgpInline = ({ amount }: { amount: number }) => (
  <bdi
    dir="ltr"
    data-egp=""
    className="tabular-nums"
    style={{ ...isolate, whiteSpace: 'nowrap' }}
  >
    {formatBonusEgp(amount)} ج
  </bdi>
);

/** يلف كل عدد في النص بعنصر معزول من غير ما يغيّر حروف الجملة. */
export const IsolatedNumbers = ({ text }: { text: string }) => {
  const parts = text.split(/(\d[\d,]*(?:\.\d+)?)/g);
  return (
    <>
      {parts.map((part, index) => (
        /^\d/.test(part) ? <LtrNum key={`${index}-${part}`} value={part} /> : <span key={`${index}-t`}>{part}</span>
      ))}
    </>
  );
};
