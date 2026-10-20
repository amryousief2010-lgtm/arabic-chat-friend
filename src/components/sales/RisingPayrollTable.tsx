import { formatBonusEgp, formatBonusKg } from '@/lib/moderatorKgBonus';

export interface RisingPayrollRow {
  girl: string;
  name: string;
  base: number;
  ownKg: number;
  carriedKg: number;
  countedKg: number;
  ownBonus: number;
  carriedBonus: number;
  deductions: number;
  total: number;
  overridden: boolean;
  qualified: boolean;
}

interface Props {
  rows: RisingPayrollRow[];
  canEdit?: boolean;
  locked?: boolean;
  onBonusCommit?: (girl: string, value: number | null) => void;
  onDeductionCommit?: (girl: string, value: number | null) => void;
  onOpenCarry?: (girl: string) => void;
  carryEnabled?: (girl: string) => boolean;
}

const cell = 'border px-2 py-2 text-center align-middle';
const label = 'border bg-[#F6ECF4] px-2 py-2 text-right font-bold whitespace-nowrap';

const RisingPayrollTable = ({
  rows,
  canEdit = false,
  locked = false,
  onBonusCommit,
  onDeductionCommit,
  onOpenCarry,
  carryEnabled,
}: Props) => {
  const editable = canEdit && !locked;
  const showCarry = rows.some((row) => row.carriedKg > 0 || row.carriedBonus > 0);

  return (
    <div data-testid="admin-bonus-payroll" dir="rtl">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm" style={{ fontFamily: 'Cairo, sans-serif', minWidth: 520 }}>
          <thead>
            <tr style={{ background: '#A4288A', color: 'white' }}>
              <th className="border border-white/20 px-2 py-2 text-right">البيان</th>
              {rows.map((row) => (
                <th key={row.girl} className="border border-white/20 px-2 py-2 text-center">{row.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className={label}>الراتب الأساسي</td>
              {rows.map((row) => <td key={row.girl} className={cell}>{formatBonusEgp(row.base)}</td>)}
            </tr>
            <tr>
              <td className={label}>كجم الشهر</td>
              {rows.map((row) => <td key={row.girl} className={cell}>{formatBonusKg(row.ownKg)}</td>)}
            </tr>
            {showCarry && (
              <tr>
                <td className={label}>كجم مرحّل</td>
                {rows.map((row) => (
                  <td key={row.girl} className={cell}>{row.carriedKg > 0 ? formatBonusKg(row.carriedKg) : '—'}</td>
                ))}
              </tr>
            )}
            <tr>
              <td className={label}>الكيلو المحسوب</td>
              {rows.map((row) => (
                <td key={row.girl} className={`${cell} font-bold`}>
                  {formatBonusKg(row.countedKg)}
                  <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">
                    {row.qualified ? 'البونص مفتوح' : 'لسه تحت ٤٠٠'}
                  </span>
                </td>
              ))}
            </tr>
            <tr style={{ background: '#FDE4D8' }}>
              <td className={label}>بونص كجم الشهر</td>
              {rows.map((row) => (
                <td key={row.girl} className={cell}>
                  {editable ? (
                    <input
                      type="number"
                      aria-label={`بونص ${row.name}`}
                      defaultValue={Math.round(row.ownBonus)}
                      key={`${row.girl}-bonus-${row.ownBonus}`}
                      className="h-8 w-24 rounded-md border px-1 text-center"
                      onBlur={(event) => {
                        const value = Number(event.target.value);
                        if (value !== Math.round(row.ownBonus)) onBonusCommit?.(row.girl, value);
                      }}
                    />
                  ) : (
                    <span className="font-bold" style={{ color: '#A4288A' }}>{formatBonusEgp(row.ownBonus)}</span>
                  )}
                  {row.overridden && <span className="mt-0.5 block text-[11px]">معدّل</span>}
                </td>
              ))}
            </tr>
            {showCarry && (
              <tr>
                <td className={label}>بونص المرحّل</td>
                {rows.map((row) => (
                  <td key={row.girl} className={cell}>
                    <button
                      type="button"
                      className="font-bold underline underline-offset-2 disabled:no-underline disabled:text-muted-foreground"
                      style={{ color: '#A4288A' }}
                      disabled={!(carryEnabled?.(row.girl))}
                      onClick={() => onOpenCarry?.(row.girl)}
                    >
                      {formatBonusEgp(row.carriedBonus)}
                    </button>
                  </td>
                ))}
              </tr>
            )}
            <tr>
              <td className={label}>إجمالي البونص</td>
              {rows.map((row) => (
                <td key={row.girl} className={`${cell} font-extrabold`} style={{ color: '#A4288A' }}>
                  {formatBonusEgp(row.ownBonus + row.carriedBonus)}
                </td>
              ))}
            </tr>
            <tr>
              <td className={label}>الخصومات</td>
              {rows.map((row) => (
                <td key={row.girl} className={cell}>
                  {editable ? (
                    <input
                      type="number"
                      min={0}
                      aria-label={`خصم ${row.name}`}
                      defaultValue={row.deductions ? Math.round(row.deductions) : ''}
                      placeholder="0"
                      key={`${row.girl}-deduction-${row.deductions}`}
                      className="h-8 w-24 rounded-md border px-1 text-center"
                      onBlur={(event) => {
                        const raw = event.target.value.trim();
                        const value = raw === '' ? null : Number(raw);
                        if ((value ?? 0) !== Math.round(row.deductions || 0)) onDeductionCommit?.(row.girl, value);
                      }}
                    />
                  ) : (
                    <span>{row.deductions ? formatBonusEgp(row.deductions) : '0'}</span>
                  )}
                </td>
              ))}
            </tr>
            <tr style={{ background: '#A4288A', color: 'white' }}>
              <td className="border border-white/20 px-2 py-3 text-right font-extrabold">إجمالي القبض</td>
              {rows.map((row) => (
                <td key={row.girl} className="border border-white/20 px-2 py-3 text-center text-lg font-extrabold">
                  {formatBonusEgp(row.total)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs leading-6 text-muted-foreground">
        البونص على كيلوات المصنّعات المسلّمة بنفس العدّ القديم: أوردرات الشهر، والكيلو المرحّل من شهر اتقيّد قبضه.
        تحت ٤٠٠ كجم البونص صفر، وعند ٤٠٠ يفتح بـ ٢٬٤٠٠ جنيه وبعدين بيزيد لحد الطن وطن ونص و٢ طن.
        فوق الـ ٢ طن كل كيلو لسه بيزوّد البونص. المرتب = الأساسي + البونص − الخصم.
        لحوم وعظم وكتاكيت وتارجت القيمة وبونص الفريق مش داخلين. الشهور المعتمدة القديمة متسيبة زي ما اتسجّلت.
      </p>
    </div>
  );
};

export default RisingPayrollTable;
